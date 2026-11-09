"""Use Moss's authenticated control API without logging credentials or responses."""
import json
from urllib.parse import quote, urlsplit
import urllib.error
import urllib.request


class MossControlError(RuntimeError):
    """A sanitized failure with an explicit startup-retry classification."""

    def __init__(self, message, retryable=False):
        super().__init__(message)
        self.retryable = retryable


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Credentials must stay on the explicitly selected control origin."""

    def redirect_request(self, *unused, **ignored):
        return None


class MossControl:
    """Shared host controller client; secrets remain owned by Moss/Nexus Vault."""

    def __init__(self, origin, opener=None):
        parsed = urlsplit(origin)
        if (parsed.scheme not in ('https', 'http') or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ('', '/')
                or (parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', '::1'))):
            raise ValueError('Moss control requires HTTPS or a literal loopback HTTP origin')
        self.origin = origin.rstrip('/')
        self.token = None
        self.opener = opener or urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, body=None, method=None):
        if not path.startswith('/api/v1/') or urlsplit(path).netloc or '#' in path:
            raise ValueError('Expected a relative Moss control API path')
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        request = urllib.request.Request(self.origin + path, headers=headers,
            data=None if body is None else json.dumps(body).encode(), method=method)
        try:
            with self.opener.open(request, timeout=15) as response:
                raw = response.read(1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            # Neither the response body nor request content is safe to report.
            code = error.code
            error.close()
            raise MossControlError('Moss control request failed: HTTP ' + str(code),
                retryable=code in (502, 503, 504)) from None
        except (OSError, urllib.error.URLError):
            raise MossControlError('Moss control connection unavailable', retryable=True) from None
        try:
            if len(raw) > 1024 * 1024:
                raise ValueError()
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            raise RuntimeError('Moss control returned an invalid response') from None
        if value.get('success') is False:
            raise RuntimeError('Moss control rejected the request')
        return value

    def login(self, credentials, organization_id):
        """Pin the response to the intended organization before any secret read."""
        self.token = None
        if not isinstance(organization_id, str) or not organization_id:
            raise ValueError('An explicit Moss organization is required')
        value = self.request('/api/v1/auth/login',
            {'grant_type': 'password', 'username': credentials['username'], 'password': credentials['password']})
        if (not isinstance(value.get('access_token'), str) or not value['access_token']
                or not isinstance(value.get('organization'), dict)
                or value['organization'].get('id') != organization_id):
            raise RuntimeError('Moss login did not select the intended organization')
        self.token = value['access_token']

    def secret(self, namespace, key):
        """Read an enabled, nonempty value through the existing audited Vault API."""
        if not self.token:
            raise RuntimeError('Authenticate before reading Moss secrets')
        if not namespace.startswith('system:') or not key:
            raise ValueError('Expected an organization-scoped system secret reference')
        value = self.request('/api/v1/secrets/' + quote(namespace, safe='') + '/' + quote(key, safe=''))
        data = value.get('data')
        if (value.get('success') is not True or not isinstance(data, dict)
                or data.get('status') != 'enabled' or not isinstance(data.get('value'), str)
                or not data['value'].strip()):
            raise RuntimeError('The selected Moss secret is absent, disabled or invalid')
        return data['value']
