# ADR 0014: Concrete cryptographic constructions for `packages/crypto`

- Status: accepted (14 Oct 2026)
- Refines: ARCHITECTURE §5.2, §5.4 and §5.5

## Decisions

1. **OPRF: RFC 9497 VOPRF mode, ristretto255-SHA512, using `@noble/curves` `ristretto255_oprf`.**
   - Each oracle runs `blindEvaluateBatch` with its Shamir share `k_i`. Its RFC DLEQ proof is checked against that oracle's public share `K_i`.
   - The client verifies each oracle's batch proof, combines `t` evaluations with Lagrange coefficients in the exponent, unblinds, and applies the RFC `Finalize`.
   - `Finalize` hashes `len‖input‖len‖unblinded‖"Finalize"` and does not depend on the mode. So the combined result equals a single-key VOPRF under `k = Σ λ_i k_i`. Tests check this for every pair of oracles.
   - **Tag:** `T = SHA-256("mulenet:tag:v1" ‖ output)`.
   - **Why:** we reuse an audited RFC implementation instead of writing hash-to-group and DLEQ ourselves. RFC test vectors (A.1.1 and A.1.2) pass against our build.
2. **Key generation: trusted dealer** for both the OPRF key and the guardian key. This is a documented hackathon simplification (§8.2). Production replaces `dealShares` with a Pedersen DKG.
3. **Threshold ElGamal KEM.**
   - Construction: `C1 = e·G`, `key = HKDF-SHA256(ikm = e·X, salt = C1, info = "mulenet:kem:v1")`, then XChaCha20-Poly1305 with `aad = C1`.
   - Format: `ct = C1 ‖ nonce ‖ AEAD`, and `ctHash = SHA-256(ct)`.
   - Decryption shares `x_i·C1` carry a Chaum–Pedersen DLEQ proof (domain `mulenet:dleq:v1`). The combiner skips invalid shares, so one faulty guardian cannot block or corrupt decryption.
4. **Relay records.**
   - Keys: `lookupKey` and `recKey` are HKDF-SHA256 of `T` with distinct info strings. `bucket` is the big-endian u16 of `lookupKey[0..2]`.
   - The AEAD binds `v ‖ bucket ‖ lookupKey`, so the relay cannot re-file a record under another subject or bucket.
   - Bodies are CBOR without the cbor-x record extension, so other implementations can decode them.
5. **Hash mirrors.**
   - Compact's `persistentHash<Vector<n, Bytes<32>>>` is SHA-256 over the concatenation, and the `Uint→Field→Bytes<32>` cast is 32-byte little-endian. Both were verified empirically.
   - `@mulenet/crypto/hash` mirrors every derivation in §5.3. A property test in `contracts/` checks each one against the compiled `pureCircuits`.

## Consequences

- Bank nodes and services never need the Midnight runtime to compute tags, leaves or keys.
- Normalisation (`mulenet-id/v1`) ships with test vectors that other implementations must match.
