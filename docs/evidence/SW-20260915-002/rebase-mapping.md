# Rebase SHA Mapping — SW-20260915-002 Evidence Erratum

Date: 2026-10-10
Status: additive erratum — no original evidence file is modified by this record.

## Purpose

The feat/contract-zone branches of `nexus` and `sudocode` were rebased on
2026-10-10 (nexus: full-branch rebase followed by an amend, per its reflog;
sudocode: rebase onto `origin/main` plus cohost-adaptation fixes). Every
revision SHA recorded in this directory's evidence and in the zone-v1 pin
records that pointed into those branches **before** the rebase is no longer
an ancestor of the current branch tips. The commits' content survives under
new SHAs. This file maps the old (dangling) SHAs to their post-rebase
counterparts so the evidence remains traceable.

The dangling SHAs still resolve in local clones that predate the rebase, but
they are not reachable from any branch ref; a fresh clone cannot fetch them
through the branch. Treat every old SHA below as a historical anchor, not a
reproducible pin.

## Mapping (content verified by subject match on current HEAD)

| Old SHA (recorded in evidence / pins) | Repo | Recorded at | New SHA (same change, post-rebase) | Commit subject (identical on both SHAs, verified via `git log --grep`) |
|---|---|---|---|---|
| `d78448594c7dd00d71581b62919ab0ca60cfedbb` | nexus | 2026-09-24 20:47 | `35ab74b1c0` (2026-10-10 16:58) | `fix(contracts): use portable delegation timestamp` |
| `a8194cf444c0b35cc056ea8950f659135776a11f` | nexus | 2026-09-29 13:46 | `a766df4d0f` (2026-10-10 16:58) | `test(zones): cover the two missing §11.2 truth-table supplements` |
| `4740251c7f` | sudocode | 2026-09-27 21:00 | `4570c088` (2026-10-10 17:28) | `feat(zones): enforce host-injected runtime resource scope` |
| `3415b171` (context) | nexus | 2026-10-09 16:44 | `5132ba7757` (2026-10-10 17:00) | `fix(zone): back off the recovery outbox exponentially on unavailability` |

Note on `3415b171`: it is not itself recorded in the zone-v1 pins, but it was
the nexus branch tip as of 2026-10-09; its rewrite is what makes the rebase
visible to anything anchored to "HEAD at that date". It is listed for
completeness.

## Where the dangling SHAs are recorded (all left untouched)

- `contracts/zone-v1/pin.json` — `nexus.rev` = `d78448594...`
- `contracts/zone-v1/provenance.gen.json` — owner revs `d78448594...` / `bc89aa638...` / `406427e2...`
- `compatibility/baseline/_pin.json` — `nexus` = `d78448594...`
- `compatibility/zone-consumers.yaml` — `zone_v1.owner_revisions.nexus` = `d78448594...`; `nexus_runtime_topology.admin_plane.nexus_commit` = `a8194cf444...`; `consumers.sudocode.pin_status` = `4740251c7f`
- `docs/evidence/SW-20260915-002/g7/pin-matrix.json` — `revisions.nexus` = `a8194cf444...`, `revisions.sudocode` = `4740251c7f`, `consumer_pins` accordingly

## Consequence for equivalence claims

The "equivalence-judged / byte-identical consumption surface" reasoning
recorded in `zone-consumers.yaml` was valid against the pinned revisions at
freeze time. As of the 2026-10-10 measurements it no longer holds on the
content axis, independent of the SHA dangling above:

- nexus `contracts/` zone family drifted +1377/−109 across 14 files since
  `d78448594` (includes new `fixtures/openapi/zone-v2.openapi.json`, i.e. the
  /v2 API fixtures, +970 lines)
- nexus-vfs zone-id/zone-path specs changed since `bc89aa638` — a revision
  that is still an ancestor of the branch tip but now 316 commits behind
  (`zone-path/spec.json` +45/−22, `zone-id/spec.json` +7, plus the derived
  `zone-wire-path` spec)

The pin records are intentionally NOT silently bumped here: per the pin.json
comment, aligning the pin onto newer revisions is its own work item. This
erratum only restores traceability of the frozen anchors.
