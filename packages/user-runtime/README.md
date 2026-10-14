# @sudo/user-runtime

Shared Kubernetes owner runtime lifecycle for SudoCloud, SudoPrivate and SudoEdge. This package owns retained volumes, Pod and Service discovery, release verification, credential delivery and controlled replacement. The control plane supplies authenticated readiness verification and resolves user model configuration.

Moss owns accounts, organizations, model authorization, Agent identity and Session binding. Nexus owns signed capabilities and its credential manifest. SudoCode owns execution and durable native Session data. This package imports the official Nexus client and does not define another credential format.

```ts
import { UserPodService } from '@sudo/user-runtime'

const runtime = new UserPodService(options, undefined, verifyAuthenticatedRuntime)
const connection = await runtime.resolve(authenticatedOwnerId, ownerModelConfiguration)
```

The readiness callback must establish an authenticated owner connection. A TCP probe alone cannot publish a usable runtime. Resource names and annotations remain stable so adopting the common package retains existing user volumes.

Kubernetes primitives are available from `@sudo/user-runtime/kubernetes`; release parsing and verification are available from `@sudo/user-runtime/release`. Those entry points do not load the owner runtime's credential issuer or controller lifecycle.

The controller caches addresses and credentials in memory. Closing it cancels renewal and joins outstanding delivery while retaining user Pods and volumes. Replacement drains the owner, uses observed resource UIDs for deletion, retains the volume, verifies the actual image and executable, and rolls back on failure. The deployment must drain peer controllers before a runtime upgrade; the native runtime does not yet enforce a global admission barrier.

Upgrading an existing runtime first renews its projected server identity and waits for authenticated readiness. This also works after a controller restart when an older image has an expired certificate. Renewal preserves model configuration and the observed Secret version. A UID and owner checked annotation update asks kubelet to refresh the projection without restarting the Pod. A busy runtime keeps its original Pod and volume; a changed Pod identity stops the upgrade before drain or deletion.

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
