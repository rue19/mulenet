# ADR 0001: Target ledger 8 with Compact toolchain 0.31.1

- Status: accepted (14 Oct 2026)

## Context

In October 2026, Preview, Preprod and Mainnet all run ledger 8. The support matrix pins Compact toolchain 0.31.1, compact-runtime 0.16.0 and Midnight.js 4.1.1. Toolchains 0.34 and 0.35 target ledger 9, which brings native Schnorr verification, events and cross-contract calls, but their contracts cannot be deployed to the public networks.

## Decision

Build against ledger 8: toolchain 0.31.1, runtime 0.16.0, Midnight.js 4.1.1, wallet SDK 1.2.0.
- `versions.json` records the pins, and `scripts/check-versions.mjs` enforces them in CI.
- A dedupe check (`scripts/check-dedupe.mjs`) requires exactly one copy of each Midnight runtime package. Two copies broke every call with `expected instance of StateValue` until `onchain-runtime-v3` was pinned to 3.0.0.

## Rejected

Toolchain 0.35 for native Schnorr verification: it cannot deploy to Preprod or Mainnet.

## Consequences

No in-circuit signatures (ADR 0002). The ledger-9 features are roadmap items: native credentials, events, and `isCorroborated` for other contracts.
