import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  verifyVpayWebhookSignature,
  parseAndValidateVpayWebhook,
  createVpayOrder,
  getVpayOrderStatus,
  clearVpayTokenCache,
} from '../src/lib/vpay';
import {
  processVpayWebhook,
  StoredOrderRecord,
  VpayWebhookAuditEntry,
  VpayWebhookStore,
} from '../src/lib/vpayWebhookHandler';
import {
  calculateServerCheckoutPricing,
  PricingValidationError,
} from '../src/lib/vpayPricing';

const TEST_SECRET = 'whsec_test_vpay_secret_key_123456';

function signRawBytes(rawBody: Buffer, secret: string = TEST_SECRET): string {
  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hex}`;
}

function createInMemoryStore(initialOrders: StoredOrderRecord[] = []) {
  const orders = new Map<string, StoredOrderRecord>(
    initialOrders.map((o) => [o.id, { ...o }])
  );
  const deliveries = new Set<string>();
  const auditLogs: VpayWebhookAuditEntry[] = [];

  const store: VpayWebhookStore = {
    async findOrderByVpayOrReference(vpayOrderId: string, sourceId?: string) {
      for (const order of Array.from(orders.values())) {
        if (order.vpayOrderId === vpayOrderId) return { ...order };
        if (sourceId && (order.reference === sourceId || order.id === sourceId)) {
          return { ...order };
        }
      }
      return null;
    },

    async hasProcessedDelivery(deliveryId: string) {
      return deliveries.has(deliveryId);
    },

    async confirmOrderAndRecordEvent(confirm, audit) {
      if (deliveries.has(confirm.deliveryId)) {
        return { transitioned: false, duplicateDelivery: true, order: null };
      }

      const existing = orders.get(confirm.orderId);
      if (!existing) {
        return { transitioned: false, duplicateDelivery: false, order: null };
      }

      deliveries.add(confirm.deliveryId);
      auditLogs.push(audit);

      if (existing.status === 'completed') {
        return { transitioned: false, duplicateDelivery: false, order: { ...existing } };
      }

      const updated: StoredOrderRecord = {
        ...existing,
        status: 'completed',
        paymentMethod: 'vpay',
        vpayOrderId: confirm.vpayOrderId,
      };
      orders.set(existing.id, updated);
      return { transitioned: true, duplicateDelivery: false, order: { ...updated } };
    },

    async recordRejectedOrIgnoredEvent(audit) {
      auditLogs.push(audit);
    },
  };

  return { store, orders, deliveries, auditLogs };
}

function buildValidHeaders(
  rawBody: Buffer,
  overrides: Record<string, string | undefined> = {},
  secret: string = TEST_SECRET
): Record<string, string | undefined> {
  return {
    'content-type': 'application/json',
    'x-voidpay-event': 'payment.confirmed',
    'x-voidpay-delivery': 'deliv_001',
    'x-voidpay-timestamp': '2026-11-24T12:00:00.000Z',
    'x-voidpay-signature': signRawBytes(rawBody, secret),
    ...overrides,
  };
}

test('1. Assinatura válida (HMAC-SHA256 sobre bytes exatos) confirma ordem pendente e executa efeito uma vez', async () => {
  const { store, orders, auditLogs } = createInMemoryStore([
    {
      id: 'ORD-1001',
      reference: 'VPAY_REF_1001',
      vpayOrderId: 'ord_vpay_1001',
      clientName: 'João Silva',
      clientEmail: 'joao@exemplo.co.mz',
      serviceName: 'Profissional (1 Mês)',
      amount: 2500,
      currency: 'MZN',
      status: 'pending',
    },
  ]);

  const rawBody = Buffer.from(
    JSON.stringify({
      event: 'payment.confirmed',
      orderId: 'ord_vpay_1001',
      status: 'paid',
      amount: 2500,
      currency: 'MZN',
      timestamp: '2026-11-24T12:00:00.000Z',
      transactionId: 'txn_9001',
      source: 'api',
      sourceId: 'VPAY_REF_1001',
    }),
    'utf8'
  );

  let fulfilledCount = 0;
  const res = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody),
    TEST_SECRET,
    store,
    async () => {
      fulfilledCount += 1;
    }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'completed');
  assert.equal(orders.get('ORD-1001')?.status, 'completed');
  assert.equal(fulfilledCount, 1);
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].processed, true);
});

test('2. Assinatura inválida, ausente ou segredo não configurado é rejeitada com 401 sem alterar ordem', async () => {
  const { store, orders } = createInMemoryStore([
    {
      id: 'ORD-1002',
      vpayOrderId: 'ord_vpay_1002',
      clientName: 'Ana',
      clientEmail: 'ana@exemplo.co.mz',
      serviceName: 'Básico (1 Mês)',
      amount: 550,
      currency: 'MZN',
      status: 'pending',
    },
  ]);

  const rawBody = Buffer.from(
    JSON.stringify({
      event: 'payment.confirmed',
      orderId: 'ord_vpay_1002',
      status: 'paid',
      amount: 550,
      currency: 'MZN',
    }),
    'utf8'
  );

  // Assinatura errada
  const badSig = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-signature': `sha256=${'a'.repeat(64)}` }),
    TEST_SECRET,
    store
  );
  assert.equal(badSig.status, 401);

  // Assinatura ausente
  const missingSig = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-signature': undefined }),
    TEST_SECRET,
    store
  );
  assert.equal(missingSig.status, 401);

  // Segredo ausente (fail-closed)
  const missingSecret = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody),
    '',
    store
  );
  assert.equal(missingSecret.status, 401);
  assert.equal(orders.get('ORD-1002')?.status, 'pending');
});

test('3. Validação usa os bytes exatos do corpo original (espaços e UTF-8 multibyte preservados)', async () => {
  const { store, orders } = createInMemoryStore([
    {
      id: 'ORD-1003',
      vpayOrderId: 'ord_vpay_1003',
      clientName: 'João Moçambique',
      clientEmail: 'joao@mz.co.mz',
      serviceName: 'Básico (1 Mês)',
      amount: 550,
      currency: 'MZN',
      status: 'pending',
    },
  ]);

  // Corpo original formatado com espaços/quebras de linha e UTF-8 multibyte (diferente de JSON.stringify minificado)
  const prettyBodyString =
    '{\n  "event": "payment.confirmed",\n  "orderId": "ord_vpay_1003",\n  "status": "paid",\n  "amount": 550,\n  "currency": "MZN",\n  "customer": { "name": "João Moçambique" }\n}';
  const rawBody = Buffer.from(prettyBodyString, 'utf8');

  // Assinatura calculada sobre a versão minificada NÃO deve validar o corpo pretty original
  const minifiedBytes = Buffer.from(JSON.stringify(JSON.parse(prettyBodyString)), 'utf8');
  assert.equal(
    verifyVpayWebhookSignature(rawBody, signRawBytes(minifiedBytes), TEST_SECRET),
    false
  );

  // Assinatura sobre os bytes exatos do corpo original DEVE validar e confirmar a ordem
  const res = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-delivery': 'deliv_raw_bytes_001' }),
    TEST_SECRET,
    store
  );
  assert.equal(res.status, 200);
  assert.equal(orders.get('ORD-1003')?.status, 'completed');
});

test('4. Divergência de montante é rejeitada com 422 e mantém ordem pendente', async () => {
  const { store, orders } = createInMemoryStore([
    {
      id: 'ORD-1004',
      vpayOrderId: 'ord_vpay_1004',
      clientName: 'Carlos',
      clientEmail: 'carlos@exemplo.co.mz',
      serviceName: 'Profissional (1 Mês)',
      amount: 2500,
      currency: 'MZN',
      status: 'pending',
    },
  ]);

  const rawBody = Buffer.from(
    JSON.stringify({
      event: 'payment.confirmed',
      orderId: 'ord_vpay_1004',
      status: 'paid',
      amount: 100, // Divergente (esperado 2500)
      currency: 'MZN',
    }),
    'utf8'
  );

  let fulfilled = false;
  const res = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-delivery': 'deliv_amt_mismatch' }),
    TEST_SECRET,
    store,
    async () => {
      fulfilled = true;
    }
  );

  assert.equal(res.status, 422);
  assert.equal(orders.get('ORD-1004')?.status, 'pending');
  assert.equal(fulfilled, false);
});

test('5. Divergência de moeda é rejeitada com 422 e mantém ordem pendente', async () => {
  const { store, orders } = createInMemoryStore([
    {
      id: 'ORD-1005',
      vpayOrderId: 'ord_vpay_1005',
      clientName: 'Maria',
      clientEmail: 'maria@exemplo.co.mz',
      serviceName: 'Profissional (1 Mês)',
      amount: 2500,
      currency: 'MZN',
      status: 'pending',
    },
  ]);

  const rawBody = Buffer.from(
    JSON.stringify({
      event: 'payment.confirmed',
      orderId: 'ord_vpay_1005',
      status: 'paid',
      amount: 2500,
      currency: 'USD', // Divergente (esperado MZN)
    }),
    'utf8'
  );

  const res = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-delivery': 'deliv_curr_mismatch' }),
    TEST_SECRET,
    store
  );

  assert.equal(res.status, 422);
  assert.equal(orders.get('ORD-1005')?.status, 'pending');
});

test('6. Ordem inexistente retorna 404 sem criar registo fantasma', async () => {
  const { store, orders } = createInMemoryStore([]);

  const rawBody = Buffer.from(
    JSON.stringify({
      event: 'payment.confirmed',
      orderId: 'ord_nao_existe',
      status: 'paid',
      amount: 550,
      currency: 'MZN',
    }),
    'utf8'
  );

  const res = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-delivery': 'deliv_missing_order' }),
    TEST_SECRET,
    store
  );

  assert.equal(res.status, 404);
  assert.equal(orders.size, 0);
});

test('7. Entrega duplicada (mesmo deliveryId ou mesma ordem já paga) é idempotente e não duplica efeitos', async () => {
  const { store, orders } = createInMemoryStore([
    {
      id: 'ORD-1007',
      vpayOrderId: 'ord_vpay_1007',
      clientName: 'Pedro',
      clientEmail: 'pedro@exemplo.co.mz',
      serviceName: 'Empresarial (1 Mês)',
      amount: 6200,
      currency: 'MZN',
      status: 'pending',
    },
  ]);

  const rawBody = Buffer.from(
    JSON.stringify({
      event: 'payment.confirmed',
      orderId: 'ord_vpay_1007',
      status: 'paid',
      amount: 6200,
      currency: 'MZN',
      transactionId: 'txn_1007',
    }),
    'utf8'
  );

  let fulfillCalls = 0;
  const first = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-delivery': 'deliv_dup_001' }),
    TEST_SECRET,
    store,
    async () => {
      fulfillCalls += 1;
    }
  );
  assert.equal(first.status, 200);
  assert.equal(fulfillCalls, 1);

  // Repetição exata com o mesmo X-Voidpay-Delivery
  const retrySameDelivery = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-delivery': 'deliv_dup_001' }),
    TEST_SECRET,
    store,
    async () => {
      fulfillCalls += 1;
    }
  );
  assert.equal(retrySameDelivery.status, 200);
  assert.equal(retrySameDelivery.body.duplicate, true);
  assert.equal(fulfillCalls, 1);

  // Novo X-Voidpay-Delivery para a mesma ordem já paga
  const secondDeliverySameOrder = await processVpayWebhook(
    rawBody,
    buildValidHeaders(rawBody, { 'x-voidpay-delivery': 'deliv_dup_002' }),
    TEST_SECRET,
    store,
    async () => {
      fulfillCalls += 1;
    }
  );
  assert.equal(secondDeliverySameOrder.status, 200);
  assert.equal(secondDeliverySameOrder.body.duplicate, true);
  assert.equal(fulfillCalls, 1);
  assert.equal(orders.get('ORD-1007')?.status, 'completed');
});

test('8. Evento diferente de payment.confirmed ou cabeçalhos inválidos seguem o contrato oficial', async () => {
  const { store, orders } = createInMemoryStore([
    {
      id: 'ORD-1008',
      vpayOrderId: 'ord_vpay_1008',
      clientName: 'Sofia',
      clientEmail: 'sofia@exemplo.co.mz',
      serviceName: 'Básico (1 Mês)',
      amount: 550,
      currency: 'MZN',
      status: 'pending',
    },
  ]);

  const otherEventBody = Buffer.from(
    JSON.stringify({
      event: 'payment.pending',
      orderId: 'ord_vpay_1008',
      status: 'pending',
      amount: 550,
      currency: 'MZN',
    }),
    'utf8'
  );

  const ignored = await processVpayWebhook(
    otherEventBody,
    buildValidHeaders(otherEventBody, {
      'x-voidpay-event': 'payment.pending',
      'x-voidpay-delivery': 'deliv_ignore_001',
    }),
    TEST_SECRET,
    store
  );
  assert.equal(ignored.status, 200);
  assert.equal(ignored.body.ignored, true);
  assert.equal(orders.get('ORD-1008')?.status, 'pending');

  // Header X-Voidpay-Delivery ausente -> 400
  const missingDelivery = parseAndValidateVpayWebhook(
    otherEventBody,
    buildValidHeaders(otherEventBody, {
      'x-voidpay-event': 'payment.pending',
      'x-voidpay-delivery': undefined,
    }),
    TEST_SECRET
  );
  assert.equal(missingDelivery.ok, false);
  if (!missingDelivery.ok) assert.equal(missingDelivery.status, 400);
});

test('9. Cálculo de preços no servidor ignora valores falsos e valida catálogo/moeda', async () => {
  // Plano Profissional 3 meses (2500 * 3 * 0.95 = 7125) + domínio .co.mz (3000) = 10125 MZN
  const pricing = await calculateServerCheckoutPricing({
    planId: 'pro',
    durationMonths: 3,
    domain: 'minhaloja.co.mz',
  });
  assert.equal(pricing.currency, 'MZN');
  assert.equal(pricing.totalMzn, 10125);

  // Plano inválido deve lançar PricingValidationError
  await assert.rejects(
    () => calculateServerCheckoutPricing({ planId: 'plano_inexistente', durationMonths: 1 }),
    PricingValidationError
  );
});

test('10. Cliente VPay autentica, cria ordem com shipping desativado e consulta status por mock fetch', async () => {
  clearVpayTokenCache();
  const calls: Array<{ url: string; method: string; body?: any }> = [];

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (url.endsWith('/v1/auth/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'tok_test_123',
          refresh_token: 'ref_test_123',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/v1/orders')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'ord_vpay_mock_1',
            checkoutUrl: 'https://checkout.vpay.co.mz/pay/ord_vpay_mock_1',
            status: 'pending',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/v1/orders/ord_vpay_mock_1/status')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            orderId: 'ord_vpay_mock_1',
            status: 'paid',
            amount: 2500,
            transactionId: 'txn_mock_1',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  const cfg = {
    baseUrl: 'https://api.vpay.co.mz',
    clientId: 'app_8792a492ed599bc467db57d6679ff7e9',
    clientSecret: 'secret_test_only',
    webhookSecret: TEST_SECRET,
    environment: 'development',
  };

  const created = await createVpayOrder(
    {
      customer: { name: 'Cliente Teste', email: 'cliente@exemplo.co.mz' },
      items: [{ originProductId: 'HOSTING_pro_1M', name: 'Profissional', quantity: 1, price: 2500 }],
      successUrl: 'https://www.wehosthere.com/checkout?vpay_order_ref=VPAY_1&vpay_status=return',
      cancelUrl: 'https://www.wehosthere.com/checkout?vpay_order_ref=VPAY_1&vpay_status=cancelled',
      reference: 'VPAY_1',
    },
    cfg,
    mockFetch
  );

  assert.equal(created.vpayOrderId, 'ord_vpay_mock_1');
  assert.equal(created.checkoutUrl, 'https://checkout.vpay.co.mz/pay/ord_vpay_mock_1');

  const statusRes = await getVpayOrderStatus('ord_vpay_mock_1', cfg, mockFetch);
  assert.equal(statusRes.status, 'paid');
  assert.equal(statusRes.amount, 2500);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.shippingAddressDisabled, true);
  assert.equal(calls[1].body.deliveryInfoDisabled, true);
});
