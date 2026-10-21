"""Thin, configured owner composition for the synthetic source-checkout lab."""
import argparse
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from agent_management import read_json, registry_configuration, secret


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config', required=True)
    p.add_argument('--initialize-schema', action='store_true')
    args = p.parse_args()
    r = registry_configuration(read_json(args.config, private=True))
    from sqlalchemy import create_engine
    from nexus.services.product_agent_registry.store import initialize_schema
    database_url = secret(r['database_url_file'])
    if args.initialize_schema:
        engine = create_engine(database_url)
        try:
            initialize_schema(engine)
        finally:
            engine.dispose()
        print('Explicit additive initialization completed; no legacy migration or publication.')
        return
    from fastapi import FastAPI
    from nexus.storage.record_store import SQLAlchemyRecordStore
    from nexus.bricks.rebac.entity_registry import EntityRegistry
    from nexus.bricks.rebac.manager import ReBACManager
    from nexus.services.product_agent_registry.configuration import configure, configure_execution
    from nexus.server.api.v2.routers.product_agent_registry import router
    from nexus.remote.rpc_transport import RPCTransport
    from nexus.remote.vfs_client import RemoteFilesystemClient
    from nexus.security.tls.config import ZoneTlsConfig
    from nexus.server.api.v2.routers.async_files import create_async_files_router
    import uvicorn
    os.environ.update({
        'NEXUS_AGENT_REGISTRY_SIGNING_KEY_FILE': r['signing_key_file'],
        'NEXUS_AGENT_REGISTRY_DOMAIN_ZONES': json.dumps(r['domain_zones']),
        'NEXUS_AGENT_INVENTORY_ZONE_DOMAINS': json.dumps(r['inventory_zone_domains']),
        'NEXUS_AGENT_INVENTORY_ATTESTORS': json.dumps(r['attestors']),
        'NEXUS_AGENT_EXECUTION_POLICY_FILE': r['execution_policy_file'],
    })
    store = SQLAlchemyRecordStore(db_url=database_url, create_tables=False)
    try:
        app = FastAPI()
        app.state.api_key = secret(r['token_file'])
        configure(app, store)
        configure_execution(app, store, EntityRegistry(store), ReBACManager(store.engine, enable_tiger_cache=False, enable_leopard=False))
        tls = r['vfs']['tls']
        transport = RPCTransport(urlsplit(r['vfs']['endpoint']).netloc, tls_config=ZoneTlsConfig(
            Path(tls['ca']), Path(tls['cert']), Path(tls['key']), Path(r['vfs']['known_zones'])))
        class SnapshotFiles(RemoteFilesystemClient):
            def read(self, path, *, return_metadata=False, context=None):
                if return_metadata:
                    raise NotImplementedError('Composite metadata reads are not enabled')
                return self.sys_read(path, context=context)
        app.include_router(create_async_files_router(nexus_fs=SnapshotFiles(transport)), prefix='/api/v2/files')
        app.include_router(router)
        uvicorn.run(app, host=r['host'], port=r['port'], log_level='warning', loop='asyncio')
    finally:
        store.engine.dispose()


if __name__ == '__main__':
    main()
