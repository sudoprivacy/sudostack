import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { NexusZoneApiClient, userRuntimeServerName, createUserRuntimeCredentialBundle, type SessionCredential, type NexusVfsTlsConfig } from '@nexus-ai-fs/vfs-client'
import { buildKubectlBaseArgs, kubectlApply, readK8sResource, deleteK8sResource, observeK8sRuntime, refreshK8sPodProjection, type K8sResource } from './k8sResources.js'
import { parseCohostBuild, type RuntimeRelease } from './runtimeRelease.js'
import { renewRuntimeSecretData } from './runtimeSecret.js'
import { PRIMARY_RUNTIME_ALLOCATION as PRIMARY_ALLOCATION, runtimeAllocationId as allocationName } from './agentRuntimeHomes.js'
export interface UserRuntimeConnectionConfig {
  endpoint: string
  authToken: string
  tls: NexusVfsTlsConfig
  runtimeEndpoint: string
}

export type UserRuntimeReady = (config: UserRuntimeConnectionConfig, ownerId: string, signal: AbortSignal) => Promise<void>

/** A running owner's configuration can change only through the controlled upgrade path. */
export class UserRuntimeUpdateRequiredError extends Error {
  constructor(readonly reason: 'runtime' | 'model-backend') {
    super(reason === 'runtime'
      ? 'User Pod image or configuration requires an explicit runtime upgrade'
      : 'User Pod model backend changes require an explicit runtime restart')
    this.name = 'UserRuntimeUpdateRequiredError'
  }
}

const OWNER_ANNOTATION = 'moss.sudo.dev/runtime-owner'
const ALLOCATION_ANNOTATION = 'moss.sudo.dev/runtime-allocation'
const SPEC_ANNOTATION = 'moss.sudo.dev/runtime-spec'
const APP_LABEL = 'moss-user-runtime'
const DATA_ROOT = '/data'
const RUNTIME_PORT = 8443
const CREDENTIAL_VALIDITY_SECS = 300

export interface UserPodOptions {
  allocationId?: string
  image: string
  nodeHost: string
  namespace: string
  kubeconfig?: string
  storageClass: string
  storageSize?: string
  runtimeClassName?: string
  cpuLimit?: string
  memoryLimit?: string
  issuer: { endpoint: string; tls: NexusVfsTlsConfig }
  configuration?: (ownerId: string) => Promise<Record<string, string>>
  imagePullPolicy?: string
  imagePullSecrets?: string[]
  release?: RuntimeRelease
}

interface UserPodConnection {
  config: UserRuntimeConnectionConfig
  podUid: string
  close: () => Promise<void>
  configure: (configuration: Record<string, string>) => Promise<void>
}

export interface UserPodResources {
  read: (kind: string, name: string) => Promise<K8sResource | undefined>
  write: (manifest: Record<string, unknown>, verb?: 'create' | 'apply' | 'patch') => Promise<void>
  remove?: (kind: 'pods' | 'secrets', name: string, uid: string) => Promise<void>
  observe?: (name: string) => Promise<{ version: string; binaryDigest: string }>
  refreshProjection?: (name: string, uid: string, ownerId: string) => Promise<void>
}

function kubernetesResources(options: UserPodOptions): UserPodResources {
  const base = buildKubectlBaseArgs(options.namespace, options.kubeconfig)
  return {
    read: (kind, name) => readK8sResource(base, kind, name),
    write: (manifest, verb) => kubectlApply(base, manifest, verb),
    remove: (kind, name, uid) => deleteK8sResource(base, options.namespace, kind, name, uid),
    observe: name => observeK8sRuntime(base, name),
    refreshProjection: (name, uid, ownerId) => refreshK8sPodProjection(base, name, uid, ownerId),
  }
}

/** Stable Kubernetes resource names are placement; signed owner identity controls access. */
export function userPodName(ownerId: string, allocationId = PRIMARY_ALLOCATION): string {
  userRuntimeServerName(ownerId)
  const allocation = allocationName(allocationId)
  const digest = createHash('sha256').update(ownerId)
  if (allocation !== PRIMARY_ALLOCATION) digest.update('\0').update(allocation)
  return `moss-user-${digest.digest('hex').slice(0, 40)}`
}

