# MuleNet — Detailed Build Plan, Phases 3-closeout → 9

| | |
|---|---|
| Written | 15 Oct 2026 (IST) |
| Repo | `github.com/rue19/mulenet` (61 commits pushed; 18 local Phase-3 commits pending) |
| Baseline | Phases 0–2 done. Phase 3 is done except the 1,000-run property test. |
| Toolchain | Compact 0.31.1 / runtime 0.16.0 / Midnight.js 4.1.1 / wallet SDK 1.2.0. Local stack: node 1.0.0, indexer 4.3.3, proof server 8.1.0 on **:6301**. |
| Decision taken from Phase 1 | Flag tree **depth 20** (1,048,576 leaves). `attest` proves in 5.5 s warm and 12.3 s cold, well inside budget. |
| Ownership tags | **[YOU]** you write it yourself · **[AGENT]** the coding agent writes it · **[PAIR]** the agent drafts, you review line by line and own the explanation |

---

## 0. What the new research changes

These are facts from this week's docs and reference code, each with the plan change it forces.

| # | Finding | Source | Plan change |
|---|---|---|---|
| R1 | Official sponsorship flow: the **user** runs `createUnprovenCallTx` → `proofProvider.proveTx` → `wallet.balanceUnboundTransaction(tx, keys, { ttl, tokenKindsToBalance: ['shielded','unshielded'] })` → `signRecipe(recipe, payload => keystore.signData(payload))` → `finalizeRecipe` → hex. The **sponsor** runs `Transaction.deserialize<SignatureEnabled, Proof, Binding>('signature','proof','binding', bytes)` → `balanceFinalizedTransaction(tx, keys, { ttl, tokenKindsToBalance: ['dust'] })` → `signRecipe` → `finalizeRecipe` → `submitTransaction`. | `example-private-party` `src/sponsor.ts`, `src/wallet.ts`, `docs/SPONSORSHIP.md` | Copy this exactly. Each bank node **still needs a wallet** for the user-side step. That raises two questions: (a) does a bank's wallet key or signature land in the tx and make it linkable? (b) must every bank wallet sync from genesis? Both are answered in spike **S6.1** (§6). |
| R2 | "Fees for the whole transaction are collected in the guaranteed phase, so a **fallible-phase failure still consumes the fee**." | DUST sponsorship guide | The sponsor must run a **local pre-execution** and track failures per institution. A member submitting failing calls can otherwise drain sponsor DUST. |
| R3 | "The real deadline is the **intent TTL fixed when the transaction is constructed** … Do not let a transaction sit in a queue on the sponsor's side." | SPONSORSHIP.md troubleshooting | Batching windows must be short (≤ 45 s). The bank node sets TTL explicitly when building. The sponsor rejects anything with < 5 min of TTL left. |
| R4 | Concurrent spends from one sponsor wallet cause nondeterministic balancing failures (`DustDoubleSpend`, code 196). The reference test suite disables file parallelism for this reason. | SPONSORSHIP.md | **One in-flight tx per sponsor wallet.** Throughput comes from the pool of 3, not from concurrency within a wallet. |
| R5 | Error codes: **170** `InvalidDustSpendProof` (sponsor not fully synced), **173** insufficient DUST for registration, **196** `DustDoubleSpend`. Submission failures surface as `1010: Invalid Transaction: Custom error: N`. | DUST sponsorship guide | Retry and resync logic is keyed on these codes (§6.4). |
| R6 | Blockfrost free tier: **50,000 requests/day**, **10 req/s per IP with a 500 burst**. HTTP **402** means the daily limit is exhausted; **403** means a token problem. Midnight shares the Cardano plan limits. | Blockfrost blog and OpenAPI | Public reads go through **one explorer read-model** that holds a single WebSocket subscription. Bank nodes read the explorer, not Blockfrost. There is a request budget table (§6.6). |
| R7 | Midnight.js 4.1.x: import ledger types from `@midnight-ntwrk/midnight-js-protocol/ledger`. A second ledger copy fails type-checking (`separate declarations of a private property 'type_'`). Two runtime copies give `expected instance of …` errors. | Deploy-and-operate guide | Workspace-wide dedupe check in CI (`npm ls @midnight-ntwrk/compact-runtime` must show one version). You already hit a version of this in Phase 3. |
| R8 | `deployContract` **installs a single-signature maintenance authority by default** and stores its key in the private-state provider. The authority can remove or insert verifier keys and replace itself. | Deploy-and-operate guide | New **ADR-0015: maintenance authority custody** (§6.5). Back up that key or lose upgradability. |
| R9 | `ledger(state.data)`, not `ledger(state)`. Otherwise you get `expected instance of ChargedState`. | Deploy-and-operate troubleshooting | The explorer decoder uses `.data`. |
| R10 | Indexer v4 subscription `contractActions(address: HexEncoded!, offset: BlockOffset)` streams every action on the contract. Blockfrost serves the same schema at `wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=…`. | Indexer API v4 docs; Blockfrost docs | The explorer is built on exactly one `contractActions` subscription. |
| R11 | npm **11.16+** prints `allow-scripts` warnings for dependency install scripts. **npm 12** will not run them unless allow-listed in `package.json#allowScripts`. Use `npm approve-scripts <pkg>` after install, and `npm ci --strict-allow-scripts` in CI to fail early. | npm release notes; Chainguard migration guide | Approve `classic-level` and any other native module now, commit `allowScripts`, and add a strict CI job (§8). Use built-in `node:sqlite` (unflagged since Node 22.13; **VERIFY** your Node version) instead of a native SQLite module. |
| R12 | `levelPrivateStateProvider` requires `accountId` and a password of ≥16 characters with 3 of 4 character classes. A wrong password surfaces deep inside a tx flow unless you write a **canary value** at creation and verify it on unlock. | Deploy-and-operate guide | The bank node writes and checks a canary at boot (§4.3). |
| R13 | Wave 1 deadline was **2026-09-16 15:00 UTC**. Wave 3's exact deadline is **not public anywhere I could find**. The submission package is: GitHub repo + README + slide deck + demo video + progress description. The technical gate is: a compiling Compact contract, meaningful Midnight use, the `midnightntwrk` topic, and Apache-2.0. | Wave-1 READMEs and HackMD; AKINDO | Schedule in §10 is written relative to **D = deadline**, with a cut plan for D = 22 Oct and for D ≥ 26 Oct. **Get D from the AKINDO page today.** |
| R14 | Competitor signal: FairGate (Wave 2) lists "hosted proof server" and "DUST fee sponsorship so auditors never need tokens" as Wave-3 goals. | FairGate README | Sponsorship alone won't differentiate you. **Privacy-preserving** sponsorship plus a measured leak scan will, so S6.1 matters for the pitch too. |

