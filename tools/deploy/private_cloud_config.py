"""Consume the existing Cloud local-runtime projection from a trusted desktop.

This module does not authenticate a human or grant local execution. The native
desktop must obtain a fresh projection from the selected account's existing
authenticated /api/v1/client/local-runtime endpoint and keep its human bearer.
Only the model account enters SudoCode configuration. No network calls occur.
"""
import json
import os
from pathlib import Path
import shutil
import tempfile
from urllib.parse import urlsplit


MAX_PROJECTION_BYTES = 512 * 1024


def read_projection(stream, *, user_id, organization_id):
    raw = stream.read(MAX_PROJECTION_BYTES + 1)
    if len(raw) > MAX_PROJECTION_BYTES:
        raise ValueError('Cloud model configuration is too large')
    try:
        projection = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ValueError('Cloud model configuration is not valid JSON') from None
    return configuration(projection, user_id=user_id, organization_id=organization_id)


def configuration(projection, *, user_id, organization_id):
    """Validate the original projection; never infer grants from a model list."""
    def text(value):
        return (isinstance(value, str) and 0 < len(value) <= 4096
                and value == value.strip() and not any(ord(c) < 32 or ord(c) == 127 for c in value))

    if not text(user_id) or not text(organization_id) or not isinstance(projection, dict):
        raise ValueError('A current Cloud account and organization are required')
    execution, runtime = projection.get('execution'), projection.get('localRuntime')
    if not isinstance(execution, dict) or execution.get('isLocalAllowed') is not True:
        raise ValueError('This Cloud account does not currently allow local execution')
    if not isinstance(runtime, dict) or runtime.get('status') != 'ready':
        raise ValueError('Cloud model access is not ready; finish account setup in the existing web UI')
    if runtime.get('userId') != user_id or runtime.get('organizationId') != organization_id:
        raise ValueError('Cloud model configuration belongs to a different account or organization')
    models, selected = projection.get('models'), projection.get('scode_auto_model')
    if (not isinstance(models, list) or not models or len(models) > 10000
            or not all(text(model) for model in models) or not text(selected) or selected not in models):
        raise ValueError('Cloud must select an available model for the bootstrap Agent')
    endpoint, key = projection.get('model_service_url'), projection.get('sudorouter_key')
    if not text(key) or any(c.isspace() for c in key):
        raise ValueError('Cloud did not provide a usable model credential')
    if not text(endpoint) or any(c.isspace() for c in endpoint):
        raise ValueError('Cloud did not provide a valid model endpoint')
    try:
        parsed = urlsplit(endpoint)
        valid_port = parsed.port is None or 0 < parsed.port < 65536
    except ValueError:
        raise ValueError('Cloud did not provide a valid model endpoint') from None
    if (parsed.scheme != 'https' or not parsed.hostname or not valid_port or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment or '\\' in endpoint
            or parsed.path.rstrip('/').endswith(('/messages', '/responses', '/chat/completions'))):
        raise ValueError('Cloud must provide an HTTPS model API root without credentials or a query')
    # Match the qualified first-run wizard: SudoCode owns model capabilities and
    # protocol discovery. Do not copy the older frontend's model-name heuristics.
    account = {'auth_modes': {'proxy': {'sudorouter': {
        'baseUrl': endpoint.rstrip('/'), 'apiKey': key}}}}
    settings = {'auth_profile': 'sudorouter', 'model': selected}
    # Provenance for avoiding accidental account replacement, not an identity or
    # entitlement database. Only the login authority can authorize this account.
    provenance = {'schemaVersion': 1, 'userId': user_id, 'organizationId': organization_id}
    return {'sudocode.json': account, 'settings.json': settings, 'cloud-account.json': provenance}


def install_configuration(directory, files):
    """Publish a complete first-login config, or accept an identical retry.

    Existing or changed account configuration is never replaced by this bootstrap
    entry. Refresh/logout/account switching belong to the native login owner.
    """
    directory = Path(directory)
    if directory.is_symlink():
        raise ValueError('Refusing redirected model configuration')
    payloads = {name: (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
                for name, value in files.items()}
    if directory.exists():
        same = directory.is_dir() and all(
            (directory / name).is_file() and not (directory / name).is_symlink()
            and (directory / name).read_bytes() == payload for name, payload in payloads.items())
        if same:
            return
        raise ValueError('Existing model configuration was preserved; use the desktop account transition')
    # Atomic directory publication prevents a partial account/settings pair from
    # looking configured after an interruption. Stage only inside the owned root.
    temporary = Path(tempfile.mkdtemp(prefix='.cloud-config-', dir=directory.parent))
    try:
        temporary.chmod(0o700)
        for name, payload in payloads.items():
            target = temporary / name
            with target.open('xb') as stream:
                target.chmod(0o600)
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        temporary.rename(directory)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
