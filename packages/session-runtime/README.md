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
