# Q&A prep pack: where each answer lives

**Raaj answers these himself.** This file only points at the code and the tests that prove each answer. Read the lines, then say the answer out loud without notes.

Line numbers refer to `main` at the time of writing. `C` = `contracts/src/mulenet.compact`.

| # | Question (plan §2.1) | Read | Proven by |
|---|---|---|---|
| 1 | Why one shared tree and not one tree per institution? | `C:46` (flags ledger); `C:141`, `C:222` (`checkRoot(disclose(…))`); `C:266` (one root per attestation); ADR 0003 | `adversarial/forged-slots.test.ts` ("mixed roots"); `attest2.test.ts` |
| 2 | What does `checkRoot(disclose(root))` reveal? | `C:141`, `C:146`, `C:222`, `C:254–270` | Leak scan in `packages/sdk/scripts/spike-local.ts` (on-chain bytes); `docs/BENCHMARKS.md` correctness table |
| 3 | Why does the pseudonym exclude the epoch while the flag nullifier includes it? | `C:87–89` (`pseudonym`); `C:95–97` (`flagNullifier`); ARCHITECTURE §5.3 "Why each value is shaped this way" | `adversarial/stuffing.test.ts` (two epochs, same pseudonym → `dup`); invariant I2 (`invariants.test.ts`) |
| 4 | How is the leaf index bound now that it comes from the Merkle path? | `C:91` (`flagLeaf` has no index); `C:129–136` (`pathIndex`); `C:207–227` (`revokeFlag`); ADR 0011 | `unit/core.test.ts` (`pathIndex`; mutation check in TESTING.md); `revoked.test.ts`; invariant I5; local spike "stale-state" flags |
| 5 | Why does revocation reset history, and what does that cost? | `C:225`; `C:178–183` (`advanceEpoch` also resets); ADR 0008; bank-node retry in `services/bank-node/src/flows.ts` (attest, "slot not in tree") | invariant I4; `adversarial/revoked.test.ts`; judge step 8 |
| 6 | What stops a bank counting its own flag? | `C:231–235` (`slotRoot`, line 234) | `adversarial/self.test.ts`; judge step 5 |
| 7 | What stops a member filling the tree? | `C:51` (`flagQuota`); `C:187–205` (quota nullifier, lines 193–196); ADR 0012 | `unit/core.test.ts` (quota tests); `adversarial/arithmetic.test.ts`; `stuffing.test.ts` |
| 8 | What does the querier learn? | `C:254–275` (the slots the querier supplies); ADR 0004; `services/bank-node/src/flows.ts` (`check` returns counts only) | `services/bank-node/src/test/flows.test.ts` |
| 9 | Why are there no signatures in-circuit? | `C:138–147` (binding, then membership); `C:69–70` (witnesses); ADR 0001, ADR 0002 | `adversarial/path-replay.test.ts`; `malicious-witness.test.ts` |
| 10 | What can 2 colluding guardians do? | `services/guardian/src/policy.ts:1–7` (header comment) and `:17–61`; ADR 0007; leakage register L10 | `services/guardian/src/test/guardian.test.ts` |
| 11 | Why can't MuleNet prove "fewer than k flags"? | `C:254–275` (the circuit proves the existence of k slots); README honest limits; ARCHITECTURE §3.2 | (none, by design) |
| 12 | What leaks to the sponsor? | `services/sponsor/src/preflight.ts`; `services/sponsor/src/server.ts`; ADR 0010; ADR 0016; leakage register L1, L8 | `services/sponsor/src/test/sponsor.test.ts`; S6.1 spike (`spike-sponsor.ts`) |

## Likely follow-ups from Midnight engineers

| Question | Read | Proven by |
|---|---|---|
| What exactly does a guardian check before releasing a share? | `services/guardian/src/policy.ts:18–26` (round 1), `:29–61` (round 2) | `guardian.test.ts` (one refusal test per check) |
| How do you know the deployed circuits are the ones in this repo? | `verify/src/cli.ts` (`deployment`); `docs/verifier-keys.json`; `.github/workflows/ci.yml` ("Reproducible verifier keys") | CI run; ADR 0015 |
| Who can change the circuits? | ADR 0015 | `mulenet-verify deployment` |
| Can the sponsor alter a bank's transaction? | `packages/sdk/src/wallet.ts` (`balanceOwnValueAndFinalize`, `addDustFeesAndFinalize`); ADR 0010 | `spike-sponsor.ts` (one flipped byte → rejected, error 115) |
| How does the oracle avoid learning the account? | `packages/crypto/src/oprf.ts`; ADR 0005, ADR 0014 | `packages/crypto/src/test/rfc9497.test.ts`, `oprf.test.ts` |
| Why is the property test chunked? | `docs/TESTING.md` ("1,000-run result"); `scripts/property-chunks.sh` | `test-artifacts/property/summary.txt` |
| What happens if the relay lies? | `services/bank-node/src/flows.ts` (`check`: index and leaf verification) | `flows.test.ts` (forged record, false index); `relay.test.ts` |
