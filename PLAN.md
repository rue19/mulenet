# MuleNet — Implementation Plan

Derived from `MULENET_ARCHITECTURE.md` v1.0 (14 Oct 2026). Section refs (§) point into that doc.

---

## Status (14 Oct 2026)

- ✅ **Phase 0** done. Repo: https://github.com/rue19/mulenet
- ✅ **Phase 1** done. The contract compiles on 0.31.1 and 36 simulator tests pass. On the local chain the stale-state flag test passed and the leak scan found 0 hits. At depth 20, `attest3` proves in 8.1 s and `submitFlag` in 5.5 s. See `docs/BENCHMARKS.md` and ADRs 0011–0013.
- ⏭ **Next:** Phase 2 (`packages/crypto`) and Phase 3 (full invariant and adversarial suites).

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

### Phase 4 — Core services, flag→check locally — §7.2, §7.3, §8.1–8.3
- `packages/sdk`: `networks.ts` (§12.2), provider assembly, typed `MuleNetClient` (deploy/join/call/read ledger, `pathForLeaf`), retry-on-stale-root.
- `services/oracle` ×3: Fastify, `POST /v1/evaluate` (batch ≤ 64), token bucket per institution, audit counters. mTLS deferred to a shared-secret header for local dev, mTLS in compose.
- `services/relay`: SQLite, `PUT /v1/records`, `GET /v1/buckets/:b?sinceEpoch=`, content addressing, nightly Merkle snapshot.
- `services/bank-node`: `POST /v1/flags`, `POST /v1/check`, `GET /v1/health`; encrypted level private state; **direct submission with its own funded local wallet first** (sponsor comes in Phase 6).
- `infra/docker-compose.services.yml` + `scripts/bootstrap-local.ts` (deploy, register 3–4 institutions through governance, write configs).

**Exit:** on `undeployed`, Bank A and Bank B flag an account; Bank C's `/check` returns 2 distinct institutions.

### Phase 5 — Attest, revoke, governance, warrants — §7.4–7.7, §8.5
- Bank node: `POST /v1/attest`, `POST /v1/flags/:index/revoke`, escalation ciphertext.
- `services/guardian` ×3: watch proposals/disclosures, approve via API, release decryption shares **only** for authorised `attKey`s, append-only release log.
- Epoch keeper (cron) calling `advanceEpoch`.

**Exit:** the full §18 script (flag ×3, negative paths, attest, revoke→count drops→re-attest fails, warrant 1-approval fails→2 approvals→decrypt) runs locally via a script.

### Phase 6 — Sponsor + Preprod — §8.4, §12, §15
- First, confirm wallet-sdk 1.2.0 sponsorship method names against the official example (§22.4).
- `services/sponsor`: pre-flight (contract address, circuit allowlist, per-institution quota), wallet pool rotation, DUST monitoring, `DustDoubleSpend` resync, jitter/shuffle; bank nodes switch to zero-DUST unbalanced txs.
- Deploy to Preprod via Blockfrost; run the §18 script; record each circuit's tx hash in `docs/RECEIPTS.md`.

**Exit:** every circuit has a Preprod tx hash.

### Phase 7 — Explorer + Console — §8.6, §9
- `services/explorer`: indexer subscription → Postgres (or SQLite) tables `epochs, flag_counts, attestations, proposals, disclosures`.
- `apps/console` (Next.js): Analyst, Regulator (approval counter, disabled execute until quorum), Transparency, Privacy X-ray, Judge mode (one button per §18 step, backed by simulated bank nodes).

**Exit:** §18 runs end-to-end from the browser on Preprod with no terminal.

### Phase 8 — Leak scanner, verify CLI, CI — §14.4, §14.5, §15.3
- Leak scanner: gather indexer transcripts, state dump, relay DB, oracle logs, explorer DB; search bytes/hex/base64 for every test secret → fail on any hit. Shares its engine with Privacy X-ray. Closes I8.
- `verify` CLI: `deployment`, `attestation`, `warrants`; compares verifier-key SHA-256s from the release.
- GitHub Actions: PR (compile, version pin, typecheck, lint, all unit/adversarial/crypto/property/service tests), nightly local-dev integration + leak scanner, manual Preprod E2E.

**Exit:** CI green; verifier passes against the Preprod deployment.

### Phase 9 — Docs and submission — §10, §19, §21
- README (pitch, quickstart, per-circuit privacy table, honest limits), `THREAT_MODEL.md`, `PRIVACY_BOUNDARIES.md`, `DEMO.md`, `WAVE3_CHANGES.md`, ADRs 0001–0010 (+ new ones from the spike).
- Deck, 3-minute video.

---

## 3. Schedule (14 working days; re-fit once the deadline is known)

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
