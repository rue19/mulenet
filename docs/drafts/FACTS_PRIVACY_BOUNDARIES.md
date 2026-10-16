# Fact sheet: PRIVACY_BOUNDARIES.md (Raaj writes the document)

Facts and sources only.

## Per circuit (public side effects)
- Source: README "What an observer learns"; ARCHITECTURE §10.1; `contracts/src/mulenet.compact`.
- `submitFlag` publishes: quota nullifier, flag nullifier, leaf hash, institutions root, counter (`C:187–205`).
- `revokeFlag` publishes: the revoked index, roots, a quota nullifier (`C:207–227`).
- `attest*` publishes: attKey, k, typology, escalationCtHash, querierTag, one flags root (`C:231–300`).
- Governance publishes: kind, payload, vote nullifier (`C:300–375`).
- On-chain leak scan, 0 hits: `docs/BENCHMARKS.md`; `packages/sdk/scripts/spike-local.ts`.

## Per service
- **Oracle:** sees the blinded point and the caller id. Stores `(institution, day, count)` only. Source: `services/oracle/src/server.ts`; test "stores counts only".
- **Relay:** sees bucket number, caller id and opaque bytes. Source: `services/relay/src/server.ts`; test "stores no plaintext".
- **Sponsor:** sees caller id, timing and the bound tx (proof, no witnesses). Source: `services/sponsor/src/preflight.ts`; ADR 0010; L1, L8.
- **Bank node:** holds instSecret (encrypted level store) and its own flag ledger. No identifier or T persisted. Test: `flows.test.ts` "never stores the identifier or T".
- **Guardians:** learn T in round 2 (by design: oversight parties). Source: `services/guardian/src/policy.ts:29–61`; ARCHITECTURE v1.3 changelog.
- **Explorer:** public data only. Privacy X-ray: identifiers 0 hits, public values found (README Evidence).

## S6.1 status
- Local only, two runs: 0 bank wallet keys in sponsored tx bytes.
- An unexplained size delta (+32/33 bytes) on a bank's second tx.
- Source: `docs/adr/0016-sponsored-tx-linkability.md`. Preprod confirmation pending.

## Leakage register
- L1–L11: ARCHITECTURE §10.2.
- Candidate L12 (bank wallet linkability): only if S6.1 on Preprod finds a link.
