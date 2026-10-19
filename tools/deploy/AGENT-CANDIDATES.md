# Local Agent candidate images

The existing `release.py` assembles published owner assets into a Cloud suite.
`agent_candidate.py` prepares the preceding local build stage, using those owners'
Dockerfiles and the existing image export/checksum/verification helpers. It keeps
rc.9 and the published release schemas unchanged.

Required images are Moss, its Nexus runtime/Secret daemon, SudoWork WebUI, the
independent HTTP Provider, and the **Nexus Python product Registry**. The latter
is distinct from the runtime daemon and cannot be substituted by it.

## Prepare once

Commit each owner's changes and build the Provider using the Moss owner's
`scripts/build-http-agent-provider.ts`. Initialize Work's pinned submodules and
materialize LFS files. Use a new output directory:

```sh
python3 tools/deploy/agent_candidate.py prepare \
  --moss /checkouts/moss --work /checkouts/sudowork --nexus /checkouts/nexus \
  --provider /checkouts/moss/dist/http-agent-provider \
  --architecture arm64 --output /candidates/agent-001
```

Preparation checks the existing contract source chains, records full owner
commits, exports committed source and exact submodule commits, verifies actual
LFS object hashes, and copies the verified Provider executable. Untracked files
and local configuration are excluded. The candidate lock and source archives
are inputs to every build. The three assembler Python files are also checksummed;
copy them from the recorded Stack commit when building on another host. Python
3.12 or later and Docker Buildx are required. A different assembler fails before
building, so use a new preparation after changing it.
Keep an independent checksum of the lock when handing
it to another operator; these are local records, not signed attestations.

## Build and inspect

```sh
python3 tools/deploy/agent_candidate.py build --directory /candidates/agent-001 --component http-provider
python3 tools/deploy/agent_candidate.py build --directory /candidates/agent-001 --component moss
python3 tools/deploy/agent_candidate.py build --directory /candidates/agent-001 --component nexus-runtime
python3 tools/deploy/agent_candidate.py build --directory /candidates/agent-001 --component webui
python3 tools/deploy/agent_candidate.py build --directory /candidates/agent-001 --component product-registry
python3 tools/deploy/agent_candidate.py assemble --directory /candidates/agent-001
```

Each build extracts verified source into a temporary context. Records bind the
candidate lock hash, source revision, platform, image config digest and archive
hash. Changed source/archive bytes, foreign or stale records, and missing
components fail assembly. A failed build removes its previous success record;
a failed assembly removes any previous aggregate success manifest.

`candidate-images.json` means all five images were assembled. It is **not** an
installation receipt, a production approval, a reproducible-build assertion or
a desktop signing result. Owner Dockerfiles may still resolve base tags and
unlocked runtime dependencies; image digests pin the resulting bytes, and build
logs must be retained. Both architectures require their own native build and
runtime acceptance. This command neither publishes releases nor starts services.

## Deployment qualification still required

For fresh synthetic-data testing, use the optional
[isolated lab preparation tool](agent-lab/README.md). It revalidates the candidate
archives and loaded images, creates separate private service configuration, and
requires explicit schema initialization and organization binding. Preparation
is not a deployment or acceptance receipt.

Use the existing owner deployment tools with a separately reviewed environment
configuration. Keep runtime configuration, credentials and database backups out
of these source/image archives. Register the exact image config digests and
application manifests in the deployment evidence.

- Provision the product Registry database/signing key/Zone mapping and its
  authenticated API; initialize its schema explicitly. Configure Moss's Registry
  client and Secret endpoint independently.
- Deploy Provider credentials/database and authorized Router endpoint separately.
  Retain old revision instances for existing sessions or explicitly reject them;
  never silently route an old revision to a new executable.
- Supply WebUI PostgreSQL, authentication/session secrets and Moss endpoint.
- Run maintenance-window migration with old writers stopped and verified backups,
  then exercise real admin/user UI, both Provider types, version promotion,
  rollback, revocation, tenant isolation and recovery on that exact combination.
- Build and validate desktop installers using the existing signing workflow;
  source/image assembly does not validate signature, notarization or first launch.

The candidate is restricted to the already supported synthetic external-Agent
scope until separate data-egress and business admission work is complete.
