import {
  parseAndValidateVpayWebhook,
  VpayConfirmedEventPayload,
  WebhookHeaderMap,
} from './vpay';

export interface StoredOrderRecord {
  id: string;
  reference?: string;
  vpayOrderId?: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  serviceName: string;
  amount: number;
  currency?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'suspended';
  paymentMethod?: string;
  metadata?: Record<string, any>;
}

export interface VpayWebhookAuditEntry {
  eventId: string;
  eventType: string;
  provider: 'vpay';
  deliveryId: string;
  vpayOrderId?: string;
  rawEventTimestamp?: string;
  paymentId?: string;
  reference?: string;
  status?: string;
  amount?: number;
  currency?: string;
  clientName?: string;
  clientEmail?: string;
  serviceName?: string;
  processed: boolean;
  errorMessage?: string;
}

export interface ConfirmOrderParams {
  orderId: string;
  vpayOrderId: string;
  transactionId?: string;
  deliveryId: string;
  paidAt: string;
  amount: number;
}

export interface VpayWebhookStore {
  findOrderByVpayOrReference(vpayOrderId: string, sourceId?: string): Promise<StoredOrderRecord | null>;
  hasProcessedDelivery(deliveryId: string): Promise<boolean>;
  confirmOrderAndRecordEvent(
    confirm: ConfirmOrderParams,
    audit: VpayWebhookAuditEntry
  ): Promise<{ transitioned: boolean; duplicateDelivery: boolean; order: StoredOrderRecord | null }>;
  recordRejectedOrIgnoredEvent(audit: VpayWebhookAuditEntry): Promise<void>;
}

export interface ProcessVpayWebhookResult {
  status: number;
  body: Record<string, any>;
}

