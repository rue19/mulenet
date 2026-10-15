// Threat: forged membership. Replaying another member's Merkle path from a public transaction.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pc } from '../../managed/mulenet/contract/index.js';
import { World, bytes, subject } from '../world.js';

const S = subject('replay');

describe('adversarial: membership path replay', () => {
  it("an outsider replaying a member's institution path fails the binding assert", () => {
    const w = new World().register('A');
    expect(() => w.as({ institutionSecret: bytes() }).call('submitFlag', S, 1n, bytes(), 0n, w.institutionPath('A'))).toThrow(
      'not bound',
    );
  });

  it("a member replaying another member's path fails too", () => {
    const w = new World().register('A', 'B');
    expect(() => w.asBank('B').call('submitFlag', S, 1n, bytes(), 0n, w.institutionPath('A'))).toThrow('not bound');
  });

  it("an outsider's own leaf grafted onto a member's siblings fails the root check", () => {
    const w = new World().register('A');
    const forged = { ...w.institutionPath('A'), leaf: pc.institutionLeaf(w.secretOf('X'), 0n) };
    expect(() => w.asBank('X').call('submitFlag', S, 1n, bytes(), 0n, forged)).toThrow('not a member');
  });

  it('a guardian path replayed by a non-guardian fails', () => {
    const w = new World();
    expect(() => w.as({ guardianSecret: bytes() }).call('approve', bytes(), w.guardianPath(2))).toThrow('not bound');
  });

  it("a guardian's own leaf grafted onto real siblings fails the root check", () => {
    const w = new World();
    const gs = bytes();
    const forged = { ...w.guardianPath(1), leaf: pc.guardianLeaf(gs) };
    expect(() => w.as({ guardianSecret: gs }).call('propose', 1n, bytes(), forged)).toThrow('not a guardian');
  });
});