function userRuntimeCredentialData(ownerId: string, credential: SessionCredential): Record<string, string> {
  const bundle = createUserRuntimeCredentialBundle(ownerId, credential)
  return { [bundle.manifestName]: bundle.manifest.toString('utf8'),
    ...Object.fromEntries(Object.entries(bundle.files).map(([name, bytes]) => [name, bytes.toString('utf8')])) }
}

/** Compose one owner allocation with its own native cohost and durable Nexus volume. */
function userPodManifests(ownerId: string, options: UserPodOptions) {
  const name = userPodName(ownerId, options.allocationId)
  const metadata = { name, namespace: options.namespace, labels: { app: APP_LABEL, runtime: name },
    annotations: { [OWNER_ANNOTATION]: ownerId, [ALLOCATION_ANNOTATION]: options.allocationId ?? PRIMARY_ALLOCATION } }
  const container = {
    name: 'runtime', image: options.image, imagePullPolicy: options.imagePullPolicy ?? 'IfNotPresent',
    command: ['nexusd-cohost'],
    args: ['--data-dir', `${DATA_ROOT}/nexus`, '--root-path', `${DATA_ROOT}/files`,
      '--plugin-dir', '/opt/scode-plugins', '--bind-addr', `0.0.0.0:${RUNTIME_PORT}`,
      'serve-user', '--owner', ownerId, '--credential', '/runtime-identity',
      '--backend-config', '/runtime-config/backend-config.json'],
    env: [{ name: 'SCODE_GLOBAL_CONFIG_DIR', value: `${DATA_ROOT}/scode` },
      { name: 'SCODE_CHECK_UPDATES', value: '0' }, { name: 'HOME', value: '/home/agent' }],
    resources: { requests: { cpu: '100m', memory: '128Mi' },
      limits: { cpu: options.cpuLimit ?? '2', memory: options.memoryLimit ?? '4Gi' } },
    securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
    volumeMounts: [{ name: 'data', mountPath: DATA_ROOT }, { name: 'home', mountPath: '/home/agent' },
      { name: 'credentials', mountPath: '/runtime-identity', readOnly: true },
      { name: 'configuration', mountPath: '/runtime-config', readOnly: true }],
    readinessProbe: { tcpSocket: { port: RUNTIME_PORT }, initialDelaySeconds: 1, periodSeconds: 2 },
  }
  const spec = {
    automountServiceAccountToken: false, restartPolicy: 'Always',
    runtimeClassName: options.runtimeClassName ?? 'gvisor',
    securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 },
    containers: [container],
    initContainers: [{ name: 'configuration', image: options.image,
      imagePullPolicy: options.imagePullPolicy ?? 'IfNotPresent',
      command: ['sh', '-ec',
        'mkdir -p /data/scode /data/files; if [ -e /data/scode/sudocode.json ] || [ -L /data/scode/sudocode.json ]; then test "$(readlink /data/scode/sudocode.json)" = /runtime-config/sudocode.json; else ln -s /runtime-config/sudocode.json /data/scode/sudocode.json; fi'],
      securityContext: container.securityContext,
      volumeMounts: [{ name: 'data', mountPath: DATA_ROOT },
        { name: 'configuration', mountPath: '/runtime-config', readOnly: true }],
    }],
    imagePullSecrets: (options.imagePullSecrets ?? []).map(name => ({ name })),
    volumes: [{ name: 'data', persistentVolumeClaim: { claimName: name } },
      { name: 'home', emptyDir: {} }, { name: 'credentials', secret: { secretName: name } },
      { name: 'configuration', secret: { secretName: name, items: [
        { key: 'sudocode.json', path: 'sudocode.json' },
        { key: 'backend-config.json', path: 'backend-config.json' },
      ] } }],
  }
  const digest = createHash('sha256').update(JSON.stringify({ spec, release: options.release })).digest('hex')
  return {
    pod: { apiVersion: 'v1', kind: 'Pod', metadata: { ...metadata,
      annotations: { ...metadata.annotations, [SPEC_ANNOTATION]: digest,
        ...(options.release ? { 'moss.sudo.dev/runtime-release': options.release.releaseId,
          'moss.sudo.dev/engine-commit': options.release.engine.commit,
          'moss.sudo.dev/cohost-digest': options.release.cohost.binaryDigest } : {}) } }, spec },
    claim: { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata,
      spec: { accessModes: ['ReadWriteOnce'], storageClassName: options.storageClass,
        resources: { requests: { storage: options.storageSize ?? '10Gi' } } } },
    secret: { apiVersion: 'v1', kind: 'Secret', type: 'Opaque', metadata },
    service: { apiVersion: 'v1', kind: 'Service', metadata,
      spec: { type: 'NodePort', selector: metadata.labels,
        ports: [{ name: 'nexus', port: RUNTIME_PORT, targetPort: RUNTIME_PORT, protocol: 'TCP' }] } },
  }
}

