// SPDX-License-Identifier: Apache-2.0
// Client side of the threshold OPRF (§5.2): blind locally, ask every oracle in parallel,
// verify each DLEQ proof against that oracle's registered public share, and combine any
// `threshold` valid answers. One oracle down or misbehaving does not block tagging.
import { blindInputs, combineAndFinalize, fromHex, normalise, oprfInput, subjectTag, toHex, type Identifier } from '@mulenet/crypto';
import { signRequest, type SigningKey } from '@mulenet/service-kit';
import { EvaluateResponse } from './api-types.js';
import type { PublicConfig } from './config.js';

export type OprfClientOptions = {
  oracles: PublicConfig['oracles'];
  signingKey: SigningKey;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class OprfUnavailableError extends Error {}

export const createOprfClient = ({ oracles, signingKey, timeoutMs = 3_000, fetchImpl = fetch }: OprfClientOptions) => {
  const publicShares = oracles.members.map((m) => ({ index: m.index, publicKey: fromHex(m.publicShare) }));

  const askOracle = async (url: string, blinded: string[]) => {
    const body = new TextEncoder().encode(JSON.stringify({ blinded }));
    const res = await fetchImpl(`${url}/v1/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signRequest(signingKey, 'POST', '/v1/evaluate', body) },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`oracle ${url}: HTTP ${res.status}`);
    const r = EvaluateResponse.parse(await res.json());
    return { index: r.index, evaluated: r.evaluated.map(fromHex), proof: fromHex(r.proof) };
  };

  // Canonical mulenet-id/v1 strings in, 32-byte subject tags T out (same order).
  const tags = async (canonical: string[]): Promise<Uint8Array[]> => {
    const st = blindInputs(canonical.map(oprfInput));
    const blinded = st.blinded.map(toHex);
    const settled = await Promise.allSettled(oracles.members.map((m) => askOracle(m.url, blinded)));
    const responses = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    if (responses.length < oracles.threshold) {
      throw new OprfUnavailableError(`only ${responses.length} of ${oracles.members.length} oracles answered`);
    }
    return combineAndFinalize(st, publicShares, responses, oracles.threshold).map(subjectTag);
  };

  return {
    tags,
    tag: async (id: Identifier | string) => (await tags([typeof id === 'string' ? id : normalise(id)]))[0],
  };
};

export type OprfClient = ReturnType<typeof createOprfClient>;
