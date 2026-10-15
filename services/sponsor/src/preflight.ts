// SPDX-License-Identifier: Apache-2.0
// Structural pre-flight (§4.4 step 3). Runs before the sponsor spends any DUST.
// A transaction is sponsorable only if every action is a call to the MuleNet contract on an
// allow-listed entry point, it moves no shielded or unshielded value, it carries no DUST
// actions of its own, and enough intent TTL remains (R3: the TTL is fixed at construction).
import { ContractCall, type FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';

export type PreflightOptions = {
  contractAddress: string;
  allowedCircuits: ReadonlySet<string>;
  minTtlMs?: number;
  now?: number;
};

export type PreflightResult =
  | { ok: true; circuits: string[]; ttl: Date }
  | { ok: false; reason: 'not-mulenet' | 'circuit-not-allowed' | 'ttl' | 'value-movement' | 'malformed'; detail: string };

const entryName = (e: Uint8Array | string) => (typeof e === 'string' ? e : new TextDecoder().decode(e));

const hasValue = (offer: { inputs: unknown[]; outputs: unknown[] } | undefined) => !!offer && (offer.inputs.length > 0 || offer.outputs.length > 0);

export const preflight = (tx: FinalizedTransaction, o: PreflightOptions): PreflightResult => {
  const now = o.now ?? Date.now();
  const minTtlMs = o.minTtlMs ?? 5 * 60_000;
  if (tx.rewards) return { ok: false, reason: 'malformed', detail: 'reward claim' };
  if (tx.guaranteedOffer || (tx.fallibleOffer && tx.fallibleOffer.size > 0)) {
    return { ok: false, reason: 'value-movement', detail: 'shielded offer' };
  }
  const intents = [...(tx.intents?.values() ?? [])];
  if (intents.length === 0) return { ok: false, reason: 'malformed', detail: 'no intents' };

  const circuits: string[] = [];
  let ttl = new Date(8.64e15);
  for (const intent of intents) {
    if (hasValue(intent.guaranteedUnshieldedOffer) || hasValue(intent.fallibleUnshieldedOffer)) {
      return { ok: false, reason: 'value-movement', detail: 'unshielded offer' };
    }
    if (intent.dustActions) return { ok: false, reason: 'malformed', detail: 'already carries DUST actions' };
    if (intent.actions.length === 0) return { ok: false, reason: 'malformed', detail: 'empty intent' };
    for (const action of intent.actions) {
      if (!(action instanceof ContractCall)) return { ok: false, reason: 'not-mulenet', detail: 'deploy or maintenance update' };
      if (String(action.address) !== o.contractAddress) return { ok: false, reason: 'not-mulenet', detail: 'foreign contract' };
      const name = entryName(action.entryPoint);
      if (!o.allowedCircuits.has(name)) return { ok: false, reason: 'circuit-not-allowed', detail: name };
      circuits.push(name);
    }
    if (intent.ttl < ttl) ttl = intent.ttl;
  }
  if (ttl.getTime() - now < minTtlMs) return { ok: false, reason: 'ttl', detail: `ttl ${ttl.toISOString()}` };
  return { ok: true, circuits, ttl };
};