/** Coordinates user boxes without storing addresses, credentials or PID presence in SQL. */
export class UserPodService {
  private allocationRoot?: UserPodService
  private readonly allocations = new Map<string, UserPodService>()
  private readonly connections = new Map<string, Promise<UserPodConnection>>()
  private readonly pendingResolutions = new Map<string, Promise<UserPodConnection>>()
  private readonly lifecycle = new AbortController()
  private readonly runtimeHost: string

  constructor(private readonly options: UserPodOptions, private readonly resources = kubernetesResources(options),
    private readonly ready: UserRuntimeReady) {
    this.options = { ...options, allocationId: allocationName(options.allocationId ?? PRIMARY_ALLOCATION) }
    if (typeof ready !== 'function') throw new Error('User runtimes require authenticated readiness verification')
    if (!options.image || !options.storageClass) throw new Error('User Pods require an image and retained storage')
    if (!options.nodeHost) throw new Error('User Pods require a private compute node host')
    const host = new URL(`https://${options.nodeHost}`)
    if (host.username || host.password || host.port || host.pathname !== '/' || host.search || host.hash) {
      throw new Error('User Pod compute host must be a hostname or IP address')
    }
    this.runtimeHost = host.hostname
    if (options.release && options.release.image.reference !== options.image) throw new Error('User runtime image differs from the shared release manifest')
  }

  /** Scope placement and retained storage while preserving the signed user identity. */
  forAllocation(allocationId: string): UserPodService {
    const root = this.allocationRoot ?? this
    if (root.lifecycle.signal.aborted) throw new Error('User Pod service is closed')
    allocationName(allocationId)
    if (allocationId === (root.options.allocationId ?? PRIMARY_ALLOCATION)) return root
    let service = root.allocations.get(allocationId)
    if (!service || service.lifecycle.signal.aborted) {
      service = new UserPodService({ ...root.options, allocationId }, root.resources, root.ready)
      service.allocationRoot = root
      root.allocations.set(allocationId, service)
    }
    return service
  }

  private async readAllocationResource(kind: string, name: string): Promise<K8sResource | undefined> {
    const resource = await this.resources.read(kind, name)
    const allocation = resource?.metadata.annotations?.[ALLOCATION_ANNOTATION] ?? PRIMARY_ALLOCATION
    if (resource && allocation !== (this.options.allocationId ?? PRIMARY_ALLOCATION)) {
      throw new Error('User runtime resource belongs to another allocation')
    }
    if (kind === 'pod' && resource?.spec) {
      const volumes = z.array(z.object({ name: z.string(), persistentVolumeClaim: z.object({
        claimName: z.string(), readOnly: z.boolean().optional(),
      }).optional() })).parse(resource.spec.volumes)
      const claims = volumes.filter(volume => volume.persistentVolumeClaim)
      if (claims.length !== 1 || claims[0]!.name !== 'data' || claims[0]!.persistentVolumeClaim!.claimName !== name || claims[0]!.persistentVolumeClaim!.readOnly) {
        throw new Error('User runtime data volume does not belong to this allocation')
      }
    }
    return resource
  }

  /** Report version drift without provisioning a missing runtime. */
  async inspect(ownerId: string) {
    const pod = await this.readAllocationResource('pod', userPodName(ownerId, this.options.allocationId))
    if (pod && pod.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) throw new Error('User Pod belongs to another owner')
    const expected = userPodManifests(ownerId, this.options).pod
    return { ownerId, allocationId: this.options.allocationId ?? PRIMARY_ALLOCATION, isPresent: Boolean(pod), isDrifted: Boolean(pod && (pod.metadata.annotations?.[SPEC_ANNOTATION] !== expected.metadata.annotations[SPEC_ANNOTATION] ||
      (this.options.release && pod.status?.phase === 'Running' && !this.isReleaseImage(pod)))),
      phase: pod?.status?.phase ?? 'absent', expectedImage: this.options.image,
      observedImageDigest: pod?.status?.containerStatuses?.find(container => container.name === 'runtime')?.imageID ?? null,
      releaseId: this.options.release?.releaseId ?? null }
  }

