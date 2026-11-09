import { parseEgressPolicy, policyApplicationStatus } from './index.js'

/** Safe to map into a product error; contains no detector output or business terms. */
export class EgressPolicyNotAppliedError extends Error {
  constructor() {
    super('Retry policy delivery or update the runtime')
    this.name = 'EgressPolicyNotAppliedError'
    this.code = 'EGRESS_POLICY_NOT_APPLIED'
  }
}

/** Apply to managed model sessions only; standalone CLI without Nexus stays optional. */
export function assertEgressRuntimeAdmission(input, runtime, actual) {
  const policy = parseEgressPolicy(input)
  if (!policy.enabled) return
  // A current-looking receipt cannot qualify an execution engine with direct model transport.
  if (runtime !== 'cohost' || actual?.version !== 1 || actual.error !== null ||
      policyApplicationStatus(policy, actual).state !== 'applied') {
    throw new EgressPolicyNotAppliedError()
  }
}
