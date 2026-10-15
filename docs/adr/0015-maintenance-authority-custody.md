# ADR 0015: Custody of the contract maintenance authority

- Status: accepted (15 Oct 2026)
- Context reference: docs/plans/PHASES_4-9.md R8

## Context

`deployContract` installs a single-signature **maintenance authority** by default, and stores its signing key in the deployer's private-state provider. That authority can insert or remove verifier keys, which changes what the circuits accept, and can replace itself. It sits entirely outside the contract's own 2-of-3 guardian governance.

So "who can change your circuits?" has a precise answer: whoever holds that key.

## Decision

- **During the Wave:** keep the auto-generated single-signature authority, held by the deployer, with its key backed up offline. Losing it only removes the ability to upgrade, never the ability to run.
- **Detection:** `mulenet-verify deployment` compares every on-chain verifier key with the release hashes in `docs/verifier-keys.json`. CI reproduces those hashes from source on every push, and key generation is deterministic (checked by an independent recompile). Any change the authority makes is therefore publicly detectable.
- **After the hackathon:**
  - Either `replaceAuthority` to a committee held by the same guardians at 2-of-3, so circuit upgrades need the same quorum as warrants;
  - or relinquish the authority (an empty committee) for an immutable deployment, rotating to a new deployment ("season") when circuits change.

## Consequences

- During the Wave, trust in circuit integrity rests on the deployer **plus** public detection by the verifier. This is stated in the README's honest-limits section.
- The guardian-committee option is the production answer and needs no contract change.
