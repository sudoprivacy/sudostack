import {
  NexusVfsClient,
  NexusZoneApiClient,
  userRuntimeServerName,
  type NexusVfsClientOptions,
  type NexusVfsTlsConfig,
  type SessionCredential,
} from '@nexus-ai-fs/vfs-client'

export const SESSION_CREDENTIAL_VALIDITY_SECS = 300

export interface SessionConnectionConfig {
  /** Existing authorized credential issuer, resolved by trusted composition. */
  endpoint: string
  tls: NexusVfsTlsConfig
  /** Existing placement of this owner; the issuer endpoint stays separate. */
  runtimeEndpoint?: string
}

export interface SessionIdentity {
  readonly credential: SessionCredential
  readonly tls: NexusVfsTlsConfig
  readonly subjectId: string
}

export interface SessionRuntimeConnection {
  readonly client: NexusVfsClient
  readonly authToken: ''
  readonly identity: SessionIdentity
}

function copyTls(tls: NexusVfsTlsConfig): NexusVfsTlsConfig {
  if (!tls || !tls.ca || !tls.cert || !tls.key) {
    throw new Error('An owner runtime requires an authenticated mTLS credential issuer')
  }
  const copy = (value: Buffer | string): Buffer | string =>
    Buffer.isBuffer(value) ? Buffer.from(value) : value
  return { ca: copy(tls.ca), cert: copy(tls.cert), key: copy(tls.key), serverName: tls.serverName }
}

/** Renew through the existing minter; closing the SDK connection cancels renewal. */
export async function renewSessionCredential(
  endpoint: string,
  tls: NexusVfsTlsConfig,
  current: SessionCredential,
  signal: AbortSignal,
): Promise<SessionCredential> {
  signal.throwIfAborted()
  const zoneApi = NexusZoneApiClient.withMtls(endpoint, tls)
  const onAbort = (): void => { zoneApi.close() }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    signal.throwIfAborted()
    return await zoneApi.renewSessionAgent(current, { validitySecs: SESSION_CREDENTIAL_VALIDITY_SECS })
  } finally {
    signal.removeEventListener('abort', onAbort)
    zoneApi.close()
  }
}

/** Connect as the already authorized owner using Nexus's existing delegated lease.
 *
 * The caller checks current membership, placement and operation grants before
 * invoking this capability. This function does not authorize those decisions.
 * Credentials stay in the execution controller and must not reach agent children.
 */
export async function connectSessionRuntime(
  config: SessionConnectionConfig,
  ownerId: string,
  options: Omit<NexusVfsClientOptions, 'tls'> = {},
): Promise<SessionRuntimeConnection> {
  if (typeof ownerId !== 'string' || !ownerId) {
    throw new Error('An owner runtime requires an authenticated owner')
  }
  // Validate with the existing native codec before touching the credential issuer.
  const runtimeName = userRuntimeServerName(ownerId)
  const endpoint = config.endpoint
  const runtimeEndpoint = config.runtimeEndpoint
  if (typeof endpoint !== 'string' || !endpoint ||
    (runtimeEndpoint !== undefined && (typeof runtimeEndpoint !== 'string' || !runtimeEndpoint))) {
    throw new Error('An owner runtime requires an explicit issuer and placement')
  }
  // Capture trusted selection before the first await. Caller mutation cannot
  // retarget execution/renewal or replace byte-backed issuer credentials later.
  const minterTls = copyTls(config.tls)
  const clientOptions = { ...options }
  const zoneApi = NexusZoneApiClient.withMtls(endpoint, minterTls)
  let credential: SessionCredential
  try {
    credential = await zoneApi.mintSessionAgent(ownerId, {
      validitySecs: SESSION_CREDENTIAL_VALIDITY_SECS,
    })
  } finally {
    zoneApi.close()
  }
  const identity: SessionIdentity = {
    credential,
    get subjectId() { return credential.subjectId },
    get tls() {
      return { ca: credential.caPem, cert: credential.certPem, key: credential.keyPem,
        serverName: runtimeEndpoint ? runtimeName : minterTls.serverName }
    },
  }
  const client = NexusVfsClient.withMtls(runtimeEndpoint ?? endpoint, identity.tls, clientOptions)
  try {
    client.maintainSessionCredential(credential, {
      validitySecs: SESSION_CREDENTIAL_VALIDITY_SECS,
      renew: (current, signal) => renewSessionCredential(endpoint, minterTls, current, signal),
    })
  } catch (error) {
    client.close()
    throw error
  }
  // Per-request deployment tokens can override mTLS identity; use only the
  // delegated owner connection for execution, files and mailbox operations.
  return Object.freeze({ client, authToken: '' as const, identity })
}