---

## 1. Two structural changes to the remaining phases

### 1.1 Build the sponsor inside Phase 4, on the local network, not in Phase 6

If bank nodes first submit self-paid transactions and are switched to sponsorship later, the whole submission path gets written twice. The private-party example runs sponsorship entirely on the local devnet: the genesis wallet is the sponsor, and a zero-DUST wallet is the user. So:

- **Phase 4** builds `services/sponsor` against `undeployed`, and every bank-node transaction goes through it from day one.
- **Phase 6** becomes *promotion to Preprod*: endpoints, the wallet pool, receipts and the S6.1 linkability findings.

### 1.2 Put a Preprod walking skeleton at the start, not the end

Preprod runs node **1.0.400**, which rejects some calls that 1.0.0 accepts (non-canonical transcript values). Blockfrost has its own quirks: tokens, sync lag, and non-portable sync state. Finding these on the last day is how projects miss deadlines. So **as soon as sponsor wallet #1 has DUST**, deploy the current contract to Preprod and land one `submitFlag` (task P6-0). That can happen during Phase 4.

---

## 2. Phase 3 closeout (today, ~2 hours)

| # | Task | Owner | Done when |
|---|---|---|---|
| 3.1 | Let the 1,000-run property test finish. If it fails, **keep the seed and the shrunk counterexample** in `contracts/test/property/regressions/` as a permanent fixed-seed test. | AGENT | Green, or a regression test committed with the fix |
| 3.2 | Push the 18 local commits **now** to a branch (`phase-3`) as a backup, and merge to `main` after 3.1 passes. Holding unpushed work on one laptop with 3.2 GB free disk is the bigger risk. | AGENT | Branch pushed |
| 3.3 | Commit `docs/TESTING.md`, including how to run each suite and the property-test seed policy. | AGENT | Committed |
| 3.4 | Close the `attestCorroboration2` gap. Give it the same test parity as `attest3`: the distinctness, self-exclusion, expiry, revoked-slot, shared-root and policy-k tests, plus a benchmark row. | AGENT | Parity table in TESTING.md |
| 3.5 | Update `docs/ARCHITECTURE.md` to v1.2: depth 20, capacity 1,048,576, measured prove times, and the depth-16 benchmark marked skipped with the reason. | AGENT | Changelog entry |
| 3.6 | **Contract ownership session (half a day).** See §2.1. | **YOU** | You can answer the 12 questions in §2.1 without notes |

### 2.1 Why 3.6 isn't optional

The contract and its tests were written by the agent. Wave-3 judges are the Midnight team, and their questions will be about the contract. Whether you can answer them without looking anything up decides the Engineering score more than the code does. This is the point where relying on generated code turns into a liability, so close the gap deliberately:

1. Read `contracts/src/mulenet.compact` top to bottom with the architecture doc closed. For each exported circuit, write its row of the per-circuit privacy table from memory, then diff your version against the doc's.
2. Write **3 adversarial tests yourself**, without the agent:
   - (a) a path replayed from another bank;
   - (b) a flag reused after revocation via a pre-revocation path;
   - (c) a quota-slot replay in the same epoch.
3. Answer these out loud and record yourself:
   - Why one shared tree and not one tree per institution?
   - What does `checkRoot(disclose(root))` reveal?
   - Why does the pseudonym exclude the epoch but the flag nullifier include it?
   - How is the leaf index bound now that it comes from the Merkle path?
   - Why does revocation reset history, and what does that cost?
   - What stops a bank counting its own flag?
   - What stops a member filling the tree?
   - What does the querier learn?
   - Why are there no signatures in-circuit?
   - What can 2 colluding guardians do?
   - Why can't MuleNet prove "fewer than k flags"?
   - What leaks to the sponsor?

---

## 3. Cross-cutting decisions to lock before Phase 4

| ID | Decision | Choice | Why |
|---|---|---|---|
| X1 | Service runtime | Node 22, TypeScript, **Fastify 5**, `pino` logs with a redaction list (`project_id`, `seed`, `secret`, `identifier`, `T`) | Fast, typed schemas (JSON-Schema validation on every route) |
| X2 | Service-to-service auth | **Ed25519 request signatures** (`@noble/curves/ed25519`): header `X-MuleNet-Inst`, `X-MuleNet-Ts`, `X-MuleNet-Sig` over `method‖path‖ts‖sha256(body)`, with a ±60 s window and a replay cache | Simpler than mTLS in a hackathon, and the security property can be demonstrated. Document mTLS as production. |
| X3 | Local storage | `node:sqlite` (WAL mode) per service; `levelPrivateStateProvider` only for contract private state | Avoids a second native module (R11) |
| X4 | Encoding | Binary in hex at API boundaries, CBOR (`cbor-x`) inside encrypted records | Deterministic and compact |
| X5 | Shared types | `packages/sdk/src/api-types.ts` with zod schemas, imported by every service and the console | One source of truth |
| X6 | Config | `infra/config/*.json` (consortium: institution public keys, oracle URLs and public shares, guardian keys) plus `.env` for secrets only | Secrets never in JSON |
| X7 | Job model for anything that proves | Durable queue in SQLite (`jobs` table), one worker per bank node, idempotency keys, an **outbox** for relay writes | Proving takes 5–12 s and can fail mid-flight, so state has to survive restarts |
| X8 | Demo proof server topology | **One proof server per host in demo**, shared by the simulated banks. This is labelled a demo shortcut in the README; production is one per bank. | Five proof servers won't fit your RAM or disk. All banks are run by you anyway, so no real trust boundary is crossed. |
| X9 | Demo epochs | **Two Preprod deployments.** `main` uses 24 h epochs and 30-epoch TTL. `demo` uses 5-minute epochs and a 2-epoch TTL, so the expiry and epoch-roll steps show live. | `epochLength` is `sealed` and fixed at construction |

---

## 4. Phase 4 — Core services (oracle ×3, relay, sponsor-local, bank node)

**Goal:** two banks flag an account locally, and a third bank's `/check` returns `distinctInstitutions: 2`. Every tx goes through the sponsor.
**Size:** 3 days (including the sponsor pulled forward from Phase 6).

### 4.1 Tagging oracle ×3 (`services/oracle`) [AGENT]

**Responsibilities:** evaluate blinded ristretto255 points with its key share and a DLEQ proof. Rate-limit per institution. Keep a count-only audit log.

**API**

