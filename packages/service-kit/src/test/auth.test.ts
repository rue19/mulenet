import { describe, expect, it } from 'vitest';
import { createApp, createVerifier, generateSigningKey, requireSignature, signRequest } from '../index.js';

const bank = generateSigningKey('bank-a');
const other = generateSigningKey('bank-b');
const body = new TextEncoder().encode(JSON.stringify({ blinded: ['ab'] }));

const app = (now?: () => number) => {
  const a = createApp({ name: 'test', logger: false });
  const verify = createVerifier({ publicKeys: new Map([[bank.id, bank.publicKey]]), now });
  a.post('/v1/evaluate', { preHandler: requireSignature(verify) }, async (req) => ({ caller: req.caller }));
  return a;
};
const post = (a: ReturnType<typeof app>, headers: Record<string, string>, payload: Uint8Array = body) =>
  a.inject({ method: 'POST', url: '/v1/evaluate', headers: { 'content-type': 'application/json', ...headers }, payload: Buffer.from(payload) });

describe('request signatures', () => {
  it('accepts a correctly signed request and identifies the caller', async () => {
    const r = await post(app(), signRequest(bank, 'POST', '/v1/evaluate', body));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ caller: 'bank-a' });
  });

  it('rejects unsigned requests', async () => {
    expect((await post(app(), {})).statusCode).toBe(401);
  });

  it('rejects an unknown caller', async () => {
    expect((await post(app(), signRequest(other, 'POST', '/v1/evaluate', body))).statusCode).toBe(401);
  });

  it('rejects a signature by another key under a known id', async () => {
    const forged = signRequest({ id: 'bank-a', secretKey: other.secretKey }, 'POST', '/v1/evaluate', body);
    expect((await post(app(), forged)).statusCode).toBe(401);
  });

  it('rejects a tampered body', async () => {
    const h = signRequest(bank, 'POST', '/v1/evaluate', body);
    expect((await post(app(), h, new TextEncoder().encode('{"blinded":["cd"]}'))).statusCode).toBe(401);
  });

  it('rejects a signature for another path', async () => {
    expect((await post(app(), signRequest(bank, 'POST', '/v1/other', body))).statusCode).toBe(401);
  });

  it('rejects a replayed request', async () => {
    const a = app();
    const h = signRequest(bank, 'POST', '/v1/evaluate', body);
    expect((await post(a, h)).statusCode).toBe(200);
    const r = await post(a, h);
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toBe('replayed request');
  });

  it('rejects a timestamp outside ±60 s', async () => {
    const now = Math.floor(Date.now() / 1000);
    const h = signRequest(bank, 'POST', '/v1/evaluate', body, now - 61);
    expect((await post(app(() => now), h)).statusCode).toBe(401);
    const ok = signRequest(bank, 'POST', '/v1/evaluate', body, now - 59);
    expect((await post(app(() => now), ok)).statusCode).toBe(200);
  });

  it('serves an unauthenticated health check', async () => {
    const r = await app().inject({ method: 'GET', url: '/v1/health' });
    expect(r.json()).toEqual({ service: 'test', ok: true });
  });
});
