#!/usr/bin/env python3
"""Explicit source-checkout deployment for the bounded Agent management lab.

The input is an operator-owned private JSON file. Nothing is installed, migrated,
started or published by `check`. Existing databases are never initialized at startup.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

REQUIRED_ENV = {
    'moss': {'MOSS_SERVER_CONFIG', 'MOSS_AGENT_REGISTRY_CONFIG_FILE',
             'MOSS_AGENT_HOSTED_CONFIG_FILE', 'MOSS_AGENT_HOSTED_TASKS_ENABLED',
             'MOSS_AGENT_EXTERNAL_TASK_CONTEXT_ORIGIN', 'MOSS_NEXUS_MODE',
             'MOSS_NEXUS_ENDPOINT', 'MOSS_AUTH_PROXY_PORT', 'MOSS_INSTANCE_ID',
             'MOSS_PUBLIC_BASE_URL'},
    'webui': {'CONFIG_PATH', 'DATABASE_URL', 'NODE_ENV', 'SESSION_HMAC_KEY', 'TOKEN_AES_KEY'},
}
OPTIONAL_ENV = {'moss': {'MOSS_AGENT_DISCOVERY_ORIGINS'}, 'webui': set()}


def read_json(path, private=False):
    path = Path(path)
    if not path.is_absolute() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError('Expected an absolute configuration file (at most 1 MiB)')
    if private and path.stat().st_mode & 0o077:
        raise ValueError('Private configuration must be owner-readable only')
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError('Expected a JSON object')
    return value


def secret(path):
    p = Path(path)
    if not p.is_absolute() or not p.is_file() or p.stat().st_mode & 0o077 or p.stat().st_size > 16384:
        raise ValueError('Expected an owner-readable private credential file')
    value = p.read_text().strip()
    if not value:
        raise ValueError('Empty private credential file')
    return value


def loopback_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'}
            or parsed.username or parsed.password or parsed.path not in {'', '/'}
            or parsed.query or parsed.fragment or not parsed.port):
        raise ValueError('This qualification launcher requires a loopback HTTP origin')


def source_paths(config):
    if set(config.get('sources', {})) != {'moss', 'work', 'nexus', 'stack'}:
        raise ValueError('All four source checkouts and exact revisions are required')
    result = {}
    for name, item in config['sources'].items():
        if set(item) != {'path', 'revision'} or not re.fullmatch('[0-9a-f]{40}', item['revision']):
            raise ValueError('Each source requires an exact full commit')
        path = Path(item['path'])
        if not path.is_absolute() or not path.is_dir():
            raise ValueError('Missing source checkout: ' + name)
        actual = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
        dirty = subprocess.check_output(['git', '-C', str(path), 'status', '--porcelain', '--untracked-files=no'], text=True)
        if actual != item['revision'] or dirty:
            raise ValueError('Source checkout differs from recorded revision: ' + name)
        result[name] = path
    expected = result['stack'] / 'tools/deploy/agent_management.py'
    if expected.resolve() != Path(__file__).resolve():
        raise ValueError('Run the launcher from the recorded Stack checkout')
    return result


def service_environment(config, service):
    record = config['services'][service]
    if set(record) != {'env', 'secret_files'} or not isinstance(record['env'], dict) or not isinstance(record['secret_files'], dict):
        raise ValueError('Service requires env and secret_files maps')
    values = record['env']
    refs = record['secret_files']
    if set(values) & set(refs):
        raise ValueError('Duplicate environment key')
    allowed = REQUIRED_ENV[service] | OPTIONAL_ENV[service]
    if not REQUIRED_ENV[service] <= values.keys() | refs.keys() or (values.keys() | refs.keys()) - allowed:
        raise ValueError('Missing or unsupported service environment keys')
    if any(not isinstance(v, str) or '\x00' in v for v in values.values()):
        raise ValueError('Environment values must be strings')
    private_keys = {'DATABASE_URL', 'SESSION_HMAC_KEY', 'TOKEN_AES_KEY'}
    if values.keys() & private_keys or refs.keys() - private_keys:
        raise ValueError('Credentials must use private file references')
    env = dict(values, **{k: secret(v) for k, v in refs.items()})
    if service == 'moss':
        if env['MOSS_AGENT_HOSTED_TASKS_ENABLED'] != '1' or env['MOSS_NEXUS_MODE'] != 'external':
            raise ValueError('Hosted tasks and the explicit external Nexus binding are required')
        for key in ('MOSS_PUBLIC_BASE_URL', 'MOSS_AGENT_EXTERNAL_TASK_CONTEXT_ORIGIN', 'MOSS_NEXUS_ENDPOINT'):
            loopback_origin(env[key])
        if env['MOSS_AGENT_EXTERNAL_TASK_CONTEXT_ORIGIN'] != env['MOSS_PUBLIC_BASE_URL']:
            raise ValueError('Task gateway and Moss origin must match in this local topology')
        for key in ('MOSS_SERVER_CONFIG', 'MOSS_AGENT_REGISTRY_CONFIG_FILE', 'MOSS_AGENT_HOSTED_CONFIG_FILE'):
            read_json(env[key], private=True)
        app = read_json(env['MOSS_SERVER_CONFIG'], private=True)
        origin = env['MOSS_PUBLIC_BASE_URL']
    else:
        if env['NODE_ENV'] != 'development':
            raise ValueError('Loopback HTTP lab requires the explicit development cookie profile')
        app = read_json(env['CONFIG_PATH'], private=True)
        origin = app.get('publicOrigin', '')
        loopback_origin(origin)
    server = app.get('server', {})
    if server.get('host') != '127.0.0.1' or server.get('port') != urlsplit(origin).port:
        raise ValueError('Application bind address must match the declared loopback origin')
    return env


def registry_configuration(config):
    r = config['services']['registry']
    required = {'python', 'database_url_file', 'signing_key_file', 'token_file', 'domain_zones',
                'inventory_zone_domains', 'attestors', 'execution_policy_file', 'vfs', 'host', 'port'}
    if set(r) != required or r['host'] != '127.0.0.1' or type(r['port']) is not int or not 1024 <= r['port'] <= 65535:
        raise ValueError('Invalid loopback Registry configuration')
    if not Path(r['python']).is_absolute() or not os.access(r['python'], os.X_OK):
        raise ValueError('Missing prepared Python environment')
    for key in ('database_url_file', 'signing_key_file', 'token_file'):
        secret(r[key])
    if not isinstance(r['domain_zones'], dict) or not r['domain_zones']:
        raise ValueError('Registry domain and Zone mappings are required')
    if not isinstance(r['inventory_zone_domains'], dict) or set(r['inventory_zone_domains'].values()) - {'office', 'core'}:
        raise ValueError('Invalid domain policy')
    if set(r['domain_zones'].values()) != set(r['inventory_zone_domains']):
        raise ValueError('Every Zone requires a domain policy')
    if not isinstance(r['attestors'], list) or any(not isinstance(v, str) or not v for v in r['attestors']):
        raise ValueError('Attestors must be explicit operator identities')
    read_json(r['execution_policy_file'], private=True)
    vfs = r['vfs']
    if set(vfs) != {'endpoint', 'tls', 'known_zones'} or set(vfs['tls']) != {'ca', 'cert', 'key'}:
        raise ValueError('VFS requires an explicit mutual TLS binding')
    u = urlsplit(vfs['endpoint'])
    if u.scheme != 'https' or not u.hostname or not u.port or u.username or u.password or u.path or u.query or u.fragment:
        raise ValueError('VFS endpoint must use TLS')
    for key in ('ca', 'cert', 'key'):
        p = Path(vfs['tls'][key])
        if not p.is_absolute() or not p.is_file():
            raise ValueError('Missing prepared VFS TLS material')
    secret(vfs['tls']['key'])
    if not Path(vfs['known_zones']).is_absolute():
        raise ValueError('Known Zones store must have an absolute path')
    return r


def validate(config):
    if set(config) != {'schema_version', 'scope', 'sources', 'services'} or type(config['schema_version']) is not int or config['schema_version'] != 1 or config['scope'] != 'synthetic':
        raise ValueError('Only the explicit synthetic qualification profile is supported')
    if set(config['services']) != {'moss', 'webui', 'registry'}:
        raise ValueError('All three application services are required')
    sources = source_paths(config)
    envs = {name: service_environment(config, name) for name in REQUIRED_ENV}
    registry_configuration(config)
    for path in (sources['moss'] / 'bin/moss-server.mjs', sources['work'] / 'apps/webui/dist/server/index.js'):
        if not path.is_file():
            raise ValueError('Build the recorded source before deployment: ' + str(path))
    return sources, envs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check', 'run-moss', 'run-webui', 'run-registry', 'initialize-registry'])
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    config = read_json(args.config, private=True)
    sources, envs = validate(config)
    if args.command == 'check':
        print(json.dumps({'scope': 'synthetic', 'sources': {n: config['sources'][n]['revision'] for n in sources},
                          'configuration_sha256': hashlib.sha256(args.config.read_bytes()).hexdigest(),
                          'configuration_valid': True, 'runtime_acceptance': False, 'offline_acceptance': False}, indent=2))
        return
    # Do not inherit unrelated credentials or optional application feature switches.
    env = {k: v for k, v in os.environ.items() if k in {'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'DOCKER_HOST', 'DOCKER_CONTEXT'}}
    if args.command in {'run-registry', 'initialize-registry'}:
        env['PYTHONPATH'] = str(sources['nexus'] / 'src')
        entry = sources['stack'] / 'tools/deploy/agent-lab/management_registry.py'
        argv = [config['services']['registry']['python'], str(entry), '--config', str(args.config)]
        if args.command == 'initialize-registry':
            argv.append('--initialize-schema')
        os.execvpe(argv[0], argv, env)
    name = args.command.removeprefix('run-')
    env.update(envs[name])
    cwd = sources['moss'] if name == 'moss' else sources['work'] / 'apps/webui'
    os.chdir(cwd)
    argv = ['node', 'bin/moss-server.mjs' if name == 'moss' else 'dist/server/index.js']
    os.execvpe(argv[0], argv, env)


if __name__ == '__main__':
    main()
