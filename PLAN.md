# MuleNet — Implementation Plan

Derived from `MULENET_ARCHITECTURE.md` v1.0 (14 Oct 2026). Section refs (§) point into that doc.

---

## Status (14 Oct 2026)

- ✅ **Phase 0** done. Repo: https://github.com/rue19/mulenet
- ✅ **Phase 1** done. The contract compiles on 0.31.1 and 36 simulator tests pass. On the local chain the stale-state flag test passed and the leak scan found 0 hits. At depth 20, `attest3` proves in 8.1 s and `submitFlag` in 5.5 s. See `docs/BENCHMARKS.md` and ADRs 0011–0013.
- ✅ **Phase 2** done. `packages/crypto` has 75 tests: RFC 9497 vectors, threshold equivalence, ElGamal, records and properties. 13 more tests in `contracts/` check hash parity. See ADR 0014.
- ⏭ **Next:** Phase 3 (full invariant and adversarial suites, plus the reference-model property test).

## 0. Where we start

| Item | State on this machine | Action |
|---|---|---|
| Compact toolchain | **0.31.1 installed and active** ✓ | none |
| Compact devtools | 0.5.2 (doc pins 0.5.1) | keep, record in `versions.json`, confirm harmless |
| Node | v24.18.1 (doc assumes 22) | add `.nvmrc` = 22; try 24 first, fall back if Midnight.js complains |
| pnpm | missing | `corepack enable pnpm` |
| Docker images | old: `midnight-node:0.22.3`, `proof-server:8.1.0`, `indexer-standalone:4.0.1` | pull `proof-server:8.1.3` + the node/indexer tags matching node 1.0.400 |
| **Disk** | **3.2 GB free (96% full)** — blocks Docker work | `docker builder prune` frees ~7.8 GB of build cache (needs your OK) |
| Repo | not a git repo, only the architecture doc | `git init`, skeleton per §16 |

**Needs you, start on day 1 (long lead times):** Blockfrost Preprod project token; tNIGHT from the faucet for 2–3 sponsor wallets (DUST generation takes hours, §12.4); the real Wave 3 deadline (§22.1).

---

## 1. Design decisions (agreed 14 Oct 2026; these override the architecture doc)

