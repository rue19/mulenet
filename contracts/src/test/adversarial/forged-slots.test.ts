// Threat: attestation slots with forged fields, or flags borrowed from other subjects/typologies.
import { describe, expect, it } from 'vitest';
import { World, bytes, subject } from '../world.js';

const S = subject('target');
const OTHER = subject('other');

const world = () => {
  const w = new World().register('A', 'B', 'C', 'D');
  for (const b of ['A', 'B', 'C']) w.flag(b, S);
  return w;
};
const slots = (w: World) => ['A', 'B', 'C'].map((b) => w.slotOf(b, S));

describe('adversarial: forged attestation slots', () => {
  it("flags on another subject cannot be counted for this one", () => {
    const w = new World().register('A', 'B', 'C', 'D');
    for (const b of ['A', 'B', 'C']) w.flag(b, OTHER);
    const borrowed = ['A', 'B', 'C'].map((b) => w.slotOf(b, OTHER));
    expect(() => w.attest('D', S, borrowed)).toThrow('slot mismatch');
  });

  it('flags of one typology cannot attest another', () => {
    const w = world();
    expect(() => w.attest('D', S, slots(w), 2n)).toThrow('slot mismatch');
  });

  it('a forged ctHash breaks the leaf', () => {
    const w = world();
    const s = slots(w);
    s[1] = { ...s[1], ctHash: bytes() };
    expect(() => w.attest('D', S, s)).toThrow('slot mismatch');
  });

  it('a path whose leaf is not the claimed flag is rejected', () => {
    const w = world();
    const s = slots(w);
    s[2] = { ...s[2], path: s[0].path };
    expect(() => w.attest('D', S, s)).toThrow('slot mismatch');
  });

  it('a path with a tampered sibling yields an unknown root', () => {
    const w = world();
    const s = slots(w);
    const tampered = s.map((x) => ({
      ...x,
      path: { ...x.path, path: x.path.path.map((e, i) => (i === 5 ? { ...e, sibling: { field: e.sibling.field + 1n } } : e)) },
    }));
    expect(() => w.attest('D', S, tampered)).toThrow('slot not in tree');
  });

  it('slots proven against different roots are rejected', () => {
    const w = new World().register('A', 'B', 'C', 'D');
    const a = w.flag('A', S);
    w.flag('B', S);
    w.flag('C', S);
    expect(() => w.attest('D', S, [w.slotFrom(a, a.pathAtFlag), w.slotOf('B', S), w.slotOf('C', S)])).toThrow('mixed roots');
  });

  it('an attestation in a later epoch gets a new key; the old one stays', () => {
    const w = world();
    const k0 = w.attest('D', S, slots(w));
    w.advanceEpochs(1);
    const k1 = w.attest('D', S, slots(w));
    expect(Buffer.from(k0).equals(Buffer.from(k1))).toBe(false);
    expect(w.state.attestationCount).toBe(2n);
  });

  it('an unregistered querier cannot attest', () => {
    const w = world();
    expect(() =>
      w.as({ institutionSecret: bytes() }).call('attestCorroboration3', S, 1n, slots(w), w.institutionPath('D'), bytes()),
    ).toThrow('not bound');
  });
});
