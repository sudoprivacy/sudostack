# Control plane and runtime by deployment form

This is the shared deployment decision for Sudo Cloud, Sudo Private and
SudoEdge. Device addresses, versions, installation commands and acceptance
records belong in each deployment repository. These assembly choices are
currently documented decisions; a shared deployment validator does not yet
enforce them.

The product vocabulary follows [Sudo Enterprise planning](https://s.shareone.vip/s/sudo-enterprise-chan-pin-gui-hua)
and the [product introduction](https://s.shareone.vip/md/sudo-chan-pin-yu-jie-jue-fang-an-jie-shao).
Enterprise is the enterprise-owned product; Moss is its server and Agent
management component. `sudoprivate` and `sudoedge` remain engineering placement
identifiers. A standalone CLI in the enterprise network is an authorized client
of that deployment; its network location alone establishes no management level.

The shared [Agent-host placement action](deployment/agent-host.md) now supplies
verified Linux user-service executable placement. Cross-domain joining and
product-runtime qualification follow the [source design](design/cohost-deploy-and-domain-join.md);
process activation alone does not establish those properties.

## Component responsibilities

- **Moss** provides human login, organizations, catalog and model preferences,
  Agent inventory, authorization/delegation, lifecycle/audit, session APIs, and
  the browser-facing HTTP/WebSocket gateway. Native certificates are issued
  through Nexus under that authenticated authority. Moss requests
  execution from Nexus and resolves the Agent's durable allocation when
  Kubernetes is used. Kubernetes places the Pod; ManagedAgentService creates
  the actual execution. A standalone CLI owns its local execution without
  requiring Moss or a Cloud account.
- **ManagedAgentService** is a Nexus service. In `nexusd-cohost`, its runtime
  adapter creates scode session tasks in the daemon process. A cohost daemon
  is started by systemd or a container orchestrator; spawning an agent session
  does not start another cohost daemon.
- **SudoWork WebUI** is the browser interface. Its current server consumes
  Moss authentication, session, history and workspace APIs. A browser profile
  without Moss requires an implementation of those application services and
  their adapter; installing cohost alone does not provide them.
- **Nexus model mounts** carry model requests through the session filesystem.
  Router selects the local GPUStack or cloud provider. This is separate from
  the API that creates and controls an agent session.
- **Router** uses `sudoprivacy/new-api` in both cloud and appliance deployments.
  It owns channels, relay credentials and model capabilities. Nexus owns the
  filesystem mount; each deployment restores that mount after Nexus starts
  and refreshes it when Router credentials change. Mount readiness requires
  a fresh inference after restart, beyond a healthy Router endpoint.

## Profiles

| Form | Placement and control | Execution |
|---|---|---|
| Sudo Cloud | Hosted Moss and cluster control services, per-user sandbox placement | Moss connects with owner-delegated identity directly to the selected allocation's cohost ManagedAgentService |
| Sudo Private | Customer-operated Enterprise services, local identity integration and customer deployment policy | Cohost placement follows the customer's trust boundaries |
| SudoEdge | Appliance deployment; local Moss serves the existing WebUI with one organization; no cloud Kubernetes scheduler is required | Local cohost exposes ManagedAgentService directly; no additional local cluster daemon is required just to run one agent |
| Sudo Local | Desktop SudoWork with its local host adapter; no enterprise server requirement | Standalone/local sudocode |
| Standalone scode CLI | The invoking user and CLI own the local process and Session | The engine uses its in-process Nexus Kernel; collaboration attaches to an explicitly selected identity and service |

The Edge browser profile retains Moss to reuse the supported login, history,
workspace and session APIs while offline, and to keep the deployment forms
on the same application contracts. Agent count is not the reason to run it.
The engine can run without Moss. A minimal Edge profile can remove Moss only
when an alternative browser adapter covers those functions and passes the
same task, approval, cancellation and recovery acceptance.

Cloud and Edge need different process placement, while sharing service
contracts:

```text
Cloud: WebUI -> Moss -> selected user cohost ManagedAgentService -> scode task
Edge:  WebUI -> local Moss -> local cohost ManagedAgentService -> scode task
CLI:   terminal/ACP host -> local scode engine -> in-process Nexus Kernel
Model: scode task -> session Nexus model mount -> Router -> GPUStack or cloud LLM
```

Cloud's cluster supplies identity, secrets and shared control services. It is
separate from the direct owner-authenticated session connection above. A Cloud
controller can operate an Edge placement when the device owner delegates that
operation; choosing Cloud control does not relocate the Edge Agent or its data.

The standalone Kernel is already implemented in sudocode's
`rust/crates/engine-host/src/local_kernel.rs`. It needs no installed Nexus
daemon for local file execution. `nexusd-cohost` already links the Kernel and
scode execution into one binary. Runtime preparation therefore resolves the
selected profile before deciding whether a daemon must be installed or started.
The shared [bootstrap and authority design](design/cohost-deploy-and-domain-join.md#runtime-preparation)
defines that product integration; the unified bootstrap entry is not yet
enforced (`enforced_by: none`).

SudoWork's desktop adapter already consumes sudocode's
[`service-host`](https://github.com/sudoprivacy/sudocode/blob/main/docs/shared-services.md)
through `scode service stdio`. That component owns Nexus installation,
discovery and lifetime; the desktop keeps its progress UI. CLI runtime selection
belongs to this owner too. Enterprise update windows and pinned
component compatibility govern a shared service transition independently of
updating a frontend application.

The Edge Router is a local new-api deployment. Its local channel reaches
GPUStack/vLLM; a cloud channel reaches the hosted SudoRouter when credentials
are configured. Cross-domain agent messages use Nexus federation separately.
The appliance starts online and exposes its public-network switch through
`sudoedge connectivity`; LAN access and the local browser stack remain usable
in local mode. See the first diagram in the Cloud integration checklist for
the complete placement of these components.

The Edge path has now passed a user-visible migration check. On 2026-10-07,
Moss created session `9fd73394-f9f4-44eb-a89d-01dc73e3bfd1` with
`runtime.type=cohost`; the WebSocket prompt returned `COHOST_MODEL_OK` and a
successful result. The cohost service was an ARM64 `nexusd-cohost` build using
Nexus VFS v0.8.0, and the new-api log recorded the corresponding streamed
`qwen3-30b` completion. This is evidence for the local Edge path:

```text
Edge: WebUI -> local Moss -> local ManagedAgentService -> in-process scode
      -> session Nexus /model -> new-api -> GPUStack
```

The default was also checked without sending a runtime override:
`37de752c-20fc-4646-a04b-96009b9e0e0e` selected cohost from
`MOSS_DEFAULT_RUNTIME=cohost` and returned `DEFAULT_COHOST_OK` successfully.

Cloud and Edge each qualify the actual installed product and owner separately;
the historical Edge examples above do not qualify a current Cloud deployment.
For either form, cancellation, recovery, model-mount restore and user-visible
history remain separate checks. Use the [Cloud integration
checklist](https://s.shareone.vip/md/sudo-cloud-plan) and each deployment
repository's runbook for current evidence.

## Repository ownership

- **sudostack**: shared contracts, assembly profiles and cross-product architecture.
- **sudoedge**: appliance install, GPU configuration, networking, startup and diagnostics.
- **new-api**: shared Router implementation; deployments select and record its revision.
- **moss / sudocode / nexus-vfs / sudowork**: implementation of their own services and clients.

Shared design belongs here; implementation fixes remain in the component that
owns the behavior. Deployment repositories consume those fixes and record
their versions and acceptance results.
