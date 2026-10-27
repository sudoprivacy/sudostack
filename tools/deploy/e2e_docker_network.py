"""Allocate an owned, explicit subnet from Docker's available address pools."""
import ipaddress
import json
import re
import subprocess

LABEL = 'com.sudoprivacy.acceptance'


class NetworkCommandError(RuntimeError):
    pass


def _docker(*arguments):
    result = subprocess.run(['docker', *arguments], capture_output=True, text=True,
                            encoding='utf-8', timeout=60)
    if result.returncode:
        raise NetworkCommandError('docker ' + ' '.join(arguments) + ': ' + result.stderr.strip())
    return result.stdout.strip()


def _owned(identifier, label):
    assert re.fullmatch('[a-f0-9]{64}', identifier)
    current = json.loads(_docker('network', 'inspect', identifier))[0]
    if current['Id'] != identifier or current['Labels'].get(LABEL) != label:
        raise ValueError('Network ownership differs from the acceptance run: ' + identifier)
    return current


def remove_owned_network(network, label):
    """Remove only the exact network whose ownership was verified."""
    _owned(network['id'], label)
    _docker('network', 'rm', network['id'])


def create_owned_network(name, label):
    """Select through IPAM, then configure the selected subnet for static endpoints."""
    for attempt in range(3):
        probe = _docker('network', 'create', '--label', LABEL + '=' + label, name + '-ipam-' + str(attempt))
        current = _owned(probe, label)
        try:
            config = next(item for item in current['IPAM']['Config']
                          if ipaddress.ip_network(item['Subnet']).version == 4)
            subnet = ipaddress.ip_network(config['Subnet'])
            gateway = config['Gateway']
            address = str(next(item for item in subnet.hosts() if str(item) != gateway))
        finally:
            remove_owned_network({'id': probe}, label)
        try:
            identifier = _docker('network', 'create', '--label', LABEL + '=' + label,
                                 '--subnet', str(subnet), '--gateway', gateway, name)
        except NetworkCommandError as error:
            # A concurrent allocator may acquire the released pool. Ask IPAM
            # for another pool; operational and authorization errors propagate.
            if 'pool overlaps' in str(error).lower():
                continue
            raise
        network = {'id': identifier, 'name': name, 'subnet': str(subnet), 'address': address}
        _owned(identifier, label)
        return network
    raise NetworkCommandError('Concurrent allocations exhausted three available subnet attempts')
