# Control plane and runtime by deployment form

This is the shared deployment decision for Sudo Cloud, Sudo Private and
SudoEdge. Device addresses, versions, installation commands and acceptance
records belong in each deployment repository. These assembly choices are
currently documented decisions; a shared deployment validator does not yet
enforce them.

## Component responsibilities

- **Moss** provides human login, organizations, catalog and model preferences,
  session APIs, and the browser-facing HTTP/WebSocket gateway. It requests
  execution from Nexus and manages placement when Kubernetes is used.
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
| Sudo Cloud | Our hosted Atlas; Moss and cluster control plane, per-user sandbox placement | Per-user cohost; cluster ManagedAgentService routes to the owning runtime |
| Sudo Private | The same Atlas services operated in the customer's network; local identity integration and customer deployment policy | Cohost placement follows the customer's trust boundaries |
| SudoEdge | Atlas on the appliance; local Moss serves the existing WebUI with one organization; no cloud Kubernetes scheduler is required | Local cohost exposes ManagedAgentService directly; no additional local cluster daemon is required just to run one agent |
| Sudo Local | Desktop SudoWork with its local host adapter; no Atlas requirement | Standalone/local sudocode |

The Edge browser profile retains Moss to reuse the supported login, history,
workspace and session APIs while offline, and to keep the three Atlas forms
on the same application contracts. Agent count is not the reason to run it.
The engine can run without Moss. A minimal Edge profile can remove Moss only
when an alternative browser adapter covers those functions and passes the
same task, approval, cancellation and recovery acceptance.

Cloud and Edge need different process placement, while sharing service
contracts:

```text
Cloud: WebUI -> Moss -> cluster ManagedAgentService -> user cohost -> scode task
Edge:  WebUI -> local Moss -> local cohost ManagedAgentService -> scode task
Model: scode task -> session Nexus model mount -> Router -> GPUStack or cloud LLM
```

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

Cloud still needs its own deployment evidence against the production cluster;
the Edge acceptance does not imply that cloud sessions have moved from
external spawn. For either form, cancellation, recovery, model-mount restore
and user-visible history remain separate checks. Use the [Cloud integration
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