1. **Flag index comes from the Merkle path, not `flagCount`.** (The doc's version made batching impossible: every leaf bound the current `flagCount`, so concurrent flags conflicted.)
   - The leaf becomes `H("mulenet:flag:v1", T, p, epoch, typology, ctHash)`, with no index. `submitFlag` uses plain `flags.insert(leaf)` and does not read `flagCount`. `flagCount.increment(1)` stays, because it is write-only.
   - Once the tx lands, the bank node finds its leaf's position once and stores it.
   - `revokeFlag` rebuilds the index from the path's `goes_left` bits in a fixed 16-step loop and asserts it equals the public `index`.
   - **Phase-1 test:** two flags proven against the same state, landing in the same block, must both succeed. If they don't, fall back to the sponsor sending one flag per block.
2. **Spam and griefing limits.** (The circuit can't check that `T` came from the OPRF, so without these a member could fill the tree, or loop flag→revoke to keep resetting root history.)
   - **Flag quota:** nullifier `H("mulenet:quota:v1", sk, epoch, slot)`, with `slot < Q` proven in-circuit. Q = 500 per epoch.
   - **Revocation cap:** nullifier `H("mulenet:rvquota:v1", sk, epoch, slot)`, with `slot < 3`.
   - The bank node keeps track of which slots it has used in its private state.
   - **Capacity:** at Q = 500 with 3 banks flagging at the maximum rate, a depth-16 tree fills in about 44 days. So use depth 20 if it benchmarks acceptably.
3. **Governance range checks.**
   - `SetCorroborationK`: `2 ≤ value ≤ 3`.
   - `SetTtl`: `1 ≤ value ≤ 90`.
4. **Smaller fixes.**
   - **OPRF:** implement RFC 9497 `Finalize` exactly (ristretto255-SHA512), then `T = SHA-256("mulenet:tag:v1" ‖ output)`. RFC test vectors cover single-key evaluation. A separate test checks that the 2-of-3 combined evaluation equals single-key evaluation with the reconstructed key.
   - **Proposal expiry:** `approve` also checks it.
   - **Retries:** the bank node treats a stale root or a `currentEpoch` transcript mismatch as "re-read state and re-prove", at most twice.

---

## 2. Phases

Each phase has an exit criterion. Nothing in a later phase starts until the gate before it is green, except where marked *parallel*.

### Phase 0 — Environment and scaffold (½ day)
- Free disk: `docker builder prune`. Pull the images pinned by `midnight-local-dev`'s `standalone.yml` for the local stack; don't force node 1.0.400 there. Pull `proof-server:8.1.3` for Preprod. Then remove the old `midnight-node:0.22.3` and `proof-server:8.1.0` images.
- Generate 2–3 sponsor wallet addresses so you can request tNIGHT from the faucet and register each wallet for DUST. Seeds go in a gitignored `.env`.
- `git init`, Apache-2.0 `LICENSE`, `.gitignore`, pnpm workspace with the §16 layout (`contracts/`, `packages/{crypto,sdk}`, `services/*`, `apps/console`, `verify/`, `infra/`, `docs/`).
- `versions.json` (§12.1) plus a `scripts/check-versions.ts` that fails on toolchain ≠ 0.31.1 or compact-runtime ≥ 0.19.
- Shared tooling: TypeScript strict, Vitest, ESLint, Prettier.
- Move `MULENET_ARCHITECTURE.md` → `docs/ARCHITECTURE.md` and update it to v1.1.

**Exit:** `pnpm install && pnpm -r build` works on an empty skeleton; version check passes.

### Phase 1 — Day-1 spike (gates everything) — §13.3
1. Minimal `mulenet.compact` with the constructor, `submitFlag`, `revokeFlag`, `attestCorroboration2` and helpers, **with the §1 decisions already folded in**. Get it through `compact compile`. Resolve every `VERIFY` item:
   - `Uint → Field → Bytes<32>` cast chain; `Uint<32>` narrowing in `execute`
   - `HistoricMerkleTree.insertIndex / insertIndexDefault / resetHistory` exist on 0.31.1 (else fallback revocation-tag `Set`, leak documented)
   - `Counter.read()` call style; ternary in `minFreshEpoch`
   - whether asserts on private comparisons need `disclose`
   - `MerkleTreePath<n,T>` and `Vector<k, struct>` as exported-circuit params; `for … of` over a vector of structs
   - the `MerkleTreePath` field names (`goes_left`), for deriving the index (§1.1)
2. Simulator tests via `@midnight-ntwrk/compact-runtime` 0.16.0 for both circuits.
3. Bring up midnight-local-dev and deploy. Run the **same-block double-flag test** (§1.1). Then time proofs at flag-tree depth 12 / 16 / 20 for `submitFlag` and `attest2` (and `attest3` if it compiles).
4. Confirm the transcript of `insert(disclose(leaf))` shows the leaf hash only, never `T`/`sk`.
5. Write `docs/BENCHMARKS.md`.

**Exit / decisions recorded in `docs/adr/`:** tree depth (prefer 20); revocation strategy; result of the same-block insert test; whether `attest3` fits the < 60 s budget.

### Phase 2 — `packages/crypto` — §5

**Design (fixed on 14 Oct 2026, before coding):**

| Module | What it does | Built on |
|---|---|---|
| `normalise.ts` | `mulenet-id/v1` for IN accounts, UPI VPAs and UK accounts. Strict regexes; anything else is rejected. | — |
| `hash.ts` | Every §5.3 derivation. `persistentHash<Vector<n,Bytes<32>>>` is plain SHA-256 over the concatenation, and the `Uint→Field→Bytes<32>` cast is 32-byte little-endian (verified against the compiled contract). | `@noble/hashes` |
| `shamir.ts` | t-of-n Shamir sharing over the ristretto255 scalar field, plus Lagrange coefficients at 0. | `@noble/curves` |
| `oprf.ts` | Threshold VOPRF (§5.2): the RFC 9497 VOPRF mode, ristretto255-SHA512. Each oracle runs `blindEvaluate` with its share `k_i` and proves it with a DLEQ proof against `K_i`. The client verifies each proof, combines two shares with Lagrange coefficients and unblinds, then applies the RFC `Finalize`. `T = SHA-256("mulenet:tag:v1" ‖ output)`. Batches of up to 64. | `@noble/curves` `ristretto255_oprf` |
| `dleq.ts` | Chaum-Pedersen DLEQ proofs with a Fiat–Shamir challenge, for decryption shares. | `@noble/curves` |
| `elgamal.ts` | Threshold ElGamal KEM with XChaCha20-Poly1305 (§5.5). The guardian key comes from a trusted dealer for now (documented). Each decryption share carries a DLEQ proof; 2-of-3 shares combine. `ctHash = SHA-256(ct)`. | `@noble/curves`, `@noble/ciphers` |
| `records.ts` | Relay records (§5.4): HKDF-SHA256 for `lookupKey`, `bucket` and `recKey`, then CBOR and XChaCha20-Poly1305. AAD binds `v ‖ bucket ‖ lookupKey`, so the relay can't move a record between buckets. | `@noble/hashes`, `@noble/ciphers`, `cbor-x` |

**Tests (target about 40):**
- RFC 9497 ristretto255 vectors, both OPRF and VOPRF.
- Threshold check: a 2-of-3 combined evaluation equals single-key evaluation with the reconstructed key, for every pair of oracles.
- Rejection paths: a bad oracle proof, too few shares, a tampered AEAD.
- Normalisation vectors.
- Round trips and tamper tests for records and ElGamal.
- `fast-check` properties.
- A cross-check in `contracts/` that `hash.ts` equals the contract's `pureCircuits` byte for byte.

**Exit:** all green.

### Phase 3 — Full contract and on-chain test suites — §6, §11, §14
- Complete `mulenet.compact`: all 9 circuits, plus every §1 decision.
- `contracts/src/witnesses.ts` (§6.5).
- Test harness: a `world()` builder (institutions, guardians, flag/revoke/attest/advance-epoch helpers, block-time control, malicious private state).
- Unit + invariant tests I1–I7 (I8 comes with the leak scanner).
- Adversarial suite: stuffing, self-corroboration, path replay, eviction, revoked-flag reuse with stale path, expiry, double vote, proposal replay, quorum, arithmetic edges, quota exhaustion.
- Reference-model property test with `fast-check` (§14.3): attestation accepted **iff** model has ≥k distinct, fresh, unrevoked, non-self flags.
- CI lint: no `Field`-keyed Set/Map, assert messages are string literals.

**Exit:** I1–I7 green; adversarial suite green; property test green at 1,000+ runs.

### Phases 4–9 — see `docs/plans/PHASES_4-9.md`

The detailed spec for Phases 4–9 is `docs/plans/PHASES_4-9.md` (15 Oct 2026). It supersedes the earlier Phase 4–9 outlines that used to be here. **Section numbers below (§) refer to that document.** The execution order and status live in **§5 of this file**.

## 3. Original schedule (superseded by §10 of docs/plans/PHASES_4-9.md)

| Day | Work |
|---|---|
| 1 | Phase 0; Phase 1 steps 1–2; Phase 2 starts; **you:** Blockfrost token + faucet |
| 2 | Phase 1 steps 3–5 (benchmarks, decisions); Phase 2 OPRF + normalisation |
| 3–5 | Phase 3 contract + tests; Phase 2 ElGamal/records finish |
| 5–7 | Phase 4 |
| 7–8 | Phase 5 |
| 9 | Phase 6 |
| 10–11 | Phase 7 |
| 12 | Phase 8 |
| 13 | Phase 9 docs/deck |
| 14 | Video, submission, buffer |

**Cut list (in order), from §20:** UK identifier → `attest2` → relay mirroring → Lace path → threshold OPRF (single-key VOPRF) → guardian auto-policy. Also cuttable: Postgres for explorer (use SQLite), mTLS (use signed tokens).
**Never cut:** leak scanner, adversarial tests, Preprod receipts.

## 4. Top risks

| Risk | Early signal | Response |
|---|---|---|
| `attest3` too big to prove (k ≥ 17) | Day-2 benchmark | Depth 16→12, ship `attest2` as the policy |
| `insertIndexDefault`/`resetHistory` missing on 0.31.1 | Day-1 compile | Revocation-tag Set fallback, document the leak |
| Sponsorship API differs from §8.4 | Phase 6 start | Read the official example first; fallback is self-funded fresh wallets per bank (loses fee privacy, L8) |
| Preprod wallet sync / DUST slowness | Day 1 | Fund and warm sponsor wallets immediately |
| Disk space | now | prune Docker build cache |

---

## 5. Execution plan, Phases 3-closeout → 9 (from 15 Oct 2026)

Tasks run in this order. ✅ = done, ▶ = in progress. Ownership tags follow the plan doc: [AGENT], [PAIR] or [YOU].

**Adjustments to the plan doc:**
- **Timing typo:** line 9 quotes `submitFlag` timings for "attest". The measured `attestCorroboration3` is 8.1 s (BENCHMARKS.md).
- **Disk:** the build cache was pruned on 14 Oct and about 11 GB is free. The node 0.22.3 and indexer 4.0.1 images are already gone.
- **Proof-server image:** keep `proof-server:8.1.0`, because the local stack pins it.
- **Proof server port:** 6301 locally, set through `MN_PROOF_SERVER`.
- **Node version:** Node is v24.18, so `node:sqlite` (X3) is available unflagged.

### A. Phase 3 closeout
1. ✅ 3.1: 1,000 runs as 10 seeded chunks, all passing. Two earlier single-process attempts died around run 650 with `CompactError: RuntimeError: unreachable`. That is a WebAssembly memory trap in the runtime, not a contract or model divergence: the simulator leaks about 6.7 MB per simulated world and hits WASM's 4 GB ceiling. Chunking in fresh processes is the fix (docs/TESTING.md).
2. ✅ 3.2: pushed to `phase-3` throughout. Merge to `main` once 3.1 passes.
3. ✅ 3.3: `docs/TESTING.md`, with the seed policy.
4. ✅ 3.4: `attest2` parity (9 tests). The benchmark row is added to the spike but not yet re-measured.
5. ✅ 3.5: ARCHITECTURE v1.2.
6. 3.6 [YOU]: contract ownership session (§2.1).

### B. Cross-cutting setup (§3)
7. ✅ X1/X2/X5:
   - `packages/sdk/src/api-types.ts` (zod)
   - an Ed25519 request-signing helper with a replay cache
   - a Fastify service skeleton with pino redaction
8. ✅ R11: `npm approve-scripts` for `classic-level` and the other native modules. Commit `allowScripts`. Smoke-test opening a level store.
9. ✅ X6: `infra/config/` layout plus the key-generation scripts (oracle shares, guardian keys, institution signing keys).

### C. Phase 4: core services
10. ✅ 4.1: oracle ×3 and the client library (`oprf-client`), 10 tests.
11. ✅ 4.2: relay (`node:sqlite`, append-only, buckets, snapshot), 9 tests. Mirror *client* union done; mirror *server* mode not built (cut-list item 2).
12. ✅ 4.4: sponsor, local edition, 16 tests, plus the local sponsorship spike (zero-DUST banks; tampered tx rejected). Follow the private-party sponsorship flow (R1) exactly, with the genesis wallet as sponsor.
13. ✅ 4.3: bank node, with boot sequence, durable job queue, flag and check flows, and the outbox, 20 tests against the contract simulator.
14. ✅ 4.5: `scripts/bootstrap.ts`, with `--skip` and named deployments.
15. ✅ 4.6: integration test `flag-check`, green twice in a row on fresh processes.
16. ◐ 4.7: the services image builds (1.25 GB, 346 s). The compose stack hasn't been started from it yet. `npm run dev:up` (process runner) works.
17. **P6-0 Preprod walking skeleton, as soon as DUST exists.** Blocked on [YOU] faucet and token.

### D. Phase 5: attest, revoke, warrants
18. ✅ 5.1 [PAIR] attest
19. ✅ 5.2 revoke
20. ✅ 5.4 epoch keeper (auto, manual and off modes)
21. ✅ 5.3 [PAIR] guardian daemon (8 tests). Governance runs through each guardian's operator API rather than a separate `mulenet-gov` CLI.
22. ✅ 5.5 demo integration test, 11/11
23. ◐ S6.1 [PAIR]: first pass done (0 bank wallet keys in tx bytes). One 16-byte window shared by a bank's two txs (`0000…009a`) still needs explaining → ADR-0016

### E. Phase 6: Preprod promotion (blocked on [YOU] faucet, token and VPS decision)
24. P6-1 promote the services
25. `demo` deployment
26. P6-2 receipts
27. ADR-0015 (maintenance authority)

### F. Phase 7: explorer and console
28. ✅ 7.1 explorer
29. ✅ 7.3 X-ray engine
30. ✅ 7.2 console. A Playwright judge-mode test passes all 11 steps in a browser (nightly).
31. 7.5 hosting

### G. Phase 8
32. ✅ 8.1 leak scanner, with a live canary on every run
33. ✅ 8.2 `mulenet-verify`
34. ✅ 8.3 CI green on GitHub; nightly and preprod workflows written

### H. Phase 9: docs and submission (§9), mostly [YOU]/[PAIR]
35. Docs and submission package

**Still needed from you:** the Wave 3 deadline (UTC), faucet tNIGHT for the 3 sponsor addresses, the Blockfrost Preprod token, a VPS decision, and the 3.6 session.
