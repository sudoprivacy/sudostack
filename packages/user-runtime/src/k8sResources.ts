import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)
const ResourceSchema = z.object({
  metadata: z.object({
    name: z.string(), uid: z.string().optional(), resourceVersion: z.string().optional(),
    annotations: z.record(z.string(), z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }).passthrough(),
  status: z.object({ phase: z.string().optional(), podIP: z.string().optional(),
    conditions: z.array(z.object({ type: z.string(), status: z.string() }).passthrough()).optional(),
    containerStatuses: z.array(z.object({ name: z.string(), imageID: z.string() }).passthrough()).optional(),
  }).passthrough().optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.string()).optional(),
}).passthrough()
export type K8sResource = z.infer<typeof ResourceSchema>

export function buildKubectlBaseArgs(namespace: string, kubeconfig?: string): string[] {
  return [...(kubeconfig ? ['--kubeconfig', kubeconfig] : []), '--namespace', namespace]
}

/** Read resource metadata through the controller's Kubernetes identity. */
export async function readK8sResource(base: string[], kind: string, name: string): Promise<K8sResource | undefined> {
  let stdout: string
  try {
    ({ stdout } = await execFileAsync('kubectl', [...base, 'get', kind, name, '--ignore-not-found', '-o', 'json'],
      { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }))
  } catch (error) {
    throw formatKubectlApplyError(null, String((error as { stderr?: unknown }).stderr ?? ''), 'get')
  }
  return stdout.trim() ? ResourceSchema.parse(JSON.parse(stdout)) : undefined
}

/** Keep credentials in stdin and report only the Kubernetes error category. */
export async function kubectlApply(base: string[], manifest: Record<string, unknown>, verb: 'apply' | 'create' | 'patch' = 'apply'): Promise<void> {
  if (verb === 'patch') {
    const secret = ResourceSchema.parse(manifest)
    const owner = secret.metadata.annotations?.['moss.sudo.dev/runtime-owner']
    if (manifest.kind !== 'Secret' || !secret.metadata.uid || !secret.metadata.resourceVersion || !owner || !secret.data) throw new Error('Credential patch requires the observed owner Secret and version')
    const patch: Record<string, unknown>[] = [
      { op: 'test', path: '/metadata/uid', value: secret.metadata.uid },
      { op: 'test', path: '/metadata/resourceVersion', value: secret.metadata.resourceVersion },
      { op: 'test', path: '/metadata/annotations/moss.sudo.dev~1runtime-owner', value: owner },
      { op: 'add', path: '/data', value: secret.data },
    ]
    if (Object.hasOwn(secret.metadata.annotations!, 'kubectl.kubernetes.io/last-applied-configuration')) patch.push({ op: 'remove', path: '/metadata/annotations/kubectl.kubernetes.io~1last-applied-configuration' })
    // kubectl patch does not treat --patch-file - as stdin. Keep credentials
    // out of argv in a private temporary file and retire it on every outcome.
    const directory = await mkdtemp(join(tmpdir(), 'sudo-runtime-secret-'))
    const patchFile = join(directory, 'patch.json')
    try {
      await writeFile(patchFile, JSON.stringify(patch), { mode: 0o600, flag: 'wx' })
      return await kubectlJsonRequest(base, ['patch', 'secret', secret.metadata.name, '--type=json', '--patch-file', patchFile], undefined, verb)
    } finally {
      await rm(patchFile, { force: true })
      await rmdir(directory)
    }
  }
  return kubectlJsonRequest(base, [verb, '-f', '-'], manifest, verb)
}

