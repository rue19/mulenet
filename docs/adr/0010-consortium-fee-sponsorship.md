# ADR 0010: Consortium fee sponsorship

- Status: accepted (14 Oct 2026); linkability evidence in ADR 0016

## Context

DUST is non-transferable. Banks should hold no crypto, and the fee payer shouldn't identify the bank.

## Decision

The official two-sided flow (`example-private-party`):
- **The bank** proves, balances only its own value (`shielded`, `unshielded`), signs and binds.
- **The sponsor** deserialises the bound transaction, pre-flights it, adds DUST only, signs and submits.

The sponsor service enforces:
- **Pre-flight:** every call is to the MuleNet contract, with no value movement and enough TTL left.
- **Role allow-lists:** banks flag, revoke and attest; guardians govern; the keeper rolls epochs.
- **Accounting:** a daily quota and a failure breaker.
- **Wallet pool:** one in-flight transaction per wallet.

## Rejected

Banks self-funding NIGHT and DUST.

## Consequences

- Bank wallets hold 0 DUST, asserted in integration tests.
- A tampered sponsored transaction is rejected by the network.
- The sponsor sees which institution submits (L8).
