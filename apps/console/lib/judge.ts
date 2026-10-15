// SPDX-License-Identifier: Apache-2.0
// Judge mode (§7.2): the demo script (§5.5) as one server-side state machine. Each step calls the
// real bank nodes, guardians and sponsor, and reports the outcome against what is expected.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { disclose } from './disclose';
import { bank, explorer, guardian, txLinks } from './server';

type Job = { state: string; txId?: string; blockHeight?: number; attKey?: string; error?: { code: string; message: string } };
export type StepResult = { ok: boolean; expected: string; outcome: string; receipts: { label: string; txId: string; links: { label: string; href: string }[] }[]; details?: unknown };

const s: { account: string; attKey?: string } = { account: '' };
const fresh = () => `acct:v1:IN:ICIC0000104:${(BigInt('0x' + randomBytes(7).toString('hex')) % 10n ** 12n).toString().padStart(12, '7')}`;
s.account = fresh();

const receipt = (label: string, j: Job) => (j.txId ? [{ label, txId: j.txId, links: txLinks(j.txId) }] : []);
const refused = (j: Job, code: string) => j.state === 'failed' && j.error?.code === code;

export const judgeState = () => ({ account: s.account, attKey: s.attKey });
export const resetJudge = () => {
  s.account = fresh();
  s.attKey = undefined;
  return judgeState();
};

