# Isolated Agent candidate qualification lab

`agent_lab.py` prepares an **empty, synthetic-data-only lab**, after revalidating
the five candidate archives and the locally loaded image config digests. It
does not start services, initialize schema, migrate old data or publish an Agent.
Use Docker Compose v2. The existing deployment installer and frozen rc.9 are
unchanged. Run this on the same native architecture as the candidate.

The lab has one network namespace for Moss, Nexus Secret runtime, the Nexus
Python product Registry, the independent HTTP Provider and WebUI. Only the
Moss and WebUI ports are published, on host loopback. PostgreSQL has a separate
private service and an isolated Compose volume. No host Docker socket is mounted.
This is a single-host qualification topology, **not HA or an enforced egress/DLP
boundary**. WebUI uses its production bundle with `NODE_ENV=development` because
the lab uses loopback HTTP; production HTTPS/cookies must be qualified separately.

## Prepare and start explicitly

1. Run the candidate `assemble` command and load its five verified image archives
   into the test Docker daemon. Pull PostgreSQL 16, record its official repository
   digest, and pass that digest below. No floating image tag is accepted.
2. Prepare a new protected directory. Supply the existing Router configuration
   file; only `auth_modes.proxy.sudorouter.baseUrl/apiKey` are copied. Do not put a
   credential on the command line. Keep the output out of source control and
   evidence archives. On Linux root, Provider files become UID/GID 10001; on a
   non-root host the Provider uses the invoking UID/GID.

```sh
python3 tools/deploy/agent_lab.py prepare \
  --candidate /candidate/r3 --output /candidate/lab-r3 \
  --router-config /protected/router.json --model MODEL \
  --postgres-image postgres:16@sha256:RECORDED_OFFICIAL_DIGEST
cd /candidate/lab-r3
docker compose -p agent-candidate-r3 -f compose.json config --quiet
docker compose -p agent-candidate-r3 -f compose.json up -d runtime database
docker compose -p agent-candidate-r3 -f compose.json run --rm registry --initialize-schema
docker compose -p agent-candidate-r3 -f compose.json run --rm webui node dist/server/migrate.js
docker compose -p agent-candidate-r3 -f compose.json up -d registry moss provider webui
```

The explicit Registry initialization uses the **same primary RecordStore** as
the running service. Ordinary Registry startup only checks its tables. These
commands create new lab schema; they are not legacy maintenance migration.
The lab initially has an intentionally unmatched organization mapping, so
external enrollment cannot silently use the wrong Zone.

3. Log in to Moss at `http://127.0.0.1:43134/admin` using the protected
   `admin-login.json`, inspect the organization returned by authenticated Moss,
   and bind that exact ID once:

```sh
python3 /checkout/tools/deploy/agent_lab.py bind-organization \
  --output /candidate/lab-r3 --organization-id ACTUAL_MOSS_ORG_ID
docker compose -p agent-candidate-r3 -f compose.json restart moss
```

The binding command cannot remap an already bound authority. Record the actual
organization, Zone and nonsecret configuration in evidence. For remote test
hosts, forward only these loopback ports over SSH; use the same URLs locally.

## Actual acceptance remains required

Use Moss's management interface to create authorized ordinary users and enroll
the HTTP Provider with `http://127.0.0.1:28094/v1` plus
`provider/secrets/client.token`. Select the current synthetic capability scope.
Retrieve its authenticated manifest from inside the lab network, and upload it
through the existing Custom HTTP flow. Dify is enrolled independently through
the same management flow, with its own test app credential. Never submit the
Router model key as an Agent client token.

At `http://127.0.0.1:26834`, verify ordinary-user login, catalog selection, actual
model output and Registry/remote execution evidence. Record exact images, app
version and accepted Task/Attempt/version references. Exercise publish, approval,
stable/canary, rollback, tenant denial, revocation, Registry failure, snapshot
restoration and unknown-run reconciliation. Retain an old Provider image at its
original endpoint for old revisions or verify explicit rejection; changing the
image cannot silently reinterpret an old execution revision.

Migration requires a separate legacy fixture: stop its writers, back up and
verify the primary stores, run the owner's explicit Task and publication
migration procedures, verify receipts and then start new writers. Fresh lab
startup does not prove migration or backup recovery.

`lab-inputs.json` contains image and public-input digests, not test success. Keep
test receipts/screenshots separate and remove tokens, passwords, connection
strings and private keys before handoff. Do not archive the whole lab directory.

## Cleanup

Stop the lab with `docker compose -p agent-candidate-r3 -f compose.json down`.
After retaining sanitized receipts and confirming this is only disposable lab
data, remove its PostgreSQL volume with `down --volumes`, and delete the protected
lab directory. This does not clean unrelated containers, caches or images.
