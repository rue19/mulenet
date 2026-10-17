// SPDX-License-Identifier: Apache-2.0
// Threat: a malicious prover controls its own witnesses (Midnight security guide).
// Every witness value must be constrained by an assert; lying in a witness gains nothing.
import { describe, expect, it } from 'vitest';
import { World, bytes, subject } from '../world.js';

const S = subject('witness');

describe('adversarial: malicious private state', () => {
  it('a witness returning a random institution secret is rejected', () => {
    const w = new World({ witnessOverrides: { institutionSecret: ({ privateState }) => [privateState, bytes()] } }).register('A');
    expect(() => w.flag('A', S)).toThrow('not bound');
  });

  it("a witness returning another member's secret only impersonates that member, and then only once per epoch", () => {
    // Possession of a secret is the identity; the nullifier still caps that identity at one flag.
    const w = new World().register('A', 'B');
    w.flag('A', S);
    expect(() => w.as({ institutionSecret: w.secretOf('A') }).call('submitFlag', S, 1n, bytes(), 1n, w.institutionPath('A'))).toThrow(
      'duplicate flag',
    );
  });

  it('a missing secret aborts without leaking anything in the message', () => {
    const w = new World().register('A');
    let msg = '';
    try {
      w.as({}).call('submitFlag', S, 1n, bytes(), 0n, w.institutionPath('A'));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('institution secret not provisioned');
    expect(msg).not.toMatch(/[0-9a-f]{32}/);
  });

  it('a wrong-length secret is refused by the witness', () => {
    const w = new World().register('A');
    expect(() => w.as({ institutionSecret: new Uint8Array(31) }).call('submitFlag', S, 1n, bytes(), 0n, w.institutionPath('A'))).toThrow(
      'not provisioned',
    );
  });

  it('a guardian witness lying about its secret cannot vote', () => {
    const w = new World({ witnessOverrides: { guardianSecret: ({ privateState }) => [privateState, bytes()] } });
    expect(() => w.asGuardian(0).call('propose', 1n, bytes(), w.guardianPath(0))).toThrow('not bound');
  });
});
