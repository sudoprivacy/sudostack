#!/usr/bin/env python3
"""Business policy contract against the real deployed analyzer, using synthetic data."""

import json
import sys
import urllib.error
import urllib.request

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "presidio"))
from business_policy import BusinessPolicy


def main():
    base = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:59080"
    policy = BusinessPolicy.load(Path(__file__).with_name("business-policy.fixture.json"))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    identity = json.loads(opener.open(base + "/policy", timeout=10).read())
    assert identity["sha256"] == policy.sha256, "Wrong policy deployed"

    def analyze(text, **extra):
        body = {"text": text, "language": "zh", "entities": ["PERSON", "LOCATION", "ORGANIZATION"], "score_threshold": 0.5, **extra}
        req = urllib.request.Request(base + "/analyze", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        return json.loads(opener.open(req, timeout=15).read())

    public = "北京星河科技有限公司"
    assert analyze(public) == [], "Public company should be allowed"
    for text in ["南京澄明数据有限公司", "😀Client-Aster-7400 Client-Aster-7400", "客户名单：" + public, "[CONFIDENTIAL] " + public]:
        rows = analyze(text, entities=["PERSON"], score_threshold=1.0)
        assert rows and all(item["entity_type"].startswith("PROTECTED_") for item in rows)
        assert all(text[item["start"]:item["end"]] for item in rows)
    assert len(analyze("😀Client-Aster-7400 Client-Aster-7400")) == 2
    assert analyze("讨论客户名单功能，部署本地推理服务。") == []
    for extra in [{"allow_list": ["Client-Aster-7400"]}, {"ad_hoc_recognizers": []}, {"score_threshold": float("nan")}, {"score_threshold": True}]:
        try:
            analyze("Client-Aster-7400", **extra)
        except urllib.error.HTTPError as error:
            assert error.code == 400
            assert b"Client-Aster" not in error.read()
        else:
            raise AssertionError("Request bypass was accepted")
    print(json.dumps({"passed": True, "policy_sha256": policy.sha256, "checks": 12, "scope": "real_analyzer_business_policy"}))


if __name__ == "__main__":
    main()
