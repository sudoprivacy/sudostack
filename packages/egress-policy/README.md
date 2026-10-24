# Shared egress policy

The policy document and its validation belong here. Cloud, Private, Edge and
Nexus-connected CLI installations consume the same format. Nexus owns the
kernel hook; Moss owns authenticated administration, persistence and delivery.

`createEgressPolicy()` defaults to disabled. Enabling requires explicitly named
outbound mounts. `redact` is the default mode. Business lists require a local
analyzer; statistical recognition remains subject to domain quality acceptance.

The deployment supplies one `NEXUS_EGRESS_GATE_CONFIG` file path. Moss distributes
the complete versioned JSON file through the existing runtime configuration
channel. A running kernel reads a new version before its next eligible write.
Updates must increase `revision`; invalid updates retain the last admitted
policy and deny writes on its protected paths. They do not unhook the service.
Files must be replaced atomically and kept outside agent-writable workspaces.

`readEgressPolicyStatus` queries the existing authenticated Nexus Call transport.
Runtime status contains the applied revision, mode, switch and outbound mounts;
it does not contain protected business values. Agent credentials have no policy
mutation RPC. `policyApplicationStatus` distinguishes delivery from enforcement.

Moss administration supports platform defaults and organization overrides.
Production Cloud starts disabled; turning it on is an explicit administrator
action. Node-local GPU routes are excluded from outbound model mounts.

Run `npm test`. The immutable release archive is published by
`.github/workflows/egress-policy.yml` after its checks pass.
