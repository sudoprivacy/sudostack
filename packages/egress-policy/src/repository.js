import { createEgressPolicy, parseEgressPolicy } from './index.js'

export class EgressPolicyConflict extends Error {
  constructor() { super('Egress policy changed; reload before saving'); this.name = 'EgressPolicyConflict' }
}

/** Shared SQLite/PostgreSQL storage; applications supply their existing driver. */
export class EgressPolicyRepository {
  constructor(db, defaults = createEgressPolicy()) {
    this.db = db
    this.defaults = parseEgressPolicy(defaults)
  }

  async initialize() {
    await this.db.exec(`CREATE TABLE IF NOT EXISTS egress_policy_revision (
      singleton INTEGER PRIMARY KEY, revision BIGINT NOT NULL
    ); CREATE TABLE IF NOT EXISTS egress_policies (
      scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, policy_json TEXT, revision BIGINT NOT NULL,
      updated_by TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (scope_type, scope_id)
    );`)
    await this.db.run('INSERT INTO egress_policy_revision (singleton, revision) VALUES (1, 0) ON CONFLICT(singleton) DO NOTHING')
  }

  async get(organizationId) {
    const row = await this.db.get(`SELECT o.revision AS organization_revision, o.policy_json AS organization_policy, p.policy_json AS platform_policy
      FROM egress_policy_revision r
      LEFT JOIN egress_policies p ON p.scope_type = 'platform' AND p.scope_id = ''
      LEFT JOIN egress_policies o ON o.scope_type = 'organization' AND o.scope_id = ?
      WHERE r.singleton = 1`, [organizationId ?? ''])
    if (!row) throw new Error('Egress policy storage is not initialized')
    const stored = organizationId ? row.organization_policy ?? row.platform_policy : row.platform_policy
    const policy = stored ? parseEgressPolicy(JSON.parse(stored)) : structuredClone(this.defaults)
    if (organizationId && !row.organization_policy) policy.revision = Math.max(policy.revision, Number(row.organization_revision ?? 0))
    return parseEgressPolicy(policy)
  }

  async hasOverride(organizationId) {
    return Boolean(await this.db.get("SELECT scope_id FROM egress_policies WHERE scope_type = 'organization' AND scope_id = ? AND policy_json IS NOT NULL", [organizationId]))
  }

  async put(organizationId, input, expectedRevision, actorId) {
    if (!actorId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid egress policy update')
    const document = parseEgressPolicy(input)
    return this.db.transaction(async () => {
      document.revision = await this.allocateRevision(organizationId, expectedRevision)
      await this.db.run(`INSERT INTO egress_policies (scope_type, scope_id, policy_json, revision, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        policy_json = excluded.policy_json, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [organizationId ? 'organization' : 'platform', organizationId ?? '', JSON.stringify(document), document.revision, actorId, Date.now()])
      return document
    })
  }

  async inherit(organizationId, expectedRevision) {
    if (!organizationId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid egress policy inheritance')
    return this.db.transaction(async () => {
      const revision = await this.allocateRevision(organizationId, expectedRevision)
      await this.db.run(`INSERT INTO egress_policies (scope_type, scope_id, policy_json, revision, updated_by, updated_at)
        VALUES ('organization', ?, NULL, ?, '', ?) ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        policy_json = NULL, revision = excluded.revision, updated_at = excluded.updated_at`, [organizationId, revision, Date.now()])
      return this.get(organizationId)
    })
  }

  async allocateRevision(organizationId, expectedRevision) {
    // The counter row serializes writers across instances before the scoped CAS.
    // Its value is an allocation ID; unrelated organizations retain their revision.
    await this.db.run('UPDATE egress_policy_revision SET revision = revision + 1 WHERE singleton = 1')
    if ((await this.get(organizationId)).revision !== expectedRevision) throw new EgressPolicyConflict()
    const row = await this.db.get('SELECT revision FROM egress_policy_revision WHERE singleton = 1')
    const revision = Number(row?.revision)
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Egress revision allocation failed')
    return revision
  }
}
