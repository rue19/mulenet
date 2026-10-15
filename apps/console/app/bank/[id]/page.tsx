import Link from 'next/link';
import { BankPanel } from '@/components/BankPanel';
import { bankIds } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function BankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="stack">
      <h1>Analyst console — {id}</h1>
      <p className="lede">
        Checks are free and private: no transaction, and nobody learns which bank asked. Flags, attestations and revocations are
        proven on this bank&apos;s own node and paid for by the consortium sponsor, so the bank holds no tokens.
      </p>
      <div className="row">
        {bankIds().map((b) => (
          <Link key={b} href={`/bank/${b}`} className={b === id ? '' : 'muted'}>
            {b}
          </Link>
        ))}
      </div>
      <BankPanel bank={id} />
    </div>
  );
}
