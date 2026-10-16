# ADR 0002: No in-circuit signatures

- Status: accepted (14 Oct 2026)

## Context

On ledger 8 the standard library has no signature verification (`jubjubSchnorrVerify` and the others arrived with toolchains 0.33/0.34). An official Schnorr polyfill exists (`example-zkloan/contract/src/schnorr.compact`).

## Decision

Authorisation uses **derived identity plus Merkle membership**:
- An institution leaf is `H(instSecret, membershipGen)` and a guardian leaf is `H(guardianSecret)`.
- Every circuit first asserts `path.leaf == H(secret, …)` (binding), then `checkRoot(root(path))` (membership).
- Possession of the secret is the identity. Nothing ever depends on `ownPublicKey()` or on who paid the fee.

## Rejected

The Schnorr polyfill: it adds circuit cost and gives this design nothing that membership doesn't.

## Consequences

- No signature parsing or verification cost in-circuit.
- Path replay and leaf grafting are defeated by the binding assert (`adversarial/path-replay.test.ts`).
- Under fee sponsorship the fee payer can never act as a member (`adversarial/malicious-witness.test.ts`).
