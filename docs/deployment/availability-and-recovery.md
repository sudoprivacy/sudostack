# Agent runtime availability and recovery

Status: deployment design and acceptance requirements, not an implemented HA
profile or a claim that the existing fleet tolerates a host outage.

The 2026-10-26 six-peer incident exposed two different lifecycle gaps. After
Windows rebooted, its manually launched shared Node did not resume. Windows
was also the only voter of the shared conversation and control zones; the Mac
learner could not elect a replacement. Resuming the original binary, data and
Node identity restored authenticated directory access at both endpoints. This
did not qualify actual six-peer sends, version compatibility or failover.

## One service owner per installation

Sudocode's existing service-host owns installation, authenticated discovery,
exclusive lifecycle ownership and daemon startup. CLI setup and SudoWork must
consume that owner. Selecting shared mode can ensure the selected local service
is running; selecting local mode must not stop another frontend's service.
An OS startup registration is an explicit lifecycle policy of that installation,
not a second launcher or a detached watchdog added by each Agent.

The existing six-peer Node has a different persistent root and discovery record
from service-host's default installation. A new setup invocation must not be
described as adopting it. Migration requires explicit ownership inspection,
drain, an actual cold checkpoint, identity-preserving adoption and authenticated
readiness, with no overlapping daemon on the same state. Runtime and certificate
compatibility are checked before activation. A CLI update must not silently
replace a shared Node.

Sudostack composes those native operations. SudoEdge selects device placement;
SudoCloud selects its existing runtime placement. Neither frontend implements
another downloader, election algorithm, certificate issuer or lease manager.

## Availability belongs to each authoritative zone

Raft availability depends on the committed voting configuration and a connected
majority. A learner stores replicated data but contributes no vote. Promoting
the Mac alone to form two voters would still require both voters for progress.
Tolerating one failed voter requires at least three voters, with a surviving
connected majority. Three processes on one laptop do not tolerate that laptop
failing.

Deployment inspection must use the native membership/health interface for every
shared zone required by the operation, including control and locking
dependencies. An address in a peer list, a copied transcript or a healthy TCP
port is insufficient. Local roots are distinguished from shared authoritative
zones; making only the conversation zone redundant must not conceal a separate
shared control dependency on the failed host.

The intended deployment choice must distinguish an explicitly single-host
installation from a deployment qualified to tolerate one host outage. The
latter requires actual voters in independent failure domains, caught-up
membership, working routes and authenticated client recovery. These checks
must be enforced before an HA acceptance receipt can be issued. There is no
such enforcement or receipt implemented by this document.

## Cross-domain join does not grant voting authority

An Edge/Cloud Agent joining a collaboration space receives participant
authorization. This does not authorize its device to join the hosting domain's
Raft quorum. Domains retain their own issuers, policies and lifecycle owners.
The space's native policy selects one authoritative hosting authority and zone;
other domains route through their own Kernel policy boundary to that host.

If the hosting authority promises HA, its serving cluster must satisfy the
voter and failure-domain requirements above. Adding DGX or Tencent Cloud to
Agent discovery alone establishes none of those properties. A separate approved
cluster-membership operation is required before any device becomes a voter.
Do not copy a domain's CA private key, re-found an existing zone or change
membership merely to increase the chat participant count.

## Qualification before declaring HA

1. Record the actual binaries, Node identities, committed membership, relevant
   shared zones and serving routes. Exercise authorized list and send through
   the real product Agents before injecting a fault.
2. Stop the current leader on an isolated qualified deployment. After normal
   election and client recovery, a surviving real Agent must still discover
   participants, append, receive and naturally commit its reader position.
   A success measured only after restarting the old leader does not pass.
3. Isolate a minority partition. It must not report a successful committed send
   without quorum. Preserve typed refusal/Unknown outcomes and never infer that
   an uncertain append can be resent. Inspect actual envelopes and operation
   identities rather than deduplicating message text.
4. Return the original Node using its original durable identity and state;
   verify catch-up and continued product history without force-unlocking,
   editing cursors, recreating Agents or minting replacement identities.
5. Separately qualify whole-host reboot recovery through the chosen service
   owner and startup policy. Confirm one owner, authenticated readiness and
   compatible versions. Recovery speed does not substitute for leader-outage
   availability.

Budgets and policy remain explicit and fixed for each fixture. A seven-party
round trip is useful application evidence after deployment, but cannot replace
these failure-mode qualifications.
