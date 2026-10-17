// SPDX-License-Identifier: Apache-2.0
// Threat: revoked-flag reuse, and revocation abuse.
import { describe, expect, it } from 'vitest';
import { World, bytes, subject } from '../world.js';

const S = subject('revoked');

describe('adversarial: revocation', () => {
  it('a revoked flag cannot be used with its pre-revocation path', () => {
    const w = new World().register('A', 'B', 'C', 'D');
    const recs = ['A', 'B', 'C'].map((b) => w.flag(b, S));
    const stale = recs.map((r) => w.slotFrom(r));
    w.revoke('B', S);
    expect(() => w.attest('D', S, stale)).toThrow('slot not in tree');
  });

  it("revocation of someone else's leaf fails even with the right index and path", () => {
    const w = new World().register('A', 'B');
    const a = w.flag('A', S);
    expect(() =>
      w.asBank('B').call('revokeFlag', S, a.epoch, a.typology, a.ctHash, a.index, 0n, w.flagPath(a.index, a.leaf), w.institutionPath('B')),
    ).toThrow('not yours');
  });

  it('cannot revoke the same flag twice', () => {
    const w = new World().register('A');
    const a = w.flag('A', S);
    const path = w.flagPath(a.index, a.leaf);
    w.revoke('A', S);
    expect(() => w.revoke('A', S, { path })).toThrow('unknown flag');
  });

  it('the revocation cap bounds history resets per epoch', () => {
    const w = new World({ revokeQuota: 2n }).register('A');
    for (const s of ['r1', 'r2', 'r3']) w.flag('A', subject(s));
    w.revoke('A', subject('r1'));
    w.revoke('A', subject('r2'));
    expect(() => w.revoke('A', subject('r3'))).toThrow('quota');
    w.advanceEpochs(1);
    expect(() => w.revoke('A', subject('r3'))).not.toThrow();
  });

  it('a revocation quota slot cannot be reused', () => {
    const w = new World().register('A');
    w.flag('A', subject('q1'));
    w.flag('A', subject('q2'));
    w.revoke('A', subject('q1'));
    const r = w.lastFlag('A', subject('q2'));
    expect(() =>
      w.asBank('A').call('revokeFlag', r.t, r.epoch, r.typology, r.ctHash, r.index, 0n, w.flagPath(r.index, r.leaf), w.institutionPath('A')),
    ).toThrow('quota slot used');
  });

  it('cannot revoke with forged flag fields', () => {
    const w = new World().register('A');
    const a = w.flag('A', S);
    const path = w.flagPath(a.index, a.leaf);
    const call = (epoch: bigint, typology: bigint, ct: Uint8Array) =>
      w.asBank('A').call('revokeFlag', S, epoch, typology, ct, a.index, 0n, path, w.institutionPath('A'));
    expect(() => call(a.epoch + 1n, a.typology, a.ctHash)).toThrow('not yours');
    expect(() => call(a.epoch, 2n, a.ctHash)).toThrow('not yours');
    expect(() => call(a.epoch, a.typology, bytes())).toThrow('not yours');
  });
});
