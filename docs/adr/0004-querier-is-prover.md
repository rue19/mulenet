# ADR 0004: The querier is the prover; count-only disclosure

- Status: accepted (14 Oct 2026)

## Context

The first design promised that the querier "learns only a boolean". That is impossible when the querier builds the proof: a prover always knows its own witness, which here means the slots (pseudonyms, epochs, typologies).

## Decision

The attesting bank proves the statement itself. Be explicit about what it learns:
- **It learns:** the count, the per-flag pseudonyms (unlinkable across subjects), the epochs and the typologies.
- **It never learns:** which institution is behind any flag.

The off-chain `check` returns only counts to bank systems. Pseudonyms stay inside the node.

## Rejected

MPC between banks so that nobody sees the slots: it can't be built within a wave, and it needs online participation by every flagger.

## Consequences

This is leakage-register entry L5 ("by design"), stated in the README's honest limits.
