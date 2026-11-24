import { NextRequest, NextResponse } from 'next/server';
import { getVpayConfig } from '@/lib/vpay';
import { processVpayWebhook } from '@/lib/vpayWebhookHandler';
import {
  createMongoVpayWebhookStore,
  triggerVpayOrderFulfillment,
} from '@/lib/vpayMongoStore';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let rawBody: Buffer;
  try {
    const ab = await req.arrayBuffer();
    rawBody = Buffer.from(ab);
  } catch {
    return NextResponse.json(
      { success: false, error: 'Erro ao ler o corpo bruto da requisição.' },
      { status: 400 }
    );
  }

  const { webhookSecret } = getVpayConfig();
  const store = createMongoVpayWebhookStore();

  const result = await processVpayWebhook(
    rawBody,
    req.headers,
    webhookSecret,
    store,
    triggerVpayOrderFulfillment
  );

  return NextResponse.json(result.body, { status: result.status });
}
