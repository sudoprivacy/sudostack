import { parseEgressPolicy, policyApplicationStatus } from './index.js'

/** The authenticated application selects scope and supplies storage/runtime adapters. */
export class EgressPolicyService {
  #initialization

  constructor(repository, runtimes) {
    this.repository = repository
    this.runtimes = runtimes
  }

  async ready() {
    this.#initialization ??= this.repository.initialize().catch(error => {
      this.#initialization = undefined
      throw error
    })
    await this.#initialization
  }

  async policy(organizationId) {
    await this.ready()
    return this.repository.get(organizationId)
  }

  async view(organizationId, isApply = false) {
    const policy = await this.policy(organizationId)
    const targets = await this.runtimes.targets(organizationId)
    if (organizationId && targets.some(target => target.organizationId !== organizationId)) {
      throw new Error('Runtime target is outside the selected organization')
    }
    const receipts = []
    // Keep controller work bounded independently of organization count.
    for (let offset = 0; offset < targets.length; offset += 4) {
      const rows = await Promise.all(targets.slice(offset, offset + 4).map(async target => {
        const desired = await this.policy(target.organizationId)
        const actual = await this.runtimes.observe(target, isApply ? desired : undefined)
        return actual.map(receipt => ({
          ...receipt,
          ...policyApplicationStatus(desired, receipt.status),
          ...(!receipt.isPresent ? { state: 'pending' } : {}),
          ...(receipt.error ? { state: 'error' } : {}),
        }))
      }))
      receipts.push(...rows.flat())
    }
    return {
      scopeType: organizationId ? 'organization' : 'platform',
      organizationId,
      policy,
      isInherited: organizationId ? !(await this.repository.hasOverride(organizationId)) : false,
      runtimes: receipts,
    }
  }

  async save(organizationId, input, expectedRevision, actorId) {
    await this.ready()
    await this.repository.put(organizationId, parseEgressPolicy(input), expectedRevision, actorId)
    return this.view(organizationId, true)
  }

  async inherit(organizationId, expectedRevision) {
    await this.ready()
    await this.repository.inherit(organizationId, expectedRevision)
    return this.view(organizationId, true)
  }
}
