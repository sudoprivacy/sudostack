# Owner runtime connection

`@sudo/session-runtime` connects an already authorized controller to an existing
owner placement with the official Nexus SDK. It reuses delegated session minting
and renewal from archived Moss `server-v0.1.103`
(`d0b84d4c8fd5905d9ec3f7c160f2ce633f535d0d`,
`src/server/nexus/sessionConnection.ts` and `sessionIdentity.ts`). The new package
requires an explicit owner and mTLS issuer.

```ts
const connection = await connectSessionRuntime({
  endpoint: issuer.endpoint,
  tls: issuer.tls,
  runtimeEndpoint: placement.endpoint,
}, authorizedOwnerId)
try {
  await connection.client.call(method, payload, connection.authToken)
} finally {
  connection.client.close()
}
```

The issuer keeps its original certificate and endpoint. Runtime I/O uses the
delegated owner certificate and an empty bearer token, with the existing owner's
server name for a separate placement. The SDK renews the same delegated identity;
closing it cancels renewal. Certificate/key material remains in controller memory.
Trusted deployment may supply existing issuer PEM paths; this package does not
write delegated credentials or pass controller credentials to agent children.

Current principal, organization, member, resource grants, Agent placement and
native session/host incarnation checks belong to the existing authorities. A
connection is neither their grant nor proof that a native writer stopped. Unknown
execution/cancel outcomes require original native reconciliation. This package
does not start a runtime or create/load/cancel a conversation.

The package pins the same published Node SDK0.8.1 as the reference consumer. That
is separate from the SDK used by `@sudo/user-runtime` for Kubernetes delivery.
Cloud, Private and Edge provide their own trusted placement/issuer configuration;
Python/SDK composition and matched native artifact acceptance remain deployment
requirements. Local mTLS tests use ephemeral fixture issuers and runtimes, not
production credentials or a real Nexus/cohost process.

## Private controller RPC

`sudo-session-runtime-controller` runs the same SDK in a trusted controller
component for a host written in another language. It communicates over private
stdin/stdout and opens no listener. Run it with the controller's verified Node
and package artifacts; this component must never be used as an Agent/engine.

The first UTF-8 JSON line configures one fixed owner and trusted existing issuer
PEM paths:

```json
{"type":"connect","version":1,"ownerId":"alice","config":{"endpoint":"https://issuer:8443","runtimeEndpoint":"https://alice-runtime:8444","tls":{"ca":"/run/controller/ca.pem","cert":"/run/controller/cert.pem","key":"/run/controller/key.pem","serverName":"nexus-node"}}}
```

After `{"type":"ready","version":1}`, send `call` frames with a monotonically
increasing local correlation ID, existing native method name and JSON payload
string. A result returns that same ID and the SDK's original response string.
The private ready frame means the controller SDK is configured; native runtime
readiness, original binding, grants and admission require their actual checks.

Calls always use the delegated owner connection and empty bearer. Per-call
credential, issuer, endpoint or owner overrides are refused. Framing and active
calls are bounded; private correlation IDs are not native operation/delivery
IDs. Writes and failed calls are never retried here. A lost or invalid reply
retains an uncertain native outcome. The only definite local capacity refusal
is `LIMIT_REACHED`, before native dispatch.

Errors expose stable codes. A native JSON-RPC `code`/`message` may also be
returned privately for exact existing-session recovery; it must stay in trusted
controller code. Other exception details, credentials and stacks are omitted.
Closing stdin releases this SDK transport and renewal. It neither cancels a
native task nor proves joined writer cleanup.

The authenticated host checks current authority before opening the controller
and after waits immediately before dispatch. Native services retain their
atomic ownership/effect fences. The process never receives a browser-supplied
principal and must not expose its RPC as an end-user API. It provides native
`Call` only; it does not implement ACP, `NexusSessionTransport`, a mailbox codec,
runtime provisioning or a new credential authority.

Run `npm run build && npm test` for source and actual private-process mTLS
regressions. The TLS helper also supports bounded Python/SDK fixture acceptance;
its keys and native effects are synthetic.
