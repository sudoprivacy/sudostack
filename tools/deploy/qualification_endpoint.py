#!/usr/bin/env python3
"""Expose one explicit real loopback dependency to a private qualification netns.

Host mode binds an owner-only Unix socket and forwards opaque bytes to one fixed
loopback TCP port. Namespace mode restores that same loopback port inside the
isolated network namespace. Neither side logs headers, credentials or payloads;
neither retries a connection. This is a qualification boundary, not an Agent
gateway, a model proxy policy, or a production service installer.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import signal
import stat


def check_path(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Use an absolute private socket path')
    for parent in [*reversed(path.parents), path]:
        if parent.is_symlink():
            raise ValueError('Symlink socket paths are refused')
    parent = path.parent.stat()
    if parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('Socket directory must belong only to the current user')
    return path


class Endpoint:
    def __init__(self, mode, path, port, host_namespace):
        if mode not in ('host', 'namespace') or not 1 <= port <= 65535:
            raise ValueError('One explicit loopback TCP port is required')
        current = os.readlink('/proc/self/ns/net')
        if (current == host_namespace) != (mode == 'host'):
            raise ValueError('Qualification network namespace does not match the requested endpoint side')
        self.mode, self.path, self.port = mode, check_path(path), port
        if mode == 'host':
            if self.path.exists():
                raise ValueError('Refuse an existing socket path')
        else:
            metadata = self.path.stat()
            if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
                raise ValueError('Use the existing owner-only qualification socket')
        self.tasks = set()
        self.report = {'mode':mode, 'port':port, 'connections':0, 'connectionFailures':0,
                       'forwardedBytes':0, 'payloadRecorded':False, 'automaticRetries':0}
        self.server = None
        self.socket_inode = None

    async def start(self):
        if self.mode == 'host':
            # umask applies before bind, so there is no permissive socket window.
            previous = os.umask(0o077)
            try:
                self.server = await asyncio.start_unix_server(self.accept, path=str(self.path))
                self.path.chmod(0o600)
                self.socket_inode = self.path.stat().st_ino
            finally:
                os.umask(previous)
        else:
            self.server = await asyncio.start_server(self.accept, '127.0.0.1', self.port)
        return self

    async def accept(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        peer = None
        transfers = []
        try:
            if len(self.tasks) > 16:
                return
            self.report['connections'] += 1
            if self.mode == 'host':
                upstream, peer = await asyncio.wait_for(asyncio.open_connection('127.0.0.1', self.port), 10)
            else:
                upstream, peer = await asyncio.wait_for(asyncio.open_unix_connection(str(self.path)), 10)

            async def transfer(source, destination):
                while data := await source.read(65536):
                    destination.write(data)
                    await destination.drain()
                    self.report['forwardedBytes'] += len(data)
                if destination.can_write_eof():
                    destination.write_eof()
                    await destination.drain()

            transfers = [asyncio.create_task(transfer(reader, peer)), asyncio.create_task(transfer(upstream, writer))]
            await asyncio.gather(*transfers)
        except (OSError, asyncio.TimeoutError):
            self.report['connectionFailures'] += 1
        finally:
            for pending in transfers:
                pending.cancel()
            await asyncio.gather(*transfers, return_exceptions=True)
            for stream in (writer, peer):
                if stream:
                    stream.close()
                    try:
                        await stream.wait_closed()
                    except OSError:
                        pass
            self.tasks.discard(task)

    async def close(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.socket_inode is not None and self.path.exists() and self.path.stat().st_ino == self.socket_inode:
            self.path.unlink()


async def main(options):
    endpoint = await Endpoint(options.mode, options.socket, options.port, options.host_network_namespace).start()
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    print(json.dumps({'ready':True, **endpoint.report}), flush=True)
    try:
        await stopped.wait()
    finally:
        await endpoint.close()
        print(json.dumps({'closed':True, **endpoint.report}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['host','namespace'])
    parser.add_argument('--socket', required=True, type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--host-network-namespace', required=True)
    asyncio.run(main(parser.parse_args()))
