// SPDX-License-Identifier: Apache-2.0
// mulenet-verify (§8.2, §15.3): checks a MuleNet deployment from public chain data alone.
// It needs only an indexer (a local one, or Blockfrost with your own BLOCKFROST_PROJECT_ID) and
// this repository: no MuleNet service, explorer or team infrastructure.
//
//   mulenet-verify keys [--write docs/verifier-keys.json]
//   mulenet-verify deployment  --address <hex> [--network preprod]
//   mulenet-verify attestation --address <hex> --att-key <hex>
//   mulenet-verify warrants    --address <hex>
//   mulenet-verify receipts    docs/RECEIPTS.md
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MuleNet } from '@mulenet/contract';
import { fromHex, toHex } from '@mulenet/crypto';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const root = process.env.MULENET_ROOT ?? resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : dflt;
};
const network = opt('network', 'undeployed')!;

const endpoints = () => {
  if (network === 'undeployed') return { http: 'http://127.0.0.1:8088/api/v4/graphql', ws: 'ws://127.0.0.1:8088/api/v4/graphql/ws' };
  const id = process.env.BLOCKFROST_PROJECT_ID;
  if (!id) throw new Error('set BLOCKFROST_PROJECT_ID (your own Blockfrost Midnight project) to verify against preprod');
  const q = `?project_id=${encodeURIComponent(id)}`;
  return { http: `https://midnight-${network}.blockfrost.io/api/v0${q}`, ws: `wss://midnight-${network}.blockfrost.io/api/v0/ws${q}` };
};

const gql = async <T>(query: string, variables: object = {}): Promise<T> => {
  const r = await fetch(endpoints().http, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data!;
};

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

const address = () => {
  const a = opt('address') ?? (existsSync(resolve(root, `infra/state/${network}.json`)) ? JSON.parse(readFileSync(resolve(root, `infra/state/${network}.json`), 'utf8')).contractAddress : undefined);
  if (!a) throw new Error('--address is required');
  return a as string;
};

const latestState = async (addr: string) => {
  const d = await gql<{ contractAction: { state: string; transaction: { hash: string; block: { height: number } } } | null }>(
    'query($a: HexEncoded!) { contractAction(address: $a) { state transaction { hash block { height } } } }',
    { a: addr },
  );
  if (!d.contractAction) throw new Error(`no contract at ${addr}`);
  const cs = ContractState.deserialize(Buffer.from(d.contractAction.state, 'hex'));
  return { cs, ledger: MuleNet.ledger(cs.data), height: d.contractAction.transaction.block.height };
};

const keysDir = resolve(root, 'contracts/src/managed/mulenet/keys');
const localKeyHashes = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(keysDir)
      .filter((f) => f.endsWith('.verifier'))
      .map((f) => [f.replace('.verifier', ''), sha(readFileSync(resolve(keysDir, f)))]),
  );
const releaseHashes = (): Record<string, string> => {
  const p = resolve(root, opt('hashes', 'docs/verifier-keys.json')!);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).circuits : localKeyHashes();
};

// Replays the contract's history until `pred` holds for a state; returns that action.
const findAction = (addr: string, pred: (l: MuleNet.Ledger) => boolean) =>
  new Promise<{ hash: string; height: number } | null>((res, rej) => {
    const client = createClient({ url: endpoints().ws, webSocketImpl: WebSocket });
    let latest = 0;
    const timer = setTimeout(() => {
      dispose();
      void client.dispose();
      res(null);
    }, 60_000);
    const dispose = client.subscribe<{ contractActions: { state: string; transaction: { hash: string; block: { height: number } } } }>(
      {
        query: 'subscription($a: HexEncoded!, $o: BlockOffset) { contractActions(address: $a, offset: $o) { state transaction { hash block { height } } } }',
        variables: { a: addr, o: { height: 0 } },
      },
      {
        next: ({ data }) => {
          if (!data) return;
          const a = data.contractActions;
          latest = a.transaction.block.height;
          if (pred(MuleNet.ledger(ContractState.deserialize(Buffer.from(a.state, 'hex')).data))) {
            clearTimeout(timer);
            dispose();
            void client.dispose();
            res({ hash: a.transaction.hash, height: latest });
          }
        },
        error: rej,
        complete: () => res(null),
      },
    );
  });

