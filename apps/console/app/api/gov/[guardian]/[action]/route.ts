import { NextResponse } from 'next/server';
import { guardian } from '@/lib/server';

// Governance as a guardian's operator: propose, approve, execute, or ask the keeper to roll the epoch.
export async function POST(req: Request, ctx: { params: Promise<{ guardian: string; action: string }> }) {
  const { guardian: g, action } = await ctx.params;
  const op = guardian(Number(g));
  const body = (await req.json().catch(() => ({}))) as { kind?: number; payload?: string; id?: string; value?: number };
  const r =
    action === 'propose'
      ? await op.propose(Number(body.kind), String(body.payload))
      : action === 'approve'
        ? await op.approve(String(body.id))
        : action === 'execute'
          ? await op.execute(String(body.id), body.value ?? 0)
          : action === 'advance-epoch'
            ? await op.advanceEpoch()
            : { status: 404, body: { error: 'unknown action' } };
  return NextResponse.json(r.body, { status: r.status });
}
