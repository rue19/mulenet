// SPDX-License-Identifier: Apache-2.0
// Service-to-service request signatures (decision X2). Every internal request carries
//   X-MuleNet-Inst: <caller id>   X-MuleNet-Ts: <unix seconds>   X-MuleNet-Nonce: <16 random bytes, hex>
//   X-MuleNet-Sig: <hex Ed25519 sig over "mulenet-req:v1\n" ‖ METHOD ‖ path ‖ ts ‖ nonce ‖ SHA-256(body)>
// Timestamps outside ±60 s are refused, and each signature is accepted once (replay cache).
// The nonce matters: Ed25519 is deterministic, so without it two identical legitimate requests
// in the same second (an idempotent retry) would collide in the replay cache.
// Production would use mTLS; this keeps the property demonstrable without a PKI.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

export const HEADER_INST = 'x-mulenet-inst';
export const HEADER_TS = 'x-mulenet-ts';
export const HEADER_NONCE = 'x-mulenet-nonce';
export const HEADER_SIG = 'x-mulenet-sig';

export class AuthError extends Error {}

const enc = new TextEncoder();

const signedMessage = (method: string, path: string, ts: number, nonce: string, body: Uint8Array): Uint8Array => {
  const head = enc.encode(`mulenet-req:v1\n${method.toUpperCase()}\n${path}\n${ts}\n${nonce}\n`);
  const out = new Uint8Array(head.length + 32);
  out.set(head);
  out.set(sha256(body), head.length);
  return out;
};

export type SigningKey = { id: string; secretKey: Uint8Array };

export const generateSigningKey = (id: string): SigningKey & { publicKey: Uint8Array } => {
  const secretKey = ed25519.utils.randomSecretKey();
  return { id, secretKey, publicKey: ed25519.getPublicKey(secretKey) };
};

export const signRequest = (
  key: SigningKey,
  method: string,
  path: string,
  body: Uint8Array = new Uint8Array(),
  now = Math.floor(Date.now() / 1000),
): Record<string, string> => {
  const nonce = bytesToHex(randomBytes(16));
  return {
    [HEADER_INST]: key.id,
    [HEADER_TS]: String(now),
    [HEADER_NONCE]: nonce,
    [HEADER_SIG]: bytesToHex(ed25519.sign(signedMessage(method, path, now, nonce, body), key.secretKey)),
  };
};

export type VerifierOptions = { publicKeys: Map<string, Uint8Array>; windowSeconds?: number; now?: () => number };

export const createVerifier = ({ publicKeys, windowSeconds = 60, now = () => Math.floor(Date.now() / 1000) }: VerifierOptions) => {
  const seen = new Map<string, number>(); // signature hex → expiry

  return (headers: Record<string, string | string[] | undefined>, method: string, path: string, body: Uint8Array): string => {
    const get = (h: string) => {
      const v = headers[h];
      return Array.isArray(v) ? v[0] : v;
    };
    const inst = get(HEADER_INST);
    const tsRaw = get(HEADER_TS);
    const sig = get(HEADER_SIG);
    const nonce = get(HEADER_NONCE);
    if (!inst || !tsRaw || !sig || !nonce) throw new AuthError('missing signature headers');
    if (!/^[0-9a-f]{32}$/.test(nonce)) throw new AuthError('malformed nonce');
    const pk = publicKeys.get(inst);
    if (!pk) throw new AuthError('unknown caller');
    const ts = Number(tsRaw);
    const t = now();
    if (!Number.isInteger(ts) || Math.abs(t - ts) > windowSeconds) throw new AuthError('stale timestamp');
    if (!/^[0-9a-f]{128}$/.test(sig)) throw new AuthError('malformed signature');

    for (const [k, exp] of seen) if (exp < t) seen.delete(k);
    if (seen.has(sig)) throw new AuthError('replayed request');
    if (!ed25519.verify(hexToBytes(sig), signedMessage(method, path, ts, nonce, body), pk)) throw new AuthError('bad signature');
    seen.set(sig, ts + windowSeconds);
    return inst;
  };
};

export type Verifier = ReturnType<typeof createVerifier>;
