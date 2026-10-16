import { randomUUID } from 'node:crypto'

export const PRIMARY_RUNTIME_ALLOCATION = 'primary'

/** An allocation identifies durable storage independently of a Pod's current UID or address. */
export function runtimeAllocationId(value: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error('Invalid runtime allocation ID')
  return value
}

export interface AgentRuntimeHome {
  ownerId: string
  agentId: string
  allocationId: string
}

/** The store serializes claims for one owner across controllers and commits before returning. */
export interface AgentRuntimeHomeStore {
  claim(ownerId: string, agentId: string,
    chooseAllocation: (homes: readonly AgentRuntimeHome[]) => string): Promise<AgentRuntimeHome>
  find(ownerId: string, agentId: string): Promise<AgentRuntimeHome | undefined>
  list(ownerId: string): Promise<AgentRuntimeHome[]>
}

/** Pack new Agents while preserving every existing Agent's durable storage assignment. */
export class AgentRuntimeHomes {
  constructor(private readonly store: AgentRuntimeHomeStore, private readonly agentsPerAllocation: number) {
    if (!Number.isSafeInteger(agentsPerAllocation) || agentsPerAllocation < 1) {
      throw new Error('Agents per allocation must be a positive safe integer')
    }
  }

  async resolve(ownerId: string, agentId: string, existingAllocationId?: string): Promise<AgentRuntimeHome> {
    this.requireIdentities(ownerId, agentId)
    if (existingAllocationId !== undefined) runtimeAllocationId(existingAllocationId)
    const home = await this.store.claim(ownerId, agentId, homes => {
      const counts = new Map<string, number>()
      const agents = new Set<string>()
      for (const home of homes) {
        this.validate(home, ownerId)
        if (agents.has(home.agentId)) throw new Error('Agent has multiple runtime homes')
        agents.add(home.agentId)
        counts.set(home.allocationId, (counts.get(home.allocationId) ?? 0) + 1)
      }
      if (existingAllocationId !== undefined) return existingAllocationId
      if (!counts.size) return PRIMARY_RUNTIME_ALLOCATION
      const available = this.sortedAllocations(counts.keys())
        .find(allocation => counts.get(allocation)! < this.agentsPerAllocation)
      return available ?? `allocation-${randomUUID()}`
    })
    this.validate(home, ownerId, agentId)
    return home
  }

  async find(ownerId: string, agentId: string): Promise<AgentRuntimeHome | undefined> {
    this.requireIdentities(ownerId, agentId)
    const home = await this.store.find(ownerId, agentId)
    if (home) this.validate(home, ownerId, agentId)
    return home
  }

  /** Discovery includes the original namespace and never provisions a missing allocation. */
  async allocations(ownerId: string): Promise<string[]> {
    this.requireIdentities(ownerId)
    const homes = await this.store.list(ownerId)
    for (const home of homes) this.validate(home, ownerId)
    return this.sortedAllocations(new Set([PRIMARY_RUNTIME_ALLOCATION, ...homes.map(home => home.allocationId)]))
  }

  private validate(home: AgentRuntimeHome, ownerId: string, agentId?: string): void {
    if (home.ownerId !== ownerId || typeof home.agentId !== 'string' || !home.agentId || (agentId !== undefined && home.agentId !== agentId)) {
      throw new Error('Agent runtime home identity mismatch')
    }
    runtimeAllocationId(home.allocationId)
  }

  private requireIdentities(...identities: string[]): void {
    if (identities.some(value => typeof value !== 'string' || !value)) {
      throw new Error('Agent home requires owner and Agent identities')
    }
  }

  private sortedAllocations(values: Iterable<string>): string[] {
    return [...values].sort((left, right) => left === right ? 0 :
      left === PRIMARY_RUNTIME_ALLOCATION ? -1 : right === PRIMARY_RUNTIME_ALLOCATION ? 1 : left.localeCompare(right))
  }
}
