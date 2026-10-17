// SPDX-License-Identifier: Apache-2.0
'use client';
import { useEffect, useState } from 'react';

type Step = { title: string; narration: string };
type Result = { ok: boolean; expected: string; outcome: string; ms: number; receipts: { label: string; txId: string; links: { label: string; href: string }[] }[] };

export function Judge() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [account, setAccount] = useState('');
  const [results, setResults] = useState<Record<number, Result>>({});
  const [running, setRunning] = useState<number | null>(null);

  const load = async () => {
    const s = await (await fetch('/api/judge/state')).json();
    setSteps(s.steps);
    setAccount(s.account);
  };
  useEffect(() => {
    void load();
  }, []);

  const run = async (i: number) => {
    setRunning(i);
    const r = (await (await fetch(`/api/judge/${i}`, { method: 'POST' })).json()) as Result;
    setResults((x) => ({ ...x, [i]: r }));
    setRunning(null);
  };

  return (
    <div className="stack">
      <div className="card row">
        <span>Demo account: <code>{account}</code></span>
        <button className="ghost" style={{ marginLeft: 'auto' }} onClick={async () => {
          const r = await (await fetch('/api/judge/reset', { method: 'POST' })).json();
          setAccount(r.account);
          setResults({});
        }}>Reset with a fresh account</button>
      </div>
      {steps.map((s, idx) => {
        const i = idx + 1;
        const r = results[i];
        return (
          <div key={i} className="card stack">
            <div className="row">
              <strong>{i}. {s.title}</strong>
              <button style={{ marginLeft: 'auto' }} disabled={running !== null} onClick={() => run(i)}>
                {running === i ? 'running…' : r ? 'Run again' : 'Run'}
              </button>
            </div>
            <div className="muted">{s.narration}</div>
            {r && (
              <div className="stack">
                <div>
                  <span className={`badge ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? (r.expected.startsWith('refused') ? 'refused as designed' : 'as expected') : 'unexpected'}</span>{' '}
                  {r.outcome} <span className="muted">({(r.ms / 1000).toFixed(1)} s)</span>
                </div>
                <div className="muted">expected: {r.expected}</div>
                {r.receipts.map((rc) => (
                  <div key={rc.txId} className="mono">
                    {rc.label}: {rc.txId.slice(0, 18)}… {rc.links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer"> {l.label} ↗</a>)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
