# ADR 0006: Off-chain encrypted records with on-chain hash binding

- Status: accepted (14 Oct 2026); amended 15 Oct (record carries `ct`)

## Context

Banks need each flag's pseudonym, epoch, typology and index to build attestations, and the regulator needs the case ciphertexts under a warrant. Putting these on-chain would cost write budget (50 KB per block of persistent writes) and would create public keys that link queries.

## Decision

An append-only relay stores records:
- **Bucketing:** records are filed by the first two bytes of `HKDF(T, "lookup")`.
- **Encryption:** each record is encrypted under `HKDF(T, "rec")`, with AEAD binding the version, bucket and lookup key.
- **Contents:** `p, epoch, typology, ctHash, ct, index`, where `ct` is the guardian-encrypted case details.
- **Verification:** clients count a record only if its leaf (which commits `ctHash`) is in the tree at the claimed index.

## Rejected

On-chain ciphertexts (write budget and linkable keys).

## Consequences

- **The relay** can withhold records, which mirrors defeat, but cannot forge or re-file them.
- **Members** fetch whole buckets, so the relay learns only the bucket (L7).
- **Size:** records are 408 bytes, and a worst-case test keeps them under the 1 KB limit.
