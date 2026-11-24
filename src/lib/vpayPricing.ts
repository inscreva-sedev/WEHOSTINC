import { hostingPlans, websiteTypes } from './catalog';
import { getDomainPrice, sanitizeDomainName } from './domains';

export const VPAY_CURRENCY = 'MZN' as const;
export const AFFILIATE_VERIFICATION_AMOUNT_MZN = 2;

export interface VpayCheckoutItemInput {
  originProductId: string;
  name: string;
  quantity: number;
  price: number;
  description?: string;
}

export interface ServerCheckoutPricingInput {
  service?: string;
  planId?: string;
  durationMonths?: number;
  siteType?: string;
  domain?: string;
  courseId?: string;
  installments?: number;
  installmentNumber?: number;
  couponCode?: string;
  continueOrderId?: string;
  quantity?: number;
}

export interface CourseLookupRecord {
  id: string;
  title: string;
  price: number;
  active?: boolean;
}

export interface CouponLookupRecord {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minPurchaseAmount?: number;
  courseIds?: string[];
  maxUses?: number;
  usedCount?: number;
  expiresAt?: string;
  active?: boolean;
}

export interface PendingOrderLookupRecord {
  id: string;
  serviceName: string;
  amount: number;
  currency?: string;
  status: string;
  clientEmail?: string;
}

export interface PricingDependencies {
  findCourseById?: (courseId: string) => Promise<CourseLookupRecord | null>;
  findCouponByCode?: (code: string) => Promise<CouponLookupRecord | null>;
  findPendingOrderById?: (orderId: string) => Promise<PendingOrderLookupRecord | null>;
}

export interface ComputedServerPricing {
  items: VpayCheckoutItemInput[];
  subtotalMzn: number;
  discountMzn: number;
  totalMzn: number;
  currency: typeof VPAY_CURRENCY;
  serviceName: string;
  couponId?: string;
  couponCode?: string;
  existingOrderId?: string;
  meta: {
    serviceType: 'course' | 'affiliate_verification' | 'hosting' | 'website' | 'domain' | 'existing_order';
    planId?: string;
    durationMonths?: number;
    siteType?: string;
    domain?: string;
    courseId?: string;
    courseTitle?: string;
    installments?: number;
    installmentNumber?: number;
    totalCoursePrice?: number;
  };
}

export class PricingValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PricingValidationError';
    this.status = status;
  }
}

const VALID_DURATIONS = new Set([1, 3, 6, 12]);

export function computeHostingPlanPrice(planId: string, durationMonths: number): {
  planName: string;
  priceMzn: number;
} {
  const plan = hostingPlans.find((p) => p.id === planId);
  if (!plan || plan.id === 'website_creation') {
    throw new PricingValidationError('Plano de hospedagem inválido.');
  }

  if (!VALID_DURATIONS.has(durationMonths)) {
    throw new PricingValidationError('Duração de subscrição inválida (permitido: 1, 3, 6 ou 12 meses).');
  }

  let priceMzn = plan.price;
  if (durationMonths === 12) {
    priceMzn = plan.priceAnnual;
  } else if (durationMonths === 6) {
    priceMzn = Math.round(plan.price * 6 * 0.9);
  } else if (durationMonths === 3) {
    priceMzn = Math.round(plan.price * 3 * 0.95);
  }

  return { planName: plan.name, priceMzn };
}

