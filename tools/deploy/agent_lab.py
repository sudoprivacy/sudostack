#!/usr/bin/env python3
"""Prepare a fresh loopback-only Agent qualification lab. Never starts services."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
from urllib.parse import urlsplit

from agent_candidate import assemble
from artifacts import checksum


def write(path, value):
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def router_credential(path):
    try:
        router = json.loads(path.read_text())['auth_modes']['proxy']['sudorouter']
        endpoint, key = router['baseUrl'], router['apiKey']
        url = urlsplit(endpoint)
        if (url.scheme != 'https' or not url.hostname or url.username or url.password
                or url.query or url.fragment or not isinstance(key, str) or not key.strip()
                or any(char.isspace() for char in endpoint)):
            raise ValueError()
        return {'baseUrl': endpoint, 'apiKey': key}
    except (ValueError, KeyError, TypeError):
        raise ValueError('Invalid Router credential configuration') from None


def local_image(image, architecture):
    info = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image], text=True))[0]
    if info.get('Os') != 'linux' or info.get('Architecture') != architecture:
        raise ValueError('Lab images must match the candidate platform')
    return info['Id']


def prepare(candidate, output, router_path, model, postgres_image):
    if output.exists():
        raise ValueError('Use a new lab directory; existing state is never overwritten')
    if not model.strip() or len(model) > 200:
        raise ValueError('Specify a model identifier')
    if not re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', postgres_image):
        raise ValueError('PostgreSQL must use a previously pulled immutable image digest')
    # Reverify the actual five archives; a saved aggregate alone is insufficient.
    manifest = assemble(candidate)
    architecture = manifest['images']['moss']['architecture']
    images = {}
    for name, record in manifest['images'].items():
        image_id = local_image(record['image'], architecture)
        if image_id != record['image_config_digest']:
            raise ValueError('Load the verified candidate image: ' + name)
        images[name] = image_id
    pg_id = local_image(postgres_image, architecture)
    router = router_credential(router_path)
    output.mkdir(mode=0o700, parents=True)
    for directory in ('moss/config', 'moss/data', 'moss/secrets', 'registry/secrets',
                      'registry/data', 'provider/secrets', 'provider/data', 'postgres', 'webui', 'runtime'):
        (output / directory).mkdir(mode=0o700, parents=True, exist_ok=True)
    for directory in output.rglob('*'):
        if directory.is_dir():
            directory.chmod(0o700)
    token, admin_password = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    provider_token, pg_password = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    write(output / 'registry/secrets/token', token)
    write(output / 'moss/secrets/registry-token', token)
    signing = output / 'registry/secrets/signing.pem'
    subprocess.run(['openssl', 'genpkey', '-algorithm', 'ED25519', '-out', str(signing)], check=True)
    signing.chmod(0o600)
    public = subprocess.check_output(['openssl', 'pkey', '-in', str(signing), '-pubout'], text=True)
    write(output / 'moss/config/registry.json', {
        'endpoint': 'http://127.0.0.1:22139', 'tokenFile': '/lab/secrets/registry-token',
        'publicKeys': [public], 'organizations': {'lab-bootstrap-pending': {'trustDomain': 'agents.lab.sudo', 'zoneId': 'zone-1'}}})
    write(output / 'moss/config/server.json', {
        'server': {'host': '0.0.0.0', 'port': 43134, 'publicBaseUrl': 'http://127.0.0.1:43134'},
        'bootstrapAdmin': {'username': 'agent-lab-admin', 'password': admin_password, 'email': 'agent-lab-admin@example.test'},
        'storage': {'rootDir': '/lab/data', 'dbPath': '/lab/data/moss.db',
                    'transcriptDir': '/lab/data/transcripts', 'runtimeDir': '/lab/data/runtime'}})
    write(output / 'admin-login.json', {'username': 'agent-lab-admin', 'password': admin_password})
    write(output / 'provider/secrets/client.token', provider_token)
    write(output / 'provider/secrets/router.json', {'auth_modes': {'proxy': {'sudorouter': router}}})
    write(output / 'provider/provider.json', {
        'host': '127.0.0.1', 'port': 28094, 'database_file': '/lab/data/provider.sqlite',
        'router_config_file': '/lab/secrets/router.json', 'allowed_router_endpoints': [router['baseUrl']],
        'clients': [{'id': 'moss-lab', 'token_file': '/lab/secrets/client.token', 'agent_ids': ['review-assistant']}],
        'definitions': [{'external_agent_id': 'review-assistant', 'name': 'Candidate review assistant',
                         'system_prompt': 'Answer synthetic test questions concisely. Do not request sensitive data.',
                         'router_endpoint': router['baseUrl'], 'model': model, 'max_output_tokens': 512}], 'concurrency': 2})
    provider_uid = os.getuid() or 10001
    if os.geteuid() == 0:
        for path in [output / 'provider', *(output / 'provider').rglob('*')]:
            os.chown(path, provider_uid, provider_uid)
    write(output / 'postgres/password', pg_password)
    write(output / 'webui/runtime.env', '\n'.join([
        'NODE_ENV=development', 'PORT=26834', 'PUBLIC_ORIGIN=http://127.0.0.1:26834',
        'MOSS_BASE_URL=http://127.0.0.1:43134', 'MOSS_WS_BASE_URL=ws://127.0.0.1:43134',
        'DATABASE_URL=postgresql://agent_lab:' + pg_password + '@database:5432/agent_lab',
        'SESSION_HMAC_KEY=' + secrets.token_hex(32), 'TOKEN_AES_KEY=' + secrets.token_hex(32), '']))
    shutil.copyfile(Path(__file__).parent / 'agent-lab/registry.py', output / 'registry/entrypoint.py')
    common = {'restart': 'no', 'security_opt': ['no-new-privileges:true'],
              'logging': {'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '2'}}}
    def service(image, **options):
        return {**common, 'image': image, 'pull_policy': 'never', **options}
    compose = {'services': {
        'runtime': service(images['nexus-runtime'], volumes=['./runtime:/data/nexus'],
                           ports=['127.0.0.1:43134:43134', '127.0.0.1:26834:26834']),
        'database': service(pg_id, environment={'POSTGRES_USER': 'agent_lab', 'POSTGRES_DB': 'agent_lab',
                                               'POSTGRES_PASSWORD_FILE': '/run/secrets/password'},
                            volumes=['database:/var/lib/postgresql/data', './postgres/password:/run/secrets/password:ro'],
                            healthcheck={'test': ['CMD-SHELL', 'pg_isready -U agent_lab -d agent_lab'], 'interval': '3s', 'timeout': '3s', 'retries': 30}),
        'registry': service(images['product-registry'], network_mode='service:runtime',
                            environment={'HOME': '/lab/data', 'REDACT_API_KEY_IN_LOGS': 'true'},
                            entrypoint=['python', '/lab/entrypoint.py'], volumes=['./registry:/lab']),
        'moss': service(images['moss'], network_mode='service:runtime', volumes=['./moss:/lab'],
                        environment={'CLAUDE_CONFIG_DIR': '/lab/data', 'MOSS_SERVER_CONFIG': '/lab/config/server.json',
                                     'MOSS_INSTANCE_ID': 'agent-candidate-lab', 'MOSS_NEXUS_MODE': 'external',
                                     'MOSS_NEXUS_ENDPOINT': 'http://127.0.0.1:2126',
                                     'MOSS_AGENT_REGISTRY_CONFIG_FILE': '/lab/config/registry.json'}),
        'provider': service(images['http-provider'], network_mode='service:runtime',
                            user=f'{provider_uid}:{provider_uid}', read_only=True, cap_drop=['ALL'], tmpfs=['/tmp'],
                            entrypoint=['node', '/app/http-agent-provider.mjs', '/lab/provider.json'],
                            volumes=['./provider:/lab'], mem_limit='512m', cpus=1),
        'webui': service(images['webui'], network_mode='service:runtime', env_file=['./webui/runtime.env'],
                         depends_on={'database': {'condition': 'service_healthy'}}),
    }, 'volumes': {'database': {}}}
    write(output / 'compose.json', compose)
    # Receipt excludes credentials and their hashes. It binds public inputs only.
    write(output / 'lab-inputs.json', {'kind': 'AgentCandidateLabInputs', 'candidate_lock_sha256': manifest['candidate_lock_sha256'],
          'images': images, 'postgres_image': postgres_image, 'postgres_config_digest': pg_id,
          'entrypoint_sha256': checksum(output / 'registry/entrypoint.py'), 'compose_sha256': checksum(output / 'compose.json'),
          'scope': 'synthetic loopback lab; not production TLS, HA, desktop signing or migration acceptance'})


def bind_organization(output, org_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', org_id) or org_id == 'lab-bootstrap-pending':
        raise ValueError('Provide the actual organization ID returned by authenticated Moss')
    path = output / 'moss/config/registry.json'
    value = json.loads(path.read_text())
    if set(value['organizations']) != {'lab-bootstrap-pending'}:
        raise ValueError('Lab organization already bound; no implicit authority remapping')
    value['organizations'] = {org_id: value['organizations']['lab-bootstrap-pending']}
    write(path, value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare_args = commands.add_parser('prepare')
    for name in ('candidate', 'output', 'router-config'):
        prepare_args.add_argument('--' + name, required=True, type=Path)
    prepare_args.add_argument('--model', required=True)
    prepare_args.add_argument('--postgres-image', required=True)
    bind_args = commands.add_parser('bind-organization')
    bind_args.add_argument('--output', required=True, type=Path)
    bind_args.add_argument('--organization-id', required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.candidate, args.output, args.router_config, args.model, args.postgres_image)
    else:
        bind_organization(args.output, args.organization_id)
    print('Lab configuration prepared. No service was started or migrated.')


if __name__ == '__main__':
    main()
