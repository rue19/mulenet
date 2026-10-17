# Changes for Raaj's review

Security-critical code that Raaj must be able to defend (instruction set §1, rule 8). Every change to these files gets an entry here: what changed, why, and which file and lines.

## Baseline: everything below was written by the agent and has not yet had Raaj's line-by-line review

| Area | File | What to understand |
|---|---|---|
| Contract | `contracts/src/mulenet.compact` (whole file) | the binding-then-membership assert (`assertInstitution`, `assertGuardian`); the flag leaf without an index, plus `pathIndex` (ADR 0011); quota nullifiers (ADR 0012); `slotRoot` and the single disclosed root; the `execute` range checks |
| Guardian policy | `services/guardian/src/policy.ts` (`checkEscalation`, `checkDetails`) | the checks before releasing a share: warrant on-chain; `attKey = H(T, epoch, typology)`; record decrypts under `T` (which also checks `SHA-256(ct) = ctHash`); leaf on-chain at its index |
| Sponsor pre-flight | `services/sponsor/src/preflight.ts` | MuleNet address only; allow-listed entry points; no shielded or unshielded value; no DUST actions of its own; TTL ≥ 5 min |
| Sponsor breaker and quotas | `services/sponsor/src/accounting.ts`, `services/sponsor/src/server.ts` (`ROLE_CIRCUITS`) | daily quota; more than 3 failures per hour opens the breaker for 1 h; role allow-lists |
| S6.1 method | `packages/sdk/scripts/spike-sponsor.ts` (S6.1 section), `docs/adr/0016-sponsored-tx-linkability.md` | which keys are searched, and how; the A-only window comparison; provisional status |

## Change log

- **15 Oct 2026, records:** `packages/crypto/src/records.ts`. Relay records now carry the guardian-encrypted case details (`ct`) inside the tag-encrypted body, and `openRecord` rejects a record whose `SHA-256(ct)` differs from its `ctHash`. **Why:** the warrant flow (§7.6) needed the regulator to fetch the ciphertexts, and no store for them existed. Guardians rely on this check (policy item 4).
- **17 Oct 2026, bank-node storage at rest:** `services/bank-node/src/store.ts` (`openStore`, `seal`, `unseal`, `jobRequest`) and `services/bank-node/src/main.ts` (job key). **Found by the nightly leak scan:** raw account identifiers survived in `bank.db-wal` after jobs finished. Deleting the field doesn't erase SQLite's old WAL frames or free pages. **Fix:**
  - the identifier in a queued job is stored only as XChaCha20-Poly1305 ciphertext, under a key `SHA-256("mulenet:bank-job-key:v1" ‖ instSecret)`;
  - `secure_delete` zeroes freed pages.
  
  Test: `services/bank-node/src/test/store-at-rest.test.ts` reads the raw DB and WAL bytes, and fails on the old code.