export async function processVpayWebhook(
  rawBody: Buffer,
  headers: WebhookHeaderMap,
  webhookSecret: string,
  store: VpayWebhookStore,
  onConfirmed?: (order: StoredOrderRecord, payload: VpayConfirmedEventPayload) => Promise<void>
): Promise<ProcessVpayWebhookResult> {
  const validated = parseAndValidateVpayWebhook(rawBody, headers, webhookSecret);
  if (!validated.ok) {
    return {
      status: validated.status,
      body: { success: false, error: validated.error },
    };
  }

  // Eventos não ligados ao fluxo de confirmação são reconhecidos com 200 sem alterar ordens
  if (validated.action === 'ignore') {
    try {
      await store.recordRejectedOrIgnoredEvent({
        eventId: validated.deliveryId,
        eventType: validated.eventName,
        provider: 'vpay',
        deliveryId: validated.deliveryId,
        rawEventTimestamp: validated.timestamp,
        processed: true,
      });
    } catch {
      // Ignora erro de duplicado em evento não acionado
    }
    return {
      status: 200,
      body: { received: true, ignored: true, event: validated.eventName },
    };
  }

  const { payload, deliveryId, timestamp } = validated;

  // Idempotência por identificador de entrega (X-Voidpay-Delivery)
  try {
    const alreadyProcessed = await store.hasProcessedDelivery(deliveryId);
    if (alreadyProcessed) {
      return {
        status: 200,
        body: { received: true, duplicate: true, deliveryId },
      };
    }
  } catch (dbErr) {
    console.error('[VPAY WEBHOOK] Erro ao verificar idempotência de entrega:', dbErr);
    return {
      status: 500,
      body: { success: false, error: 'Erro interno ao verificar entrega.' },
    };
  }

  // Localizar a ordem pendente na loja por vpayOrderId ou sourceId/reference
  let order: StoredOrderRecord | null = null;
  try {
    order = await store.findOrderByVpayOrReference(payload.orderId, payload.sourceId);
  } catch (dbErr) {
    console.error('[VPAY WEBHOOK] Erro ao consultar ordem:', dbErr);
    return {
      status: 500,
      body: { success: false, error: 'Erro interno ao consultar ordem.' },
    };
  }

  if (!order) {
    try {
      await store.recordRejectedOrIgnoredEvent({
        eventId: deliveryId,
        eventType: payload.event,
        provider: 'vpay',
        deliveryId,
        vpayOrderId: payload.orderId,
        rawEventTimestamp: timestamp,
        paymentId: payload.transactionId,
        reference: payload.sourceId || payload.transactionReference,
        status: payload.status,
        amount: payload.amount,
        currency: payload.currency,
        processed: false,
        errorMessage: 'Ordem não encontrada na loja.',
      });
    } catch {
      // Não mascarar o 404 se o registo de auditoria falhar
    }
    return {
      status: 404,
      body: { success: false, error: 'Ordem não encontrada.' },
    };
  }

  // Validar moeda e montante contra o registo da loja
  const expectedCurrency = String(order.currency || 'MZN').trim().toUpperCase();
  const receivedCurrency = payload.currency.trim().toUpperCase();
  const expectedAmount = Number(order.amount);
  const receivedAmount = Number(payload.amount);

  if (receivedCurrency !== expectedCurrency) {
    try {
      await store.recordRejectedOrIgnoredEvent({
        eventId: deliveryId,
        eventType: payload.event,
        provider: 'vpay',
        deliveryId,
        vpayOrderId: payload.orderId,
        rawEventTimestamp: timestamp,
        paymentId: payload.transactionId,
        reference: order.reference || order.id,
        status: payload.status,
        amount: receivedAmount,
        currency: receivedCurrency,
        clientName: order.clientName,
        clientEmail: order.clientEmail,
        serviceName: order.serviceName,
        processed: false,
        errorMessage: `Divergência de moeda: esperado ${expectedCurrency}, recebido ${receivedCurrency}.`,
      });
    } catch {
      // silencioso
    }
    return {
      status: 422,
      body: {
        success: false,
        error: `Moeda divergente: esperado ${expectedCurrency}, recebido ${receivedCurrency}.`,
      },
    };
  }

  if (!Number.isFinite(expectedAmount) || Math.abs(receivedAmount - expectedAmount) >= 0.01) {
    try {
      await store.recordRejectedOrIgnoredEvent({
        eventId: deliveryId,
        eventType: payload.event,
        provider: 'vpay',
        deliveryId,
        vpayOrderId: payload.orderId,
        rawEventTimestamp: timestamp,
        paymentId: payload.transactionId,
        reference: order.reference || order.id,
        status: payload.status,
        amount: receivedAmount,
        currency: receivedCurrency,
        clientName: order.clientName,
        clientEmail: order.clientEmail,
        serviceName: order.serviceName,
        processed: false,
        errorMessage: `Divergência de montante: esperado ${expectedAmount}, recebido ${receivedAmount}.`,
      });
    } catch {
      // silencioso
    }
    return {
      status: 422,
      body: {
        success: false,
        error: `Montante divergente: esperado ${expectedAmount} ${expectedCurrency}, recebido ${receivedAmount} ${receivedCurrency}.`,
      },
    };
  }

  // Idempotência por ordem já confirmada
  if (order.status === 'completed') {
    try {
      await store.recordRejectedOrIgnoredEvent({
        eventId: deliveryId,
        eventType: payload.event,
        provider: 'vpay',
        deliveryId,
        vpayOrderId: payload.orderId,
        rawEventTimestamp: timestamp,
        paymentId: payload.transactionId,
        reference: order.reference || order.id,
        status: 'duplicate_completed_order',
        amount: receivedAmount,
        currency: receivedCurrency,
        clientName: order.clientName,
        clientEmail: order.clientEmail,
        serviceName: order.serviceName,
        processed: true,
      });
    } catch {
      // Ignora erro de índice único em entregas repetidas
    }
    return {
      status: 200,
      body: { received: true, duplicate: true, orderId: order.id },
    };
  }

  // Persistir atomicamente a confirmação e o registo de entrega antes de responder 2xx
  let confirmResult: {
    transitioned: boolean;
    duplicateDelivery: boolean;
    order: StoredOrderRecord | null;
  };
  try {
    confirmResult = await store.confirmOrderAndRecordEvent(
      {
        orderId: order.id,
        vpayOrderId: payload.orderId,
        transactionId: payload.transactionId,
        deliveryId,
        paidAt: payload.timestamp || timestamp,
        amount: expectedAmount,
      },
      {
        eventId: deliveryId,
        eventType: payload.event,
        provider: 'vpay',
        deliveryId,
        vpayOrderId: payload.orderId,
        rawEventTimestamp: timestamp,
        paymentId: payload.transactionId,
        reference: order.reference || order.id,
        status: payload.status,
        amount: receivedAmount,
        currency: receivedCurrency,
        clientName: order.clientName,
        clientEmail: order.clientEmail,
        serviceName: order.serviceName,
        processed: true,
      }
    );
  } catch (persistErr) {
    console.error('[VPAY WEBHOOK] Falha ao persistir confirmação:', persistErr);
    return {
      status: 500,
      body: { success: false, error: 'Falha ao persistir confirmação do pagamento.' },
    };
  }

  if (confirmResult.duplicateDelivery || !confirmResult.transitioned) {
    return {
      status: 200,
      body: { received: true, duplicate: true, orderId: order.id },
    };
  }

  // Executar efeitos pós-confirmação apenas uma vez na transição vencedora
  if (onConfirmed && confirmResult.order) {
    try {
      await onConfirmed(confirmResult.order, payload);
    } catch (fulfillErr) {
      // A confirmação já foi persistida de forma durável; não retornar 5xx para não causar retentativas desnecessárias
      console.error('[VPAY WEBHOOK] Erro não impeditivo pós-confirmação:', fulfillErr);
    }
  }

  return {
    status: 200,
    body: {
      received: true,
      orderId: order.id,
      vpayOrderId: payload.orderId,
      status: 'completed',
    },
  };
}
