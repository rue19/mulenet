// SPDX-License-Identifier: Apache-2.0
'use client';
import { useState } from 'react';

type Result = { query: string; canonical?: string; hits: { needle: string; source: string; offset: number }[]; searchedBytes: number; documents: number; needles: string[]; error?: string };

export function XrayForm() {
  const [q, setQ] = useState('acct:v1:IN:HDFC0001234:50100123456789');
  const [r, setR] = useState<Result | null>(null);
  return (
    <div className="stack">
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        setR(await (await fetch(`/api/xray?q=${encodeURIComponent(q)}`)).json());
      }}>
        <input className="wide" value={q} onChange={(e) => setQ(e.target.value)} placeholder="account number, UPI VPA, or any hex value" />
        <button type="submit">Search everything public</button>
      </form>
      {r && (r.error ? <span className="badge bad">{r.error}</span> : (
        <div className="card stack">
          <div className="stat">
            <div className={`n ${r.hits.length === 0 ? 'ok' : 'bad'}`}>{r.hits.length} hits</div>
            <div className="l">searched {r.searchedBytes.toLocaleString()} bytes across {r.documents} public documents (every transaction and every contract state)</div>
          </div>
          {r.canonical && <div>normalised as <code>{r.canonical}</code></div>}
          <div className="muted">encodings tried: {r.needles.join(', ')}</div>
          {r.hits.length > 0 && <ul>{r.hits.slice(0, 20).map((h, i) => <li key={i} className="mono">{h.needle} in {h.source} @ {h.offset}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}
