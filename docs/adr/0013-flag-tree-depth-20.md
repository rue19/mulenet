# ADR 0013: Flag tree depth 20

- Status: accepted (14 Oct 2026)
- Supersedes: depth 16 in ARCHITECTURE v1.0 §6.1

## Context

At depth 16 (65,536 leaves), three banks flagging at the ADR 0012 quota fill the tree in about 44 days. v1.0 set a proving budget of under 60 s for `attest3` and under 20 s for `submitFlag`.

## Decision

Use depth 20 (about 1M leaves).

## Evidence

On a laptop at depth 20 (BENCHMARKS.md):
- `attestCorroboration3`: 8.1 s
- `submitFlag`: 5.5 s warm, 12.3 s cold
- `revokeFlag`: 4.4 s

All are well inside budget.

## Consequences

- One deployment lasts years at realistic flag volumes, instead of the quarterly "seasons" v1.0 planned.
- Depth 24 is possible later if national-scale volumes need it. Re-benchmark before switching.