```
GET  /v1/public            → { index: 1|2|3, publicShare: hex, groupPublicKey: hex, suite: "ristretto255-SHA512" }
POST /v1/evaluate          (signed, X2)
     body { blinded: hex[] (1..64) }
     → 200 { evaluated: hex[], proof: { c: hex, s: hex } }   // one batched DLEQ per RFC 9497 §2.2.1
     → 429 { error: "quota", resetAt }
GET  /v1/health
```

**Storage:** `quota(institution, day, used)` and `audit(institution, day, count)`. **Never** store blinded points.
**Rate limits:** 5,000 evaluations per institution per day (config), with a burst alarm when a 5-minute window exceeds 10× the institution's median.
**Keys:** trusted-dealer setup script `scripts/oracle-keygen.ts`. It writes 3 share files (`infra/secrets/oracle-{1,2,3}.key`, mode 0600) and the public config. ADR-0014 already documents dealer setup over DKG.

**Tests**
- RFC 9497 vectors (already in `packages/crypto`).
- Batched DLEQ verifies for 1 and 64 points.
- Bad signature → 401.
- Replayed `ts` → 401.
- Quota exhaustion → 429.
- A response from the wrong share is detected by the client's DLEQ check.
- Any 2 of 3 oracles give the same `T`.
- One oracle down → client still succeeds with the other two.

**Exit:** the client library `packages/crypto/oprf-client.ts` gets `T` from any 2 of the 3 local oracles in under 150 ms.

### 4.2 Flag relay (`services/relay`) [AGENT]

**API**

```
PUT  /v1/records           (signed) body { record: base64(cbor) }        → 201 { id: sha256hex } | 409 duplicate
GET  /v1/buckets/:bucket?since=cursor&limit=500                          → { records: base64[], cursor }
GET  /v1/snapshot          → { count, root: hex, at }                    // Merkle root over record ids, hourly
GET  /v1/health
```

- `bucket` = first 2 bytes of `lookupKey`, which gives 65,536 buckets. The relay validates CBOR structure and size (≤ 1 KB) only. It cannot validate content, by design.
- Append-only. There is no DELETE endpoint. Revocation is a chain fact, and clients ignore revoked leaves.
- **Mirror mode** (stretch): `relay --mirror <url>` pulls from the primary and serves the same API.

**Tests**
- A forged record (valid CBOR, no matching on-chain leaf) is ignored by the client. Write this as a bank-node test.
- Withholding: the primary drops a record, the mirror has it, and the client unions both.
- A bucket fetch returns all records in the bucket, not just the target one.
- The relay DB contains no `T` and no `lookupKey` beyond what is inside the opaque record. This becomes a leak-scanner target in Phase 8.

### 4.3 Bank node (`services/bank-node`) [AGENT, with PAIR on the flow logic]

**Boot sequence**
1. Load config.
2. `setNetworkId`.
3. Polyfill `globalThis.WebSocket = ws`.
4. Open `levelPrivateStateProvider({ privateStateStoreName: 'mulenet-<inst>', signingKeyStoreName: 'mulenet-<inst>-keys', privateStoragePasswordProvider, accountId: <wallet bech32> })`.
5. Verify the canary. If it is missing on a store that claims to be provisioned, refuse to start.
6. Build providers: `NodeZkConfigProvider('contracts/src/managed/mulenet')` and `httpClientProofProvider('http://localhost:6301', zk)`.
7. Build and start the wallet. Restore serialized sync state if present (S6.1).
8. Run `findDeployedContract`.
9. Cache this institution's path in the institution tree.

**API (internal, signed)**

```
POST /v1/flags                { identifier, typology: 1..4, caseRef, idempotencyKey }  → 202 { jobId }
POST /v1/flags/:id/revoke     { idempotencyKey }                                       → 202 { jobId }
POST /v1/check                { identifier, typology? }                                → 200 CheckResult (sync, no tx)
POST /v1/attest               { identifier, typology, caseRef, k: 2|3, idempotencyKey } → 202 { jobId }   (Phase 5)
GET  /v1/jobs/:jobId          → { state: queued|tagging|proving|sponsoring|submitted|confirmed|failed,
                                  txId?, blockHeight?, flagIndex?, error?: { code, retryable } }
GET  /v1/health               → { proofServer, indexer|explorer, oracles: [up,up,up], sponsor, wallet: { synced } }
```

**`CheckResult`**

```ts
{
  distinctInstitutions: number,
  flags: { epoch: number, typology: number, fresh: boolean }[],   // no pseudonyms exposed to bank systems
  skipped: { revoked: number, expired: number, notOnChain: number },
  attestation: { k: 2|3, epoch: number, typology: number } | null,
  verifiedAgainst: { root: hex, atBlock: number },
  timings: { oprfMs, relayMs, verifyMs }
}
```

**The flag flow (job worker)**
1. `normalise(identifier)`.
2. Get `T` via the OPRF (2 of 3).
3. Derive `p`, the ctHash for the guardian-encrypted details, and the epoch.
4. `createUnprovenCallTx(providers, { contract, circuitId: 'submitFlag', args, privateStateId })`.
5. `proofProvider.proveTx`.
6. User-side balance, sign and finalize per R1.
7. POST to the sponsor.
8. Wait for confirmation (indexer or explorer).
9. Find the actual leaf index. Read `flags` state, start from the `firstFree` value recorded before submit, and recompute the leaf for each candidate index. That is O(batch), not O(n).
10. Write the relay record through the **outbox** (retry until 201 or 409).
11. Drop `x` and `T` from memory. Persist only `{flagIndex, caseRef-handle, epoch, typology, ctHash, txId}`.

**The check flow**
1. Get `T` via the OPRF.
2. Derive `lookupKey` and `bucket`.
3. GET the bucket from the relay (and the mirror if configured), union, then filter by `lookupKey`.
4. Decrypt each record with `recKey`.
5. For each record, recompute the leaf and confirm it is in the current tree. Use `pathForLeaf(index, leaf)` against state from the explorer, then recompute the root and compare it to the current root. A revoked index holds the default leaf, so its root check fails and it lands in `skipped.revoked`.
6. Apply TTL against `currentEpoch`.
7. Count distinct pseudonyms.
8. Read `attestations[attKey]`.

**Retry matrix (bank side)**

| Failure | Detect | Action |
|---|---|---|
| Epoch rolled between prove and land | tx rejected; `currentEpoch` changed | Re-read state, re-prove, max 2 attempts |
| Root history reset by a revocation (attest only) | `slot not in tree` at execution | Re-fetch the root, rebuild the paths, re-prove |
| Quota slot already used | `quota` assert | Pick the next free slot (track used slots locally per epoch) |
| Sponsor 429 or 503 | HTTP | Back off with jitter; keep the TTL check |
| TTL < 5 min left | local | Rebuild the tx from scratch |

