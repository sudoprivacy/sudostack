#!/usr/bin/env python3
"""Collect bounded, credential-redacted logs for installation qualification."""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess


def kube(*args, input=None):
    result = subprocess.run(['k3s', 'kubectl', *args], text=True, input=input,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=45)
    if result.returncode:
        raise RuntimeError(result.stdout)
    return result.stdout


def redact(text, credentials):
    for value in sorted(set(credentials), key=len, reverse=True):
        if len(value) >= 6:
            text = text.replace(value, '[REDACTED]')
    text = re.sub(r'-----BEGIN [^-]+-----.*?-----END [^-]+-----',
                  '[REDACTED PEM]', text, flags=re.DOTALL)
    text = re.sub(r'(?im)((?:set-cookie|cookie)["\']?\s*[:=]\s*)[^\r\n]+',
                  r'\1[REDACTED]', text)
    text = re.sub(r'(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+', r'\1[REDACTED]', text)
    text = re.sub(r'([a-z]+://[^\s?"\']+)\?[^\s"\']+', r'\1?[REDACTED]', text)
    text = re.sub(r'([a-z]+://)[^\s/@]+:[^\s/@]+@', r'\1[REDACTED]@', text)
    text = re.sub(r'(?i)((?:password|token|api[_-]?key|secret|authorization)'
                  r'["\']?\s*[:=]\s*["\']?)[^\s,"\'}]+', r'\1[REDACTED]', text)
    return text


def collect(output):
    output.mkdir(parents=True, exist_ok=True)
    credentials = []
    pods = {}
    # Fail closed before reading logs if credentials cannot be obtained.
    for namespace in ('atlas-system', 'moss-sessions'):
        secrets = json.loads(kube('-n', namespace, 'get', 'secrets', '-o', 'json'))
        for secret in secrets['items']:
            for value in secret.get('data', {}).values():
                credentials.extend((value, base64.b64decode(value).decode('utf-8', errors='replace')))
        pods[namespace] = json.loads(kube('-n', namespace, 'get', 'pods', '-o', 'json'))['items']
    for namespace, items in pods.items():
        for pod in items:
            name = pod['metadata']['name']
            for container in pod['spec'].get('containers', []) + pod['spec'].get('initContainers', []):
                for previous in (False, True):
                    filename = f'{namespace}-{name}-{container["name"]}' + ('-previous' if previous else '') + '.log'
                    args = ['-n', namespace, 'logs', name, '-c', container['name'],
                            '--timestamps', '--tail=1200', '--limit-bytes=524288']
                    if previous:
                        args.append('--previous')
                    try:
                        text = kube(*args)
                    except (RuntimeError, subprocess.TimeoutExpired) as error:
                        text = str(error)
                    (output / filename).write_text(redact(text, credentials))
    state_failed = False
    try:
        state = kube('-n', 'atlas-system', 'exec', '-i', 'deployment/moss-server',
                     '-c', 'server', '--', 'node', '-',
                     input=Path(__file__).with_name('moss-diagnostics.cjs').read_text())
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        state_failed = True
        state = str(error)
    (output / 'moss-runtime-state.log').write_text(redact(state, credentials))
    if state_failed:
        raise RuntimeError('Moss recovery diagnostics failed; see moss-runtime-state.log')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    collect(parser.parse_args().output)
