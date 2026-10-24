export interface BusinessPolicy {
  version: 1
  public_organizations: string[]
  protected_terms: string[]
  protected_markers: string[]
}
export interface EgressAnalyzer {
  url: string
  language: 'zh' | 'en'
  scoreThreshold: number
  entities: string[]
  timeoutMs: number
}
export interface EgressPolicy {
  version: 1
  revision: number
  enabled: boolean
  mode: 'redact' | 'deny' | 'observe'
  modelMounts: string[]
  a2aMounts: string[]
  analyzer: EgressAnalyzer | null
  businessPolicy: BusinessPolicy
}
export interface EgressPolicyStatus {
  version: 1
  revision: number
  enabled: boolean
  mode: EgressPolicy['mode']
  modelMounts: string[]
  a2aMounts: string[]
  error: string | null
}
export const POLICY_FILENAME: 'egress-policy.json'
export const POLICY_ENVIRONMENT: 'NEXUS_EGRESS_GATE_CONFIG'
export const DEFAULT_POLICY: Readonly<EgressPolicy>
export function parseEgressPolicy(input: unknown): EgressPolicy
export function createEgressPolicy(overrides?: Partial<EgressPolicy>): EgressPolicy
export function policyApplicationStatus(desired: EgressPolicy, actual?: EgressPolicyStatus): {
  state: 'pending' | 'error' | 'applied'; desiredRevision: number; appliedRevision: number | null
}
export function readEgressPolicyStatus(client: {
  call(method: string, payload: string, authToken: string): Promise<string>
}, authToken: string): Promise<EgressPolicyStatus>
export interface PolicyDatabase {
  get<T extends Record<string, unknown>>(sql: string, params?: (string | number)[]): Promise<T | undefined>
  run(sql: string, params?: (string | number)[]): Promise<number>
  exec(sql: string): Promise<void>
  transaction<T>(action: () => Promise<T>): Promise<T>
}
export class EgressPolicyConflict extends Error {}
export class EgressPolicyRepository {
  constructor(db: PolicyDatabase, defaults?: EgressPolicy)
  initialize(): Promise<void>
  get(organizationId?: string): Promise<EgressPolicy>
  hasOverride(organizationId: string): Promise<boolean>
  put(organizationId: string | undefined, input: EgressPolicy, expectedRevision: number, actorId: string): Promise<EgressPolicy>
  inherit(organizationId: string, expectedRevision: number): Promise<EgressPolicy>
}
