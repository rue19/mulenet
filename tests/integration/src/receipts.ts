// SPDX-License-Identifier: Apache-2.0
// Receipts run (plan P6-2): executes the demo script (§5.5) against a running stack and writes
// docs/RECEIPTS[.<network>].md. Refusals that happen before any proof are recorded as
// "refused before proof", never presented as on-chain rejections.
//   MULENET_NETWORK=preprod MULENET_DEPLOYMENT=demo npx tsx src/receipts.ts
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bankClient, guardianOperator, regulatorClient } from '@mulenet/sdk/clients';
import { deploymentName, loadDeployment, repoRoot } from '@mulenet/sdk/config';
import { networks } from '@mulenet/sdk';
import type { Job } from '@mulenet/sdk/api-types';

const NET = process.env.MULENET_NETWORK ?? 'undeployed';
const dep = loadDeployment(NET);
const X = `acct:v1:IN:ICIC0000104:${(BigInt('0x' + randomBytes(7).toString('hex')) % 10n ** 12n).toString().padStart(12, '5')}`;
const [A, B, C, D, E] = ['bank-a', 'bank-b', 'bank-c', 'bank-d', 'bank-e'].map((b) => bankClient(NET, b));
const g1 = guardianOperator(NET, 1);
const g3 = guardianOperator(NET, 3);
void regulatorClient;

type Row = { step: string; circuit: string; outcome: string; kind: 'on-chain' | 'refused before proof' | 'refused on-chain' | 'off-chain'; tx?: string; block?: number; hash?: string };
const rows: Row[] = [];
const add = (step: string, circuit: string, j: Job, expectFail?: string) => {
  const kind: Row['kind'] = j.state === 'confirmed' ? 'on-chain' : j.txId ? 'refused on-chain' : 'refused before proof';
  rows.push({ step, circuit, outcome: j.state === 'confirmed' ? 'confirmed' : `${j.error?.code}: ${j.error?.message}`, kind, tx: j.txId, block: j.blockHeight });
  const ok = expectFail ? j.error?.code === expectFail : j.state === 'confirmed';
  console.log(`${ok ? '✓' : '✗'} ${step}: ${rows.at(-1)!.outcome}`);
  if (!ok) process.exitCode = 1;
};

const links = (tx: string) =>
  NET === 'preprod'
    ? `[midnightexplorer](https://preprod.midnightexplorer.com/tx/${tx}) · [subscan](https://midnight-preprod.subscan.io/extrinsic/${tx}) · [1am](https://explorer.1am.xyz/tx/${tx}?network=preprod)`
    : 'local network';

for (const [n, b] of [['A', A], ['B', B], ['C', C]] as const) add(`1. bank ${n} flags X`, 'submitFlag', await b.flag(X));
add('2. bank A flags X again', 'submitFlag', await A.flag(X), 'duplicate-flag');
add('3. unregistered bank E flags', 'submitFlag', await E.flag(X), 'not-a-member');
add('4. D attests k=3 with a duplicated slot', 'attestCorroboration3', await D.attest(X, 3, 'duplicate-slot'), 'duplicate-pseudonym');
add('5. C attests with its own flag', 'attestCorroboration3', await C.attest(X, 3, 'include-self'), 'self-excluded');
const att = await D.attest(X, 3);
add('6. D attests k=3', 'attestCorroboration3', att);
const chk = await E.check(X);
rows.push({ step: '7. E checks X', circuit: '— (off-chain)', outcome: `attestation k=${chk.attestation?.k}, ${chk.distinctInstitutions} institutions`, kind: 'off-chain' });
add('8a. B revokes its flag', 'revokeFlag', await B.revokeLatest(X));
add('8b. D attests k=3 again', 'attestCorroboration3', await D.attest(X, 3), 'insufficient');
const p = await g1.propose(4, att.attKey!);
rows.push({ step: '9a. guardian 1 proposes the warrant', circuit: 'propose', outcome: p.status === 200 ? 'confirmed' : String(p.status), kind: 'on-chain', tx: p.body.txId });
const a1 = await g1.approve(p.body.proposalId);
rows.push({ step: '9b. guardian 1 approves', circuit: 'approve', outcome: a1.status === 200 ? 'confirmed' : String(a1.status), kind: 'on-chain', tx: a1.body.txId });
const early = await g1.execute(p.body.proposalId);
rows.push({ step: '9c. execute with 1 approval', circuit: 'execute', outcome: `${early.body.reason ?? early.status}`, kind: early.status === 409 ? 'refused before proof' : 'on-chain' });
const a3 = await g3.approve(p.body.proposalId);
rows.push({ step: '9d. guardian 3 approves', circuit: 'approve', outcome: a3.status === 200 ? 'confirmed' : String(a3.status), kind: 'on-chain', tx: a3.body.txId });
const ex = await g1.execute(p.body.proposalId);
rows.push({ step: '9e. execute with 2 approvals', circuit: 'execute', outcome: ex.status === 200 ? 'confirmed' : String(ex.status), kind: 'on-chain', tx: ex.body.txId });

// Services report transaction identifiers; explorers and the verifier use transaction hashes.
const net = networks[NET as 'undeployed' | 'preprod']();
for (const r of rows.filter((x) => x.tx)) {
  const res = await fetch(net.indexer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query($i: HexEncoded!) { transactions(offset: { identifier: $i }) { hash block { height } } }', variables: { i: r.tx } }),
  });
  const t = ((await res.json()) as { data?: { transactions?: { hash: string; block: { height: number } }[] } }).data?.transactions?.[0];
  if (t) {
    r.hash = t.hash;
    r.block = t.block.height;
  } else {
    console.log(`✗ could not resolve tx ${r.tx} on the indexer`);
    process.exitCode = 1;
  }
}

const md = [
  `# Receipts (${NET}${deploymentName() === 'main' ? '' : `, ${deploymentName()}`})`,
  '',
  `Contract \`${dep.contractAddress}\`. Generated ${new Date().toISOString()} by \`tests/integration/src/receipts.ts\`.`,
  '',
  'A refusal *before proof* happens while the call is built: the contract assert fails locally, so nothing is proven, sponsored or submitted.',
  '',
  '| Step | Circuit | Outcome | Kind | Transaction |',
  '|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.step} | \`${r.circuit}\` | ${r.outcome} | ${r.kind} | ${r.hash ? `hash \`${r.hash}\` (block ${r.block})<br>id \`${r.tx}\`<br>${links(r.hash)}` : '—'} |`,
  ),
  '',
];
const out = resolve(repoRoot(), NET === 'preprod' ? 'docs/RECEIPTS.md' : `docs/RECEIPTS.${NET}.md`);
writeFileSync(out, md.join('\n'));
// Machine-readable copy for `mulenet-verify receipts`.
writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify({ network: NET, contract: dep.contractAddress, generatedAt: new Date().toISOString(), rows }, null, 2) + '\n');
console.log(`wrote ${out}`);
