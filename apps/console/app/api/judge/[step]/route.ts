// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { STEPS, judgeState, resetJudge } from '@/lib/judge';

export const maxDuration = 600;

export async function POST(_req: Request, ctx: { params: Promise<{ step: string }> }) {
  const { step } = await ctx.params;
  if (step === 'reset') return NextResponse.json(resetJudge());
  const s = STEPS[Number(step) - 1];
  if (!s) return NextResponse.json({ error: 'no such step' }, { status: 404 });
  const t0 = Date.now();
  try {
    return NextResponse.json({ ...(await s.run()), ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ ok: false, expected: '', outcome: e instanceof Error ? e.message : String(e), receipts: [], ms: Date.now() - t0 });
  }
}

export async function GET() {
  return NextResponse.json({ ...judgeState(), steps: STEPS.map((s) => ({ title: s.title, narration: s.narration })) });
}
