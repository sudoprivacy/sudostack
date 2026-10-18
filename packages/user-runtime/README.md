# @sudo/user-runtime

Shared Kubernetes owner runtime lifecycle for SudoCloud, SudoPrivate and SudoEdge. This package owns retained volumes, Pod and Service discovery, release verification, credential delivery and controlled replacement. The control plane supplies authenticated readiness verification and resolves user model configuration.

Moss owns accounts, organizations, model authorization, Agent identity and Session binding. Nexus owns signed capabilities and its credential manifest. SudoCode owns execution and durable native Session data. This package imports the official Nexus client and does not define another credential format.

```ts
import { UserPodService } from '@sudo/user-runtime'

const runtime = new UserPodService(options, undefined, verifyAuthenticatedRuntime)
const connection = await runtime.resolve(authenticatedOwnerId, ownerModelConfiguration)
```

The readiness callback must establish an authenticated owner connection. A TCP probe alone cannot publish a usable runtime. Resource names and annotations remain stable so adopting the common package retains existing user volumes.

Resolving a live Pod with a different runtime or model backend throws `UserRuntimeUpdateRequiredError`, with reason `runtime` or `model-backend`. Consumers can offer an explicit owner update using `upgrade`; retrying ordinary startup does not apply the change. The existing Pod and configuration remain intact when resolution reports this error. Cached connections and controller restarts use the same error contract.

`MOSS_RUNTIME_LIVE=1 node --import tsx test/live/runtimeUpdateRequired.ts` reads `{ ownerId, options }` from standard input and verifies both refusals against the owner's existing Kubernetes resources. Use the running deployment's exact options and an unused issuer endpoint: this check must stop before credential issuance, readiness or execution. It disables writes and compares Pod identity, Secret identity, resource version and data digest before and after; it sends no model prompt.

Use `runtime.forAllocation(allocationId)` for another placement of the same authenticated owner. Each allocation has its own Pod, PVC, Service, configuration, credential renewal and upgrade lock. The primary allocation preserves existing resource names and accepts resources created before allocation annotations existed. Other allocations require their exact allocation annotation and never mount the primary volume. Signed credentials remain bound to the user; an allocation is a storage placement, not a new user identity.

The control plane owns durable Agent-to-allocation assignment. It must resolve a Session through that assignment rather than choosing another allocation on a reconnect. This library caches only transports and active delivery work. Closing the root service joins all allocation services; upgrading one allocation retains its own volume and leaves sibling allocations running. This placement API does not provide concurrent access to one Agent's state from separate allocations. Two production gVisor sandboxes mounting one test PVC both acquired `flock` and `lockf` on 2026-10-16, while two processes inside one sandbox correctly excluded each other. Ordinary shared-volume file locks cannot fence native writers across those sandboxes.

`AgentRuntimeHomes` shares the assignment policy across control planes. Supply a durable `AgentRuntimeHomeStore` and an explicit Agent capacity per allocation, then use `homes.resolve(ownerId, agentId)` and `runtime.forAllocation(home.allocationId)` for every Session of that Agent. The store must serialize claims for an owner across controllers and commit the selected home before returning it. It must return an existing home without invoking the allocation chooser. Addresses, Pod UIDs, live process IDs and credentials do not belong in this store.

The shared policy packs only new Agents. A controller restart or a capacity change never reassigns an existing Agent. When adopting an Agent with existing native state, pass its original allocation as the third argument to `resolve`; this hint applies only to a first assignment. Controllers must import existing native Session bindings before assigning new homes. Allocation discovery always includes the original primary namespace and does not create missing Pods. The library provides placement and identity checks; the control plane supplies its SQL transaction and tenant authorization adapters. This source API is not evidence that a consuming deployment has enabled multi-Pod routing.

Kubernetes primitives are available from `@sudo/user-runtime/kubernetes`; release parsing and verification are available from `@sudo/user-runtime/release`. Those entry points do not load the owner runtime's credential issuer or controller lifecycle.

The controller caches addresses and credentials in memory. Resolution checks the actual owner Pod before reusing that cache; a missing Pod is recreated on the retained PVC, and a changed Pod UID requires authenticated readiness again. Concurrent requests share the same check and creation. Closing the controller cancels renewal and joins outstanding delivery while retaining user Pods and volumes. Replacement drains the owner, uses observed resource UIDs for deletion, retains the volume, verifies the actual image and executable, and rolls back on failure. The deployment must drain peer controllers before a runtime upgrade; the native runtime does not yet enforce a global admission barrier.

Opening or upgrading an existing runtime renews its projected server identity when needed and waits for authenticated readiness. This also works after a controller restart when an older image has an expired certificate. Renewal preserves model configuration and the observed Secret version. The shared credential update path requests a UID and owner checked Pod annotation update so kubelet refreshes the projection during ordinary recovery, later configuration updates, periodic renewal and upgrades. Initial credentials precede fresh Pod creation; later updates use its observed UID. A busy upgrade keeps its original Pod and volume; a changed Pod identity stops the upgrade before drain or deletion.

Credential renewal uses JSON Patch with atomic tests for the observed Secret UID, resource version and owner. This needs the controller's existing `patch` permission, keeps credential history out of the apply annotation, and removes a legacy last-applied annotation. Only expired certificates signed by the current CA for that owner, and their unreferenced credential files, are retired. Current, referenced, foreign and unrecognized files remain intact. The patch body uses a private temporary file because `kubectl patch --patch-file -` does not read stdin; it is removed after success or failure.

Current Kubernetes delivery uses projected Secrets, including short-lived leaf keys and model configuration. Volatile delivery and its recovery path must be completed before treating this as the final storage design. The package has one source implementation; consumers must remove their copies when switching to the versioned package.

## Checks

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack
```

Lifecycle regressions use signed owner credentials with the SDK's production validation enabled. The real deployment acceptance remains the native cohost and Kubernetes journeys in Moss, which also exercise its authorization and Session adapters.

`test/upgradeExpiredIdentity.test.ts` exercises actual mTLS failure, issuer renewal, authenticated drain and busy-runtime preservation. `USER_RUNTIME_LIVE=1 node --import tsx test/live/upgradeExpiredRuntime.ts config.private.json` creates a separate owned Pod against a real Kubernetes cluster, waits for its certificate to expire, upgrades it and verifies retained file bytes. The configuration supplies `options` and a private evidence `output` path. The live journey removes its Pod and identity and records its retained fixture volume for operator cleanup.

`MOSS_RUNTIME_LIVE=1 MOSS_LIVE_NAMESPACE=moss-sessions MOSS_LIVE_KUBECONFIG=/private/kubeconfig node --import tsx test/live/secretRenewalSize.ts evidence.json` creates one isolated Secret containing 400 KiB of history. It verifies the legacy apply annotation limit with a server dry run, rejects wrong UID/version/owner patches without mutation, renews through the restricted controller's patch permission, verifies retained bytes and UID, and removes the fixture with a UID precondition. This journey was run against the real production cluster using the Moss account with `update=no`; it changes no runtime Pod, model configuration or RBAC.
