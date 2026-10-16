# Receipts (undeployed)

Contract `df2b9ecf7264a01ccbb30d277f1f44ebd92c07e3edfc983d69a40bddd9c8ce8a`. Generated 2026-10-16T06:37:37.866Z by `tests/integration/src/receipts.ts`.

A refusal *before proof* happens while the call is built: the contract assert fails locally, so nothing is proven, sponsored or submitted.

| Step | Circuit | Outcome | Kind | Transaction |
|---|---|---|---|---|
| 1. bank A flags X | `submitFlag` | confirmed | on-chain | hash `1f634c81ffa5932f320bc3448a7ad7842d805e5fec59baaad3a7436afd8b542c` (block 232)<br>id `0084462b7b72e1b45d51c3dd87abfc0e1204c9b73b22a933e149a9e6447a5fb4a7`<br>local network |
| 1. bank B flags X | `submitFlag` | confirmed | on-chain | hash `652fe8396f6e0af5667e32d7ead982b25d53eb1ebcb40e79d2e0c4cbed42aeaa` (block 237)<br>id `0093ee0f77bb1b1aacad58917cb45a2340737dbf0169012c0f23c126fdb22d2c3b`<br>local network |
| 1. bank C flags X | `submitFlag` | confirmed | on-chain | hash `282504cd7f3b968dc2db1bd2bfd8415fcb5a2b7e3810adf9be8a614989da57c7` (block 242)<br>id `00388644bceaf64ecf8069d8a604c35646b822479f3d1ff480eb7c38dca2bce5e7`<br>local network |
| 2. bank A flags X again | `submitFlag` | duplicate-flag: this institution already flagged this account in the current epoch | refused before proof | — |
| 3. unregistered bank E flags | `submitFlag` | not-a-member: this institution is not a registered member | refused before proof | — |
| 4. D attests k=3 with a duplicated slot | `attestCorroboration3` | duplicate-pseudonym: dup | refused before proof | — |
| 5. C attests with its own flag | `attestCorroboration3` | self-excluded: self excluded | refused before proof | — |
| 6. D attests k=3 | `attestCorroboration3` | confirmed | on-chain | hash `e91b0b6df81ee581997b4dae8cb05ec7eb6772568334e0df364e50b459ddbcec` (block 248)<br>id `0050b93716e3e932d94bbb6d2527b3422324b95fc27e9d32cc50f05c6cc0baf525`<br>local network |
| 7. E checks X | `— (off-chain)` | attestation k=3, 3 institutions | off-chain | — |
| 8a. B revokes its flag | `revokeFlag` | confirmed | on-chain | hash `f5c417922b86631da12b9e34b0297d5b274e2af96598dfdd4c53d269ba1499c6` (block 253)<br>id `00e38f935454e0ec307cb5785e3a57bd9ad045dd91f4967701d68f29a65946f89c`<br>local network |
| 8b. D attests k=3 again | `attestCorroboration3` | insufficient: only 2 independent fresh flags of this typology; 3 required | refused before proof | — |
| 9a. guardian 1 proposes the warrant | `propose` | confirmed | on-chain | hash `161ab7bd389662e5e71310dafbfe4d84c38fdb3666659ac112e4be8cc72481c6` (block 257)<br>id `00bde0c61b41197a46177e5a2b00320ca8fbe02081b030cff369052365e83a9ee3`<br>local network |
| 9b. guardian 1 approves | `approve` | confirmed | on-chain | hash `8a6f3863f46490555d15960cb637eea11497f19107ca4d21e2af457bc5bf55ba` (block 261)<br>id `0050dc5cbf61dd11d5e1c7be08485a37fc03e9d41a628a57f194f885068894b2d8`<br>local network |
| 9c. execute with 1 approval | `execute` | quorum | refused before proof | — |
| 9d. guardian 3 approves | `approve` | confirmed | on-chain | hash `933f185691dbf30575bacbf4907b08f9f99c467810a8df64c8f414722e7e05e3` (block 265)<br>id `00c1e20dda6741525026fa64c1800f21bdbd6ff7d04c443e1dd3c47fd92b141a2a`<br>local network |
| 9e. execute with 2 approvals | `execute` | confirmed | on-chain | hash `d04a3affe1ee1ba2db5f61307ef42bb549393f87a0cebbdc6b8a8a43b9321694` (block 269)<br>id `004eb68b37787c6de6df5c059a2d88dd9756efa288f3b9ddd6a39dd4d90d9315e5`<br>local network |
