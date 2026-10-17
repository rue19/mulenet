// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { bank } from '@/lib/server';

// Bank analyst actions. The bank node does the work (OPRF, proving, sponsorship); this route only
// signs the request as that bank's internal system.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  const b = bank(id);
  const body = (await req.json()) as Record<string, unknown>;
  const idem = crypto.randomUUID();
  switch (action) {
    case 'check':
      return NextResponse.json((await b.call('POST', '/v1/check', { identifier: body.identifier, typology: body.typology })).body);
    case 'flag':
      return NextResponse.json((await b.call('POST', '/v1/flags', { identifier: body.identifier, typology: Number(body.typology ?? 1), caseRef: body.caseRef ?? 'FRM-DEMO', idempotencyKey: idem })).body);
    case 'attest':
      return NextResponse.json(
        (await b.call('POST', '/v1/attest', { identifier: body.identifier, typology: Number(body.typology ?? 1), caseRef: body.caseRef ?? 'STR-DEMO', k: Number(body.k ?? 3), demoHook: body.demoHook, idempotencyKey: idem })).body,
      );
    case 'revoke':
      return NextResponse.json((await b.call('POST', `/v1/flags/${Number(body.flagIndex)}/revoke`, { identifier: body.identifier, idempotencyKey: idem })).body);
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 404 });
  }
}
