"""Verify the real Chinese analyzer at the gate's default score threshold."""

import argparse
import ipaddress
import json
import socket
import sys
import urllib.request
from urllib.parse import urlparse


CASES = [
    (
        "person-contact",
        "客户联系人张伟负责确认采购预算。",
        [("PERSON", "张伟")],
    ),
    (
        "person-manager",
        "项目经理王小明正在安排下周会议。",
        [("PERSON", "王小明")],
    ),
    (
        "organization-customer",
        "客户公司是北京星河科技有限公司。",
        [("ORGANIZATION", "北京星河科技有限公司")],
    ),
    (
        "organization-employer",
        "上海晨光信息技术有限公司负责这个项目。",
        [("ORGANIZATION", "上海晨光信息技术有限公司")],
    ),
    (
        "location-office",
        "请把会议安排在北京市海淀区中关村。",
        [("LOCATION", "北京市海淀区中关村")],
    ),
    (
        "negative-technical",
        "请修复工具结果展示并验证流式回复中的空格。",
        [],
    ),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:59080")
    args = parser.parse_args()
    url = urlparse(args.url)
    if url.scheme != "http" or not url.hostname:
        parser.error("The analyzer must use HTTP on loopback")
    addresses = socket.getaddrinfo(url.hostname, url.port or 80)
    if not addresses or any(
        not ipaddress.ip_address(address[4][0]).is_loopback for address in addresses
    ):
        parser.error("The analyzer must resolve only to loopback")

    failures = []
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for case_id, text, expected in CASES:
        body = json.dumps(
            {
                "text": text,
                "language": "zh",
                "entities": ["PERSON", "LOCATION", "ORGANIZATION"],
                "score_threshold": 0.5,
            }
        ).encode()
        request = urllib.request.Request(
            args.url.rstrip("/") + "/analyze",
            body,
            {"Content-Type": "application/json"},
        )
        with opener.open(request, timeout=15) as response:
            findings = json.load(response)
        actual = set()
        for finding in findings:
            start, end = finding["start"], finding["end"]
            if not 0 <= start < end <= len(text) or finding["score"] < 0.5:
                raise ValueError(f"{case_id}: invalid analyzer span or score")
            actual.add((finding["entity_type"], text[start:end]))
        is_passed = actual == set(expected)
        if not is_passed:
            failures.append(case_id)
        print(
            json.dumps(
                {
                    "case": case_id,
                    "passed": is_passed,
                    "expected": sorted(expected),
                    "actual": sorted(actual),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    print(json.dumps({"passed": len(CASES) - len(failures), "failed": failures}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
