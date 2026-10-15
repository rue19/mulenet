import { NextResponse } from 'next/server';
import { explorer } from '@/lib/server';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const r = await explorer(`/xray?q=${encodeURIComponent(q)}`);
  return r ? NextResponse.json(r) : NextResponse.json({ error: 'explorer unavailable' }, { status: 503 });
}