  private isReleaseImage(pod: K8sResource): boolean {
    const imageId = pod.status?.containerStatuses?.find(container => container.name === 'runtime')?.imageID
    const release = this.options.release
    if (!release) return true
    // Config hashes from loaded image archives differ from registry manifest
    // hashes. Refuse an ambiguous report instead of comparing unlike digests.
    const observed = release.image.digestKind === 'oci-config'
      ? /^(?:docker:\/\/)?(sha256:[a-f0-9]{64})$/.exec(imageId ?? '')?.[1]
      : /@(sha256:[a-f0-9]{64})$/.exec(imageId ?? '')?.[1]
    return observed === release.image.digest
  }

  /** Serialize rollouts across controllers; only the Pod is replaced and the owner PVC is retained. */
  async upgrade(ownerId: string, drain: (previous?: UserRuntimeConnectionConfig) => Promise<void>, configuration?: Record<string, string>): Promise<UserRuntimeConnectionConfig> {
    if (this.lifecycle.signal.aborted) throw new Error('User Pod service is closed')
    if (!this.resources.remove) throw new Error('Runtime replacement is unavailable')
    const name = userPodName(ownerId, this.options.allocationId)
    const lockName = `${name}-upgrade`
    const operation = randomUUID()
    await this.resources.write({ apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
      metadata: { name: lockName, namespace: this.options.namespace,
        annotations: { [OWNER_ANNOTATION]: ownerId, [ALLOCATION_ANNOTATION]: this.options.allocationId ?? PRIMARY_ALLOCATION, 'moss.sudo.dev/upgrade-operation': operation } }, stringData: {} }, 'create')
    const lock = await this.readAllocationResource('secret', lockName)
    if (!lock?.metadata.uid || lock.metadata.annotations?.['moss.sudo.dev/upgrade-operation'] !== operation) throw new Error('Runtime upgrade lock was not acquired')
    try {
      await this.pendingResolutions.get(ownerId)
      const pending = this.connections.get(ownerId)
      if (pending) await pending
      const pod = await this.readAllocationResource('pod', name)
      if (pod && (pod.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId || !pod.metadata.uid)) throw new Error('User Pod belongs to another owner or lacks an identity')
      // A restarted controller may discover an older image whose short-lived
      // server identity has expired. Restore authenticated access to that same
      // Pod before checking whether its agents can safely drain.
      let previous: UserRuntimeConnectionConfig | undefined
      if (pod) {
        previous = await this.runtimeConnection(ownerId)
        await this.refreshUpgradeIdentity(ownerId, pod)
        await this.ready(previous, ownerId, this.lifecycle.signal)
        await this.assertUpgradePod(ownerId, pod)
      }
      await drain(previous)
      if (pod) await this.assertUpgradePod(ownerId, pod)
      const connection = this.connections.get(ownerId)
      if (connection) await (await connection).close()
      this.connections.delete(ownerId)
      // Join configuration delivery and certificate renewal before capturing
      // rollback state or replacing the Secret with the next runtime's data.
      const savedSecret = await this.readAllocationResource('secret', name)
      if (savedSecret && savedSecret.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) throw new Error('User Pod Secret belongs to another owner')
      const saved: Record<string, string> = {}
      for (const key of ['sudocode.json', 'backend-config.json']) {
        if (savedSecret?.data?.[key]) saved[key] = Buffer.from(savedSecret.data[key], 'base64').toString('utf8')
      }
      if (pod) {
        await this.resources.remove('pods', name, pod.metadata.uid!)
        await this.waitForPodRemoval(name)
      }
      const next = this.open(ownerId, configuration)
      this.connections.set(ownerId, next)
      try { return (await next).config }
      catch (error) {
        this.connections.delete(ownerId)
        if (pod?.spec) {
          try {
            const failed = await this.readAllocationResource('pod', name)
            if (failed) {
              const expected = userPodManifests(ownerId, this.options).pod
              if (failed.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId || !failed.metadata.uid ||
                failed.metadata.annotations?.[SPEC_ANNOTATION] !== expected.metadata.annotations[SPEC_ANNOTATION]) {
                throw new Error('Runtime rollback refused a replacement with another identity')
              }
              await this.resources.remove('pods', name, failed.metadata.uid)
              await this.waitForPodRemoval(name)
            }
            const restored = this.open(ownerId, saved, pod)
            this.connections.set(ownerId, restored)
            await restored
          } catch (rollbackError) {
            this.connections.delete(ownerId)
            throw new AggregateError([error, rollbackError], 'Runtime upgrade and rollback failed; the owner volume is retained')
          }
        }
        throw error
      }
    } finally {
      await this.resources.remove('secrets', lockName, lock.metadata.uid)
    }
  }

