// Read-only, field-allowlisted Moss restart state. Never prints config, tokens,
// transcript content, event payloads, process arguments, or environment.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = JSON.parse(fs.readFileSync(process.env.MOSS_SERVER_CONFIG || '/etc/moss/server.json', 'utf8'));
const db = new DatabaseSync(config.storage.dbPath, { readOnly: true });
const now = Date.now();
const attempts = db.prepare(`SELECT s.session_id, s.status, s.desired_state,
  s.current_attempt_id, a.generation, a.server_instance_id, a.runtime_state,
  a.runner_pid, a.attach_path, a.last_heartbeat_at, a.stopped_at,
  a.exit_code, a.exit_signal, a.stop_reason
  FROM sessions s LEFT JOIN session_attempts a ON a.attempt_id=s.current_attempt_id
  ORDER BY s.updated_at DESC LIMIT 50`).all();
for (const row of attempts) {
  row.heartbeatAgeMs = row.last_heartbeat_at == null ? null : now - row.last_heartbeat_at;
  row.socketExists = row.attach_path ? fs.existsSync(row.attach_path) : false;
  row.pidAlive = false;
  if (row.runner_pid > 0) {
    try { process.kill(row.runner_pid, 0); row.pidAlive = true; } catch {}
  }
  if (row.runner_pid && process.platform === 'linux') {
    try { row.pidComm = fs.readFileSync(`/proc/${row.runner_pid}/comm`, 'utf8').trim(); } catch {}
  }
  if (row.generation != null) {
    const dir = path.join(config.storage.runtimeDir, 'sessions', row.session_id, `attempt-${String(row.generation).padStart(4, '0')}`);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      row.runnerManifest = { configuredInstanceId: manifest.config?.instanceId ?? null,
        ownerInstanceId: manifest.attempt?.serverInstanceId ?? null,
        heartbeatTimeoutMs: manifest.config?.heartbeatTimeoutMs ?? null,
        runtimeType: manifest.session?.runtime?.type ?? null,
        k8sPodName: manifest.session?.runtime?.k8sPodName ?? null };
    } catch (error) { row.manifestReadCode = error.code ?? error.name; }
    try {
      const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
      row.runnerStatus = { state: status.state, code: status.code, signal: status.signal };
    } catch (error) { row.statusReadCode = error.code ?? error.name; }
    try {
      const fd = fs.openSync(path.join(dir, 'stderr.log'), 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const tail = Buffer.alloc(Math.min(size, 65536));
        fs.readSync(fd, tail, 0, tail.length, size - tail.length);
        row.runnerStderr = tail.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch (error) { row.stderrReadCode = error.code ?? error.name; }
  }
}
const instances = db.prepare('SELECT instance_id, pid, status, started_at, heartbeat_at, stopped_at FROM server_instances ORDER BY started_at DESC LIMIT 20').all();
const events = db.prepare('SELECT session_id, attempt_id, event_type, created_at FROM session_events ORDER BY created_at DESC LIMIT 100').all();
console.log(JSON.stringify({ capturedAt: now, configuredInstanceId: process.env.MOSS_INSTANCE_ID || config.server?.instanceId || null, instances, attempts, events }, null, 2));
db.close();
