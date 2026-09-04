# sudostack/deploy — same-source, multi-target deployment

This is the **assembly-side deploy automation** for the Sudo family. It lives in
sudostack (not in any single base product) because deployment *is* assembly:
per the architecture SSOT, there is **one base ("一份底座") deployed to multiple
targets** (本地 / 办公域 / 核心域 / 腾讯云 SaaS), differing by configuration, not by
forking code.

## Shape: shared spine + per-target profiles

- **Spine (`components.toml`)** — env-agnostic: which components make up a
  deployment, pinned to exact versions, and the logical topology they form
  (`client → moss-server → scode + nexus-broker → SudoRouter`). One source of
  truth for "what gets deployed", independent of where.
- **Profiles (`profiles/<target>/`)** — env-specific overlays: host/network,
  advertised addresses, secrets, TLS termination, and the substrate (bare VM +
  systemd vs K8s). A profile supplies only what differs for its target.

The divergence axis (public cloud vs enterprise intranet vs local box) is a
**known, fixed axis** — that is why the spine/profile seam can be designed up
front here, rather than guessed. Per-component build/packaging stays in each base
product's own repo (e.g. the webui image in `sudowork`); this layer only
**composes and deploys** already-built artifacts.

## Targets

| Profile | Target | Status |
|---|---|---|
| `saas-tencent` | 数牍腾讯云 公有云 (single VM: moss-server + nexus-broker, systemd) | **live** — the current dogfood deploy, being codified from the hand-built VM |
| `atlas-office` | 企业内网·办公域 (用户自管) | placeholder — added when sudoatlas is built |
| `atlas-core`   | 企业内网·核心域 (IT 管控, 数据不出域) | placeholder |
| `local`        | 个人端本地 (断网可独立跑) | placeholder |

## Verified SaaS topology (source: the running 腾讯云 VM `sudowork-saas`)

```
Tailscale 100.64.0.1
  └─ moss-server  (systemd, node)      :43127   control plane; hosts scode (ACP, stdio, per-session)
  └─ nexus-broker (systemd, nexusd)    :2126    storage/identity/secrets; cluster founder :8443
       scode  → --auth proxy → SudoRouter (sudorouter.ai)   model egress (external)
```

## Status / TODO

- [x] Codify the live SaaS deploy as config-as-code (this profile — topology,
      systemd units, env schema, version pins).
- [ ] Wire artifact provenance (moss build, `nexusd-cluster-main` release, pinned
      scode release) so a profile can be deployed to a fresh host.
- [ ] Idempotent `deploy.sh` per profile (render env + units from the profile,
      place artifacts, enable services) + post-deploy health check.
- [ ] Add the Atlas intranet profiles once sudoatlas exists (the second target
      confirms which parts of the spine are truly shared).
