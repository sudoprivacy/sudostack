import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { UserPodResources } from '../src/userPodService.js'
import type { K8sResource } from '../src/k8sResources.js'

/** In-memory Kubernetes objects with the same creation and patch identities as the controller. */
export function userPodPlatform(isScopedByName = false) {
  const objects = new Map<string, K8sResource>()
  const ports = new Map<string, number>()
  const key = (kind: string, name: string) => isScopedByName ? `${kind}:${name}` : name.endsWith('-upgrade') ? 'upgrade-secret' : kind
  const writes: Array<{ kind: string; manifest: Record<string, unknown> }> = []
  const resources: UserPodResources = {
    async read(kind, name) { return objects.get(key(kind, name)) },
    async write(manifest) {
      const kind = manifest.kind === 'PersistentVolumeClaim' ? 'pvc' : String(manifest.kind).toLowerCase()
      writes.push({ kind, manifest })
      const metadata = manifest.metadata as K8sResource['metadata']
      const previousData = manifest.data as Record<string, string> | undefined
      if (kind === 'service' && !ports.has(metadata.name)) ports.set(metadata.name, 31443 + ports.size)
      objects.set(key(kind, metadata.name),
        { metadata: { ...metadata, uid: metadata.uid ?? randomUUID(), resourceVersion: String(Number(metadata.resourceVersion ?? 0) + 1) },
        ...(manifest.spec ? { spec: manifest.spec as Record<string, unknown> } : {}),
        ...(kind === 'secret' ? { data: { ...previousData, ...Object.fromEntries(Object.entries((manifest.stringData ?? {}) as Record<string, string>)
          .map(([key, value]) => [key, Buffer.from(value).toString('base64')])) } } : {}),
        ...(kind === 'service' ? { spec: { ...manifest.spec as object,
          ports: [{ name: 'nexus', port: 8443, targetPort: 8443, nodePort: isScopedByName ? ports.get(metadata.name)! : 31443 }] } } : {}),
        ...(kind === 'pod' ? { status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } } : {}) })
    },
    async remove(kind, name, uid) {
      const resourceKey = key(kind === 'pods' ? 'pod' : 'secret', name)
      assert.equal(objects.get(resourceKey)?.metadata.uid, uid, 'replacement must target the observed resource identity')
      objects.delete(resourceKey)
    },
  }
  return { objects, writes, resources }
}
