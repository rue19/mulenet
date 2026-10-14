# ADR 0011: Flag leaves carry no index; revocation derives it from the Merkle path

- Status: accepted (14 Oct 2026)
- Supersedes: the `index`-in-leaf design in ARCHITECTURE v1.0 §5.3

## Context

In v1.0, `submitFlag` read `flagCount` in-circuit and bound it into the leaf (`flags.insertIndex(leaf, flagCount)`). That read became part of the proven transcript. So two flags proven against the same state conflicted, and only one could land per block. This contradicted the sponsor's plan to batch submissions (§8.4).

## Decision

- The leaf is `H("mulenet:flag:v1", T, p, epoch, typology, ctHash)`, with no index.
- `submitFlag` calls `flags.insert(leaf)`. In the compiled transcript, insert is a `dup / idx / ins` sequence that runs on-chain against whatever the state is at that moment. There is no proven read of the next free index. `flagCount.increment(1)` is write-only.
- After the transaction lands, the bank node looks up its leaf's position once and stores it.
- `revokeFlag` rebuilds the index from the path's `goes_left` bits (`pathIndex`, a fold over the 20 path entries). It asserts the result equals the public `index` before calling `insertIndexDefault(index)`.

## Evidence

- Simulator: the `pathIndex` test checks 9 positions. Flipping the bit convention makes 4 tests fail, so the tests do catch an error here.
- Local chain: two `submitFlag` transactions built against `flagCount = 1` both landed (BENCHMARKS.md).

## Consequences

- Flags never conflict with each other. Transactions can still fail when the epoch rolls or membership rotates between proving and inclusion. The node retries at most twice.
- Leaves are unique even without an index, because the flag nullifier stops a second leaf for the same (institution, T, epoch).
