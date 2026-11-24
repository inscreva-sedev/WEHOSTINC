import crypto from 'node:crypto';
import { connectDB } from '@/lib/mongodb';
import OrderModel from '@/lib/models/Order';
import WebhookEventModel from '@/lib/models/WebhookEvent';
import InvoiceModel from '@/lib/models/Invoice';
import UserModel from '@/lib/models/User';
import EnrollmentModel from '@/lib/models/Enrollment';
import CouponModel from '@/lib/models/Coupon';
import SiteModel from '@/lib/models/Site';
import { generateHostingCredentials } from '@/lib/provisioning';
import type { VpayConfirmedEventPayload } from '@/lib/vpay';
import type {
  ConfirmOrderParams,
  StoredOrderRecord,
  VpayWebhookAuditEntry,
  VpayWebhookStore,
} from '@/lib/vpayWebhookHandler';

function toStoredOrder(doc: any): StoredOrderRecord {
  return {
    id: String(doc.id),
    reference: doc.reference ? String(doc.reference) : undefined,
    vpayOrderId: doc.vpayOrderId ? String(doc.vpayOrderId) : undefined,
    clientName: String(doc.clientName || 'Cliente'),
    clientEmail: String(doc.clientEmail || '').trim().toLowerCase(),
    clientPhone: doc.clientPhone ? String(doc.clientPhone) : undefined,
    serviceName: String(doc.serviceName || 'Serviço WEHOSTHERE'),
    amount: Number(doc.amount || 0),
    currency: String(doc.currency || 'MZN').toUpperCase(),
    status: doc.status || 'pending',
    paymentMethod: doc.paymentMethod ? String(doc.paymentMethod) : undefined,
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : undefined,
  };
}

export function createMongoVpayWebhookStore(): VpayWebhookStore {
  return {
    async findOrderByVpayOrReference(vpayOrderId: string, sourceId?: string) {
      await connectDB();
      const conditions: any[] = [{ vpayOrderId }];
      if (sourceId) {
        conditions.push({ reference: sourceId }, { id: sourceId });
      }
      const doc = await OrderModel.findOne({ $or: conditions }).lean();
      return doc ? toStoredOrder(doc) : null;
    },

    async hasProcessedDelivery(deliveryId: string) {
      await connectDB();
      const exists = await WebhookEventModel.exists({
        provider: 'vpay',
        deliveryId,
        processed: true,
      });
      return Boolean(exists);
    },

    async confirmOrderAndRecordEvent(
      confirm: ConfirmOrderParams,
      audit: VpayWebhookAuditEntry
    ) {
      await connectDB();

      // 1. Registar entrega de forma atómica pelo índice único (provider, deliveryId)
      try {
        await WebhookEventModel.create({
          ...audit,
          createdAt: new Date().toISOString(),
        });
      } catch (err: any) {
        if (err?.code === 11000) {
          return { transitioned: false, duplicateDelivery: true, order: null };
        }
        throw err;
      }

      // 2. Transicionar ordem apenas se estiver pendente ou em progresso
      const updated = await OrderModel.findOneAndUpdate(
        {
          id: confirm.orderId,
          status: { $in: ['pending', 'in_progress'] },
        },
        {
          $set: {
            status: 'completed',
            paymentMethod: 'vpay',
            vpayOrderId: confirm.vpayOrderId,
            ...(confirm.transactionId ? { vpayTransactionId: confirm.transactionId } : {}),
            vpayDeliveryId: confirm.deliveryId,
            valorFaturado: confirm.amount,
            valorPorFaturar: 0,
            paidAt: confirm.paidAt,
          },
        },
        { new: true }
      ).lean();

      if (!updated) {
        const current = await OrderModel.findOne({ id: confirm.orderId }).lean();
        return {
          transitioned: false,
          duplicateDelivery: false,
          order: current ? toStoredOrder(current) : null,
        };
      }

      return {
        transitioned: true,
        duplicateDelivery: false,
        order: toStoredOrder(updated),
      };
    },

    async recordRejectedOrIgnoredEvent(audit: VpayWebhookAuditEntry) {
      await connectDB();
      try {
        await WebhookEventModel.create({
          ...audit,
          createdAt: new Date().toISOString(),
        });
      } catch (err: any) {
        if (err?.code !== 11000) {
          throw err;
        }
      }
    },
  };
}