**Tests:** unit tests for each worker step with a mocked sponsor; integration on local-dev (§4.6).

### 4.4 Sponsor, local edition (`services/sponsor`) [AGENT, PAIR on policy]

**API**

```
POST /v1/sponsor   (signed by institution)  body { txHex, circuit: "submitFlag"|"revokeFlag"|"attestCorroboration2"|"attestCorroboration3"|"propose"|"approve"|"execute"|"advanceEpoch" }
                   → 200 { txId } | 400 { reason: "not-mulenet"|"circuit-not-allowed"|"ttl"|"preexec-failed" } | 429 { reason: "quota"|"failure-rate" }
GET  /v1/health    → { wallets: [{ id, dustBalanceSpeck, inFlight, lastError }], queueDepth }
```

**Pipeline**
1. Verify the institution signature.
2. Run `Transaction.deserialize<SignatureEnabled, Proof, Binding>('signature','proof','binding', bytes)`.
3. **Structural pre-flight.** Every contract action in the tx must target the MuleNet address, the entry point must be in the allow-list, there must be no unshielded or shielded value movements, and the TTL must have ≥ 5 min left. **VERIFY** the ledger-v8 `Transaction` inspection API: it is reached through intents → actions → contract call address and entry point. Read the `midnight-js-protocol/ledger` typings.
4. **Pre-execution (R2).** Run the call against the current public state with the compact runtime in "check" mode, if your SDK version exposes it. **VERIFY**. If it doesn't, rely on the institution's failure-rate limit (step 6).
5. Batching: hold for at most 45 s or 8 txs, shuffle, then hand to the wallet pool.
6. Per-institution accounting: daily tx quota, and a **failure-rate breaker**. More than 3 failed submissions in 1 h opens the breaker for 1 h.
7. Wallet pool: N wallets, each with a mutex (R4). Run `addDustFeesAndFinalize`, then `submitTransaction`. On 196 or 170: `waitForSyncedState`, rebuild, retry once on a different wallet.

**Local-only setup:** the genesis wallet is sponsor #1. Bank-node wallets get **zero** DUST, deliberately. Copy the private-party test that asserts "bank DUST = 0 before and after".

**Tests**
- Happy path.
- Non-MuleNet tx → 400.
- Disallowed circuit → 400.
- Expired TTL → 400.
- Over quota → 429.
- Breaker opens.
- Two concurrent requests use two different wallets.
- The sponsor cannot alter the tx: mutate one byte and the network rejects it.
- The sponsor cannot act as a bank: the sponsor tries `submitFlag` with its own secret and gets `not a member`.

### 4.5 Deploy-and-register script (`scripts/bootstrap-local.ts`) [AGENT]

1. Generate 5 institution secrets (A–E) and 3 guardian secrets. Write private states with canaries.
2. Deploy the contract with guardian leaves, `t=2`, `k=2`, 300 s epochs, TTL 2. Keep the maintenance-authority key (ADR-0015).
3. For each institution: `propose(1, leaf)` → `approve` ×2 → `execute`.
4. Write `infra/state/local.json` with the address, block numbers and roots. This contains no secrets.

### 4.6 Phase 4 integration test (`test/integration/flag-check.test.ts`) [AGENT]

```
bootstrap → A.flag(X, 1) → B.flag(X, 1) → C.check(X) == { distinctInstitutions: 2 }
         → A.flag(X, 1) again same epoch → job fails 'duplicate flag'
         → Z (unregistered).flag(X) → fails 'not a member', no tx submitted
         → C.check(Y unseen) == 0
assert: bank wallets' DUST == 0 throughout; sponsor DUST decreased
```

**Phase 4 exit:** this test is green twice in a row on a fresh local-dev. Docker compose (`infra/docker-compose.services.yml`) brings everything up with `npm run dev:up`.

### 4.7 Docker topology (local and demo)

| Container | Port | Image or build | Notes |
|---|---|---|---|
| node, indexer, proof-server | 9944, 8088, **6301** | vendored `infra/local` | existing |
| oracle-1..3 | 7101–7103 | `services/oracle` | separate key files mounted read-only |
| relay | 7200 | `services/relay` | volume `relay-data` |
| sponsor | 7300 | `services/sponsor` | seeds via env file |
| bank-a..e | 7401–7405 | `services/bank-node` | volume per bank for private state |
| guardian-1..3 | 7501–7503 | `services/guardian` (Phase 5) | |
| explorer | 7600 | `services/explorer` (Phase 7) | |
| console | 3000 | `apps/console` (Phase 7) | |

**Disk:** expect about 1.5–2 GB more for service images if you use one shared Node base image (`node:22-slim`) and a multi-stage build. Run `docker builder prune` before Phase 4, and delete the superseded Midnight images once Preprod is confirmed working.

---

## 5. Phase 5 — Attest, revoke, governance and warrants, epoch keeper

**Goal:** the full 3-minute demo script runs locally from a CLI driver.
**Size:** 2 days.

### 5.1 Bank-node attest [PAIR]

1. Run the check flow, but keep the decrypted records.
2. Select the slots. Choose k records with distinct pseudonyms, freshest first, excluding your own pseudonym. If fewer than k remain, return `422 insufficient` **without proving**. This is the demo's "proof cannot be constructed" moment, so make the UI message explicit.
3. Get **one** current root, and build all k paths from that same state snapshot. The contract now asserts the slots share one root.
4. Build `escalationCt`, encrypted to the guardian group key, over `{identifier, T, slots: [{index, ctHash}], institutionId, caseRef}`, and take `escalationCtHash`.
5. Prove `attestCorroboration{k}` and sponsor it.
6. On `slot not in tree` (a revocation landed in between), rebuild once.

### 5.2 Bank-node revoke [AGENT]

Load the stored `{T-less handle, epoch, typology, ctHash, flagIndex}`. The bank must re-derive `T` via the OPRF from its own case system's identifier, because `T` is never stored. Then build the leaf path and prove `revokeFlag` with the revocation-quota slot. **The note to put in the README:** revocation needs the bank to still hold the account identifier, which it always does for its own case.

### 5.3 Guardian daemon (`services/guardian`) [PAIR — this logic is a judge question]

**API**

