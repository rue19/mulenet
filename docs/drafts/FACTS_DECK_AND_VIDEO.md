# Fact sheet: deck and video (Raaj writes them)

Numbers, each with its source.

- **Proving times** (laptop, depth 20). Source: `docs/BENCHMARKS.md`.
  - `attestCorroboration3`: 8.1 s (14 Oct) and 8.8 s (16 Oct), first call
  - `submitFlag`: 5.5–5.7 s warm, 11–12 s first call
- **Transaction size:** about 8.5–9.0 KB per circuit (`docs/BENCHMARKS.md`, 16 Oct).
- **Tree capacity:** 1,048,576 flags (ADR 0013).
- **Tests.** Source: `docs/TESTING.md`; counts via `npx vitest run`.
  - contract simulator suites
  - property test: 1,000 runs, 475 accepted and 3,236 rejected attestations; mutation-checked
  - crypto: 76+ incl. RFC 9497 vectors
- **Leak scan:** 0 findings, live canary found every run. Source: `test-artifacts/leak-scan/leak-scan.md`.
- **Reproducible build:** CI rebuilds the verifier keys and compares them with `docs/verifier-keys.json`.
- **Judge mode:** 11/11 in a real browser. Source: `test-artifacts/e2e-results/judge-complete.png`.
- **Market statistics:** see `STATS_TO_VERIFY.md`. None verified yet.
- **Roadmap items (ledger 9):** ARCHITECTURE §21.