  private async waitForPodRemoval(name: string): Promise<void> {
    const deadline = Date.now() + 90_000
    while (await this.readAllocationResource('pod', name)) {
      if (Date.now() >= deadline) throw new Error('User runtime did not finish draining within 90 seconds')
      await delay(1000)
    }
  }

  private async assertUpgradePod(ownerId: string, observed: K8sResource): Promise<void> {
    const current = await this.readAllocationResource('pod', userPodName(ownerId, this.options.allocationId))
    if (!current || !observed.metadata.uid || current.metadata.uid !== observed.metadata.uid || current.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) {
      throw new Error('User Pod identity changed during runtime upgrade')
    }
  }

  private async refreshUpgradeIdentity(ownerId: string, pod: K8sResource): Promise<void> {
    const name = userPodName(ownerId, this.options.allocationId)
    const secret = await this.readAllocationResource('secret', name)
    if (!secret?.metadata.uid || secret.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) {
      throw new Error('User Pod Secret belongs to another owner or lacks an identity')
    }
    await this.assertUpgradePod(ownerId, pod)
    const issuer = NexusZoneApiClient.withMtls(this.options.issuer.endpoint, this.options.issuer.tls)
    try {
      const credential = await issuer.mintUserRuntime(ownerId, { validitySecs: CREDENTIAL_VALIDITY_SECS })
      await this.assertUpgradePod(ownerId, pod)
      // Keep projected model configuration and use the observed Secret version
      // so a concurrent replacement cannot receive another Pod's update.
      await this.updateCredentialSecret(ownerId, secret, userRuntimeCredentialData(ownerId, credential), credential.caPem, pod.metadata.uid!)
    } finally { issuer.close() }
  }

  private async updateCredentialSecret(ownerId: string, secret: K8sResource, values: Record<string, string>, ca: Buffer, podUid?: string): Promise<void> {
    if (!secret.metadata.uid || !secret.metadata.resourceVersion || secret.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) throw new Error('Credential update requires the observed owner Secret identity and version')
    const annotations = { ...secret.metadata.annotations }
    // JSON Patch tests the identity/version/owner and updates data atomically,
    // without copying certificate history into the apply annotation.
    await this.resources.write({ apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
      metadata: { name: secret.metadata.name, namespace: this.options.namespace,
        uid: secret.metadata.uid, resourceVersion: secret.metadata.resourceVersion,
        annotations, labels: secret.metadata.labels },
      data: renewRuntimeSecretData(ownerId, secret.data ?? {}, values, ca) }, 'patch')
    // A Pod update asks kubelet to project the new generation before readiness.
    if (podUid) await this.resources.refreshProjection?.(secret.metadata.name, podUid, ownerId)
  }

  private async runtimeConnection(ownerId: string): Promise<UserRuntimeConnectionConfig> {
    const name = userPodName(ownerId, this.options.allocationId)
    const service = await this.readAllocationResource('service', name)
    if (service?.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) throw new Error('User Pod Service belongs to another owner')
    const serviceSpec = z.object({ type: z.literal('NodePort'), selector: z.record(z.string(), z.string()),
      ports: z.array(z.object({ name: z.literal('nexus'), port: z.literal(RUNTIME_PORT),
        targetPort: z.literal(RUNTIME_PORT), nodePort: z.number().int().min(1).max(65535) })).length(1),
    }).parse(service.spec)
    if (serviceSpec.selector.app !== APP_LABEL || serviceSpec.selector.runtime !== name) throw new Error('User Pod Service does not select its owned runtime')
    return { ...this.options.issuer, authToken: '', runtimeEndpoint: `https://${this.runtimeHost}:${serviceSpec.ports[0]!.nodePort}` }
  }

  /** Discover an existing owner box without creating a Pod or workspace for a list request. */
  async find(ownerId: string): Promise<UserRuntimeConnectionConfig | undefined> {
    const pod = await this.readAllocationResource('pod', userPodName(ownerId, this.options.allocationId))
    if (!pod) return undefined
    if (pod.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) throw new Error('User Pod belongs to another owner')
    return this.resolve(ownerId)
  }

