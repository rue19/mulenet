'use client';
import { useState } from 'react';

type Proposal = { id: string; kind: number; kindName: string; payload: string; approvals: number; executed: boolean };
type Attestation = { attKey: string; epoch: number; k: number; typology: number };
type Disclosure = {
  identifier: string;
  attestingInstitution: string;
  attestingCaseRef: string;
  flaggers: { institutionId: string; caseRef: string; index: number }[];
  refused: { index: number; reason: string }[];
  error?: string;
};

const post = async (url: string, body: object = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

export function RegulatorPanel({ attestations, proposals, warrants, threshold }: { attestations: Attestation[]; proposals: Proposal[]; warrants: string[]; threshold: number }) {
  const [log, setLog] = useState<string[]>([]);
  const [opened, setOpened] = useState<Record<string, Disclosure>>({});
  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l]);
  const refresh = () => location.reload();

  return (
    <div className="stack">
      <h2>Attestations</h2>
      <table>
        <thead>
          <tr><th>attestation key</th><th>epoch</th><th>k</th><th>typology</th><th></th></tr>
        </thead>
        <tbody>
          {attestations.map((a) => (
            <tr key={a.attKey}>
              <td className="mono">{a.attKey.slice(0, 16)}…</td>
              <td>{a.epoch}</td><td>{a.k}</td><td>{a.typology}</td>
              <td>
                {warrants.includes(a.attKey) ? (
                  <button onClick={async () => {
                    const r = await post('/api/regulator/open', { attKey: a.attKey });
                    if (r.status === 200) setOpened((o) => ({ ...o, [a.attKey]: r.body }));
                    note(r.status === 200 ? `opened case for ${a.attKey.slice(0, 10)}…` : `refused: ${r.body.error}`);
                  }}>Open case (guardian shares)</button>
                ) : (
                  <button className="ghost" onClick={async () => {
                    const r = await post('/api/gov/1/propose', { kind: 4, payload: a.attKey });
                    note(r.status === 200 ? `warrant proposed (${r.body.proposalId.slice(0, 10)}…)` : `refused: ${r.body.reason ?? r.status}`);
                    refresh();
                  }}>Propose warrant</button>
                )}
              </td>
            </tr>
          ))}
          {attestations.length === 0 && <tr><td colSpan={5} className="muted">No attestations yet.</td></tr>}
        </tbody>
      </table>

      {Object.entries(opened).map(([k, d]) => (
        <div key={k} className="card stack">
          <strong>Case under warrant {k.slice(0, 12)}…</strong>
          <div>Account: <code>{d.identifier}</code></div>
          <div>Escalated by <strong>{d.attestingInstitution}</strong> (case {d.attestingCaseRef})</div>
          <div>Flagged by: {d.flaggers.map((f) => <span key={f.index} className="badge ok" style={{ marginRight: 6 }}>{f.institutionId} · {f.caseRef}</span>)}</div>
          {d.refused.length > 0 && <div className="muted">Guardians refused {d.refused.length} record(s): {d.refused.map((r) => r.reason).join('; ')}</div>}
        </div>
      ))}

      <h2>Governance proposals</h2>
      <table>
        <thead><tr><th>proposal</th><th>kind</th><th>approvals</th><th>approve as</th><th></th></tr></thead>
        <tbody>
          {proposals.map((p) => (
            <tr key={p.id}>
              <td className="mono">{p.id.slice(0, 12)}…</td>
              <td>{p.kindName}</td>
              <td><strong>{p.approvals} / {threshold}</strong></td>
              <td className="row">
                {[1, 2, 3].map((g) => (
                  <button key={g} className="ghost" disabled={p.executed} onClick={async () => {
                    const r = await post(`/api/gov/${g}/approve`, { id: p.id });
                    note(r.status === 200 ? `guardian ${g} approved` : `guardian ${g}: ${r.body.reason ?? r.status}`);
                    refresh();
                  }}>G{g}</button>
                ))}
              </td>
              <td>
                {p.executed ? <span className="badge ok">executed</span> : (
                  <button disabled={p.approvals < threshold} title={p.approvals < threshold ? 'needs quorum' : ''} onClick={async () => {
                    const r = await post('/api/gov/1/execute', { id: p.id });
                    note(r.status === 200 ? 'executed' : `refused on-chain: ${r.body.reason ?? r.status}`);
                    refresh();
                  }}>Execute</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {log.length > 0 && (
        <div className="card mono stack">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
      )}
    </div>
  );
}