const main = async () => {
  switch (cmd) {
    case 'keys': {
      const hashes = localKeyHashes();
      const out = opt('write');
      if (out) {
        writeFileSync(resolve(root, out), JSON.stringify({ compiler: '0.31.1', circuits: hashes }, null, 2) + '\n');
        console.log(`wrote ${out}`);
      }
      for (const [c, h] of Object.entries(hashes)) console.log(`  ${c.padEnd(22)} ${h}`);
      return;
    }
    case 'deployment': {
      const addr = address();
      console.log(`deployment ${addr} on ${network}`);
      const { cs, ledger: l, height } = await latestState(addr);
      const expected = releaseHashes();
      const onChain = cs.operations().map(String);
      for (const c of Object.keys(expected).sort()) {
        const op = cs.operation(c);
        if (!op) bad(`circuit ${c} missing on chain`);
        else if (sha(op.verifierKey) !== expected[c]) bad(`circuit ${c}: verifier key differs from the release`);
        else ok(`${c} verifier key matches the release (sha256 ${expected[c].slice(0, 16)}…)`);
      }
      for (const c of onChain) if (!(c in expected)) bad(`unexpected circuit on chain: ${c}`);
      ok(`guardian set = ${l.guardians.firstFree()}, threshold = ${l.guardianThreshold}, corroborationK = ${l.corroborationK}`);
      ok(`epoch ${l.currentEpoch}, ttl ${l.epochTtl} epochs, epoch length ${l.epochLength} s; state as of block ${height}`);
      ok(`public totals: ${l.flagCount} flags, ${l.revocationCount} revocations, ${l.attestationCount} attestations, ${l.disclosures.size()} warrants`);
      return;
    }
    case 'attestation': {
      const addr = address();
      const key = opt('att-key');
      if (!key) throw new Error('--att-key is required');
      console.log(`attestation ${key.slice(0, 16)}… on ${addr.slice(0, 16)}…`);
      const { ledger: l } = await latestState(addr);
      if (!l.attestations.member(fromHex(key))) return bad('no such attestation');
      const a = l.attestations.lookup(fromHex(key));
      ok(`attestation exists: epoch ${a.epoch}, k = ${a.k}, typology ${a.typology}`);
      const tx = await findAction(addr, (s) => s.attestations.member(fromHex(key)));
      if (tx) ok(`included in tx ${tx.hash} (block ${tx.height})`);
      else bad('could not locate the including transaction');
      return;
    }
    case 'warrants': {
      const addr = address();
      console.log(`warrants on ${addr.slice(0, 16)}…`);
      const { ledger: l } = await latestState(addr);
      const warrants = [...l.disclosures];
      if (warrants.length === 0) ok('no disclosures authorised');
      for (const [attKey, epoch] of warrants) {
        const p = [...l.proposals].find(([, pr]) => Number(pr.kind) === 4 && toHex(pr.payload) === toHex(attKey));
        if (!p) bad(`warrant ${toHex(attKey).slice(0, 12)}… has no governance proposal`);
        else if (!p[1].executed || p[1].approvals < l.guardianThreshold) bad(`warrant ${toHex(attKey).slice(0, 12)}…: proposal not executed with quorum`);
        else ok(`warrant ${toHex(attKey).slice(0, 12)}… authorised in epoch ${epoch}; proposal approvals ${p[1].approvals}/${l.guardianThreshold}, executed`);
        if (!l.attestations.member(attKey)) bad(`warrant ${toHex(attKey).slice(0, 12)}… does not point at an attestation`);
      }
      return;
    }
    case 'receipts': {
      const file = resolve(root, args[1] ?? 'docs/RECEIPTS.md');
      const hashes = [...new Set(readFileSync(file, 'utf8').match(/\b[0-9a-f]{64}\b/g) ?? [])];
      console.log(`${hashes.length} transaction hashes in ${file.replace(root + '/', '')}`);
      for (const h of hashes) {
        const d = await gql<{ transactions: { hash: string; block: { height: number } }[] }>(
          'query($h: HexEncoded!) { transactions(offset: { hash: $h }) { hash block { height } } }',
          { h },
        ).catch(() => ({ transactions: [] }));
        if (d.transactions.length) ok(`${h.slice(0, 16)}… in block ${d.transactions[0].block.height}`);
        else bad(`${h.slice(0, 16)}… not found on ${network}`);
      }
      return;
    }
    default:
      console.log('usage: mulenet-verify keys|deployment|attestation|warrants|receipts [--network undeployed|preprod] [--address hex]');
      process.exitCode = 2;
  }
};

main()
  .then(() => process.exit(failures === 0 && process.exitCode !== 2 ? 0 : 1))
  .catch((e) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