  async resolve(ownerId: string, configuration?: Record<string, string>): Promise<UserRuntimeConnectionConfig> {
    if (this.lifecycle.signal.aborted) throw new Error('User Pod service is closed')
    userPodName(ownerId, this.options.allocationId)
    let resolution = this.pendingResolutions.get(ownerId)
    if (!resolution) {
      resolution = this.resolveConnection(ownerId, configuration)
      this.pendingResolutions.set(ownerId, resolution)
    }
    try {
      const connection = await resolution
      if (configuration) await connection.configure(configuration)
      return connection.config
    } finally {
      if (this.pendingResolutions.get(ownerId) === resolution) this.pendingResolutions.delete(ownerId)
    }
  }

  private async resolveConnection(ownerId: string, configuration?: Record<string, string>): Promise<UserPodConnection> {
    const name = userPodName(ownerId, this.options.allocationId)
    const [lock, pod] = await Promise.all([
      this.readAllocationResource('secret', `${name}-upgrade`),
      this.readAllocationResource('pod', name),
    ])
    if (lock) throw new Error('User runtime is draining for an upgrade')
    if (pod && pod.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) throw new Error('User Pod belongs to another owner')
    let connection = this.connections.get(ownerId)
    if (connection) {
      const existing = await connection
      if (pod?.metadata.uid === existing.podUid && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')) {
        return existing
      }
      await existing.close()
      this.connections.delete(ownerId)
    }
    connection = this.open(ownerId, configuration)
    this.connections.set(ownerId, connection)
    try { return await connection } catch (error) {
      if (this.connections.get(ownerId) === connection) this.connections.delete(ownerId)
      throw error
    }
  }

