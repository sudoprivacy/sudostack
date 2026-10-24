import asyncio
import os
from pathlib import Path
import platform
import tempfile
import unittest

from qualification_endpoint import Endpoint


@unittest.skipUnless(platform.system() == 'Linux', 'Linux qualification namespaces and Unix socket')
class EndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.namespace = os.readlink('/proc/self/ns/net')

    async def asyncTearDown(self):
        self.temporary.cleanup()

    async def test_real_service_bytes_and_half_close_preserve_credentials_and_body(self):
        request = b'GET /v1/models HTTP/1.0\r\nAuthorization: Bearer fixture\r\n\r\n'
        response = b'HTTP/1.0 200 OK\r\n\r\n' + 'real service: \u4e2d\x00'.encode()
        observed = []

        async def service(reader, writer):
            observed.append(await reader.read())
            writer.write(response)
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        server = await asyncio.start_server(service, '127.0.0.1', 0)
        port = server.sockets[0].getsockname()[1]
        endpoint = await Endpoint('host', self.root/'endpoint.sock', port, self.namespace).start()
        try:
            reader, writer = await asyncio.open_unix_connection(str(endpoint.path))
            writer.write(request)
            writer.write_eof()
            self.assertEqual(await asyncio.wait_for(reader.read(), 3), response)
            writer.close()
            await writer.wait_closed()
            self.assertEqual(observed, [request])
            self.assertEqual(endpoint.report['connections'], 1)
            self.assertEqual(endpoint.report['automaticRetries'], 0)
            self.assertFalse(endpoint.report['payloadRecorded'])
            self.assertEqual(endpoint.path.stat().st_mode & 0o777, 0o600)
        finally:
            await endpoint.close()
            server.close()
            await server.wait_closed()
        self.assertFalse(endpoint.path.exists())

    async def test_wrong_namespace_and_shared_or_symlink_paths_refused(self):
        with self.assertRaisesRegex(ValueError, 'namespace'):
            Endpoint('namespace', self.root/'endpoint.sock', 3000, self.namespace)
        self.root.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'directory'):
            Endpoint('host', self.root/'endpoint.sock', 3000, self.namespace)
        self.root.chmod(0o700)
        (self.root/'link').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            Endpoint('host', self.root/'link/endpoint.sock', 3000, self.namespace)

    async def test_existing_socket_and_refused_upstream_do_not_retry(self):
        server = await asyncio.start_server(lambda r,w:None, '127.0.0.1', 0)
        port = server.sockets[0].getsockname()[1]
        server.close()
        await server.wait_closed()
        endpoint = await Endpoint('host', self.root/'endpoint.sock', port, self.namespace).start()
        try:
            with self.assertRaisesRegex(ValueError, 'existing'):
                Endpoint('host', endpoint.path, port, self.namespace)
            reader, writer = await asyncio.open_unix_connection(str(endpoint.path))
            self.assertEqual(await asyncio.wait_for(reader.read(), 3), b'')
            writer.close()
            await writer.wait_closed()
            self.assertEqual(endpoint.report['connections'], 1)
            self.assertEqual(endpoint.report['connectionFailures'], 1)
        finally:
            await endpoint.close()
