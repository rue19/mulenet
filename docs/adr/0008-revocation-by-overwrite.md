# ADR 0008: Revocation by insertIndexDefault + resetHistory

- Status: accepted (14 Oct 2026); index binding changed by ADR 0011

## Context

A withdrawn flag must stop counting immediately, including in attestations built from paths made before the withdrawal.

## Decision

The original flagger proves it can recompute the leaf (the pseudonym needs its secret) and that the path encodes the claimed index. Then:
- `insertIndexDefault(index)` overwrites the leaf;
- `resetHistory()` invalidates every older root.

Revocations are capped per epoch (ADR 0012).

## Rejected

A revocation-tag `Set`: it would link queries about the same subject.

## Consequences

- Attestations being built when a revocation lands must be re-proven; the bank node rebuilds once on `slot not in tree`.
- The index of a revoked flag is public (L3), but its leaf was always opaque.
- Evidence: invariant I4; `revoked.test.ts`; judge-mode step 8.
