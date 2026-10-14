# ADR 0012: Anonymous per-epoch quotas on flags and revocations

- Status: accepted (14 Oct 2026)

## Context

The circuit cannot check that `T` came from the OPRF, because ristretto operations are not available in Compact. The v1.0 flag nullifier blocks only a repeated (institution, T, epoch). So a malicious member could:

1. flag unlimited random `T` values and fill the flag tree; or
2. loop flag → revoke. Every `revokeFlag` calls `resetHistory()`, which invalidates every attestation proof in flight across the consortium.

## Decision

- **Flags:** each `submitFlag` consumes `H("mulenet:quota:v1", sk, epoch, slot)` with `slot < flagQuota`, proven in-circuit. Default `flagQuota` = 500.
- **Revocations:** each `revokeFlag` consumes `H("mulenet:rvquota:v1", sk, epoch, slot)` with `slot < revokeQuota`. Default `revokeQuota` = 3.
- Both nullifiers go in `quotaNullifiers`. The quotas are sealed constructor parameters. The bank node tracks which slots it has used in private state.

## Consequences

- An institution stays anonymous and is also capped. Nullifiers for different slots are unlinkable, because each hashes `sk`.
- Worst case, three banks flagging at the cap use 1,500 leaves per epoch. A depth-20 tree then lasts about 700 epochs (ADR 0013).
- Disruption from `resetHistory` is bounded to `revokeQuota × institutions` per epoch.
