# ADR 0007: Warrants on-chain, decryption off-chain

- Status: accepted (14 Oct 2026)

## Context

The first design verified t-of-n Schnorr-signed Shamir shares in-circuit. That isn't available on ledger 8, isn't needed, and was the largest feasibility risk in the design.

## Decision

- **Authorisation is on-chain:** a warrant is a 2-of-3 guardian proposal (`AuthorizeDisclosure`, which requires an existing attestation), recorded in `disclosures`.
- **Decryption is off-chain:** case details use threshold ElGamal with DLEQ-proven shares.
- **Guardian checks:** before releasing a share, every guardian independently verifies the warrant, that the tag matches the attestation key, that each record decrypts under the tag, that each leaf is on-chain at its index, and that `ct` matches the committed `ctHash` (`services/guardian/src/policy.ts`).

## Rejected

In-circuit verification of shares.

## Consequences

- Every warrant is public and checkable (`mulenet-verify warrants`).
- Two colluding guardians could still decrypt without a warrant (L10). This is a policy control, not a cryptographic one. Releases are logged publicly.
