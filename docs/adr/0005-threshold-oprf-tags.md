# ADR 0005: Threshold OPRF subject tags

- Status: accepted (14 Oct 2026); construction details in ADR 0014

## Context

Account numbers are low-entropy. A plain hash, or a hash with a shared consortium pepper, can be enumerated offline by any member, or by anyone the pepper leaks to.

## Decision

`T = SHA-256("mulenet:tag:v1" ‖ VOPRF_k(x))`, where `k` is 2-of-3 Shamir-shared across three oracles (RFC 9497 VOPRF, ristretto255-SHA512):
- **Oracles** see only blinded points. They rate-limit per institution and keep count-only audit logs.
- **Clients** verify each oracle's DLEQ proof and need any 2 valid answers.

## Rejected

A plain hash or a shared pepper (enumerable).

## Consequences

- Nobody can compute `T` offline: that requires two oracles.
- Enumeration is visible as query volume (L6).
- The circuit cannot check that `T` came from the OPRF; quotas (ADR 0012) cap abuse.
- Evidence: RFC 9497 vectors; 2-of-3 ≡ single-key for every oracle pair; oracle fault tests.
