# Testing and QA

All counts are from the current `main`. Run everything with `npm test` from the repo root.

## Layers

| Layer | Where | Tests | What it shows |
|---|---|---|---|
| Contract unit | `contracts/src/test/unit/` | 54 | Every circuit's happy path and main rejections; `pathIndex`; static source rules; hash parity with `@mulenet/crypto` |
| Invariants I1–I7 | `contracts/src/test/invariants.test.ts` | 19 | One `describe` per invariant in ARCHITECTURE §6.4 |
| Adversarial (§11) | `contracts/src/test/adversarial/` | 67 in 12 files | One file per threat-model row, attacks specific to this design, and `attest2` parity |
| Reference-model property | `contracts/src/test/property/` | 1 property, 25 runs in CI, 1,000 runs nightly | Random operation sequences; the contract must accept exactly what a plain TypeScript model accepts |
| Crypto | `packages/crypto/src/test/` | 75 | RFC 9497 vectors, threshold equivalence, ElGamal, relay records, normalisation vectors, properties |
| On-chain test run | `packages/sdk/scripts/spike-local.ts` | — | Real proofs on the local network: flags proven against the same state, timings, and a leak scan of transaction bytes (BENCHMARKS.md) |

## Invariants → tests

| ID | Invariant | Tests |
|---|---|---|
| I1 | Every flag leaf was inserted by a member at the current generation | Failed submissions add no leaf; an evicted member adds no leaf |
| I2 | At most one leaf per (institution, subject, epoch) | Different typology, ctHash or quota slot is still a duplicate; one leaf per epoch; revoking does not reopen the slot |
| I3 | k = n implies n distinct, fresh, unrevoked, non-self flags | Positive case; the key binds subject, epoch and typology; each condition failing on its own |
| I4 | A revoked leaf can never be counted | Pre-revocation path; path rebuilt against the current tree; stale path after later inserts |
| I5 | `flagCount` counts submissions; revocation clears exactly one leaf | Failed submissions excluded; other leaves untouched; cannot target another index |
| I6 | A proposal executes once, with ≥ t distinct votes, within 7 epochs | Distinct-vote quorum; single execution; expires at 8 epochs, not at 7 |
| I7 | Rotation evicts the previous generation | All members evicted until re-registered; an old leaf can't pass as the new generation |
| I8 | No secret appears in public data | Leak scan in the on-chain test run (0 hits); the CI leak scanner arrives in Phase 8 |

## Threat model (§11) → adversarial files

| Threat | File |
|---|---|
| Count stuffing | `stuffing.test.ts` |
| Self-corroboration | `self.test.ts` |
| Sybil institutions | `registration.test.ts` |
| Forged membership / path replay | `path-replay.test.ts` |
| Stale-member abuse | `eviction.test.ts` |
| Revoked-flag reuse, revocation abuse | `revoked.test.ts` |
| Expired flags, window boundaries | `expiry.test.ts` |
| Malicious witness values | `malicious-witness.test.ts` |
| Double vote, proposal replay, parameter tampering | `governance.test.ts` |
| Forged slot fields, borrowed flags, mixed roots | `forged-slots.test.ts` |
| Arithmetic and bounds | `arithmetic.test.ts` |
| Every attestation rule again for k = 2 | `attest2.test.ts` |
| Non-canonical `Field` keys, leaky assert messages | `unit/static.test.ts` |

## Reference-model property test

`property/reference-model.test.ts` generates sequences of 12–40 operations over five banks and two subjects:
- `flag`
- `revoke`
- `advance` (epoch roll)
- `attest` with random slots
- `attestLikely`, whose slots are picked at run time from banks that actually flagged the subject

TTL, flag quota and revocation quota are deliberately small, so the edge cases happen often.

A plain TypeScript model tracks flags, nullifiers, quotas and attestations. It predicts whether **every** operation succeeds, and the contract must agree each time. The test also fails if no attestation succeeds, or if none is rejected, so it can never pass without exercising both paths.

**Mutation check.** Each of these bugs was planted in the model on its own, and each was caught with a shrunk counterexample:

| Planted bug | Divergence |
|---|---|
| Freshness off by one (`>` instead of `≥`) | model rejects, contract accepts |
| Ignore self-exclusion | model accepts, contract rejects (`self excluded`) |
| Ignore revocation | model accepts, contract rejects (`slot mismatch`) |

The `goes_left` convention in `pathIndex` was checked the same way. Flipping it breaks 4 unit tests.

Commands:

```bash
npm test -w contracts                       # unit, invariants, adversarial, 25 property runs
npm run test:property:long -w contracts     # 1,000 property runs (~17 min)
npm test -w packages/crypto
```

## `attestCorroboration2` / `attestCorroboration3` parity

| Rule | attest3 test | attest2 test |
|---|---|---|
| Records k | `unit/core` | `attest2` |
| Distinct pseudonyms (`dup`) | `stuffing`, `unit/core` | `attest2` |
| Self-exclusion, any slot position | `self` | `attest2` |
| Expiry | `expiry` | `attest2` |
| Revoked slot with stale path | `revoked`, `invariants` I4 | `attest2` |
| One shared root (`mixed roots`) | `forged-slots` | `attest2` |
| Subject and typology bound in the leaf | `forged-slots` | `attest2` |
| One attestation per (subject, epoch, typology) | `unit/core` | `attest2` |
| Policy k | `unit/core` (attest2 refused under k = 3) | `attest2` (attest3 accepted under k = 2; attest2 refused after governance raises k) |

## Property-test seed policy

fast-check prints the seed and shrunk counterexample of any failure. When the property test fails:
1. Fix the contract or the model, whichever is wrong.
2. Add the counterexample as a fixed-seed regression under `contracts/src/test/property/regressions/`, named after the bug. Use `fc.assert(..., { seed, path, endOnFailure: true })` with the reported values, or an explicit op list.
3. Regressions run on every CI build and are never deleted.
