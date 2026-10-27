# Shared semantic analyzer placement

The native `egress_gate` service still owns every allow, redact and deny
decision. Its Presidio client calls `http://127.0.0.1:59080`. A Caddy relay in
the owner Pod sends classification requests over authenticated TLS. By
default, it uses its actual Kubernetes node and the Chinese model is loaded
once on that node. A deployment can instead share an analyzer on a host with
enough memory by setting `relayMode` to `shared` in its private configuration.
Direct host cohosts can use the existing loopback analyzer deployment.

Transport composition is exported by `@sudo/user-runtime`. Its real Caddy
acceptance covers correct and incorrect TLS identities, authentication,
credential stripping, request isolation and the disabled Caddy admin API.
Only `POST /analyze` is proxied. No access or body log is enabled.

## Prepare the analyzer host

Build the relay image from this directory:

```sh
docker build -t sudo-egress-relay:caddy-2.10.2 security/egress-gate/node-analyzer
```

Use this image for both the node gateway and each owner Pod relay. It removes
the upstream binary's `cap_net_bind_service` file capability because both
ports are above 1024. This permits execution with all capabilities dropped,
without privilege escalation and with a read-only root. An unmodified Caddy
image can fail with `operation not permitted` under these restrictions.
For K3s, import the reviewed image into its container store before enabling
the relay; record the built image identity in the deployment receipt.

Build the shared SDK (`npm ci --ignore-scripts && npm run build` in
`packages/user-runtime`). Build the analyzer from `../presidio/Dockerfile`
at the reviewed commit. On the selected Linux analyzer host, create a private JSON
configuration containing:

```json
{
  "version": 1,
  "dataDirectory": "/var/lib/sudo-egress-analyzer",
  "bindAddress": "10.0.0.8",
  "port": 9448,
  "serverName": "egress-node.internal",
  "analyzerImage": "sudo-presidio-zh:reviewed-commit",
  "gatewayImage": "sudo-egress-relay:caddy-2.10.2",
  "namespace": "moss-sessions",
  "relaySecretName": "sudo-egress-analyzer",
  "kubeconfig": "/private/moss-kubeconfig"
}
```

Use the analyzer host's actual private address for `bindAddress`. The gateway binds
only that address. The analyzer itself is published only on host loopback
port 59081. Protect that host from untrusted host processes. The example
address and image tag must be replaced with observed deployment values.
The preparer rejects an address absent from the local network interfaces
before creating private state or starting infrastructure. Run it on the
selected analyzer host; a controller's SSH address does not identify a compute node.

For node placement, omit `relayMode` or set it to `node`. For a shared analyzer,
add `"relayMode": "shared"`. The shared SDK fixes the relay upstream to
`bindAddress` inside its infrastructure-owned Caddyfile. It retains TLS name
verification, the private CA and the classification credential. Pod placement
and its Downward API address cannot redirect that upstream. Tenant policy
cannot change the mode or address. SDK 0.2.1 provides this rendering option.
Use a new private state directory when changing the placement identity.

For shared placement, the analyzer host needs Docker Compose and enough
memory for the Chinese model. Compute nodes need only the small relay image
in their actual Kubernetes runtime's image store. Identify the compute host
and its runtime socket before importing the image.

Run `node configure.mjs /private/node-analyzer.json` to prepare the private
files and validate Compose. Add `--apply` to start the node service and
deliver its namespace Secret. OpenSSL, Docker Compose and kubectl are required.
The dedicated classifier password and TLS private keys never appear in
command arguments, terminal output or Git. The authority key stays on the
host and is not mounted in either container. Server-side Secret application
does not create a last-applied annotation containing credential copies.

Moss receives only `egressGate.analyzerRelay = { image, secretName }` plus
its deployment's initial `defaultPolicyFile`. Node placement uses Downward API
`status.hostIP`; shared placement uses the fixed deployment address. Only the
relay mounts the Secret, runs as a separate UID and has a read-only root
filesystem. Caddy's admin API and configuration persistence are disabled.
Upgrade existing owner runtimes through the established maintenance path.

The controller's policy file remains read-only inside the agent container.
Moss saves policy revisions and shows the native service's actual applied
revision. A Secret update alone is not proof of enforcement.

## Lifecycle and acceptance

An ordinary business-policy edit is request-scoped and restarts no analyzer,
relay or cohost. Reapplying node preparation preserves the classifier password
and certificates. Infrastructure credential or certificate rotation requires
reloading the gateway and replacing relay Pods through runtime maintenance;
the preparer rejects certificates expiring within a day. Protect and back up
the private deployment directory. This preparer targets one compute node;
additional nodes need gateway certificates under the same trusted authority
before their owner Pods can use the shared relay Secret.

Verify real classification through a canary Pod, refusal on invalid node TLS
or credentials, and the runtime hook's analyzer-unavailable behavior. Then
verify raw local-model control, redacted external-model input, dynamic
on/off, saved-versus-applied status and controller/runtime restart recovery.
Cloud defaults remain disabled while canary acceptance runs.
