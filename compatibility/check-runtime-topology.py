"""Verify the G7 Nexus runtime topology and plugin-ABI compatibility.

This is intentionally a live, local check: the embedded Moss daemon and vault
plugin are git-ignored deployment artifacts, so their version/ABI/digest cannot
be proven from repository revisions alone.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
REPOS_ROOT = Path(os.environ.get("SUDOSTACK_REPOS_ROOT", REPO.parent)).resolve()
MATRIX_PATH = REPO / "docs/evidence/SW-20260915-002/g7/pin-matrix.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def daemon_facts(path: Path) -> tuple[str, int]:
    output = subprocess.check_output([str(path), "--version"], text=True).strip()
    match = re.search(r"plugin-abi\s+(\d+)\)", output)
    if match is None:
        raise RuntimeError(f"cannot parse plugin ABI from {path}: {output!r}")
    return output, int(match.group(1))


def plugin_abi(path: Path) -> int:
    library = ctypes.CDLL(str(path))
    function = library.nexus_plugin_api_version
    function.restype = ctypes.c_uint32
    return int(function())


def current_loader_policy(nexus_vfs: Path) -> tuple[int, list[int]]:
    abi_source = (nexus_vfs / "rust/plugin-abi/src/lib.rs").read_text(encoding="utf-8")
    current_match = re.search(r"pub const PLUGIN_API_VERSION:\s*u32\s*=\s*(\d+)", abi_source)
    if current_match is None:
        raise RuntimeError("PLUGIN_API_VERSION is missing from nexus-vfs")
    current = int(current_match.group(1))

    loader_source = (
        nexus_vfs / "rust/kernel/src/kernel/plugins/loader.rs"
    ).read_text(encoding="utf-8")
    policy_match = re.search(
        r"matches!\(api_version,\s*([0-9\s|]+)\|\s*PLUGIN_API_VERSION\)",
        loader_source,
    )
    accepted = {current}
    if policy_match is not None:
        accepted.update(int(value) for value in re.findall(r"\d+", policy_match.group(1)))
    return current, sorted(accepted)


def require(actual: object, expected: object, label: str) -> None:
    if actual != expected:
        raise RuntimeError(f"{label}: expected {expected!r}, got {actual!r}")


def main() -> None:
    matrix = json.loads(MATRIX_PATH.read_text(encoding="utf-8"))
    topology = matrix["runtime_topology"]
    abi_record = topology["plugin_abi_compatibility"]

    moss = REPOS_ROOT / "moss"
    nexus = REPOS_ROOT / "nexus"
    nexus_vfs = REPOS_ROOT / "nexus-vfs"
    embedded_binary = moss / "bin/nexus" / ("nexusd.exe" if os.name == "nt" else "nexusd")
    current_binary = nexus / "target/debug" / (
        "nexusd-cluster.exe" if os.name == "nt" else "nexusd-cluster"
    )
    vault_plugin = moss / "bin/nexus/plugins" / (
        "nexus_vault.dll"
        if os.name == "nt"
        else "libnexus_vault.dylib"
        if os.uname().sysname == "Darwin"
        else "libnexus_vault.so"
    )

    embedded_version, embedded_abi = daemon_facts(embedded_binary)
    current_version, current_abi = daemon_facts(current_binary)
    vault_abi = plugin_abi(vault_plugin)
    source_abi, loader_accepts = current_loader_policy(nexus_vfs)

    require(embedded_version, topology["moss_embedded"]["observed_version"], "embedded version")
    require(sha256(embedded_binary), topology["moss_embedded"]["sha256"], "embedded digest")
    require(current_version, topology["current_built_nexusd"]["version"], "current version")
    require(sha256(current_binary), topology["current_built_nexusd"]["sha256"], "current digest")
    require(sha256(vault_plugin), abi_record["moss_vault_plugin_sha256"], "vault digest")
    require(embedded_abi, abi_record["moss_embedded_daemon_abi"], "embedded ABI")
    require(vault_abi, abi_record["moss_vault_plugin_abi"], "vault ABI")
    require(current_abi, abi_record["current_daemon_abi"], "current daemon ABI")
    require(source_abi, abi_record["current_source_abi"], "current source ABI")
    require(loader_accepts, abi_record["current_loader_accepts"], "loader accepted ABIs")

    if embedded_abi != vault_abi:
        raise RuntimeError(
            f"embedded daemon/plugin ABI mismatch: daemon={embedded_abi}, vault={vault_abi}"
        )
    if embedded_abi not in loader_accepts:
        raise RuntimeError(
            f"legacy ABI {embedded_abi} is not accepted by current loader {loader_accepts}"
        )

    print(
        "runtime topology verified: "
        f"embedded daemon ABI={embedded_abi}, vault ABI={vault_abi}, "
        f"current ABI={current_abi}, loader accepts={loader_accepts}, "
        f"drift={'yes' if embedded_abi != current_abi else 'no'}"
    )


if __name__ == "__main__":
    main()
