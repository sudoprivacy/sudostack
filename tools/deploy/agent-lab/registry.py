"""Isolated candidate qualification entrypoint; no startup schema migration."""
import os
from pathlib import Path
import sys

import nexus
from nexus.server.fastapi_server import create_app
import uvicorn

ROOT = Path('/lab')
os.environ['NEXUS_AGENT_REGISTRY_SIGNING_KEY_FILE'] = str(ROOT / 'secrets/signing.pem')
os.environ['NEXUS_AGENT_REGISTRY_DOMAIN_ZONES'] = '{"agents.lab.sudo":"zone-1"}'
os.environ['NEXUS_KERNEL_BINARY'] = '/usr/local/bin/nexusd-cluster'
os.environ['NEXUS_USE_UVLOOP'] = 'false'
os.environ['REDACT_API_KEY_IN_LOGS'] = 'true'

if sys.argv[1:] == ['--initialize-schema']:
    from sqlalchemy import create_engine
    from nexus.services.product_agent_registry.store import initialize_schema
    engine = create_engine('sqlite:////lab/data/record-store.db')
    try:
        initialize_schema(engine)
    finally:
        engine.dispose()
    print('Explicit initialization complete; no legacy migration performed.')
elif not sys.argv[1:]:
    nx = nexus.connect(config={'profile': 'embedded', 'data_dir': '/lab/data',
                               'record_store_path': '/lab/data/record-store.db'})
    try:
        app = create_app(nx, api_key=(ROOT / 'secrets/token').read_text().strip(), data_dir='/lab/data')
        uvicorn.run(app, host='127.0.0.1', port=22139, log_level='warning', loop='asyncio')
    finally:
        nx.close()
else:
    raise SystemExit('Only --initialize-schema is accepted')
