#!/usr/bin/env python3
"""Assert what left the node, from the proxy's captures and the daemon's own log.

Inputs from the environment (set by run.sh): WORK, PRESIDIO, FAKE_KEY.
"""
import glob
import json
import os
import sys

W = os.environ["WORK"]
PRESIDIO = os.environ.get("PRESIDIO", "1") == "1"
FAKE_KEY = os.environ.get("FAKE_KEY", "")
ID, MOBILE, NAME = "11010519491231002X", "13912345678", "张三"
CARD_SPACED, CARD = "6212 3456 7890 1232", "6212345678901232"
# What the prompt actually carries — the local route must deliver all of it.
SENT = [ID, MOBILE, CARD_SPACED, NAME] + ([FAKE_KEY] if FAKE_KEY else [])
# What must not leave on the egress route: everything sent the gate is
# expected to catch, plus the card without its spaces, in case a rewrite
# ever normalised it.
RAW = [ID, MOBILE, CARD_SPACED, CARD] + ([NAME] if PRESIDIO else []) + ([FAKE_KEY] if FAKE_KEY else [])
MARKERS = (
    ["[REDACTED:PRC-ID]", "[REDACTED:PRC-MOBILE]", "[REDACTED:BANK-CARD]"]
    + (["[REDACTED:PERSON]"] if PRESIDIO else [])
    + (["[REDACTED:API-KEY]"] if FAKE_KEY else [])
)
fails = []


def check(ok, what):
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        fails.append(what)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def decoded(raw_json):
    """Every string value of a JSON document, decoded — so an escaped value
    counts as present."""
    out = []

    def walk(v):
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(json.loads(raw_json))
    return "\n".join(out)


egress = sorted(glob.glob(f"{W}/capture/egress-*.json"))
local = sorted(glob.glob(f"{W}/capture/local-*.json"))
check(len(egress) == 2, f"two requests reached the egress route (plain + escaped writer; got {len(egress)})")
check(len(local) == 1, f"one request reached the local route (got {len(local)})")

for path in egress:
    sent = decoded(read(path))
    tag = os.path.basename(path)
    for raw in RAW:
        check(raw not in sent, f"{tag}: egress wire body does not contain {raw[:6]!r}…")
    for m in MARKERS:
        check(m in sent, f"{tag}: egress wire body carries {m}")
    check("请只回复两个字" in sent, f"{tag}: non-sensitive text kept")
for path in local:
    sent = decoded(read(path))
    for raw in SENT:
        check(raw in sent, f"local wire body still carries {raw[:6]!r}… (the local model may see it)")

for name in ("cloud-model-ask-1", "cloud-model-ask-2", "model-ask-1"):
    reply = read(f"{W}/out-{name}.reply")
    check('"done"' in reply and len(reply) > 40, f"the real model answered {name} ({len(reply)} bytes)")

for stem in ("ask-1", "ask-2"):
    stored = decoded(read(f"{W}/out-cloud-model-{stem}.stored-prompt"))
    check(all(r not in stored for r in RAW), f"/cloud-model/{stem}.prompt stored redacted (decoded)")

log = read(f"{W}/daemon.log")
armed = [line for line in log.splitlines() if "egress gate armed" in line]
check(len(armed) == 1, "daemon logged the gate as armed once")
if PRESIDIO and armed:
    check("+presidio" in armed[0], "the armed classifier includes Presidio")
check("content redacted" in log, "daemon logged the redaction")
escaped_name = "".join(f"\\u{ord(c):04x}" for c in NAME)
for raw in RAW + [escaped_name]:
    check(raw not in log, f"daemon log never contains {raw[:6]!r}…")

print("\nRESULT:", "PASS" if not fails else f"FAIL ({len(fails)})")
sys.exit(1 if fails else 0)
