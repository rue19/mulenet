import { Judge } from '@/components/Judge';

export const dynamic = 'force-dynamic';

export default function JudgePage() {
  return (
    <div className="stack">
      <h1>Judge mode</h1>
      <p className="lede">
        Eleven steps, one button each, against live services on {process.env.MULENET_NETWORK ?? 'undeployed'}. No wallet, no faucet, no DUST:
        banks prove on their own nodes and the consortium sponsor pays. Red “refused” badges are the security properties at work.
      </p>
      <Judge />
    </div>
  );
}
