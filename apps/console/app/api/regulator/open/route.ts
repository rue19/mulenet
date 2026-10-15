import { NextResponse } from 'next/server';
import { disclose } from '@/lib/disclose';

export async function POST(req: Request) {
  const { attKey } = (await req.json()) as { attKey: string };
  try {
    return NextResponse.json(await disclose(attKey));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
