import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import OrderModel from '@/lib/models/Order';
import { getVpayConfig, getVpayOrderStatus } from '@/lib/vpay';
import {
  createMongoVpayWebhookStore,
  triggerVpayOrderFulfillment,
} from '@/lib/vpayMongoStore';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const reference = (searchParams.get('reference') || '').trim();
    const orderId = (searchParams.get('orderId') || '').trim();
    const vpayOrderIdParam = (searchParams.get('vpayOrderId') || '').trim();

    if (!reference && !orderId && !vpayOrderIdParam) {
      return NextResponse.json(
        { success: false, error: 'reference, orderId ou vpayOrderId é obrigatório.' },
        { status: 400 }
      );
    }

    await connectDB();

    const conditions: any[] = [];
    if (reference) conditions.push({ reference });
    if (orderId) conditions.push({ id: orderId });
    if (vpayOrderIdParam) conditions.push({ vpayOrderId: vpayOrderIdParam });

    let order = (await OrderModel.findOne({ $or: conditions }).lean()) as any;
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Ordem não encontrada.' },
        { status: 404 }
      );
    }

    // Se ainda estiver pendente e tiver vpayOrderId, consultar status diretamente na VPay (fallback ao webhook)
    if (order.status === 'pending' && order.vpayOrderId) {
      const config = getVpayConfig();
      if (config.clientId && config.clientSecret) {
        try {
          const live = await getVpayOrderStatus(String(order.vpayOrderId), config);
          if (live.status === 'paid') {
            const expectedAmount = Number(order.amount);
            const liveAmount = live.amount !== undefined ? Number(live.amount) : expectedAmount;

            if (
              Number.isFinite(expectedAmount) &&
              Number.isFinite(liveAmount) &&
              Math.abs(liveAmount - expectedAmount) < 0.01
            ) {
              const store = createMongoVpayWebhookStore();
              const deliveryId = `polling_${order.vpayOrderId}`;
              const confirmRes = await store.confirmOrderAndRecordEvent(
                {
                  orderId: String(order.id),
                  vpayOrderId: String(order.vpayOrderId),
                  transactionId: live.transactionId,
                  deliveryId,
                  paidAt: live.lastUpdated || new Date().toISOString(),
                  amount: expectedAmount,
                },
                {
                  eventId: deliveryId,
                  eventType: 'payment.confirmed',
                  provider: 'vpay',
                  deliveryId,
                  vpayOrderId: String(order.vpayOrderId),
                  rawEventTimestamp: live.lastUpdated || new Date().toISOString(),
                  paymentId: live.transactionId,
                  reference: order.reference || order.id,
                  status: 'paid',
                  amount: liveAmount,
                  currency: order.currency || 'MZN',
                  clientName: order.clientName,
                  clientEmail: order.clientEmail,
                  serviceName: order.serviceName,
                  processed: true,
                }
              );

              if (confirmRes.transitioned && confirmRes.order) {
                await triggerVpayOrderFulfillment(confirmRes.order, {
                  event: 'payment.confirmed',
                  orderId: String(order.vpayOrderId),
                  status: 'paid',
                  amount: liveAmount,
                  currency: String(order.currency || 'MZN'),
                  transactionId: live.transactionId,
                });
              }

              order = (await OrderModel.findOne({ id: order.id }).lean()) as any;
            }
          } else if (live.status === 'failed' || live.status === 'cancelled' || live.status === 'canceled') {
            await OrderModel.updateOne(
              { id: order.id, status: 'pending' },
              { $set: { status: 'cancelled' } }
            );
            order = (await OrderModel.findOne({ id: order.id }).lean()) as any;
          }
        } catch (pollErr) {
          console.warn('[VPAY STATUS] Consulta direta à VPay falhou:', pollErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      orderId: order.id,
      reference: order.reference,
      vpayOrderId: order.vpayOrderId || null,
      status: order.status,
      amount: order.amount,
      currency: order.currency || 'MZN',
      serviceName: order.serviceName,
      clientName: order.clientName,
      clientEmail: order.clientEmail,
      paidAt: order.paidAt || null,
      createdAt: order.createdAt,
    });
  } catch (error) {
    console.error('[VPAY STATUS] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao consultar estado do pagamento.' },
      { status: 500 }
    );
  }
}
