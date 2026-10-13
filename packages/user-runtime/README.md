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

Current Kubernetes delivery uses projected Secrets, including short-lived leaf keys and model configuration. Volatile delivery and its recovery path must be completed before treating this as the final storage design. The package has one source implementation; consumers must remove their copies when switching to the versioned package.

## Checks

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack
```

Lifecycle regressions use signed owner credentials with the SDK's production validation enabled. The real deployment acceptance remains the native cohost and Kubernetes journeys in Moss, which also exercise its authorization and Session adapters.
