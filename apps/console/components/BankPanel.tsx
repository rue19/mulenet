'use client';
import { useState } from 'react';
import { JobTracker } from './JobTracker';

type Check = {
  distinctInstitutions: number;
  flags: { epoch: number; typology: number; fresh: boolean }[];
  skipped: { revoked: number; expired: number; notOnChain: number };
  attestation: { k: number; epoch: number; typology: number } | null;
  timings: { oprfMs: number; relayMs: number; verifyMs: number };
  error?: string;
};
const TYPOLOGIES: Record<number, string> = { 1: 'mule — receiving', 2: 'mule — pass-through', 3: 'account takeover', 4: 'other' };
const post = async (url: string, body: object) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

export function BankPanel({ bank }: { bank: string }) {
  const [identifier, setIdentifier] = useState('acct:v1:IN:HDFC0001234:50100123456789');
  const [typology, setTypology] = useState(1);
  const [check, setCheck] = useState<Check | null>(null);
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([]);
  const [flagIndex, setFlagIndex] = useState('');

  const run = async (label: string, action: string, extra: object = {}) => {
    const r = await post(`/api/bank/${bank}/${action}`, { identifier, typology, ...extra });
    if (r.jobId) setJobs((j) => [{ id: r.jobId, label }, ...j]);
  };

  return (
    <div className="stack">
      <div className="card stack">
        <label className="muted">Account (mulenet-id/v1, or a loose form such as <code>HDFC0001234:50100123456789</code> or a UPI VPA)</label>
        <div className="row">
          <input className="wide" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          <select value={typology} onChange={(e) => setTypology(Number(e.target.value))}>
            {Object.entries(TYPOLOGIES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button onClick={async () => setCheck(await post(`/api/bank/${bank}/check`, { identifier, typology }))}>Check (free, no transaction)</button>
          <button className="ghost" onClick={() => run('flag', 'flag')}>Flag</button>
          <button className="ghost" onClick={() => run('attest k=2', 'attest', { k: 2 })}>Attest k=2</button>
          <button className="ghost" onClick={() => run('attest k=3', 'attest', { k: 3 })}>Attest k=3</button>
        </div>
        <div className="row">
          <input placeholder="own flag index" value={flagIndex} onChange={(e) => setFlagIndex(e.target.value)} style={{ width: 140 }} />
          <button className="ghost" disabled={flagIndex === ''} onClick={() => run(`revoke #${flagIndex}`, 'revoke', { flagIndex: Number(flagIndex) })}>
            Revoke own flag
          </button>
        </div>
      </div>

      {check && (
        <div className="card stack">
          {check.error ? (
            <span className="badge bad">{check.error}</span>
          ) : (
            <>
              <div className="stat">
                <div className="n">{check.distinctInstitutions}</div>
                <div className="l">independent institutions flagged this account (fresh, unrevoked, on-chain)</div>
              </div>
              <div>{check.attestation ? <span className="badge ok">attested k={check.attestation.k} in epoch {check.attestation.epoch}</span> : <span className="muted">no attestation this epoch</span>}</div>
              <div className="muted">
                skipped: {check.skipped.revoked} revoked · {check.skipped.expired} expired · {check.skipped.notOnChain} not on chain
              </div>
              <div className="muted">
                OPRF {check.timings.oprfMs} ms · relay {check.timings.relayMs} ms · on-chain verification {check.timings.verifyMs} ms
              </div>
              <div className="muted">The check never learns which institutions flagged, only how many.</div>
            </>
          )}
        </div>
      )}

      {jobs.map((j) => (
        <div key={j.id} className="stack">
          <strong>{j.label}</strong>
          <JobTracker bank={bank} jobId={j.id} />
        </div>
      ))}
    </div>
  );
}
