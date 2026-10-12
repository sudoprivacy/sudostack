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
    cases = json.loads(Path(__file__).with_name("business-cases.fixture.json").read_text(encoding="utf-8"))["cases"]
    for case in cases:
        text = case["text"]
        rows = analyze(text, entities=["PERSON"], score_threshold=1.0)
        protected = [item for item in rows if item["entity_type"].startswith("PROTECTED_")]
        assert bool(protected) == case["protected"], case["id"]
        assert all(0 <= item["start"] < item["end"] <= len(text) for item in rows), case["id"]
        if case["whole_record"]:
            assert any(item["start"] == 0 and item["end"] == len(text) for item in protected), case["id"]
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
    print(json.dumps({"passed": True, "policy_sha256": policy.sha256, "business_cases": len(cases), "families": sorted({case["family"] for case in cases}), "scope": "real_analyzer_explicit_business_policy"}))


if __name__ == "__main__":
    main()
