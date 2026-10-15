# ADR 0016: Linkability of sponsored transactions to the bank (spike S6.1)

- Status: **provisional**. Local-network evidence only; confirm on Preprod during Phase 6.
- Context reference: docs/plans/PHASES_4-9.md S6.1

## Question

In the sponsorship flow, each bank's wallet runs `balanceUnboundTransaction(['shielded','unshielded'])` and `signRecipe` before the sponsor adds DUST. Does the finalized transaction carry anything derived from the bank's wallet keys? If it does, all of a bank's flags are linkable to that bank, and the claim "fee payer unlinkable to the bank" fails.

## Method

`packages/sdk/scripts/spike-sponsor.ts` on the local network:
- Two zero-DUST bank wallets, A and B.
- Sponsored `submitFlag` ×2 from A and ×1 from B, with the genesis wallet as sponsor.
- The serialized final transactions are searched for each bank's coin public key, encryption public key, unshielded verifying key and DUST public key.
- It also looks for any 16-byte window shared by both of A's transactions that is absent from B's.

## Results

| Run | Bank key hits | A-only shared windows | Tx sizes (A1, A2, B1) |
|---|---|---|---|
| 1 | 0 | 1 (`0000…009a`, a small integer) | 8,908 / 8,941 / 8,908 |
| 2 | 0 | 0 | 8,908 / 8,940 / 8,908 |

- **No bank wallet key appears in any sponsored transaction**, in either run.
- The single shared window in run 1 did not recur in run 2. It was a coincidental small-integer encoding, not a stable identifier.
- **Open:** A's second transaction is 32 to 33 bytes larger than its first and than B's. The likely cause is the sponsor's DUST inputs varying between transactions, since B, sponsored third, is back to 8,908. A size that tracked "the institution's second flag this epoch" would be a weak leak. Confirm by sponsoring A's second flag first, and by sampling more transactions on Preprod.

## Decision (provisional)

Keep one wallet per bank for the user-side step. Report "no bank key in sponsored transactions (local evidence)" and **not** yet the stronger "unlinkable". Finalise after the Preprod run:
- If clean there too: adopt the headline claim, with the scan as evidence.
- Otherwise: ephemeral per-transaction wallets, as in the plan's fallback chain, and leakage-register entry L12.