```
POST /v1/shares/escalation  (signed by regulator)  { attKey, escalationCt }
     checks: disclosures[attKey] exists on chain; sha256(escalationCt) == attestations[attKey].escalationCtHash
     → { share: hex, dleq: {c,s}, guardianIndex }
POST /v1/shares/details     (signed by regulator)  { attKey, T, records: base64[], detailCts: hex[] }
     checks (all must hold):
       1. persistentHash("mulenet:att:v1", T, epoch, typology) == attKey           ← T is the warranted subject
       2. each record decrypts under HKDF(T,"mulenet:rec:v1")                       ← records belong to T
       3. each recomputed leaf is in the current (or historic) flag tree            ← records are real flags
       4. sha256(detailCts[i]) == record[i].ctHash                                  ← ciphertext is the committed one
     → { shares: [{ share, dleq }], guardianIndex }
GET  /v1/log                → append-only list of releases { at, attKey, kind, count }   (public, for the transparency page)
```

Why this design: guardians don't need to trust the regulator's word about which ciphertexts belong to a warrant. Given `T`, every link back to the authorised `attKey` is checked cryptographically against chain state. Guardians learn `T` in round 2, which is acceptable because guardians are the oversight parties. Write that in PRIVACY_BOUNDARIES.md.

**Governance actions:** a CLI `mulenet-gov propose|approve|execute` used by the guardians' daemons and the regulator console. Auto-approval policy is off by default. The demo's "auditor approves" step is a button, not automation.

### 5.4 Epoch keeper [AGENT]

A loop inside the sponsor service. It reads `nextEpochAt` from the explorer, waits until block time passes it plus a 12 s margin (2 blocks), then submits `advanceEpoch` with the sponsor paying both sides (no bank involved). `advanceEpoch` is idempotent in effect: a second call fails `too early`, and the keeper treats that as success.

### 5.5 Phase 5 integration test = the demo script as code (`test/integration/demo.test.ts`)

1. A, B and C flag X.
2. A re-flags X → duplicate.
3. Z (unregistered) flags → not a member.
4. D attests k=3 with a duplicate pseudonym (forced via a test hook) → `dup`.
5. C attests using its own flag → `self excluded`.
6. D attests k=3 → ok.
7. E checks → sees the attestation.
8. B revokes. E checks → 2. D's re-attest with k=3 → `insufficient` (no proof).
9. Regulator proposes the warrant → execute with 1 approval → `quorum`. Auditor approves → execute → ok.
10. Guardian shares (round 1 and round 2) → the regulator learns {A, C} plus case refs.
11. Advance block time past TTL → `advanceEpoch` ×2 → E checks → 0 fresh.

**Exit:** green on a fresh local-dev, in under 10 minutes wall-clock.

---

## 6. Phase 6 — Preprod promotion (sponsor pool, receipts, linkability spike)

**Goal:** both Preprod deployments live, a tx hash for every circuit and every negative path in `docs/RECEIPTS.md`, and S6.1 answered.
**Size:** 1.5 days of work. The **lead time** for DUST and wallet sync is hours, so start P6-0 now.

### P6-0 Preprod walking skeleton (start the moment DUST exists) [AGENT]

