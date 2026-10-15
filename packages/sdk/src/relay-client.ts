// SPDX-License-Identifier: Apache-2.0
// Member client for the flag relay (§4.2). Fetches whole buckets (optionally from mirrors too)
// and returns the union of records; filtering by lookupKey and decryption happen in the caller.
import { decodeRecord, encodeRecord, recordId, toHex, type FlagRecord } from '@mulenet/crypto';
import { signRequest, type SigningKey } from '@mulenet/service-kit';
import { BucketResponse } from './api-types.js';

export type RelayClientOptions = { urls: string[]; signingKey: SigningKey; timeoutMs?: number };

export const createRelayClient = ({ urls, signingKey, timeoutMs = 5_000 }: RelayClientOptions) => {
  const signedFetch = (url: string, method: string, path: string, body?: Uint8Array) =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...signRequest(signingKey, method, path, body) },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

  // Writes to the primary. 201 (new) and 409 (already there) both mean the record is stored.
  const put = async (rec: FlagRecord): Promise<string> => {
    const body = new TextEncoder().encode(JSON.stringify({ record: Buffer.from(encodeRecord(rec)).toString('base64') }));
    const res = await signedFetch(urls[0], 'PUT', '/v1/records', body);
    if (res.status !== 201 && res.status !== 409) throw new Error(`relay PUT failed: HTTP ${res.status}`);
    return toHex(recordId(rec));
  };

  const fetchFrom = async (url: string, bucket: number): Promise<FlagRecord[]> => {
    const out: FlagRecord[] = [];
    let since = 0;
    for (;;) {
      const path = `/v1/buckets/${bucket}?since=${since}&limit=500`;
      const res = await signedFetch(url, 'GET', path);
      if (!res.ok) throw new Error(`relay GET failed: HTTP ${res.status}`);
      const page = BucketResponse.parse(await res.json());
      for (const b64 of page.records) {
        try {
          out.push(decodeRecord(new Uint8Array(Buffer.from(b64, 'base64'))));
        } catch {
          // Malformed entries are ignored, never fatal.
        }
      }
      if (page.records.length < 500) return out;
      since = page.cursor;
    }
  };

  // Union across primary and mirrors, deduplicated by content address. One relay withholding
  // a record is defeated as long as any other copy serves it.
  const bucket = async (n: number): Promise<{ records: FlagRecord[]; reachable: number }> => {
    const settled = await Promise.allSettled(urls.map((u) => fetchFrom(u, n)));
    const seen = new Map<string, FlagRecord>();
    let reachable = 0;
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      reachable++;
      for (const r of s.value) seen.set(toHex(recordId(r)), r);
    }
    if (reachable === 0) throw new Error('no relay reachable');
    return { records: [...seen.values()], reachable };
  };

  return { put, bucket };
};

export type RelayClient = ReturnType<typeof createRelayClient>;
