/** Observe update refusals against an existing owned Kubernetes runtime without writes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { buildKubectlBaseArgs, readK8sResource } from '../../src/k8sResources.js'
import { UserPodService, UserRuntimeUpdateRequiredError, userPodName, type UserPodOptions } from '../../src/userPodService.js'

if (process.env.MOSS_RUNTIME_LIVE !== '1') throw new Error('Explicit live Kubernetes acceptance is required')
const input = JSON.parse(readFileSync(0, 'utf8')) as { ownerId: string; options: UserPodOptions }
const base = buildKubectlBaseArgs(input.options.namespace, input.options.kubeconfig)
const name = userPodName(input.ownerId, input.options.allocationId)
const read = (kind: string, resourceName: string) => readK8sResource(base, kind, resourceName)
const snapshot = async () => {
  const [pod, secret] = await Promise.all([read('pod', name), read('secret', name)])
  assert(pod?.metadata.uid && secret?.metadata.uid && secret.metadata.resourceVersion)
  for (const resource of [pod, secret]) assert.equal(resource.metadata.annotations?.['moss.sudo.dev/runtime-owner'], input.ownerId)
  const data = Object.fromEntries(Object.entries(secret.data ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  return { podUid: pod.metadata.uid, secretUid: secret.metadata.uid,
    secretVersion: secret.metadata.resourceVersion, secretDataSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') }
}
const before = await snapshot()
let writeAttempts = 0
let readinessAttempts = 0
const resources = { read, write: async () => { writeAttempts++; throw new Error('Live acceptance forbids Kubernetes writes') } }
const ready = async () => { readinessAttempts++; throw new Error('Update refusal must precede readiness and execution') }
const service = new UserPodService(input.options, resources, ready)
const changedImage = new UserPodService({ ...input.options, image: `${input.options.image}-update-probe`, release: undefined }, resources, ready)
try {
  const observed = await service.inspect(input.ownerId)
  assert(observed.isPresent && !observed.isDrifted, 'Use the actual running runtime configuration')
  const secret = (await read('secret', name))!
  const saved = Buffer.from(secret.data!['backend-config.json']!, 'base64').toString('utf8')
  assert.doesNotThrow(() => JSON.parse(saved))
  // A different desired configuration is supplied only to this read-only resolver.
  await assert.rejects(service.resolve(input.ownerId, { 'backend-config.json': saved + '\n' }),
    error => error instanceof UserRuntimeUpdateRequiredError && error.reason === 'model-backend')
  await assert.rejects(changedImage.resolve(input.ownerId),
    error => error instanceof UserRuntimeUpdateRequiredError && error.reason === 'runtime')
  assert.equal(writeAttempts, 0)
  assert.equal(readinessAttempts, 0)
  assert.deepEqual(await snapshot(), before)
  console.log(JSON.stringify({ isAccepted: true, ownerId: input.ownerId, podName: name,
    ...before, typedReasons: ['model-backend', 'runtime'], writeAttempts, readinessAttempts }))
} finally {
  await Promise.all([service.close(), changedImage.close()])
}
