import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { connectDB } from '@/lib/mongodb';
import OrderModel from '@/lib/models/Order';
import InvoiceModel from '@/lib/models/Invoice';
import { CourseModel } from '@/lib/models/CourseModel';
import CouponModel from '@/lib/models/Coupon';
import { createVpayOrder, getVpayConfig, VpayApiError } from '@/lib/vpay';
import {
  calculateServerCheckoutPricing,
  PricingValidationError,
} from '@/lib/vpayPricing';
import { rateLimit, getRateLimitIdentifier } from '@/lib/rateLimiter';

function resolveOriginUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/$/, '');
  }
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  if (host) {
    return `${proto}://${host}`.replace(/\/$/, '');
  }
  return 'https://www.wehosthere.com';
}

export async function POST(req: NextRequest) {
  try {
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const rl = rateLimit(getRateLimitIdentifier(clientIp, 'vpay_checkout'), 20, 60_000);
    if (!rl.success) {
      return NextResponse.json(
        { success: false, error: 'Muitas tentativas. Aguarde um momento antes de tentar novamente.' },
        { status: 429 }
      );
    }

    const vpayConfig = getVpayConfig();
    if (!vpayConfig.clientId || !vpayConfig.clientSecret) {
      return NextResponse.json(
        {
          success: false,
          error: 'Gateway VPay ainda não configurado no servidor.',
        },
        { status: 503 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Corpo JSON inválido.' },
        { status: 400 }
      );
    }

    const customerName = String(body?.customer?.name || body?.clientName || '').trim();
    const customerEmail = String(body?.customer?.email || body?.clientEmail || '')
      .trim()
      .toLowerCase();
    const customerPhone = String(body?.customer?.phone || body?.clientPhone || '').trim();

    if (!customerName || !customerEmail || !customerEmail.includes('@')) {
      return NextResponse.json(
        { success: false, error: 'Nome e e-mail válidos são obrigatórios.' },
        { status: 400 }
      );
    }

    await connectDB();

    // Calcular total exclusivamente no servidor a partir do catálogo e BD reais
    const pricing = await calculateServerCheckoutPricing(
      {
        service: body?.service,
        planId: body?.planId,
        durationMonths: body?.durationMonths,
        siteType: body?.siteType,
        domain: body?.domain,
        courseId: body?.courseId,
        installments: body?.installments,
        installmentNumber: body?.installmentNumber,
        couponCode: body?.couponCode,
        continueOrderId: body?.continueOrderId,
        quantity: body?.quantity,
      },
      {
        findCourseById: async (courseId: string) => {
          const c = (await CourseModel.findOne({ id: courseId }).lean()) as any;
          if (!c) return null;
          return {
            id: String(c.id),
            title: String(c.title || 'Curso WEHOSTHERE'),
            price: Number(c.price || 0),
            active: c.active !== false,
          };
        },
        findCouponByCode: async (code: string) => {
          const cp = (await CouponModel.findOne({
            code: code.trim().toUpperCase(),
            active: true,
          }).lean()) as any;
          if (!cp) return null;
          return {
            id: String(cp.id),
            code: String(cp.code),
            discountType: cp.discountType,
            discountValue: Number(cp.discountValue || 0),
            minPurchaseAmount: Number(cp.minPurchaseAmount || 0),
            courseIds: Array.isArray(cp.courseIds) ? cp.courseIds : [],
            maxUses: Number(cp.maxUses || 0),
            usedCount: Number(cp.usedCount || 0),
            expiresAt: cp.expiresAt,
            active: cp.active !== false,
          };
        },
        findPendingOrderById: async (orderId: string) => {
          const existing = (await OrderModel.findOne({ id: orderId }).lean()) as any;
          if (existing) {
            const rawCurr = String(existing.currency || 'MZN').trim().toUpperCase();
            return {
              id: String(existing.id),
              serviceName: String(existing.serviceName || ''),
              amount: Number(existing.amount || 0),
              currency: rawCurr === 'MT' ? 'MZN' : rawCurr,
              status: String(existing.status || 'pending'),
              clientEmail: existing.clientEmail,
            };
          }

          const invoice = (await InvoiceModel.findOne({
            $or: [{ id: orderId }, { invoiceNumber: orderId }],
          }).lean()) as any;
          if (!invoice) return null;

          const rawCurr = String(invoice.currency || 'MZN').trim().toUpperCase();
          const normalizedStatus =
            invoice.status === 'paid'
              ? 'completed'
              : invoice.status === 'cancelled'
              ? 'cancelled'
              : 'pending';
          const firstItemName = Array.isArray(invoice.items) && invoice.items[0]?.service
            ? String(invoice.items[0].service)
            : '';

          return {
            id: String(invoice.id || invoice.invoiceNumber || orderId),
            serviceName: firstItemName || `Fatura ${invoice.invoiceNumber || invoice.id}`,
            amount: Number(invoice.total || 0),
            currency: rawCurr === 'MT' ? 'MZN' : rawCurr,
            status: normalizedStatus,
            clientEmail: invoice.customerEmail,
          };
        },
      }
    );

    const reference = `VPAY_${Date.now().toString(36).toUpperCase()}_${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;

    const orderId =
      pricing.existingOrderId ||
      `ORD-${Date.now().toString().slice(-6)}${crypto
        .randomBytes(1)
        .toString('hex')
        .toUpperCase()}`;

    const origin = resolveOriginUrl(req);
    const successUrl = `${origin}/checkout?vpay_order_ref=${encodeURIComponent(reference)}&vpay_status=return`;
    const cancelUrl = `${origin}/checkout?vpay_order_ref=${encodeURIComponent(reference)}&vpay_status=cancelled`;

    // Persistir ordem pendente antes de redirecionar para a VPay
    const nowIso = new Date().toISOString();
    await OrderModel.findOneAndUpdate(
      { id: orderId },
      {
        $set: {
          clientName: customerName,
          clientEmail: customerEmail,
          clientPhone: customerPhone,
          serviceName: pricing.serviceName,
          amount: pricing.totalMzn,
          currency: pricing.currency,
          valorFaturado: 0,
          valorPorFaturar: pricing.totalMzn,
          paymentMethod: 'vpay',
          reference,
          status: 'pending',
          metadata: {
            ...pricing.meta,
            couponCode: pricing.couponCode,
            couponId: pricing.couponId,
            discountMzn: pricing.discountMzn,
            subtotalMzn: pricing.subtotalMzn,
            vpayEnvironment: vpayConfig.environment,
          },
        },
        $setOnInsert: {
          id: orderId,
          createdAt: nowIso,
        },
      },
      { upsert: true, new: true }
    );

    const vpayOrder = await createVpayOrder(
      {
        customer: {
          name: customerName,
          email: customerEmail,
          ...(customerPhone ? { phone: customerPhone } : {}),
        },
        items: pricing.items,
        successUrl,
        cancelUrl,
        reference,
        description: pricing.serviceName,
        notes: `WEHOSTHERE ${orderId} (${reference})`,
      },
      vpayConfig
    );

    await OrderModel.updateOne(
      { id: orderId },
      {
        $set: {
          vpayOrderId: vpayOrder.vpayOrderId,
          vpayCheckoutUrl: vpayOrder.checkoutUrl,
        },
      }
    );

    return NextResponse.json({
      success: true,
      orderId,
      reference,
      vpayOrderId: vpayOrder.vpayOrderId,
      checkoutUrl: vpayOrder.checkoutUrl,
      amount: pricing.totalMzn,
      currency: pricing.currency,
      serviceName: pricing.serviceName,
      environment: vpayConfig.environment,
    });
  } catch (error) {
    if (error instanceof PricingValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    if (error instanceof VpayApiError) {
      console.error('[VPAY CHECKOUT] Erro API VPay:', {
        status: error.status,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        {
          success: false,
          error:
            error.status === 500 && error.code === 'CONFIG_MISSING'
              ? 'Gateway VPay ainda não configurado no servidor.'
              : 'Não foi possível iniciar o pagamento na VPay. Tente novamente em instantes.',
        },
        { status: error.status >= 400 && error.status < 600 ? error.status : 502 }
      );
    }

    console.error('[VPAY CHECKOUT] Erro inesperado:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno ao preparar o pagamento VPay.' },
      { status: 500 }
    );
  }
}
