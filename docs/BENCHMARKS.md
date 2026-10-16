# Benchmarks

## Day-1 spike: local network, flag tree depth 20 (14 Oct 2026)

Raw output: [`benchmarks/2026-10-14-local-depth20.json`](benchmarks/2026-10-14-local-depth20.json). Reproduce with:

```bash
docker compose -f infra/local/standalone.yml -p mulenet-local up -d
npm run compact && npm run build -w contracts
cd packages/sdk && MN_PROOF_SERVER=http://127.0.0.1:6300 npx tsx scripts/spike-local.ts depth20
```

**Setup.**
- Machine: Intel Core Ultra 9 185H (22 threads), 30 GB RAM, laptop.
- Stack: Compact 0.31.1, Midnight.js 4.1.1, wallet SDK 1.2.0, and the `midnight-local-dev` stack (node 1.0.0, indexer 4.3.3, proof server 8.1.0).
- Contract: flag tree depth 20 (about 1M flags), institutions tree depth 6, guardian tree depth 4.

### Proving time

"Prove" is time spent in the local proof server. "Total" adds building the transaction, balancing DUST, submitting it, and waiting for finalisation, which is mostly block time.

| Circuit | Prove | Total | Budget (§13.2) |
|---|---|---|---|
| `submitFlag` (cold, first call) | 12.3 s | 29.4 s | < 20 s ✅ |
| `submitFlag` (warm) | 5.4–5.8 s | 23.6–24.0 s | < 20 s ✅ |
| `attestCorroboration3` | 8.1 s | 30.6 s | < 60 s ✅ |
| `revokeFlag` | 4.4 s | 24.0 s | — |
| `propose` | 2.5 s | 23.6 s | — |
| `approve` | 2.5 s | 24.0 s | — |
| `execute` | 2.3 s | 24.0 s | — |
| deploy | — | 18.7 s | — |

Each circuit was measured once (`submitFlag` three times), so treat these as indicative.
- The cold `submitFlag` figure includes the proof server loading a 19.5 MB proving key the first time. Later calls of any circuit reuse the loaded key.
- `attestCorroboration2` was not timed in this run. Its proving key is the same size as `attestCorroboration3`'s, so expect a similar time.

### Correctness checks on a real chain

| Check | Result |
|---|---|
| **Stale-state flags.** Banks B and C both built `submitFlag` against the same ledger state (`flagCount = 1`). Both were then submitted, C after B had changed the tree. | **Pass.** Both landed (blocks 152 and 156), `flagCount = 3`, and all three leaves are in the tree. `insert()` takes the next free index on-chain, so the sponsor can batch flags ([ADR 0011](adr/0011-flag-index-from-path.md)). |
| **Leak scan of real transactions.** The serialised bytes of the `submitFlag` ×3, `attestCorroboration3` and `revokeFlag` transactions were searched (raw and hex) for T, all four `instSecret`s, all four pseudonyms and all three `guardianSecret`s. | **Pass, 0 hits.** |
| Attestation recorded with k = 3 | Pass |
| Revocation by the original flagger | Pass (`revocationCount = 1`) |

### Decisions from these numbers

- **Flag tree depth 20** ([ADR 0013](adr/0013-flag-tree-depth-20.md)). Every circuit is far inside budget, so the depth-16 comparison run was skipped.
- **`attest3` stays the default policy.** At 8.1 s, the cut-list item "prefer attest2" is unnecessary.

### Circuit size (from proving-key size)

| Proving key | Circuits |
|---|---|
| ~19.5 MB | `submitFlag`, `attestCorroboration2`, `attestCorroboration3` |
| ~10 MB | `revokeFlag` |
| ~5.2 MB | `propose`, `approve`, `execute` |
| 75 KB | `advanceEpoch` |

The proving-key sizes are consistent with roughly k = 16 for the largest circuits, below the k ≥ 17 point where builders report hangs.

## Rerun with transaction sizes (16 Oct 2026)

Raw output: [`benchmarks/2026-10-16-local-depth20.json`](benchmarks/2026-10-16-local-depth20.json) (log: `test-artifacts/spike-local-2.log`).

**Setup.**
- Machine and stack: same as the 14 Oct run (Intel Core Ultra 9 185H, 30 GB RAM; local node 1.0.0, proof server 8.1.0 on :6301).
- Chain: a fresh local devnet after a reset.
- Command: `MN_PROOF_SERVER=http://127.0.0.1:6301 npx tsx scripts/spike-local.ts depth20-run2` → exit 0.

**Timing method.** Every circuit was measured on its first call, so the figures include the proof server loading that circuit's key ("first call"). Only `submitFlag` was also called again with its key loaded ("warm").

| Circuit | Prove, first call | Prove, warm | Serialized tx (bytes, sponsored-equivalent self-paid) |
|---|---|---|---|
| `submitFlag` | 11.1 s | 5.6 s / 5.7 s | 8,906 / 8,940 / 8,908 |
| `attestCorroboration3` | 8.8 s | not measured (one call) | 8,875 |
| `attestCorroboration2` | 8.2 s | not measured (one call) | 8,845 |
| `revokeFlag` | 4.4 s | not measured (one call) | 9,013 |
| `propose` | 2.6 s | not measured (one call) | 8,555 |
| `approve` | 2.6 s | not measured (one call) | 8,741 |
| `execute` | 2.5 s | not measured (one call) | 8,829 |
| `advanceEpoch` | not measured | not measured | not measured. The spike does not roll epochs; on the network the epoch keeper calls it. |

**Throttle arithmetic (§1, 10 MB of tx data per account per day).** At about 9 KB per transaction, one sponsor wallet can submit about 1,100 MuleNet transactions a day. The pool of 3 gives about 3,300.

**Check latency (off-chain, no transaction).** Measured once against the containerised stack on 15 Oct: OPRF 286 ms, relay 50 ms, on-chain verification 68 ms. That was a first call; warm OPRF is under 150 ms (`services/oracle` test).
