# Threat model

Adversaries considered (ARCHITECTURE §11):
- a chain observer;
- a **malicious prover** who controls its own frontend and every witness;
- operators of the off-chain infrastructure (oracles, relay, sponsor);
- a curious member bank, and a malicious one;
- colluding members;
- a corrupt minority of guardians.

Each row names the defence and the test that exercises it. Contract tests run in the compact-runtime simulator against the compiled contract. Service tests run the real services. Integration tests run everything against a live local Midnight network.

## Contract

| Threat | Attack | Defence | Tests |
|---|---|---|---|
| Count stuffing | One bank contributes more than 1 to a subject's count | Deterministic pseudonym `H(sk, T)`; pairwise-distinct pseudonyms; per-epoch flag nullifier | `contracts/src/test/adversarial/stuffing.test.ts`, `attest2.test.ts`, invariant I2/I3 |
| Self-corroboration | A querier counts its own flag | `slot.pseudonym != H(querierSecret, T)` | `adversarial/self.test.ts` |
| Sybil institutions | Unapproved banks in the registry | 2-of-3 guardian governance, vote nullifiers | `adversarial/registration.test.ts`, `governance.test.ts` |
| Forged membership | Replay another member's path; graft a leaf onto real siblings | Binding assert `path.leaf == H(sk, gen)` before `checkRoot` | `adversarial/path-replay.test.ts` |
| Stale membership | Evicted bank keeps acting | `membershipGen` in the leaf; rotation | `adversarial/eviction.test.ts`, invariant I7 |
| Revoked-flag reuse | Prove with a pre-revocation path | `insertIndexDefault` + `resetHistory` | `adversarial/revoked.test.ts`, invariant I4 |
| Expired flags | Count flags older than the TTL; claim a newer epoch | `epoch ≥ current − ttl`; the epoch is hashed into the leaf | `adversarial/expiry.test.ts` |
| Forged slots | Borrow flags of another subject or typology; forge ctHash; tamper siblings; mix roots | Leaf recomputed from the slot fields; one shared root | `adversarial/forged-slots.test.ts` |
| Malicious witnesses | Lie in private state | Every witness value is constrained by an assert | `adversarial/malicious-witness.test.ts` |
| Governance abuse | Double vote, replay, value tampering, unknown kinds, warrants without an attestation | Vote nullifiers, `executed` flag, 7-epoch expiry, value commitments, range checks | `adversarial/governance.test.ts`, invariant I6 |
| Tree filling and history-reset griefing | Unlimited random tags, or flag→revoke loops | Anonymous per-epoch flag and revocation quotas (ADR 0012) | `unit/core.test.ts`, `adversarial/revoked.test.ts`, `stuffing.test.ts` |
| Arithmetic | Out-of-range values; underflow | Range-checked casts; guarded `minFreshEpoch`; constructor checks | `adversarial/arithmetic.test.ts` |
| Non-canonical keys, leaky errors | Node 1.0.400 advisory; private data in assert messages | No `Field`-keyed Set or Map; literal assert messages only | `unit/static.test.ts` |
| Anything the model doesn't predict | — | The contract must accept exactly what a reference model accepts | `property/reference-model.test.ts` (1,000 runs; mutation-checked) |

## Off-chain

| Threat | Attack | Defence | Tests |
|---|---|---|---|
| Enumeration of accounts | A member computes tags for the whole account space | 2-of-3 threshold OPRF; per-institution daily quota; burst alarm | `services/oracle/src/test/oracle.test.ts` |
| Faulty or malicious oracle | Evaluates with a wrong key | DLEQ proof against the oracle's registered public share; the client needs any 2 valid answers | `oracle.test.ts`, `packages/crypto/src/test/oprf.test.ts` |
| Relay forgery | Injects records | Clients count a record only if its leaf is on-chain at the claimed index | `services/bank-node/src/test/flows.test.ts` (forged record, false index) |
| Relay re-filing | Moves a record to another subject or bucket | AEAD binds `v ‖ bucket ‖ lookupKey`; the relay checks bucket = lookupKey prefix | `packages/crypto/src/test/records.test.ts`, `services/relay/src/test/relay.test.ts` |
| Relay withholding | Drops records | Clients union the primary and mirrors; banks audit their own records | `relay.test.ts` (withholding) |
| Sponsor fee drain | Members submit failing or foreign transactions | Structural pre-flight; role allow-lists; daily quota; failure breaker | `services/sponsor/src/test/sponsor.test.ts` |
| Sponsor tampering | The sponsor alters a bound transaction | The user binds before sponsoring; the network rejects a modified transaction | `packages/sdk/scripts/spike-sponsor.ts` (one flipped byte → rejected) |
| Sponsor acting as a bank | The fee payer authors calls | Authorisation is by secret, never by fee payer | `adversarial/path-replay.test.ts`, `malicious-witness.test.ts` |
| Unwarranted disclosure | The regulator asks guardians for arbitrary ciphertexts | Guardians check the warrant on-chain, the attestation key from T, decryption under T, the leaf at its index, and `SHA-256(ct)` = ctHash | `services/guardian/src/test/guardian.test.ts` |
| Bogus decryption share | A guardian sends a wrong share | DLEQ-proven shares; the combiner skips invalid ones | `packages/crypto/src/test/elgamal.test.ts` |
| Request forgery and replay | Forge or replay internal API calls | Ed25519 over method, path, ts, nonce and body hash; ±60 s; replay cache | `packages/service-kit/src/test/auth.test.ts` |
| Secret leakage in outputs | Secrets in logs, databases or bundles | Leak scanner with a live canary on every run | `tools/leak-scan`, CI and nightly |
| Subject leakage on-chain | Identifiers or tags in public data | Only hidden leaves and hashed keys | On-chain leak scan in `spike-local.ts`; Privacy X-ray (`services/explorer`) |
| Fee-payer linkability | Sponsored transactions reveal the bank | Bank wallets hold zero DUST; no bank key in transaction bytes (local evidence) | ADR 0016 (provisional, Preprod pending) |

## Accepted risks (leakage register, ARCHITECTURE §10.2)

- **L1:** flag timing (mitigated by sponsor batching and shuffling).
- **L6:** per-institution query volume, visible to the oracles.
- **L7/L8:** relay access patterns, and which institution submits, visible at the network level.
- **L9:** the anonymity set is the number of active institutions.
- **L10:** t colluding guardians could decrypt without a warrant. Releases are logged.
- **Maintenance authority:** single-signature during the Wave; any change is detectable by `mulenet-verify` (ADR 0015).
