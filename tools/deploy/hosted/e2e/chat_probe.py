"""Log in to the deployed Mosswork as its admin, create an agent from the
general-assistant template if none exists, and send one chat turn.

Usage: chat_probe.py <mosswork-admin.json> <message> [base_url]
Requires the `websockets` package (e2e.sh runs it through `uv run --with`).
"""
import asyncio
import json
import sys
import urllib.request

import websockets

creds = json.load(open(sys.argv[1]))
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8088"


def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw.strip() else None


def agents(token):
    data = api("GET", "/api/agents", token=token)
    return data if isinstance(data, list) else data.get("items") or data.get("agents") or []


async def chat(agent_id, token, text):
    reply, model = [], None
    url = f"{BASE.replace('http', 'ws', 1)}/api/agents/{agent_id}/chat/ws?token={token}"
    async with websockets.connect(url, max_size=None, origin=BASE) as ws:
        await ws.send(json.dumps({"type": "user_turn", "text": text}))
        while True:
            frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=240))
            kind = frame.get("type")
            if kind == "token":
                reply.append(str(frame.get("content") or frame.get("text") or ""))
            elif kind == "usage":
                model = frame.get("model")
            elif kind == "error":
                raise SystemExit(f"chat error: {frame}")
            elif kind == "done":
                return "".join(reply), model


token = api("POST", "/api/auth/login", {"username": creds["username"], "password": creds["password"]})["access_token"]
items = agents(token)
if not items:
    api("POST", "/api/agents", {"name": "e2e 通用助手", "template_name": "general-assistant"}, token=token)
    items = agents(token)
agent_id = items[0].get("agent_id") or items[0].get("id")
text, model = asyncio.run(chat(agent_id, token, sys.argv[2]))
print(f"agent={agent_id} model={model}")
print(f"reply: {text}")
sys.exit(0 if text.strip() else 1)
