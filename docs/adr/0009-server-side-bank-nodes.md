# ADR 0009: Server-side bank nodes

- Status: accepted (14 Oct 2026)

## Context

Banks integrate server to server, not through analysts' browsers. The proof server sees witnesses in the clear, so it must be local to the prover. Midnight's wallet reference lists Dynamic's embedded-wallet support as unconfirmed.

## Decision

Each bank runs a node, with a local proof server, an encrypted level private-state store (with a canary check at boot), and a signed internal API: flag, check, attest, revoke and jobs. The console calls nodes from server routes only.

## Rejected

Browser wallets per analyst.

## Consequences

- No wallet extension is needed for judges.
- The demo shares one proof server across the simulated banks. That's a labelled shortcut: production is one per bank.
