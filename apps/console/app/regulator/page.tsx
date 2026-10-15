import { RegulatorPanel } from '@/components/RegulatorPanel';
import { explorer } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Regulator() {
  const [attestations, proposals, warrants, stats] = await Promise.all([
    explorer<{ attKey: string; epoch: number; k: number; typology: number }[]>('/attestations'),
    explorer<{ id: string; kind: number; kindName: string; payload: string; approvals: number; executed: boolean }[]>('/proposals'),
    explorer<{ attKey: string }[]>('/warrants'),
    explorer<{ latest: { guardianThreshold: number } | null }>('/stats'),
  ]);
  return (
    <div className="stack">
      <h1>Regulator</h1>
      <p className="lede">
        A warrant needs {stats?.latest?.guardianThreshold ?? 2} of 3 guardian approvals, recorded on-chain. Only then do guardians release
        decryption shares, and only for ciphertexts they can tie to that warrant themselves. Every release is logged publicly.
      </p>
      <RegulatorPanel
        attestations={attestations ?? []}
        proposals={(proposals ?? []).filter((p) => p.kind === 4).reverse()}
        warrants={(warrants ?? []).map((w) => w.attKey)}
        threshold={stats?.latest?.guardianThreshold ?? 2}
      />
    </div>
  );
}