export const STEPS: { title: string; narration: string; run: () => Promise<StepResult> }[] = [
  {
    title: 'Banks A, B and C flag the account',
    narration: 'Each bank tags the account with the threshold OPRF, proves submitFlag on its own node, and the consortium sponsor pays the fee.',
    run: async () => {
      const jobs = [];
      for (const b of ['bank-a', 'bank-b', 'bank-c']) jobs.push([b, (await bank(b).flag(s.account)) as Job] as const);
      return {
        ok: jobs.every(([, j]) => j.state === 'confirmed'),
        expected: '3 confirmed flags',
        outcome: jobs.map(([b, j]) => `${b}: ${j.state}`).join(', '),
        receipts: jobs.flatMap(([b, j]) => receipt(`${b} flag`, j)),
      };
    },
  },
  {
    title: 'Bank A flags the same account again',
    narration: 'One institution can flag a subject once per epoch: the flag nullifier H(instSecret, T, epoch) is already spent.',
    run: async () => {
      const j = (await bank('bank-a').flag(s.account)) as Job;
      return { ok: refused(j, 'duplicate-flag'), expected: 'refused: duplicate-flag', outcome: j.error?.code ?? j.state, receipts: receipt('unexpected', j) };
    },
  },
  {
    title: 'Unregistered bank E tries to flag',
    narration: 'Writers must prove membership in the governance-curated institution tree. E is not registered, so nothing is proven or sent.',
    run: async () => {
      const j = (await bank('bank-e').flag(s.account)) as Job;
      return { ok: refused(j, 'not-a-member') && !j.txId, expected: 'refused: not-a-member, no transaction', outcome: j.error?.code ?? j.state, receipts: [] };
    },
  },
  {
    title: 'Bank D tries to count bank A twice (k = 3)',
    narration: 'The attestation circuit requires pairwise-distinct pseudonyms. A duplicated slot is rejected by the contract itself.',
    run: async () => {
      const j = (await bank('bank-d').attest(s.account, 3, 'duplicate-slot')) as Job;
      return { ok: refused(j, 'duplicate-pseudonym'), expected: 'refused on-chain: dup', outcome: j.error?.code ?? j.state, receipts: [] };
    },
  },
  {
    title: 'Bank C tries to count its own flag',
    narration: 'A querier cannot corroborate itself: the circuit rejects any slot whose pseudonym equals the querier’s own.',
    run: async () => {
      const j = (await bank('bank-c').attest(s.account, 3, 'include-self')) as Job;
      return { ok: refused(j, 'self-excluded'), expected: 'refused on-chain: self excluded', outcome: j.error?.code ?? j.state, receipts: [] };
    },
  },
  {
    title: 'Bank D attests: at least 3 independent institutions',
    narration: 'D proves in zero knowledge that 3 fresh, unrevoked flags with distinct pseudonyms exist. The chain records only an opaque key and k.',
    run: async () => {
      const j = (await bank('bank-d').attest(s.account, 3)) as Job;
      s.attKey = j.attKey;
      return { ok: j.state === 'confirmed', expected: 'attestation recorded (k = 3)', outcome: j.state, receipts: receipt('attestation', j), details: { attKey: j.attKey } };
    },
  },
  {
    title: 'Bank E checks the account',
    narration: 'Any bank sees the attestation instantly with a free, private, off-chain check. E learns “3 institutions”, never which ones.',
    run: async () => {
      const r = await bank('bank-e').check(s.account);
      return { ok: r.attestation?.k === 3, expected: 'sees k = 3 attestation', outcome: `${r.distinctInstitutions} institutions; attestation ${r.attestation ? `k=${r.attestation.k}` : 'none'}`, receipts: [], details: r };
    },
  },
  {
    title: 'Bank B withdraws its flag',
    narration: 'Revocation overwrites the leaf and resets root history, so the old flag stops counting immediately. A new k = 3 proof is now impossible.',
    run: async () => {
      const rev = (await bank('bank-b').revokeLatest(s.account)) as Job;
      const check = await bank('bank-e').check(s.account);
      const again = (await bank('bank-d').attest(s.account, 3)) as Job;
      return {
        ok: rev.state === 'confirmed' && check.distinctInstitutions === 2 && refused(again, 'insufficient') && !again.txId,
        expected: 'revoked; count 2; new k=3 refused before any proof',
        outcome: `revoke ${rev.state}; count ${check.distinctInstitutions}; re-attest ${again.error?.code ?? again.state}`,
        receipts: receipt('revocation', rev),
      };
    },
  },
  {
    title: 'Regulator requests a warrant',
    narration: 'Disclosure needs 2 of 3 guardians on-chain. With one approval the contract refuses; the auditor’s approval makes it executable.',
    run: async () => {
      if (!s.attKey) return { ok: false, expected: 'run step 6 first', outcome: 'no attestation', receipts: [] };
      const { body: p } = await guardian(1).propose(4, s.attKey);
      await guardian(1).approve(p.proposalId);
      const early = await guardian(1).execute(p.proposalId);
      await guardian(3).approve(p.proposalId);
      const ok = await guardian(1).execute(p.proposalId);
      return {
        ok: early.status === 409 && early.body.reason === 'quorum' && ok.status === 200,
        expected: '1 approval → quorum refusal; 2 approvals → executed',
        outcome: `1 approval: ${early.body.reason ?? early.status}; 2 approvals: ${ok.status === 200 ? 'executed' : ok.body.reason}`,
        receipts: [p.txId, ok.body.txId].filter(Boolean).map((t, i) => ({ label: i ? 'warrant executed' : 'warrant proposed', txId: t!, links: txLinks(t!) })),
      };
    },
  },
  {
    title: 'Guardians open the case',
    narration: 'Guardians check every link to the public warrant before releasing shares. The regulator learns who flagged, and the release is logged.',
    run: async () => {
      if (!s.attKey) return { ok: false, expected: 'run steps 6 and 9 first', outcome: 'no warrant', receipts: [] };
      const d = await disclose(s.attKey);
      const who = d.flaggers.map((f) => f.institutionId).sort();
      return { ok: who.join() === 'bank-a,bank-c', expected: 'flagged by bank-a and bank-c (bank-b revoked)', outcome: `flagged by ${who.join(', ')}`, receipts: [], details: d };
    },
  },
  {
    title: 'Time passes: the flags expire',
    narration: 'Flags count for a limited number of epochs. After the epoch rolls past the TTL, the same check shows 0 fresh institutions.',
    run: async () => {
      const deadline = Date.now() + 240_000;
      let r = await bank('bank-e').check(s.account);
      while (r.distinctInstitutions > 0 && Date.now() < deadline) {
        await guardian(1).advanceEpoch();
        await new Promise((res) => setTimeout(res, 8_000));
        r = await bank('bank-e').check(s.account);
      }
      const st = await explorer<{ latest: { currentEpoch: number } | null }>('/stats');
      return { ok: r.distinctInstitutions === 0, expected: '0 fresh institutions', outcome: `${r.distinctInstitutions} fresh; ${r.skipped.expired} expired; epoch ${st?.latest?.currentEpoch}`, receipts: [] };
    },
  },
];