export async function triggerVpayOrderFulfillment(
  order: StoredOrderRecord,
  payload: VpayConfirmedEventPayload
): Promise<void> {
  await connectDB();

  // 1. Marcar fatura associada como paga
  try {
    await InvoiceModel.updateMany(
      {
        $or: [
          { id: order.id },
          { invoiceNumber: order.id },
          ...(order.reference ? [{ id: order.reference }, { invoiceNumber: order.reference }] : []),
        ],
      },
      {
        $set: {
          status: 'paid',
          paymentMethod: 'vpay',
          paymentSource: 'webhook',
          paidAt: payload.timestamp || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    );
  } catch (invErr) {
    console.warn('[VPAY FULFILLMENT] Erro ao atualizar fatura:', invErr);
  }

  // 2. Incrementar uso de cupom se aplicável
  if (order.metadata?.couponId) {
    try {
      await CouponModel.updateOne(
        { id: String(order.metadata.couponId) },
        { $inc: { usedCount: 1 } }
      );
    } catch (cpnErr) {
      console.warn('[VPAY FULFILLMENT] Erro ao incrementar cupom:', cpnErr);
    }
  }

  // 3. Ativar domínio/site pendente caso exista
  if (order.metadata?.domain && order.clientEmail) {
    try {
      const domainName = String(order.metadata.domain).trim().toLowerCase();
      await SiteModel.findOneAndUpdate(
        { domain: domainName, userEmail: order.clientEmail },
        {
          $set: { status: 'active' },
          $setOnInsert: {
            id: `SITE-${Date.now().toString().slice(-6)}`,
            name: domainName,
            domain: domainName,
            status: 'active',
            storage: 50,
            bandwidth: 100,
            userEmail: order.clientEmail,
            createdAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      );
    } catch (siteErr) {
      console.warn('[VPAY FULFILLMENT] Erro ao ativar site/domínio:', siteErr);
    }
  }

  // 4. Ativar plano no utilizador se for hospedagem
  const planId = order.metadata?.planId;
  if (
    (planId === 'basic' || planId === 'pro' || planId === 'enterprise') &&
    order.clientEmail
  ) {
    try {
      await UserModel.findOneAndUpdate(
        {
          email: {
            $regex: new RegExp(
              `^${order.clientEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
              'i'
            ),
          },
        },
        { plan: planId, status: 'active' }
      );
    } catch (planErr) {
      console.warn('[VPAY FULFILLMENT] Erro ao atualizar plano:', planErr);
    }
  }

  // 5. Auto-matrícula de curso se aplicável
  if (order.metadata?.serviceType === 'course' && order.clientEmail) {
    try {
      const courseId = String(order.metadata.courseId || '');
      const courseTitle = String(order.metadata.courseTitle || order.serviceName);
      const isSecondInstallment = Number(order.metadata.installmentNumber) === 2;
      const isInstallments = Number(order.metadata.installments) === 2;
      const existingEnr = await EnrollmentModel.findOne({
        studentEmail: order.clientEmail,
        courseId,
        status: 'active',
      });

      if (existingEnr) {
        if (isSecondInstallment) {
          existingEnr.installmentsPaid = 2;
          existingEnr.remainingAmount = 0;
          existingEnr.amountPaid = (existingEnr.amountPaid || 0) + order.amount;
          await existingEnr.save();
        }
      } else {
        const totalAmt = Number(order.metadata.totalCoursePrice || order.amount);
        await EnrollmentModel.create({
          id: `ENR_${Date.now().toString().slice(-6)}_${crypto.randomBytes(2).toString('hex')}`,
          courseId,
          courseTitle,
          studentEmail: order.clientEmail,
          studentName: order.clientName || 'Aluno',
          studentPhone: order.clientPhone || '',
          orderId: order.id,
          paymentReference: order.reference || payload.orderId,
          amountPaid: order.amount,
          paymentMethod: 'vpay',
          paymentPlan: isInstallments ? 'installments_2x' : 'full',
          installmentsTotal: isInstallments ? 2 : 1,
          installmentsPaid: isSecondInstallment ? 2 : 1,
          totalCourseAmount: totalAmt,
          remainingAmount: isInstallments ? Math.max(0, totalAmt - order.amount) : 0,
          claimToken: `CLM_${crypto.randomBytes(16).toString('hex')}`,
          claimed: false,
          status: 'active',
          enrolledAt: new Date().toISOString(),
        });
      }
    } catch (enrErr) {
      console.warn('[VPAY FULFILLMENT] Erro ao criar matrícula:', enrErr);
    }
  }

  // 6. Notificar Admin no painel, Push e Email
  try {
    const { addAdminNotification, dispatchMessage } = await import('@/lib/notifications');
    addAdminNotification({
      title: '💳 Pagamento VPay Confirmado',
      message: `${order.clientName} pagou ${order.amount.toLocaleString('pt-MZ')} ${order.currency || 'MZN'} via VPay (${order.serviceName}). Ref: ${order.reference || order.id}.`,
      type: 'payment_success',
      userEmail: order.clientEmail,
      userName: order.clientName,
      link: '/admin?tab=orders',
    });

    if (order.clientEmail) {
      await dispatchMessage({
        recipientEmail: order.clientEmail,
        recipientName: order.clientName || 'Cliente',
        templateId: 'payment-confirmed',
        variables: {
          numero_pedido: order.reference || order.id,
          valor: `${order.amount.toLocaleString('pt-MZ')} MT`,
        },
        isAutomatic: true,
        eventType: 'vpay_payment_success',
      });

      if (planId === 'basic' || planId === 'pro' || planId === 'enterprise') {
        const creds = generateHostingCredentials(order.reference || order.id, order.clientEmail);
        await dispatchMessage({
          recipientEmail: order.clientEmail,
          recipientName: order.clientName || 'Cliente',
          templateId: 'service-credentials',
          variables: {
            numero_pedido: order.reference || order.id,
            utilizador: creds.username,
            palavra_passe: creds.password,
            link_painel: creds.cpanelUrl,
            link_webmail: creds.webmailUrl,
            servidor_dns1: creds.nameserver1,
            servidor_dns2: creds.nameserver2,
          },
          isAutomatic: true,
          eventType: 'service_auto_provisioned',
        });
      }
    }

    const { sendPushToAdmins } = await import('@/lib/pushService');
    await sendPushToAdmins({
      title: `💰 VPay Confirmado: ${order.amount.toLocaleString('pt-MZ')} MZN`,
      message: `${order.clientName} concluiu pagamento de ${order.serviceName}!`,
      url: '/admin?tab=orders',
      tag: `vpay-paid-${order.id}`,
    });
  } catch (notifErr) {
    console.warn('[VPAY FULFILLMENT] Aviso ao notificar confirmação:', notifErr);
  }
}
