"""Fetch exact public benchmark revisions and verify corpus bytes before use."""

import argparse
import hashlib
import json
import pathlib
import urllib.request


def fetch(asset, destination):
    path = destination / asset["filename"]
    if path.exists():
        data = path.read_bytes()
    else:
        with urllib.request.urlopen(asset["url"], timeout=90) as response:
            data = response.read(asset["bytes"] + 1)
    if len(data) != asset["bytes"] or hashlib.sha256(data).hexdigest() != asset["sha256"]:
        raise ValueError("public corpus size or SHA256 differs from the manifest")
    if not path.exists():
        path.write_bytes(data)
    return path


def main():
    manifest = json.loads((pathlib.Path(__file__).parent / "sources.json").read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=manifest["downloadable"], required=True)
    parser.add_argument("--cache", type=pathlib.Path, required=True)
    args = parser.parse_args()
    source = manifest["downloadable"][args.dataset]
    args.cache.mkdir(parents=True, exist_ok=True)
    for asset in source["assets"]:
        path = fetch(asset, args.cache)
        print(json.dumps({"file": str(path), "sha256": asset["sha256"]}))


if __name__ == "__main__":
    main()
