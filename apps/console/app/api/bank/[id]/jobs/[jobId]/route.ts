import { NextResponse } from 'next/server';
import { bank, txLinks } from '@/lib/server';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await ctx.params;
  const { body } = await bank(id).call<{ txId?: string }>('GET', `/v1/jobs/${jobId}`);
  return NextResponse.json({ ...body, links: body.txId ? txLinks(body.txId) : [] });
}