1. **[YOU]** Request tNIGHT from the faucet (`midnight-tmnight-preprod.nethermind.dev`, 1,000 tNIGHT per request, rate-limited) for the 3 sponsor addresses.
2. **[AGENT]** Register each for DUST generation with the wallet SDK. Poll `waitForGeneratedDust`. Persist each wallet's serialized sync state locally, so restarts don't resync from genesis. A full Preprod sync can take over an hour.
3. With the **Blockfrost Preprod token** (`nightpreprod…`) in `.env`, run `scripts/smoke-preprod.ts`. It checks `system_chain == "Midnight Preprod"` and an indexer block height above 0 (the docs' curl checks, in TS).
4. Deploy `main` from sponsor #1 (self-paying) and land one `submitFlag`. **This is the first time your contract meets node 1.0.400.** Any `1010 Invalid Transaction` here means a canonicality issue, so stop and fix it before Phase 7.

### S6.1 Linkability spike: does the bank's wallet show up in a sponsored tx? [PAIR — this decides a pitch claim]

**Question:** in the R1 flow, the bank wallet runs `balanceUnboundTransaction(['shielded','unshielded'])` and `signRecipe`. For a MuleNet call that moves no value, does the finalized tx carry anything derived from the bank's wallet keys (a signature, coin public key or address)? If it does, every flag from Bank A is linkable to Bank A's wallet, and the sponsorship privacy claim falls apart.

**Method**
1. Land 2 sponsored `submitFlag`s from Bank A and 1 from Bank B on local-dev.
2. Dump the raw finalized tx bytes (the sponsor logs hex) and the indexer's view of each tx.
3. Search them for A's and B's unshielded address bytes, coin public key, encryption public key, DUST public key and any signature verification key, plus anything repeated across A's two txs that doesn't appear in B's. Use the Phase-8 leak scanner engine early.

**Outcomes and actions**

| Result | Action |
|---|---|
| Nothing bank-linked appears | Great. Make "fee payer and signer are both unlinkable to the bank" a headline claim, with the scan as evidence. |
| Bank key or signature appears | Switch to **ephemeral per-tx wallets**: a fresh seed per tx with zero balance. Test whether an **unsynced** fresh wallet can complete the user-side step when there is nothing to balance. If it can → adopt, and the problem is solved. If it can't → test building the binding with the ledger API directly, without the wallet. If neither works → keep one wallet per bank, add **L12 "bank wallet key links that bank's own transactions"** to the leakage register, and rotate bank wallets per epoch as mitigation. |

**Also measure:** serialized tx size per circuit. This feeds the 10 MB/day per-account throttle math, so record it in BENCHMARKS.md.

### P6-1 Promote the services [AGENT]

- `packages/sdk/networks.ts` `preprod()` is already done. Point every service at it.
- **Read path:** the bank nodes and guardians read **only the explorer** (§7.1), never Blockfrost directly. The explorer holds the single WS subscription. Only the wallets talk to Blockfrost directly.
- Sponsor pool: 3 wallets with mutexes. The health endpoint shows the DUST balance of each.
- Deploy `demo` (5-minute epochs, TTL 2) alongside `main`.

### P6-2 Receipts run (`scripts/preprod-receipts.ts`) [AGENT]

Runs the §5.5 script against `demo`. Each step's tx hash, block height and explorer links go to `docs/RECEIPTS.md`. Use three explorers: `preprod.midnightexplorer.com`, `midnight-preprod.subscan.io` and `explorer.1am.xyz/?network=preprod`.

Negative paths that fail **client-side** (no tx), such as `insufficient` and `not a member` before proving, are recorded as "refused before proof" with the exact error. Negative paths that are **on-chain rejections** are recorded with the submission error code. Never present a client-side refusal as an on-chain one.

### 6.4 Sponsor operational limits

| Concern | Setting |
|---|---|
| In-flight per wallet | 1 |
| Batch window | ≤ 45 s or 8 txs |
| Retry on 170 / 196 | resync, rebuild, retry once on another wallet |
| Fee-burn protection (R2) | breaker: > 3 failures per institution per hour → 1 h block |
| Throttle (10 MB/day per account) | alert at 70% of `txBytesToday` per wallet |
| DUST low-water | alert below 50 DUST; the demo needs far less |

### 6.5 ADR-0015: maintenance authority custody (R8)

**Decision:** keep the auto-generated single-signature authority during the Wave and back its key up offline. **Document the post-hackathon path:** `replaceAuthority` to a key held under 2-of-3 guardian custody, or relinquish it (empty committee) for immutability.

**Pitch angle:** a judge asking "who can change your circuits?" gets a precise answer.

### 6.6 Blockfrost request budget (free tier: 50,000/day, 10 rps)

| Consumer | Pattern | Est. daily requests |
|---|---|---|
| Explorer | 1 persistent WS subscription plus reconnects | low hundreds (**VERIFY** how Blockfrost counts WS messages) |
| 3 sponsor wallets + 5 bank wallets | sync subscriptions; restores from serialized state | first sync heavy, then light |
| Receipts run | ~40 txs plus confirmations | < 2,000 |
| Judge-mode traffic | read via explorer, not Blockfrost | ~0 |

Watch the Blockfrost dashboard on day 1 of Preprod. If wallet sync dominates, cut the wallets to "only on demand", or use ephemeral wallets (S6.1).

**Exit:** both deployments live, RECEIPTS.md complete, S6.1 decision recorded in ADR-0016.

---

## 7. Phase 7 — Explorer and console

**Goal:** the demo runs from the browser on the hosted instance. No terminal is needed for any step.
**Size:** 2.5 days.

### 7.1 Explorer read-model (`services/explorer`) [AGENT]

- **Ingest:** one `contractActions(address, offset: { height: deployHeight })` subscription per deployment (R10), persisted with `lastHeight` for resume. For each action, `ledger(action.state.data)` (R9; **VERIFY** the exact field path for the action's state in schema v4), then diff against the previous state to produce events.
- **Tables:** `actions(height, txHash, entryPoint, rawTxHex?)`, `epochs(n, startedAt, flags, revocations, attestations)`, `attestations(attKey, epoch, k, typology, escalationCtHash, txHash)`, `proposals(id, kind, payload, approvals, executed, createdEpoch)`, `warrants(attKey, epoch, txHash)`, `roots(height, root)`, `tree(index, leafHash)`. The last one lets bank nodes build paths without touching Blockfrost.
- **API (public, read-only)**

```
GET /v1/deployments                         → [{ name, address, network, deployedAt, verifierKeyHashes }]
GET /v1/:dep/stats                          → per-epoch counts
GET /v1/:dep/attestations?epoch=&typology=  → list (attKey, k, epoch, typology, txHash)
GET /v1/:dep/attestations/:attKey           → one or 404   (what bank checks call)
GET /v1/:dep/tree/path?index=               → MerkleTreePath JSON against current root
GET /v1/:dep/proposals | /warrants          → governance log
GET /v1/:dep/state                          → decoded current public state (judges love this)
GET /v1/:dep/xray?q=<string>                → leak search over everything public (see 7.3)
SSE /v1/:dep/events                         → live stream for the console
```

**Rate limit:** 20 req/s per IP. It is public, so it must not be a way to burn the Blockfrost quota.

### 7.2 Console (`apps/console`, Next.js App Router) [AGENT builds, YOU own the copy and the judge script]

**Rules**
- All chain and bank calls happen in **server routes**. The Blockfrost token and bank API keys never reach the browser. There are no private-state providers in the browser at all: the docs warn that server code resolves `classic-level`, so private state stays in the bank nodes.
- Every tx-producing button shows a receipt card with the tx hash and three explorer links.

**Views**

| Route | Persona | Contents |
|---|---|---|
| `/` | everyone | The one-line pitch, live counters, links to the views below |
| `/bank/[id]` | analyst at bank A–E | **Check** (instant, shows the timings), **Flag** with typology picker, **Attest** (k 2 or 3), **Revoke** on own flags, and a job timeline (`tagging → proving → sponsoring → confirmed`) |
| `/regulator` | regulator | Proposal queue with approvals shown as "1 / 2", propose warrant from an attestation, execute (disabled until quorum), decrypted case view after both share rounds |
| `/transparency` | public | Per-epoch chart, governance log, warrant log, each guardian's release log |
| `/xray` | public / judges | Paste anything: account number, VPA, hex. Shows hits across every public surface. The expected answer is **0 hits** for identifiers and `T`. |
| `/state` | public / judges | Decoded on-chain state, read straight from the explorer |
| `/judge` | judges | A guided 11-step script (§5.5) with one button per step, a narration panel, and an expected-result badge per step (green "refused as designed" for negative paths) |

**Judge-mode mechanics:** a server-side state machine with steps 1–11. Each step calls the right bank-node endpoint and waits on the SSE stream. A "reset demo" button deploys a fresh `demo` contract instance, or advances to a clean epoch if redeploying is too slow (**measure** which). Pre-warm the proving keys at server boot, so the first click doesn't take the 12.3 s cold hit.

### 7.3 Privacy X-ray engine (shared with the Phase-8 leak scanner)

- **Corpus:** every raw tx (hex), every decoded public state snapshot, the explorer DB, the relay DB (opaque records), and the oracle, sponsor and bank logs. Logs are for the CI scanner only; the public X-ray covers public surfaces only.
- **Query expansion:**
  - the input as UTF-8;
  - the input normalised by `mulenet-id/v1` as UTF-8;
  - hex and base64 of both;
  - for the scanner only, the derived `T`, pseudonyms and wallet keys.
- Return hits with their location. The UI copy: "searched N bytes across M transactions; 0 matches".

### 7.4 Lace path for the regulator [CUT CANDIDATE]

This is optional. Lace cannot sign for `undeployed`, and the guardian flow already works server-side. Build it only if Phases 4–8 finish with more than a day spare. It would show DApp-Connector-API v4 integration: `window.midnight` discovery, `connect('preprod')`, `getConnectionStatus().networkId`.

**Exit:** a non-team person runs `/judge` end to end on the hosted instance without help.

### 7.5 Hosting the demo (decide in Phase 6)

**What has to run 24/7 during judging:** the proof server, 5 bank nodes, 3 oracles, the relay, the sponsor, 3 guardians, the explorer and the console.

**Recommendation:** one x86 VPS with **≥ 8 GB RAM** and ≥ 40 GB disk, Docker Compose, and Caddy for TLS in front of the console and explorer only. **Every other port is closed**, and the bank, oracle, sponsor and guardian APIs live only on the internal Docker network.

**Fallback if hosting fails:** the video plus RECEIPTS.md plus "`npm run dev:up` reproduces locally".

Don't use your laptop with a tunnel as the primary option: it sleeps, and its disk is nearly full.

---

## 8. Phase 8 — Leak scanner, verify CLI, CI

**Size:** 1.5 days.

### 8.1 Leak scanner (`tools/leak-scan`) [PAIR]

- **Secrets registry:** the test harness records every secret it creates in `test-artifacts/secrets.jsonl`:
  - identifiers (raw and normalised), `T`, pseudonyms, `instSecret`, `guardianSecret`, OPRF shares, sponsor seeds;
  - bank wallet keys, as linkability targets after S6.1;
  - the Blockfrost token.
- **Targets:** raw txs from the explorer, state dumps, explorer, relay and oracle DBs, **all service logs**, Next.js server logs and the built console bundle (`.next/static`, for leaked tokens).
- **Encodings:** raw bytes, hex (both cases), base64, base64url and UTF-8.
- **Output:** a SARIF file plus a markdown summary. **Any hit fails CI.** There is an allow-list file for intentional public values, with a reason per entry.
- **Self-test:** a planted secret in a fixture log must be found. This prevents a scanner that always says 0.

### 8.2 `mulenet-verify` CLI (`verify/`) [AGENT]

```
mulenet-verify deployment  --network preprod --name main      # verifier-key hashes == release artifact hashes; params; guardian count/threshold
mulenet-verify attestation --network preprod --att-key <hex>  # exists, epoch, k, typology, tx included at height
mulenet-verify warrants    --network preprod                  # every disclosure has an executed proposal with ≥ t approvals
mulenet-verify receipts    docs/RECEIPTS.md                   # every listed tx hash resolves on the indexer
```

Works against Blockfrost with the user's own token or a local indexer. It does not depend on the team's explorer, which is the whole point. To get verifier keys from chain, use the deployed contract state's operations: query `contractState` and compare the verifier key per entry point (**VERIFY** the accessor in compact-runtime 0.16 / ledger-v8).

### 8.3 CI (GitHub Actions) [AGENT]

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | every PR and push | install Compact devtools (`curl … compact-installer.sh \| sh`, then `compact update 0.31.1`, with `~/.compact` cached) · version check · `npm ci --strict-allow-scripts` (R11) · `npm ls` dedupe check (R7) · typecheck · lint (custom rules: no `Field`-keyed Set/Map, assert messages must be literals) · contract unit, invariant, adversarial · property test **100 runs** · crypto · services (mocked chain) · console build · leak scan over test logs |
| `nightly.yml` | cron 02:00 UTC | local-dev in Docker → Phase 4 and 5 integration tests → property test **1,000 runs** → full leak scan |
| `preprod.yml` | manual dispatch | receipts run against `demo` (token from secrets, redacted) → `mulenet-verify` all → upload RECEIPTS.md as an artifact |

**Badges in the README:** CI, nightly, last receipts run, test count.

**Exit:** all three workflows green. The leak scanner self-test catches a planted secret.

---

## 9. Phase 9 — Submission package

**Size:** 2 days. **Start the deck and script outline at the Phase 7 midpoint, not after Phase 8.**

| Artifact | Owner | Contents |
|---|---|---|
| README.md | PAIR | Pitch line → 90-second explainer GIF → "try it" (hosted judge mode plus a local one-liner) → architecture diagram → per-circuit privacy table → leakage register summary → honest limits → test and receipt badges → technical-gate checklist → links to docs |
| docs/THREAT_MODEL.md | PAIR | §11 of the architecture doc, plus every attack test mapped to its file |
| docs/PRIVACY_BOUNDARIES.md | **YOU** | Per circuit and per service: what each party learns. Include the guardian round-2 `T` disclosure and the S6.1 result. |
| docs/adr/0001–0016 | AGENT | One file each, about one page |
| docs/BENCHMARKS.md | AGENT | Prove time per circuit (warm and cold), tx bytes per circuit, k or size if the compiler reports it, check-endpoint latency breakdown |
| docs/RECEIPTS.md | AGENT | From P6-2 |
| docs/DEMO.md | **YOU** | The judge-mode script with expected outputs |
| docs/WAVE3_CHANGES.md | **YOU** | What's new this wave. If you submitted earlier waves: what changed and why. If this is your first wave: say so and summarise the scope. |
| Slide deck (10 slides) | **YOU** | Problem (mule accounts plus the legal wall) → why raw sharing is impossible → the MuleNet property in one sentence → architecture diagram → the shared-tree-and-pseudonym trick → threat model and leakage register (show the honesty) → evidence (tests, property runs, receipts, leak scan 0 hits, S6.1) → demo screenshots → roadmap (ledger 9: native Schnorr, events, cross-contract `isCorroborated`) → ask |
| Demo video | **YOU** | Script in §9.1. **VERIFY** the AKINDO length limit; Wave-1 teams targeted ≤ 2 min. |
| Progress description (AKINDO form) | **YOU** | Written from WAVE3_CHANGES.md |

### 9.1 Video script (≤ 2:00; trim §5.5 down)

| Time | Shot |
|---|---|
| 0:00–0:15 | The problem, with one number from a re-verified source, and the legal wall |
| 0:15–0:35 | Banks A and B flag. Privacy X-ray: paste the account number, 0 hits. |
| 0:35–1:05 | Three refusals: duplicate flag, unregistered bank, self-corroboration. Each shows a red "refused as designed" badge. |
| 1:05–1:25 | D checks (instant) and attests. E sees the attestation. B revokes; the count drops, and the re-attest is refused before any proof. |
| 1:25–1:45 | Warrant: one approval is refused (quorum); two succeed. The regulator sees "flagged by A, C". The transparency page shows the warrant. |
| 1:45–2:00 | Terminal: `mulenet-verify attestation` passes. Close on "the privacy isn't a feature — it's the only legal way this data can be shared." |

### 9.2 Technical-gate checklist (put it in the README)

- [ ] Compact contract compiles on 0.31.1 (CI badge)
- [ ] Meaningful Midnight use: 8 circuits, hidden-leaf Merkle trees, nullifiers, sponsorship
- [ ] `midnightntwrk` topic on the repo
- [ ] Apache-2.0 on all Midnight-related code
- [ ] Repo public and the default branch is the submitted state (tag `wave3-submission`)

---

## 10. Schedule

Write `D` = the Wave-3 deadline in UTC. **Submit at D − 12 h.** AKINDO forms and video uploads fail at the last minute.

### 10.1 Full plan (if D ≥ 26 Oct)

| Day | Date (if starting 15 Oct) | Work | Gate |
|---|---|---|---|
| 0 | Thu 15 | Phase 3 closeout; **YOU**: faucet, Blockfrost token, contract session (3.6) | 3.1 green, branch pushed |
| 1 | Fri 16 | 4.1 oracles, 4.2 relay; P6-0 starts once DUST exists | OPRF 2-of-3 works |
| 2 | Sat 17 | 4.3 bank node, 4.4 sponsor-local | sponsored `submitFlag` on local |
| 3 | Sun 18 | 4.5 bootstrap, 4.6 integration; **P6-0 Preprod skeleton** | Phase 4 exit; first Preprod flag |
| 4 | Mon 19 | 5.1 attest, 5.2 revoke, 5.4 keeper | attest/revoke on local |
| 5 | Tue 20 | 5.3 guardians, 5.5 demo test; **S6.1 spike** | Phase 5 exit; ADR-0016 |
| 6 | Wed 21 | P6-1 promotion, P6-2 receipts, hosting VPS up | Phase 6 exit |
| 7 | Thu 22 | 7.1 explorer, start 7.2 console; **start the deck outline** | explorer live on Preprod |
| 8 | Fri 23 | 7.2 console (bank, regulator, transparency), 7.3 X-ray | |
| 9 | Sat 24 | 7.2 judge mode, hosted end-to-end | Phase 7 exit |
| 10 | Sun 25 | Phase 8: leak scanner, verify CLI, CI | Phase 8 exit |
| 11 | Mon 26 | Phase 9 docs, deck | |
| 12 | Tue 27 | Video, form, tag `wave3-submission` | Submitted |

### 10.2 Compressed plan (if D ≈ 22–23 Oct): cut in this order

1. Lace path (7.4), already a cut candidate.
2. Relay mirror mode (4.2 stretch).
3. The second Preprod deployment: use `demo` only, so the 24 h `main` deployment never exists.
4. `/state` page (keep `/xray`).
5. Pre-execution in the sponsor: keep the breaker only, and document it.
6. Threshold OPRF → a single-key VOPRF oracle (one container), documented in ADR. **Last resort.**
7. Console reduced to `/judge` plus `/xray` only.

**Never cut:** the leak scanner and its self-test, the adversarial and property tests, Preprod receipts, the S6.1 answer (either outcome is a good story if it's honest), and the per-circuit privacy table.

---

## 11. Risk register (remaining phases)

| # | Risk | Likelihood | Impact | Mitigation / trigger |
|---|---|---|---|---|
| K1 | Node 1.0.400 rejects a call that local 1.0.0 accepts | Med | High | P6-0 on day 3, not day 6. If hit, check transcript values for non-canonical `Field` usage. |
| K2 | Bank wallet links sponsored txs (S6.1) | Med | Med (pitch) | Ephemeral wallets → ledger-level binding → disclose as L12 |
| K3 | Preprod DUST not ready in time | Med | High | Faucet today; 3 wallets; local-dev demo video as fallback |
| K4 | Blockfrost quota exhausted (402) | Low–Med | High during judging | Single explorer subscription; bank reads via explorer; monitor; paid plan or a second project as backup |
| K5 | Disk full mid-build | High | Med | Prune now; one base image; delete old images after P6-0 |
| K6 | Proving key cold-load (12.3 s) during the judge demo | High | Low | Pre-warm at boot plus a "warming up" indicator |
| K7 | `classic-level` native build fails on npm 12 or in CI | Low (npm 11) | Med | `allowScripts` committed; CI strict-scripts job; smoke test opens a store |
| K8 | Sponsor fee drain via failing calls (R2) | Low (demo) | Med | Breaker plus pre-flight |
| K9 | Tx TTL expiry in sponsor batching (R3) | Low | Low | 45 s window, TTL check |
| K10 | Wave-3 deadline earlier than assumed | Unknown | High | Find out today; §10.2 cut plan |
| K11 | You can't defend agent-written internals in Q&A | Med | High | 3.6 session; PAIR ownership on guardian logic and S6.1 |

---

## 12. What I need from you, in order

1. **The Wave-3 deadline in UTC**, from the AKINDO buildathon page or Discord. It decides §10.1 vs §10.2.
2. **Faucet tNIGHT for the 3 sponsor addresses, today.** DUST registration and generation take hours.
3. **A Blockfrost project → Midnight Preprod**, with its ID in the gitignored `.env` as `BLOCKFROST_PROJECT_ID`. Check it starts with `nightpreprod`.
4. **OK to run `docker builder prune`** (cache only), plus deleting the old node 0.22.3 and proof-server 8.1.0 images *after* P6-0 succeeds.
5. **A VPS decision for hosting** (§7.5): provider and budget, by Phase 6.
6. **Your half-day for 3.6** before Phase 4 starts, or at least before Phase 5's PAIR items.

---

## 13. Sources

- DUST sponsorship guide — https://docs.midnight.network/guides/dust-sponsorship
- example-private-party (sponsorship reference) — https://github.com/midnightntwrk/example-private-party (`docs/SPONSORSHIP.md`, `src/wallet.ts`, `src/sponsor.ts`)
- Deploy and operate a contract (providers, `deployContract`, maintenance authority, troubleshooting) — https://docs.midnight.network/guides/deploy-and-operate
- Networks and environments (Blockfrost endpoints and migration) — https://docs.midnight.network/guides/networks-and-environments
- Compatibility matrix — https://docs.midnight.network/relnotes/support-matrix
- Indexer API v4 — https://docs.midnight.network/api-reference/midnight-indexer
- `contractActions` subscription — https://docs.midnight.network/api-reference/midnight-indexer/operations/subscriptions/contract-actions
- Blockfrost supports Midnight (free tier 50k/day) — https://blog.blockfrost.io/blockfrost-supports-midnight/
- Blockfrost API limits (10 rps, 500 burst, 402/403) — https://docs.blockfrost.io
- npm v12 install-script changes — https://support.chainguard.dev/hc/en-us/articles/52210028722715-How-to-Prepare-for-and-Migrate-to-npm-v12
- Wave-1 deadline and technical gate (third-party team docs) — https://github.com/hatif03/midnight-pool and https://hackmd.io/@2Z-6hKVdTiiiw6oZVdW1-g/rJYqjgvYGg
- FairGate Wave-3 roadmap (competitor signal) — https://github.com/rifatsarwarcodes/Midnight_Buildathon