export async function calculateServerCheckoutPricing(
  input: ServerCheckoutPricingInput,
  deps: PricingDependencies = {}
): Promise<ComputedServerPricing> {
  const quantity = input.quantity === undefined ? 1 : Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    throw new PricingValidationError('Quantidade inválida.');
  }

  // 1. Continuação de pedido pendente existente: usa o valor já persistido no servidor
  if (input.continueOrderId) {
    if (!deps.findPendingOrderById) {
      throw new PricingValidationError('Consulta de encomenda indisponível.', 500);
    }
    const existing = await deps.findPendingOrderById(String(input.continueOrderId).trim());
    if (!existing) {
      throw new PricingValidationError('Encomenda não encontrada.', 404);
    }
    if (existing.status === 'completed') {
      throw new PricingValidationError('Esta encomenda já se encontra paga.', 409);
    }
    const existingAmount = Number(existing.amount);
    if (!Number.isFinite(existingAmount) || existingAmount <= 0) {
      throw new PricingValidationError('Valor da encomenda inválido.', 400);
    }
    const existingCurrency = String(existing.currency || VPAY_CURRENCY).toUpperCase();
    if (existingCurrency !== VPAY_CURRENCY) {
      throw new PricingValidationError(`Moeda não suportada pela VPay: ${existingCurrency}.`, 400);
    }

    return {
      items: [
        {
          originProductId: `ORDER_${existing.id}`,
          name: existing.serviceName || `Encomenda ${existing.id}`,
          quantity: 1,
          price: existingAmount,
        },
      ],
      subtotalMzn: existingAmount,
      discountMzn: 0,
      totalMzn: existingAmount,
      currency: VPAY_CURRENCY,
      serviceName: existing.serviceName || `Encomenda ${existing.id}`,
      existingOrderId: existing.id,
      meta: { serviceType: 'existing_order' },
    };
  }

  // 2. Verificação de afiliado (valor fixo de servidor)
  if (input.service === 'affiliate_verification') {
    return {
      items: [
        {
          originProductId: 'AFFILIATE_VERIFICATION',
          name: 'Verificação de Afiliado WEHOSTHERE',
          quantity: 1,
          price: AFFILIATE_VERIFICATION_AMOUNT_MZN,
        },
      ],
      subtotalMzn: AFFILIATE_VERIFICATION_AMOUNT_MZN,
      discountMzn: 0,
      totalMzn: AFFILIATE_VERIFICATION_AMOUNT_MZN,
      currency: VPAY_CURRENCY,
      serviceName: 'Verificação de Afiliado',
      meta: { serviceType: 'affiliate_verification' },
    };
  }

  const items: VpayCheckoutItemInput[] = [];
  let serviceName = '';
  let subtotalMzn = 0;
  let meta: ComputedServerPricing['meta'] = { serviceType: 'hosting' };

  // 3. Compra de curso Academy (preço real lido da coleção Course)
  if (input.service === 'course') {
    const courseId = String(input.courseId || '').trim();
    if (!courseId) {
      throw new PricingValidationError('courseId é obrigatório para pagamento de curso.');
    }
    if (!deps.findCourseById) {
      throw new PricingValidationError('Catálogo de cursos indisponível.', 500);
    }
    const course = await deps.findCourseById(courseId);
    if (!course || course.active === false) {
      throw new PricingValidationError('Curso não encontrado ou indisponível.', 404);
    }
    const fullCoursePrice = Number(course.price);
    if (!Number.isFinite(fullCoursePrice) || fullCoursePrice <= 0) {
      throw new PricingValidationError('Este curso não possui valor pago configurado.');
    }

    const installments = Number(input.installments) === 2 ? 2 : 1;
    const installmentNumber = Number(input.installmentNumber) === 2 ? 2 : 1;
    const unitCoursePrice =
      installments === 2 ? Math.ceil(fullCoursePrice / 2) : fullCoursePrice;

    const suffix =
      installmentNumber === 2
        ? ' (2ª Parcela Final)'
        : installments === 2
          ? ' (1ª Parcela de 2)'
          : '';

    serviceName = `Curso: ${course.title}${suffix}`;
    items.push({
      originProductId: `COURSE_${course.id}_${installments}X_${installmentNumber}`,
      name: serviceName,
      quantity: 1,
      price: unitCoursePrice,
      description: `Acesso ao curso ${course.title}`,
    });
    subtotalMzn = unitCoursePrice;
    meta = {
      serviceType: 'course',
      courseId: course.id,
      courseTitle: course.title,
      installments,
      installmentNumber,
      totalCoursePrice: fullCoursePrice,
    };
  } else {
    // 4. Hospedagem, Criação de Site e/ou Domínio
    const planId = input.planId ? String(input.planId).trim() : 'none';
    const rawDomain = input.domain ? String(input.domain).trim() : '';

    if (planId && planId !== 'none') {
      if (planId === 'website_creation') {
        const siteTypeId = input.siteType ? String(input.siteType).trim() : '';
        if (siteTypeId) {
          const siteObj = websiteTypes.find((wt) => wt.id === siteTypeId);
          if (!siteObj) {
            throw new PricingValidationError('Tipo de site inválido.');
          }
          const sitePrice = siteObj.basePrice * quantity;
          serviceName = `Criação de Site Profissional - ${siteObj.name}`;
          items.push({
            originProductId: `WEBSITE_${siteObj.id}`,
            name: serviceName,
            quantity,
            price: siteObj.basePrice,
            description: siteObj.shortDesc,
          });
          subtotalMzn += sitePrice;
          meta = {
            serviceType: 'website',
            planId,
            siteType: siteObj.id,
          };
        } else {
          const webPlan = hostingPlans.find((p) => p.id === 'website_creation');
          if (!webPlan) {
            throw new PricingValidationError('Plano de criação de site indisponível.');
          }
          serviceName = webPlan.name;
          items.push({
            originProductId: 'WEBSITE_CREATION',
            name: webPlan.name,
            quantity,
            price: webPlan.price,
          });
          subtotalMzn += webPlan.price * quantity;
          meta = {
            serviceType: 'website',
            planId,
          };
        }
      } else {
        const durationMonths = Number(input.durationMonths || 1);
        const { planName, priceMzn } = computeHostingPlanPrice(planId, durationMonths);
        const cycleLabel = `(${durationMonths} ${durationMonths === 1 ? 'Mês' : 'Meses'})`;
        serviceName = `${planName} ${cycleLabel}`;
        items.push({
          originProductId: `HOSTING_${planId}_${durationMonths}M`,
          name: serviceName,
          quantity,
          price: priceMzn,
          description: `Hospedagem WEHOSTHERE ${cycleLabel}`,
        });
        subtotalMzn += priceMzn * quantity;
        meta = {
          serviceType: 'hosting',
          planId,
          durationMonths,
        };
      }
    }

    if (rawDomain) {
      const sanitized = sanitizeDomainName(rawDomain);
      if (!sanitized.sld || sanitized.sld.length < 2) {
        throw new PricingValidationError('Nome de domínio inválido.');
      }
      const cleanDomain = `${sanitized.sld}${sanitized.extension}`;
      const domainPrice = getDomainPrice(sanitized.extension);
      items.push({
        originProductId: `DOMAIN_${sanitized.extension.replace(/[^a-z0-9]/gi, '').toUpperCase()}`,
        name: `Registo de Domínio (${cleanDomain})`,
        quantity: 1,
        price: domainPrice,
        description: `Registo anual do domínio ${cleanDomain}`,
      });
      subtotalMzn += domainPrice;
      serviceName = serviceName
        ? `${serviceName} + Domínio (${cleanDomain})`
        : `Registo de Domínio: ${cleanDomain}`;
      meta = {
        ...meta,
        serviceType: planId && planId !== 'none' ? meta.serviceType : 'domain',
        domain: cleanDomain,
      };
    }

    if (items.length === 0 || subtotalMzn <= 0) {
      throw new PricingValidationError('Nenhum produto ou serviço válido selecionado para pagamento.');
    }
  }

  // 5. Cupom de desconto validado exclusivamente no servidor
  let discountMzn = 0;
  let couponId: string | undefined;
  let couponCode: string | undefined;

  if (input.couponCode && String(input.couponCode).trim()) {
    if (!deps.findCouponByCode) {
      throw new PricingValidationError('Validação de cupom indisponível.', 500);
    }
    const cleanCode = String(input.couponCode).trim().toUpperCase();
    const coupon = await deps.findCouponByCode(cleanCode);
    if (!coupon || coupon.active === false) {
      throw new PricingValidationError('Cupom inválido ou inexistente.');
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      throw new PricingValidationError('Este cupom já expirou.');
    }
    if (coupon.maxUses && coupon.maxUses > 0 && (coupon.usedCount || 0) >= coupon.maxUses) {
      throw new PricingValidationError('Este cupom atingiu o limite de utilizações.');
    }
    if (coupon.minPurchaseAmount && subtotalMzn < coupon.minPurchaseAmount) {
      throw new PricingValidationError(`Valor mínimo para este cupom: ${coupon.minPurchaseAmount} MZN.`);
    }
    if (coupon.courseIds && coupon.courseIds.length > 0) {
      if (!meta.courseId || !coupon.courseIds.includes(meta.courseId)) {
        throw new PricingValidationError('Este cupom não é aplicável ao item selecionado.');
      }
    }

    if (coupon.discountType === 'percentage') {
      discountMzn = Math.round((subtotalMzn * Number(coupon.discountValue)) / 100);
    } else {
      discountMzn = Math.min(subtotalMzn, Math.round(Number(coupon.discountValue)));
    }
    discountMzn = Math.max(0, Math.min(subtotalMzn, discountMzn));
    couponId = coupon.id;
    couponCode = coupon.code;
  }

  const totalMzn = Math.max(0, subtotalMzn - discountMzn);
  if (totalMzn <= 0) {
    throw new PricingValidationError('O valor final para pagamento deve ser superior a 0 MZN.');
  }

  // Se houver desconto de cupom, ajustar os items enviados à VPay para que a soma bata exatamente com totalMzn
  const finalItems: VpayCheckoutItemInput[] =
    discountMzn > 0
      ? [
          {
            originProductId: items[0].originProductId,
            name: serviceName,
            quantity: 1,
            price: totalMzn,
            description: `Inclui desconto do cupom ${couponCode}`,
          },
        ]
      : items;

  return {
    items: finalItems,
    subtotalMzn,
    discountMzn,
    totalMzn,
    currency: VPAY_CURRENCY,
    serviceName,
    couponId,
    couponCode,
    meta,
  };
}