/** Delete exactly the observed object, preserving a concurrently replaced resource with the same name. */
export async function deleteK8sResource(base: string[], namespace: string, kind: 'pods' | 'secrets', name: string, uid: string): Promise<void> {
  if (!uid || !/^[a-z0-9-]+$/.test(namespace) || !/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid owned Kubernetes resource')
  return kubectlJsonRequest(base, ['delete', '--raw', `/api/v1/namespaces/${namespace}/${kind}/${name}`, '-f', '-'],
    { apiVersion: 'v1', kind: 'DeleteOptions', preconditions: { uid }, gracePeriodSeconds: 30 }, 'delete')
}

/** Ask kubelet to refresh projected credentials without replacing a busy Pod. */
export async function refreshK8sPodProjection(base: string[], name: string, uid: string, ownerId: string): Promise<void> {
  if (!uid || !/^[a-z0-9-]+$/.test(name) || !ownerId) throw new Error('Invalid owned Kubernetes Pod')
  const patch = [
    { op: 'test', path: '/metadata/uid', value: uid },
    { op: 'test', path: '/metadata/annotations/moss.sudo.dev~1runtime-owner', value: ownerId },
    { op: 'add', path: '/metadata/annotations/moss.sudo.dev~1credential-projection', value: randomUUID() },
  ]
  try {
    await execFileAsync('kubectl', [...base, 'patch', 'pod', name, '--type=json', '--patch', JSON.stringify(patch)],
      { windowsHide: true, timeout: 30_000, maxBuffer: 32_768 })
  } catch (error) {
    throw formatKubectlApplyError(null, String((error as { stderr?: unknown }).stderr ?? ''), 'patch')
  }
}

async function kubectlJsonRequest(base: string[], args: string[], manifest: Record<string, unknown> | Record<string, unknown>[] | undefined, verb: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('kubectl', [...base, ...args], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`kubectl ${verb} timed out`))
    }, 60_000)
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-32_768) })
    child.stdin.on('error', () => {})
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(formatKubectlApplyError(code, stderr, verb))
    })
    child.stdin.end(manifest === undefined ? undefined : JSON.stringify(manifest))
  })
}

/** Inspect the executable actually running as PID 1, rather than only the Pod's requested tag. */
export async function observeK8sRuntime(base: string[], name: string): Promise<{ version: string; binaryDigest: string }> {
  const { stdout } = await execFileAsync('kubectl', [...base, 'exec', name, '-c', 'runtime', '--',
    'sh', '-ec', 'nexusd-cohost --version; sha256sum /proc/1/exe'],
  { windowsHide: true, timeout: 30_000, maxBuffer: 32_768 })
  const hash = /^([a-f0-9]{64})\s+\/proc\/1\/exe$/m.exec(stdout)?.[1]
  if (!hash) throw new Error('Runtime executable digest is missing')
  return { version: stdout.split('\n')[0]!.trim(), binaryDigest: `sha256:${hash}` }
}

export function isImmutablePodSpecError(error: unknown): boolean {
  return /may not change fields other than|field is immutable/i.test(error instanceof Error ? error.message : String(error))
}

/** Preserve actionable API errors without exposing manifests echoed by kubectl. */
export function formatKubectlApplyError(code: number | null, stderr: string, verb = 'apply'): Error {
  const reason = /Error from server \((\w+)\)/.exec(stderr)?.[1]
  const allowedReasons = new Set([
    'Forbidden', 'Unauthorized', 'NotFound', 'AlreadyExists', 'Invalid', 'BadRequest',
    'Timeout', 'ServerTimeout', 'InternalError', 'ServiceUnavailable', 'Gone', 'Conflict',
  ])
  const detail = isImmutablePodSpecError(new Error(stderr))
    ? 'pod spec field is immutable'
    : /metadata\.annotations.*(?:Too long|262144)/s.test(stderr) ? 'metadata annotations exceed the Kubernetes size limit'
    : /Secret.*(?:Too long|1048576)/s.test(stderr) ? 'Secret data exceeds the Kubernetes size limit'
    : reason && allowedReasons.has(reason) ? 'Kubernetes API ' + reason : 'manifest rejected'
  return new Error('kubectl ' + verb + ' failed (code ' + code + '): ' + detail)
}
