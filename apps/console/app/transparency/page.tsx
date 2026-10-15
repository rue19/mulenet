import { consortium, explorer } from '@/lib/server';

export const dynamic = 'force-dynamic';

const guardianLog = async (url: string) => {
  try {
    return (await (await fetch(`${url}/v1/log`, { cache: 'no-store' })).json()) as { seq: number; at: string; attKey: string; kind: string; count: number }[];
  } catch {
    return null;
  }
};

export default async function Transparency() {
  const [stats, proposals, warrants] = await Promise.all([
    explorer<{ epochs: { epoch: number; startedHeight: number; flags: number; revocations: number; attestations: number }[] }>('/stats'),
    explorer<{ id: string; kindName: string; approvals: number; executed: boolean; lastTx: string }[]>('/proposals'),
    explorer<{ attKey: string; epoch: number; txHash: string; height: number }[]>('/warrants'),
  ]);
  const logs = await Promise.all(consortium().guardians.members.map(async (g) => ({ index: g.index, log: await guardianLog(g.url) })));
  return (
    <div className="stack">
      <h1>Transparency</h1>
      <p className="lede">Everything here is public. It shows how much is happening, never about whom: no account, institution or pseudonym appears.</p>
      <h2>Per epoch</h2>
      <table>
        <thead><tr><th>epoch</th><th>from block</th><th>flags</th><th>revocations</th><th>attestations</th></tr></thead>
        <tbody>{(stats?.epochs ?? []).map((e) => <tr key={e.epoch}><td>{e.epoch}</td><td>{e.startedHeight}</td><td>{e.flags}</td><td>{e.revocations}</td><td>{e.attestations}</td></tr>)}</tbody>
      </table>
      <h2>Warrant log</h2>
      <table>
        <thead><tr><th>attestation</th><th>authorised in epoch</th><th>block</th></tr></thead>
        <tbody>
          {(warrants ?? []).map((w) => <tr key={w.attKey}><td className="mono">{w.attKey.slice(0, 16)}…</td><td>{w.epoch}</td><td>{w.height}</td></tr>)}
          {(warrants ?? []).length === 0 && <tr><td colSpan={3} className="muted">No warrants: no identity has been disclosed.</td></tr>}
        </tbody>
      </table>
      <h2>Governance</h2>
      <table>
        <thead><tr><th>proposal</th><th>kind</th><th>approvals</th><th>status</th></tr></thead>
        <tbody>{(proposals ?? []).map((p) => <tr key={p.id}><td className="mono">{p.id.slice(0, 12)}…</td><td>{p.kindName}</td><td>{p.approvals}</td><td>{p.executed ? 'executed' : 'open'}</td></tr>)}</tbody>
      </table>
      <h2>Guardian share releases</h2>
      {logs.map((g) => (
        <div key={g.index} className="card">
          <strong>Guardian {g.index}</strong>{' '}
          {g.log === null ? <span className="muted">unreachable</span> : g.log.length === 0 ? <span className="muted">no releases</span> : (
            <ul>{g.log.map((e) => <li key={e.seq} className="mono">{e.at} · {e.kind} ×{e.count} · {e.attKey.slice(0, 12)}…</li>)}</ul>
          )}
        </div>
      ))}
    </div>
  );
}
