# Deploy an Agent runtime

Cloud, Private and Edge share the deployment sequence described in
[the join design](../design/cohost-deploy-and-domain-join.md). Their placement
adapters consume native component behavior. Installing another standalone
Agent does not qualify an existing cohost product integration.

## Linux user-service placement

Python 3.11+, user systemd and a source-bound native `nexusd-cohost` executable
are required. Obtain its full commit and SHA256 from the authenticated producer
artifact receipt; a filename or `--version` alone is insufficient.

```sh
python3 tools/deploy/cohost.py inspect \
  --binary /verified/nexusd-cohost --sha256 FULL_SHA256 --source FULL_COMMIT \
  --unit my-cohost --bind 127.0.0.1:22141 --zone my-zone \
  --root /private/runtime --config /private/config \
  --install-root /private/runtime-versions
```

Replace `inspect` with `stage` to publish the verified executable into its
digest-named directory. This starts no service and changes no identity, model
or trust configuration. The files can be supplied offline. A corrupt existing
version is refused, rather than repaired silently. New files/directories are
owner controlled; existing writable-by-others directories are refused rather
than having their permissions changed. The directory tree does not claim a
hardware power-loss guarantee.

`install` creates and starts a fresh user unit only. Its receipt verifies the
actual `/proc/<MainPID>/exe` hash. Reentry for the same running executable does
not restart it. Another installed unit is refused even if stopped: changing
its data, certificate, model, policy or service drop-ins requires the product's
native drain/adoption procedure. The existing appliance installer must not
invent that lifecycle by overwriting an active systemd unit.

A `process-activated` receipt is not authenticated readiness or a domain join.
Both fields remain false until the owning native components produce their
actual proofs. No CA, certificate, Session or Agent is minted by this command.

## Existing-runtime cold checkpoint

`checkpoint.py inspect --plan PRIVATE_PLAN.json --output NEW_PRIVATE_DIRECTORY`
validates a product adapter's explicit `schemaVersion:1` plan without stopping
anything. `checkpoint` with the same arguments enters the selected user-service
maintenance boundary, copies owned state, and restores the original executables.
It never selects or activates an upgrade.

The plan contains `units` in controller-first stop order (each with `name` and
`binarySha256`), `paths` mapping simple labels to absolute owned source paths,
and `pins` listing configuration `path` and `sha256` pairs. Include the actual
unit files/drop-ins, application entry and durable state in the product plan.
Every pinned file must be covered by a selected path. Symlinks, special files,
trigger-activated units, changed pins, wrong executables and reused output
destinations are refused. The product owner must account for every writer of
the selected state; this Linux primitive cannot infer application ownership.

After each stop, MainPID, inactive state and any remaining cgroup workers are
checked. Files are copied only after all selected services stop. Source and
copy hashes must agree before restoration. Secret-bearing snapshots remain
on that host in owner-only directories/files. A partial copy is retained with
a failure receipt. Original services restart in reverse order even after a
copy/stop failure. If restoring a dependency fails, dependent controllers stay
stopped and the receipt reports that operator attention is required. SIGKILL,
power failure and an external service manager are outside this process's
automatic restoration guarantee.

An appliance adapter must inspect/drain its actual Agent lifecycle before
invocation and verify authenticated readiness after restoration. A cold file
checkpoint proves neither native history recovery nor authenticated readiness.
Qualify migrations on the copy with the producer's offline tools; never run a
second live daemon with duplicated Node identity, or restore old state over
newer accepted writes as an automatic executable rollback.

## Product consumers

`configuration.py inspect/apply --path EXISTING --expected OLD_SHA256
--prepared NATIVE_PREPARED --sha256 NEW_SHA256 --evidence NEW_PRIVATE_DIRECTORY`
selects exact producer-prepared configuration bytes for the next start. It
retains the original privately, refuses stale pins/symlinks/reused evidence,
and fsyncs the replacement and directory. It neither edits native schema nor
restarts a service. The product adapter must exclusively own configuration
writes; the cooperative deployment lock is not filesystem CAS against other
writers. A partial operation retains evidence and requires inspection, never
an automatic restore over later writes. Native readiness remains false.

SudoEdge's `install-cohost.sh` selects appliance paths and invokes this shared
action through an exact source/file lock. It contains no second installer.
Keep device locations, maintenance choices and real receipts in sudoedge.

Cloud's existing `@sudo/user-runtime` Kubernetes lifecycle retains its resource
UID, volume and authenticated-readiness rules. It is not replaced by this Linux
service adapter. The native join and A2A contracts must be the same for both.