  private async open(ownerId: string, suppliedConfiguration?: Record<string, string>, previousPod?: K8sResource): Promise<UserPodConnection> {
    const manifests = userPodManifests(ownerId, this.options)
    if (previousPod) {
      if (previousPod.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId || !previousPod.spec) throw new Error('Runtime rollback requires the observed owner Pod')
      manifests.pod = { ...manifests.pod, metadata: { ...manifests.pod.metadata,
        annotations: previousPod.metadata.annotations as typeof manifests.pod.metadata.annotations },
      spec: previousPod.spec as typeof manifests.pod.spec }
    }
    const name = manifests.pod.metadata.name
    const assertOwner = async (kind: string) => {
      const existing = await this.readAllocationResource(kind, name)
      if (existing && existing.metadata.annotations?.[OWNER_ANNOTATION] !== ownerId) {
        throw new Error(`User Pod ${kind} belongs to another owner`)
      }
      return existing
    }
    const ensureCreated = async (kind: string, manifest: Record<string, unknown>) => {
      if (await assertOwner(kind)) return
      try { await this.resources.write(manifest, 'create') } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('AlreadyExists')) throw error
        await assertOwner(kind)
      }
    }
    const existingPod = await assertOwner('pod')
    if (existingPod && !existingPod.metadata.uid) throw new Error('Existing user Pod lacks an observed identity')
    let projectionPodUid = existingPod?.metadata.uid
    if (existingPod && existingPod.metadata.annotations?.[SPEC_ANNOTATION] !== manifests.pod.metadata.annotations[SPEC_ANNOTATION]) {
      throw new UserRuntimeUpdateRequiredError('runtime')
    }
    const defaults = { 'sudocode.json': '{}', 'backend-config.json': '{"mounts":[]}' }
    const savedSecret = await assertOwner('secret')
    await assertOwner('service')
    await assertOwner('pvc')
    const saved: Record<string, string> = {}
    for (const key of Object.keys(defaults)) {
      const encoded = savedSecret?.data?.[key]
      if (encoded !== undefined) saved[key] = Buffer.from(encoded, 'base64').toString('utf8')
      else if (existingPod) throw new Error('Existing User Pod configuration is incomplete')
    }
    const requested = suppliedConfiguration ?? await this.options.configuration?.(ownerId)
    let configuration: Record<string, string> = { ...defaults, ...saved, ...requested }
    if (existingPod && saved['backend-config.json'] !== configuration['backend-config.json']) {
      throw new UserRuntimeUpdateRequiredError('model-backend')
    }
    await ensureCreated('pvc', manifests.claim)
    let updates = Promise.resolve()
    const refresh = (replacement?: Record<string, string>) => {
      const update = updates.catch(() => {}).then(async () => {
        const observed = await assertOwner('secret')
        const next = replacement ?? configuration
        const issuer = NexusZoneApiClient.withMtls(this.options.issuer.endpoint, this.options.issuer.tls)
        try {
          const credential = await issuer.mintUserRuntime(ownerId, { validitySecs: CREDENTIAL_VALIDITY_SECS })
          const values = { ...next, ...userRuntimeCredentialData(ownerId, credential) }
          if (observed) await this.updateCredentialSecret(ownerId, observed, values, credential.caPem, projectionPodUid)
          else await this.resources.write({ ...manifests.secret, stringData: values }, 'create')
          configuration = next
        } finally { issuer.close() }
      })
      updates = update
      return update
    }
    await refresh()
    await ensureCreated('pod', manifests.pod)
    const pod = await assertOwner('pod')
    if (pod?.metadata.annotations?.[SPEC_ANNOTATION] !== manifests.pod.metadata.annotations[SPEC_ANNOTATION]) {
      throw new UserRuntimeUpdateRequiredError('runtime')
    }
    const deadline = Date.now() + 90_000
    let readyPod: K8sResource
    while (true) {
      if (this.lifecycle.signal.aborted) throw new Error('User Pod service is closed')
      const current = await assertOwner('pod')
      if (current?.metadata.uid && current.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')) {
        readyPod = current
        break
      }
      if (current?.status?.phase === 'Failed' || current?.status?.phase === 'Succeeded') {
        throw new Error('User Pod exited before its service became ready')
      }
      if (Date.now() >= deadline) throw new Error('User Pod service did not become Ready within 90 seconds')
      await delay(1000)
    }
    await ensureCreated('service', manifests.service)
    const config = await this.runtimeConnection(ownerId)
    if (this.options.release && !previousPod) {
      const runningPod = await assertOwner('pod')
      if (!runningPod || !this.isReleaseImage(runningPod)) throw new Error('Running user runtime image differs from the verified release manifest')
      if (!this.resources.observe) throw new Error('Runtime build verification is unavailable')
      const observed = await this.resources.observe(name)
      const build = parseCohostBuild(observed.version)
      const expected = this.options.release
      if (build.commit !== expected.engine.commit || build.version !== expected.cohost.version ||
        build.nexusVersion !== expected.cohost.nexusVersion || build.pluginAbi !== expected.cohost.pluginAbi ||
        observed.binaryDigest !== expected.cohost.binaryDigest) throw new Error('Running user runtime differs from the verified release manifest')
    }
    projectionPodUid = readyPod.metadata.uid
    await this.ready(config, ownerId, this.lifecycle.signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    let isActive = true
    const renew = async () => {
      if (!isActive || this.lifecycle.signal.aborted) return
      let retryMs = 90_000
      try { await refresh() } catch {
        retryMs = 5_000
        process.stderr.write('[UserPodService] runtime credential renewal failed; retrying in five seconds\n')
      }
      if (isActive) { timer = setTimeout(() => { void renew() }, retryMs); timer.unref() }
    }
    timer = setTimeout(() => { void renew() }, 90_000)
    timer.unref()
    return {
      podUid: readyPod.metadata.uid!,
      configure: async (next) => {
        if (!isActive || this.lifecycle.signal.aborted) throw new Error('User Pod connection is closed')
        const replacement = { ...defaults, ...next }
        if (configuration['backend-config.json'] !== replacement['backend-config.json']) {
          throw new UserRuntimeUpdateRequiredError('model-backend')
        }
        if (JSON.stringify(configuration) === JSON.stringify(replacement)) return
        await refresh(replacement)
      },
      config,
      close: async () => {
        isActive = false
        clearTimeout(timer)
        await updates.catch(() => {})
      },
    }
  }

  /** Disconnect controller transports while retaining owned Pods and user volumes. */
  async close(): Promise<void> {
    this.lifecycle.abort()
    if (!this.allocationRoot) {
      await Promise.allSettled([...this.allocations.values()].map(service => service.close()))
      this.allocations.clear()
    }
    await Promise.allSettled(this.pendingResolutions.values())
    await Promise.allSettled([...this.connections.values()].map(async connection => (await connection).close()))
    this.connections.clear()
  }
}
