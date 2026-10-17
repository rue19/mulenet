// SPDX-License-Identifier: Apache-2.0
import { explorer } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function State() {
  const s = await explorer<object>('/state');
  return (
    <div className="stack">
      <h1>On-chain state</h1>
      <p className="lede">The contract&apos;s complete public state after the latest transaction, decoded. This is all an observer can see.</p>
      <pre className="card mono" style={{ overflowX: 'auto' }}>{JSON.stringify(s, null, 2)}</pre>
    </div>
  );
}
