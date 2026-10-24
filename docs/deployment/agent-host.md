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

## Product consumers

SudoEdge's `install-cohost.sh` selects appliance paths and invokes this shared
action through an exact source/file lock. It contains no second installer.
Keep device locations, maintenance choices and real receipts in sudoedge.

Cloud's existing `@sudo/user-runtime` Kubernetes lifecycle retains its resource
UID, volume and authenticated-readiness rules. It is not replaced by this Linux
service adapter. The native join and A2A contracts must be the same for both.
