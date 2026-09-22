# SW-20260915-002 evidence

- `g4/` preserves the P0 Zone-management and access-authorization evidence.
- `g5/` records the P1a Runtime Zone ownership subset and its cross-repo pins.
- `g6/` records the P1b implicit Task/Resolution/Attempt evidence and final
  contract assembly pin.
- `g7/` records final cross-repository pins, real-process deployment evidence,
  migration/rollback checks, and platform-specific verification limits.

The G5 claim is intentionally limited to **Runtime Zone 归属子集完成**. It does
not claim ADR-002 or the P1b Attempt/data-placement gate. The G6 record is the
separate completion claim for that P1b gate.
