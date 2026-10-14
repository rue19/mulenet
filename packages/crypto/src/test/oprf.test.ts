import { ristretto255 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { equal, toHex, utf8 } from '../bytes.js';
import { normalise, oprfInput } from '../normalise.js';
import {
  MAX_BATCH,
  OracleProofError,
  blindInputs,
  combineAndFinalize,
  dealOracleKeys,
  evaluateWithKey,
  oracleEvaluate,
  subjectTag,
} from '../oprf.js';
import { randomScalar, reconstruct, scalarFromBytes, scalarToBytes } from '../shamir.js';

const X = oprfInput(normalise({ kind: 'IN', ifsc: 'HDFC0001234', account: '50100123456789' }));
const secret = randomScalar();
const keys = dealOracleKeys(2, 3, secret);
const pubs = keys.shares.map(({ index, publicKey }) => ({ index, publicKey }));

const tagVia = (oracles: number[], inputs = [X]) => {
  const st = blindInputs(inputs);
  const rs = oracles.map((i) => oracleEvaluate(keys.shares[i], st.blinded));
  return combineAndFinalize(st, pubs, rs, 2);
};

describe('threshold VOPRF', () => {
  it('group public key is k·G for the dealt secret', () => {
    expect(equal(keys.groupPublicKey, ristretto255.Point.BASE.multiply(secret).toBytes())).toBe(true);
  });

  it('shares reconstruct the key', () => {
    const shares = keys.shares.map((s) => ({ index: s.index, value: scalarFromBytes(s.secretKey) }));
    expect(reconstruct([shares[0], shares[2]])).toBe(secret);
  });

  it('every 2-of-3 combination equals single-key VOPRF evaluation with the reconstructed key', () => {
    const reference = toHex(evaluateWithKey(scalarToBytes(secret), X));
    for (const pair of [[0, 1], [0, 2], [1, 2], [2, 0]]) {
      expect(toHex(tagVia(pair)[0])).toBe(reference);
    }
  });

  it('is deterministic across fresh blinds (two banks get the same T)', () => {
    expect(equal(subjectTag(tagVia([0, 1])[0]), subjectTag(tagVia([1, 2])[0]))).toBe(true);
  });

  it('gives different tags for different accounts', () => {
    const Y = oprfInput(normalise({ kind: 'IN', ifsc: 'HDFC0001234', account: '50100123456780' }));
    const [a, b] = tagVia([0, 1], [X, Y]);
    expect(equal(subjectTag(a), subjectTag(b))).toBe(false);
  });

  it('a different oracle key gives an unrelated tag (no offline computation without the oracles)', () => {
    const other = dealOracleKeys(2, 3);
    expect(equal(evaluateWithKey(scalarToBytes(scalarFromBytes(other.shares[0].secretKey)), X), tagVia([0, 1])[0])).toBe(false);
  });

  it('oracles never see the input: the blinded element differs on every request', () => {
    const a = blindInputs([X]).blinded[0];
    const b = blindInputs([X]).blinded[0];
    expect(equal(a, b)).toBe(false);
  });

  it('subject tag is 32 bytes and domain-separated', () => {
    const out = tagVia([0, 1])[0];
    expect(out.length).toBe(64);
    expect(subjectTag(out).length).toBe(32);
    expect(equal(subjectTag(out), out.subarray(0, 32))).toBe(false);
  });

  it('handles a batch', () => {
    const inputs = Array.from({ length: 10 }, (_, i) => utf8(`vpa:v1:user${i}@okaxis`));
    const outs = tagVia([0, 2], inputs);
    expect(outs.map(toHex)).toEqual(inputs.map((x) => toHex(evaluateWithKey(scalarToBytes(secret), x))));
  });

  it('rejects batches above the limit', () => {
    expect(() => blindInputs(Array.from({ length: MAX_BATCH + 1 }, () => X))).toThrow('batch');
  });
});

describe('threshold VOPRF failure handling', () => {
  it('fails with only one oracle', () => {
    expect(() => tagVia([0])).toThrow(OracleProofError);
  });

  it('does not count the same oracle twice', () => {
    expect(() => tagVia([1, 1])).toThrow(OracleProofError);
  });

  it('rejects an evaluation that does not match its proof', () => {
    const st = blindInputs([X]);
    const good = oracleEvaluate(keys.shares[0], st.blinded);
    const forged = { ...oracleEvaluate(keys.shares[1], st.blinded), evaluated: [ristretto255.Point.BASE.toBytes()] };
    expect(() => combineAndFinalize(st, pubs, [good, forged], 2)).toThrow(OracleProofError);
  });

  it('rejects an oracle answering with a key that is not its registered share', () => {
    const st = blindInputs([X]);
    const rogue = dealOracleKeys(2, 3).shares[1];
    const rs = [oracleEvaluate(keys.shares[0], st.blinded), oracleEvaluate(rogue, st.blinded)];
    expect(() => combineAndFinalize(st, pubs, rs, 2)).toThrow(OracleProofError);
  });

  it('skips a faulty oracle when two honest ones answer', () => {
    const st = blindInputs([X]);
    const rogue = { ...dealOracleKeys(2, 3).shares[0], index: 1 };
    const rs = [oracleEvaluate(rogue, st.blinded), oracleEvaluate(keys.shares[1], st.blinded), oracleEvaluate(keys.shares[2], st.blinded)];
    expect(toHex(combineAndFinalize(st, pubs, rs, 2)[0])).toBe(toHex(evaluateWithKey(scalarToBytes(secret), X)));
  });

  it('rejects a response with the wrong batch size', () => {
    const st = blindInputs([X, X]);
    const short = blindInputs([X]);
    const rs = [oracleEvaluate(keys.shares[0], st.blinded), oracleEvaluate(keys.shares[1], short.blinded)];
    expect(() => combineAndFinalize(st, pubs, rs, 2)).toThrow(OracleProofError);
  });
});
