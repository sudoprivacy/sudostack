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

An isolated cold-copy qualification may require a real loopback dependency
such as the product's configured model service. `qualification_endpoint.py`
provides two explicitly selected transport endpoints: `host` listens on a new
owner-only Unix socket and connects only to one declared `127.0.0.1:PORT`;
`namespace` restores that same loopback port inside a different network
namespace. Both require the observed host namespace, a private socket directory,
and current-owner socket permissions. No general network route, payload log,
connection retry, provider override or fake model response is introduced.
The appliance owns the fixed port selection and both process lifetimes. Close
both endpoints after the case, and retain metadata/failure evidence. This is
a test dependency boundary, not a production gateway or authorization policy.

For an existing product, `selection.py inspect/apply --plan PRIVATE_JSON
--output NEW_PRIVATE_DIRECTORY` composes the same stopped-process/cold-copy
boundary with exact file selection and dependency-ordered startup. The plan
contains `schemaVersion: 1`, the existing `checkpoint` plan, `selections`
(`path`, `expectedSha256`, `prepared`, `sha256`) and every service's `candidates`
(`name`, `binary`, `sha256`, `argumentFiles: [{path, sha256}]`). Every selected
original file must already be pinned in the checkpoint. Application entry
files must occur as actual live process arguments and retain their hashes;
checking only the Node executable cannot prove a Moss version was selected.

The action verifies original services, stops in the product's declared order,
checks empty process groups, creates the cold copy, installs native-prepared
files, reloads systemd and starts in reverse order. Original services may
restart after a failure before file selection begins. Once selection starts,
any failure stops the declared services and preserves configuration backups,
new data and the cold checkpoint for operator inspection. It does not
automatically restart old code over possibly migrated state or restore an old
database. A successful process selection still leaves authenticated native
readiness and the real product journey to the appliance adapter. The product
must exclude independent configuration writers throughout maintenance.

Cloud's existing `@sudo/user-runtime` Kubernetes lifecycle retains its resource
UID, volume and authenticated-readiness rules. It is not replaced by this Linux
service adapter. The native join and A2A contracts must be the same for both.

## Existing-product qualification

After process selection, `product_qualification.py inspect/apply --plan
PRIVATE_JSON --output NEW_PRIVATE_DIRECTORY` invokes the product's pinned
producer, rather than implementing another login, session or model client.
The first producer is Moss's `moss-inspect-existing-product.mjs` with explicit
`--inspect-existing` and `--exercise-existing` modes. Its full source revision
and bundle hash are required. No compiler or package installation runs on the
target.

The versioned plan contains `schemaVersion:1`, `producer:{path,sha256,source}`,
`runtime:{path,sha256}`, `configuration:{path,sha256}`, the running product's
existing selection `service:{name,binary,sha256,argumentFiles}`, and
`session:{id,ownerId,agentId,durableSessionId,repositoryPath,messagesSha256}`.
Machine paths, credentials and original session values belong in the private
device/allocation record. Pin the native producer's original binding and
history observation; the plan supplies expectations, never authority.

Inspection verifies actual process/entry hashes and private inputs, without
calling the producer. Apply shares the deployment's cooperative owner lock,
authenticates through a read-only producer preflight, and compares the original
owner/session/history before any model command. Only then does the producer run
its existing three-turn dependent-reply and reattach journey, preserving its
1080-second parent budget and native per-operation deadlines. The selected
service PID and configuration hashes are checked again afterward.

Submission evidence is persisted before the model command. Failures after
possible submission stay Unknown and retain private native output; no turn is
retried, no replacement Agent/session is created, and no execution is stopped
as cleanup. A reused evidence directory refuses. The running product retains
its execution. A pass reports authenticated product/model acceptance, with
`domainJoinAccepted:false` and no semantic-recall claim about older history.
Native identity/space/content-policy and multi-party delivery remain separate
required qualification. The appliance or Cloud allocation adapter chooses a
quiet point and owns its actual runtime lifecycle.
