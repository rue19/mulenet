// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link';
import { bankIds, deployment, explorer } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Stats = { latest: Record<string, number | string> | null; epochs: { epoch: number; flags: number; revocations: number; attestations: number }[] };

export default async function Home() {
  const stats = await explorer<Stats>('/stats');
  const l = stats?.latest;
  const tiles: [string, unknown][] = [
    ['flags', l?.flagCount],
    ['revocations', l?.revocationCount],
    ['attestations', l?.attestationCount],
    ['current epoch', l?.currentEpoch],
    ['corroboration k', l?.corroborationK],
    ['guardian threshold', l ? `${l.guardianThreshold} of 3` : undefined],
  ];
  return (
    <div className="stack">
      <h1>Prove an account is flagged by enough banks, without any bank learning who else flagged it.</h1>
      <p className="lede">
        MuleNet lets member institutions ask &ldquo;have at least k independent institutions flagged this account as a mule?&rdquo;.
        Account numbers never appear on-chain, flaggers stay anonymous, and nobody can inflate the count. Identities are recoverable
        only under a 2-of-3 guardian warrant that is logged publicly.
      </p>
      <div className="grid">
        {tiles.map(([label, v]) => (
          <div key={label} className="card stat">
            <div className="n">{v === undefined ? '—' : String(v)}</div>
            <div className="l">{label}</div>
          </div>
        ))}
      </div>
      {!stats && <p className="bad">Explorer unavailable: start services/explorer.</p>}
      <h2>Where to go</h2>
      <div className="grid">
        <Link className="card" href="/judge">Judge mode — the 11-step demo, one button each</Link>
        <Link className="card" href="/xray">Privacy X-ray — search every public byte</Link>
        <Link className="card" href="/regulator">Regulator — warrants and disclosure</Link>
        <Link className="card" href="/transparency">Transparency — what anyone can audit</Link>
      </div>
      <h2>Member banks</h2>
      <div className="row">
        {bankIds().map((b) => (
          <Link key={b} href={`/bank/${b}`} className="card">
            {b}
          </Link>
        ))}
      </div>
      <p className="muted mono">contract {deployment().contractAddress}</p>
    </div>
  );
}
