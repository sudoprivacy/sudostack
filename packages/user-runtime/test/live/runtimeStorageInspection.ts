/** Inspect one existing owner allocation through the actual Kubernetes reader. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildKubectlBaseArgs, readK8sResource } from '../../src/k8sResources.js'
import { UserPodService, userPodName, type UserPodOptions } from '../../src/userPodService.js'

if (process.env.MOSS_RUNTIME_LIVE !== '1') throw new Error('Explicit live Kubernetes acceptance is required')
const input = JSON.parse(readFileSync(0, 'utf8')) as { ownerId: string; options: UserPodOptions }
const base = buildKubectlBaseArgs(input.options.namespace, input.options.kubeconfig)
const name = userPodName(input.ownerId, input.options.allocationId)
const reads: string[] = []
let forbiddenCalls = 0
const refuse = async () => { forbiddenCalls++; throw new Error('Storage inspection requires only resource reads') }
const service = new UserPodService(input.options, {
  read: async (kind, requested) => {
    assert((kind === 'pvc' || kind === 'pod') && requested === name)
    reads.push(kind)
    return readK8sResource(base, kind, requested)
  },
  write: refuse, remove: refuse, refreshProjection: refuse, observe: refuse, list: refuse,
}, refuse)
try {
  const observed = await service.inspectStorage(input.ownerId)
  assert(observed.pvc?.uid && observed.pod?.uid, 'Use an existing owner Pod and its retained PVC')
  assert(observed.pvc.resourceVersion && observed.pod.resourceVersion)
  assert.equal(observed.pvc.deletionTimestamp, null)
  assert.equal(observed.pod.deletionTimestamp, null)
  assert.deepEqual(reads.sort(), ['pod', 'pvc'])
  assert.equal(forbiddenCalls, 0)
  console.log(JSON.stringify({ isAccepted: true, observed, reads, forbiddenCalls,
    credentialIssuanceAccepted: false, replicaAdmissionAccepted: false }))
} finally {
  await service.close()
}
