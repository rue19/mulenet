# ADR 0003: One shared flag tree with per-subject pseudonyms

- Status: accepted (14 Oct 2026)

## Context

The first design gave each institution its own Merkle tree, with an attestation proving membership in k distinct roots. But `checkRoot(disclose(root))` puts the **root** on the public transcript, so per-institution trees reveal exactly *which* institutions' flags were used. That defeats the main privacy claim.

## Decision

All flags are hidden leaves in **one** `HistoricMerkleTree<20>`:
- **Leaf:** `H(T, p, epoch, typology, ctHash)`.
- **Pseudonym:** `p = H(instSecret, T)`. It is stable for one (institution, subject) pair, so an institution can count at most once, and unlinkable across subjects, so a querier can't profile banks.
- **Distinctness** is enforced in-circuit on pseudonyms (`dup`), and self-exclusion compares against the querier's own pseudonym.
- **One disclosed root:** every slot must share one root (`mixed roots`), so only a single root is disclosed per attestation.

## Rejected

k per-institution trees (the first design).

## Consequences

- An observer learns only "some member attested ≥ k for some subject".
- The querier learns the count, the pseudonyms, the epochs and the typologies, never institution identities (ADR 0004).
- Evidence: invariant I3; `stuffing`, `self`, `forged-slots` and `attest2` tests; the reference-model property test.
