"""Static endpoint portability and ownership hold across Docker implementations."""
import json
import unittest
from unittest.mock import patch

import e2e_docker_network as network


class DockerEngine:
    def __init__(self):
        self.networks = {}
        self.operations = []
        self.count = 0
        self.overlaps = 0
        self.deny = False
        self.foreign = False
        self.deny_final_inspection = False

    def __call__(self, *args):
        self.operations.append(args)
        if args[:2] == ('network', 'create'):
            if self.deny:
                raise network.NetworkCommandError('permission denied')
            if '--subnet' in args and self.overlaps:
                self.overlaps -= 1
                raise network.NetworkCommandError('Pool overlaps with other one on this address space')
            self.count += 1
            identifier = format(self.count, '064x')
            subnet = args[args.index('--subnet') + 1] if '--subnet' in args else f'172.{17 + self.count}.0.0/16'
            gateway = args[args.index('--gateway') + 1] if '--gateway' in args else subnet.split('/')[0][:-1] + '1'
            self.networks[identifier] = {'Id': identifier, 'Name': args[-1],
                'Labels': {network.LABEL: 'other' if self.foreign else 'owned'},
                'IPAM': {'Config': [{'Subnet': subnet, 'Gateway': gateway}]},
                'userConfiguredSubnet': '--subnet' in args}
            return identifier
        if args[:2] == ('network', 'inspect'):
            if self.deny_final_inspection and self.networks[args[-1]]['userConfiguredSubnet']:
                raise network.NetworkCommandError('permission denied')
            return json.dumps([self.networks[args[-1]]])
        if args[:2] == ('network', 'rm'):
            del self.networks[args[-1]]
            return args[-1]
        raise AssertionError(args)


class OwnedNetworkTests(unittest.TestCase):
    def setUp(self):
        self.engine = DockerEngine()
        patcher = patch.object(network, '_docker', self.engine)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_static_address_uses_an_explicit_ipam_selected_subnet(self):
        selected = network.create_owned_network('acceptance', 'owned')
        self.assertTrue(self.engine.networks[selected['id']]['userConfiguredSubnet'])
        self.assertEqual(selected['address'], '172.18.0.2')
        self.assertEqual(len(self.engine.networks), 1)
        network.remove_owned_network(selected, 'owned')
        self.assertFalse(self.engine.networks)

    def test_a_concurrent_pool_allocation_gets_another_available_subnet(self):
        self.engine.overlaps = 1
        selected = network.create_owned_network('acceptance', 'owned')
        self.assertEqual(selected['subnet'], '172.19.0.0/16')
        self.assertEqual(len(self.engine.networks), 1)

    def test_operational_refusals_propagate_without_another_allocation(self):
        self.engine.deny = True
        with self.assertRaisesRegex(network.NetworkCommandError, 'permission denied'):
            network.create_owned_network('acceptance', 'owned')
        self.assertEqual(len(self.engine.operations), 1)

    def test_foreign_probe_is_preserved(self):
        self.engine.foreign = True
        with self.assertRaisesRegex(ValueError, 'ownership differs'):
            network.create_owned_network('acceptance', 'owned')
        self.assertFalse(any(args[:2] == ('network', 'rm') for args in self.engine.operations))

    def test_a_refused_final_inspection_leaves_the_resource_for_review(self):
        self.engine.deny_final_inspection = True
        with self.assertRaisesRegex(network.NetworkCommandError, 'permission denied'):
            network.create_owned_network('acceptance', 'owned')
        identifier = next(iter(self.engine.networks))
        self.assertEqual(self.engine.operations.count(('network', 'inspect', identifier)), 1)
        self.assertNotIn(('network', 'rm', identifier), self.engine.operations)

    def test_removal_checks_ownership_again(self):
        selected = network.create_owned_network('acceptance', 'owned')
        self.engine.networks[selected['id']]['Labels'][network.LABEL] = 'other'
        with self.assertRaisesRegex(ValueError, 'ownership differs'):
            network.remove_owned_network(selected, 'owned')
        self.assertIn(selected['id'], self.engine.networks)

    def test_bounded_pool_conflicts_leave_no_probe_networks(self):
        self.engine.overlaps = 3
        with self.assertRaisesRegex(network.NetworkCommandError, 'three available subnet attempts'):
            network.create_owned_network('acceptance', 'owned')
        self.assertFalse(self.engine.networks)
