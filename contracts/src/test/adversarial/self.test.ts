// Threat: self-corroboration. A querier counts its own flag.
import { describe, expect, it } from 'vitest';
import { World, subject } from '../world.js';

const S = subject('self');

describe('adversarial: self-corroboration', () => {
  it("the querier's own flag in any slot position is rejected", () => {
    for (const pos of [0, 1, 2]) {
      const w = new World().register('A', 'B', 'C');
      for (const b of ['A', 'B', 'C']) w.flag(b, S);
      const slots = [w.slotOf('A', S), w.slotOf('B', S), w.slotOf('C', S)];
      const querier = ['A', 'B', 'C'][pos];
      expect(() => w.attest(querier, S, slots)).toThrow('self excluded');
    }
  });

  it("an older-epoch flag by the querier is still its own pseudonym", () => {
    const w = new World().register('A', 'B', 'C');
    const c0 = w.flag('C', S);
    w.advanceEpochs(1);
    w.flag('A', S);
    w.flag('B', S);
    expect(() => w.attest('C', S, [w.slotOf('A', S), w.slotOf('B', S), w.slotFrom(c0)])).toThrow('self excluded');
  });
});
