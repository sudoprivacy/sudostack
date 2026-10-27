# Install the shared device actions

Edge and Cloud can consume the committed device action package without a Git
checkout, application images, model credentials or a Python package install.
It contains the exact `device_operation.IMPLEMENTATION` source closure under
`tools/deploy`; the producer reads those files from one immutable Git commit,
not from a dirty working copy. The existing bundle builder, checksum verifier,
resumable downloader and atomic unpacker own distribution for both this profile
and Atlas. The action package does not run the Atlas installer.

The native AMD64 and ARM64 host-deploy CI jobs run the process suite, build the
package, unpack it outside the source checkout and execute its installed device
entry. Their `device-actions-<architecture>-<checkout SHA>` artifacts contain the
archive, `bundle.json`, checksums and standalone `cos_bundle.py` client. Preserve
the actual CI checkout SHA: a PR's synthetic merge can differ from its head.
The package manifest's `sourceCommit` identifies the action code, while the
descriptor hashes bind every delivered file. Authenticate the artifact digest
and source through the trusted repository/CI channel before running its client;
self-consistent hashes alone do not establish publisher identity.

Produce the same package from a verified local repository:

```sh
python tools/deploy/cos_bundle.py create-actions \
  --repository /absolute/sudostack --commit FULL_COMMITTED_SHA \
  --architecture arm64 --output /absolute/device-actions
```

On the target Linux device, use a new private, versioned destination. With the
verified archive already present:

```sh
python3 device-actions/cos_bundle.py unpack \
  --descriptor device-actions/bundle.json \
  --archive device-actions/sudostack-device-actions-0.0.0-dev.COMMITPREFIX-linux-arm64.tar.gz \
  --destination /absolute/private/actions/FULL_COMMITTED_SHA
```

For files hosted at an approved immutable HTTPS location, the same client can
download and unpack the archive using its existing checksum/resume path:

```sh
python3 device-actions/cos_bundle.py fetch \
  --descriptor device-actions/bundle.json \
  --base https://approved.example/immutable/device-actions \
  --cache /absolute/private/cache/FULL_COMMITTED_SHA
```

`unpack` installs into the specified destination. `fetch` installs beneath its
cache's `assets` directory. Both verify the whole archive and source manifest,
reject changed files and special/path-traversal entries, and publish the tree
only after its checks pass. Reusing an installation revalidates its complete
content. Neither command starts services, spawns an Agent, issues credentials,
changes a deployment plan or grants permission to deploy.

Point Edge's existing `SUDOSTACK_DEPLOY_ROOT` at that installed root. Its trusted
`sudostack.lock.json` still checks every shared action's actual bytes before
execution; a package label does not replace that check. Moss's fixed device
port and the device worker similarly retain their approved plan, implementation
digest, current owner/actor and operation-ID checks. Installation is separate
from approving or executing an operation. The [device-operation contract](agent-host.md)
owns that execution and recovery behavior.

Device bundles are development, source-pinned action artifacts. They are not
complete Atlas releases or native runtime upgrades. The Atlas COS publisher
refuses this profile, preventing accidental publication over its installer
namespace. CI artifact qualification is not a claim that the real DGX has
executed a controller-replacing deploy or joined a collaboration space.
