// SPDX-License-Identifier: Apache-2.0
// RFC 9497 Appendix A.1 test vectors, ristretto255-SHA512 (OPRF and VOPRF modes).
import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from '../bytes.js';

const { oprf, voprf } = ristretto255_oprf;
const SEED = fromHex('a3'.repeat(32));
const KEY_INFO = fromHex('74657374206b6579');
const BLIND = '64d37aed22a27f5191de1c1d69fadb899d8862b58eb4220029e036ec4c1f6706';
const PROOF_RANDOM = '222a5e897cf59db8145db8d16e597e8facb80ae7d4e26d9881aa6f61d645fc0e';

// A "random" source that makes noble pick a fixed scalar. noble maps random bytes into
// [1, n-1] as (v mod (n-1)) + 1, so feed scalar − 1, little-endian and zero-extended.
const fixed = (hex: string) => (n?: number) => {
  let v = BigInt('0x' + Buffer.from(fromHex(hex)).reverse().toString('hex')) - 1n;
  const out = new Uint8Array(n ?? 32);
  for (let i = 0; i < out.length && v > 0n; i++, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
};

describe('RFC 9497 A.1.1 OPRF mode', () => {
  const keys = oprf.deriveKeyPair(SEED, KEY_INFO);
  it('derives skSm', () => {
    expect(toHex(keys.secretKey)).toBe('5ebcea5ee37023ccb9fc2d2019f9d7737be85591ae8652ffa9ef0f4d37063b0e');
  });

  const vectors = [
    {
      input: '00',
      blinded: '609a0ae68c15a3cf6903766461307e5c8bb2f95e7e6550e1ffa2dc99e412803c',
      evaluated: '7ec6578ae5120958eb2db1745758ff379e77cb64fe77b0b2d8cc917ea0869c7e',
      output:
        '527759c3d9366f277d8c6020418d96bb393ba2afb20ff90df23fb7708264e2f3ab9135e3bd69955851de4b1f9fe8a0973396719b7912ba9ee8aa7d0b5e24bcf6',
    },
    {
      input: '5a'.repeat(17),
      blinded: 'da27ef466870f5f15296299850aa088629945a17d1f5b7f5ff043f76b3c06418',
      evaluated: 'b4cbf5a4f1eeda5a63ce7b77c7d23f461db3fcab0dd28e4e17cecb5c90d02c25',
      output:
        'f4a74c9c592497375e796aa837e907b1a045d34306a749db9f34221f7e750cb4f2a6413a6bf6fa5e19ba6348eb673934a722a7ede2e7621306d18951e7cf2c73',
    },
  ];
  for (const [i, v] of vectors.entries()) {
    it(`test vector ${i + 1}`, () => {
      const b = oprf.blind(fromHex(v.input), fixed(BLIND));
      expect(toHex(b.blind)).toBe(BLIND);
      expect(toHex(b.blinded)).toBe(v.blinded);
      const z = oprf.blindEvaluate(keys.secretKey, b.blinded);
      expect(toHex(z)).toBe(v.evaluated);
      expect(toHex(oprf.finalize(fromHex(v.input), b.blind, z))).toBe(v.output);
    });
  }
});

describe('RFC 9497 A.1.2 VOPRF mode', () => {
  const keys = voprf.deriveKeyPair(SEED, KEY_INFO);
  it('derives skSm and pkSm', () => {
    expect(toHex(keys.secretKey)).toBe('e6f73f344b79b379f1a0dd37e07ff62e38d9f71345ce62ae3a9bc60b04ccd909');
    expect(toHex(keys.publicKey)).toBe('c803e2cc6b05fc15064549b5920659ca4a77b2cca6f04f6b357009335476ad4e');
  });

  const vectors = [
    {
      input: '00',
      blinded: '863f330cc1a1259ed5a5998a23acfd37fb4351a793a5b3c090b642ddc439b945',
      evaluated: 'aa8fa048764d5623868679402ff6108d2521884fa138cd7f9c7669a9a014267e',
      proof:
        'ddef93772692e535d1a53903db24367355cc2cc78de93b3be5a8ffcc6985dd066d4346421d17bf5117a2a1ff0fcb2a759f58a539dfbe857a40bce4cf49ec600d',
      output:
        'b58cfbe118e0cb94d79b5fd6a6dafb98764dff49c14e1770b566e42402da1a7da4d8527693914139caee5bd03903af43a491351d23b430948dd50cde10d32b3c',
    },
    {
      input: '5a'.repeat(17),
      blinded: 'cc0b2a350101881d8a4cba4c80241d74fb7dcbfde4a61fde2f91443c2bf9ef0c',
      evaluated: '60a59a57208d48aca71e9e850d22674b611f752bed48b36f7a91b372bd7ad468',
      proof:
        '401a0da6264f8cf45bb2f5264bc31e109155600babb3cd4e5af7d181a2c9dc0a67154fabf031fd936051dec80b0b6ae29c9503493dde7393b722eafdf5a50b02',
      output:
        '8a9a2f3c7f085b65933594309041fc1898d42d0858e59f90814ae90571a6df60356f4610bf816f27afdd84f47719e480906d27ecd994985890e5f539e7ea74b6',
    },
  ];
  for (const [i, v] of vectors.entries()) {
    it(`test vector ${i + 1}`, () => {
      const input = fromHex(v.input);
      const b = voprf.blind(input, fixed(BLIND));
      expect(toHex(b.blinded)).toBe(v.blinded);
      const r = voprf.blindEvaluate(keys.secretKey, keys.publicKey, b.blinded, fixed(PROOF_RANDOM));
      expect(toHex(r.evaluated)).toBe(v.evaluated);
      expect(toHex(r.proof)).toBe(v.proof);
      expect(toHex(voprf.finalize(input, b.blind, r.evaluated, b.blinded, keys.publicKey, r.proof))).toBe(v.output);
    });
  }

  it('test vector 3 (batch of 2)', () => {
    const inputs = [fromHex('00'), fromHex('5a'.repeat(17))];
    const blinds = [BLIND, PROOF_RANDOM].map((h) => voprf.blind(inputs[0], fixed(h)).blind);
    const blinded = inputs.map((x, i) => voprf.blind(x, fixed(toHex(blinds[i]))).blinded);
    expect(blinded.map(toHex)).toEqual([
      '863f330cc1a1259ed5a5998a23acfd37fb4351a793a5b3c090b642ddc439b945',
      '90a0145ea9da29254c3a56be4fe185465ebb3bf2a1801f7124bbbadac751e654',
    ]);
    const r = voprf.blindEvaluateBatch(
      keys.secretKey,
      keys.publicKey,
      blinded,
      fixed('419c4f4f5052c53c45f3da494d2b67b220d02118e0857cdbcf037f9ea84bbe0c'),
    );
    expect(r.evaluated.map(toHex)).toEqual([
      'aa8fa048764d5623868679402ff6108d2521884fa138cd7f9c7669a9a014267e',
      'cc5ac221950a49ceaa73c8db41b82c20372a4c8d63e5dded2db920b7eee36a2a',
    ]);
    expect(toHex(r.proof)).toBe(
      'cc203910175d786927eeb44ea847328047892ddf8590e723c37205cb74600b0a5ab5337c8eb4ceae0494c2cf89529dcf94572ed267473d567aeed6ab873dee08',
    );
  });
});
