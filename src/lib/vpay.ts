import crypto from 'node:crypto';
import type { VpayCheckoutItemInput } from './vpayPricing';

const DEFAULT_VPAY_BASE_URL = 'https://api.vpay.co.mz';
const VPAY_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface VpayConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  environment: string;
}

export function getVpayConfig(env: NodeJS.ProcessEnv = process.env): VpayConfig {
  const baseUrl = (env.VPAY_BASE_URL || DEFAULT_VPAY_BASE_URL).trim().replace(/\/$/, '');
  const clientId = (env.VPAY_CLIENT_ID || '').trim();
  const clientSecret = (env.VPAY_CLIENT_SECRET || '').trim();
  const webhookSecret = (env.VPAY_WEBHOOK_SECRET || env.VOIDPAY_WEBHOOK_SECRET || '').trim();
  const environment = (env.VPAY_ENVIRONMENT || 'development').trim();

  return { baseUrl, clientId, clientSecret, webhookSecret, environment };
}

export class VpayApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 502, code?: string) {
    super(message);
    this.name = 'VpayApiError';
    this.status = status;
    this.code = code;
  }
}

interface CachedTokenState {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
}

let tokenCache: CachedTokenState | null = null;
let inflightTokenPromise: Promise<string> | null = null;

export function clearVpayTokenCache() {
  tokenCache = null;
  inflightTokenPromise = null;
}

async function parseSafeJson(res: Response): Promise<any> {
  const rawText = await res.text();
  if (!rawText) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    throw new VpayApiError(
      `Resposta inválida (não-JSON) da API VPay (HTTP ${res.status}).`,
      res.status >= 500 ? 502 : res.status || 502
    );
  }
}

function extractTokenFields(payload: any): {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
} {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const accessToken = String(
    root?.access_token || root?.accessToken || root?.token || ''
  ).trim();
  const refreshToken = String(
    root?.refresh_token || root?.refreshToken || ''
  ).trim() || undefined;
  const expiresRaw = Number(root?.expires_in ?? root?.expiresIn ?? 3600);
  const expiresInSeconds = Number.isFinite(expiresRaw) && expiresRaw > 0 ? expiresRaw : 3600;

  if (!accessToken) {
    throw new VpayApiError('API VPay não retornou access_token válido.', 502);
  }

  return { accessToken, refreshToken, expiresInSeconds };
}

async function fetchVpayJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch
): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      cache: 'no-store',
      signal: init.signal || AbortSignal.timeout(VPAY_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new VpayApiError('Tempo limite excedido ao comunicar com a VPay.', 504, 'TIMEOUT');
    }
    throw new VpayApiError('Falha de rede ao comunicar com a API VPay.', 502, 'NETWORK_ERROR');
  }

  const data = await parseSafeJson(res);
  if (!res.ok) {
    const safeMsg =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : `Erro na API VPay (HTTP ${res.status})`;
    const code = typeof data?.code === 'string' ? data.code : undefined;
    throw new VpayApiError(safeMsg, res.status, code);
  }

  return data;
}

export async function authenticateVpay(
  config: VpayConfig = getVpayConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!config.clientId || !config.clientSecret) {
    throw new VpayApiError(
      'Credenciais VPay (VPAY_CLIENT_ID / VPAY_CLIENT_SECRET) não configuradas no servidor.',
      500,
      'CONFIG_MISSING'
    );
  }

  const payload = await fetchVpayJson(
    `${config.baseUrl}/v1/auth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    },
    fetchImpl
  );

  const extracted = extractTokenFields(payload);
  tokenCache = {
    accessToken: extracted.accessToken,
    refreshToken: extracted.refreshToken,
    expiresAtMs: Date.now() + extracted.expiresInSeconds * 1000,
  };
  return extracted.accessToken;
}

export async function refreshVpayToken(
  refreshToken: string,
  config: VpayConfig = getVpayConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const payload = await fetchVpayJson(
    `${config.baseUrl}/v1/auth/token/refresh`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
    fetchImpl
  );

  const extracted = extractTokenFields(payload);
  tokenCache = {
    accessToken: extracted.accessToken,
    refreshToken: extracted.refreshToken || refreshToken,
    expiresAtMs: Date.now() + extracted.expiresInSeconds * 1000,
  };
  return extracted.accessToken;
}

export async function getVpayAccessToken(
  config: VpayConfig = getVpayConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAtMs - TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.accessToken;
  }

  if (inflightTokenPromise) {
    return inflightTokenPromise;
  }

  inflightTokenPromise = (async () => {
    try {
      if (tokenCache?.refreshToken) {
        try {
          return await refreshVpayToken(tokenCache.refreshToken, config, fetchImpl);
        } catch {
          // Fallback para nova autenticação client_credentials se refresh falhar
        }
      }
      return await authenticateVpay(config, fetchImpl);
    } finally {
      inflightTokenPromise = null;
    }
  })();

  return inflightTokenPromise;
}

async function vpayAuthorizedRequest(
  path: string,
  init: RequestInit,
  config: VpayConfig = getVpayConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<any> {
  let token = await getVpayAccessToken(config, fetchImpl);

  const doRequest = (bearer: string) =>
    fetchVpayJson(
      `${config.baseUrl}${path}`,
      {
        ...init,
        headers: {
          ...(init.headers || {}),
          Authorization: `Bearer ${bearer}`,
        },
      },
      fetchImpl
    );

  try {
    return await doRequest(token);
  } catch (err) {
    if (err instanceof VpayApiError && err.status === 401) {
      clearVpayTokenCache();
      token = await authenticateVpay(config, fetchImpl);
      return await doRequest(token);
    }
    throw err;
  }
}

export interface CreateVpayOrderParams {
  customer: {
    name: string;
    email: string;
    phone?: string;
    merchantCustomerId?: string;
  };
  items: VpayCheckoutItemInput[];
  successUrl: string;
  cancelUrl: string;
  description?: string;
  notes?: string;
  reference: string;
}

export interface CreateVpayOrderResult {
  vpayOrderId: string;
  checkoutUrl: string;
  status: string;
  raw: any;
}

export async function createVpayOrder(
  params: CreateVpayOrderParams,
  config: VpayConfig = getVpayConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<CreateVpayOrderResult> {
  const payload = {
    source: {
      source: 'api',
      sourceId: params.reference,
    },
    customer: {
      name: params.customer.name,
      email: params.customer.email,
      ...(params.customer.phone ? { phone: params.customer.phone } : {}),
      ...(params.customer.merchantCustomerId
        ? { merchantCustomerId: params.customer.merchantCustomerId }
        : {}),
    },
    shippingAddressDisabled: true,
    deliveryInfoDisabled: true,
    items: params.items.map((item) => ({
      originProductId: item.originProductId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      ...(item.description ? { description: item.description } : {}),
    })),
    successUrl: params.successUrl,
    cancelUrl: params.cancelUrl,
    ...(params.description ? { description: params.description } : {}),
    ...(params.notes ? { notes: params.notes } : {}),
  };

  const response = await vpayAuthorizedRequest(
    '/v1/orders',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    config,
    fetchImpl
  );

  const root = response?.data && typeof response.data === 'object' ? response.data : response;
  const vpayOrderId = String(root?.id || root?.orderId || response?.id || response?.orderId || '').trim();
  const checkoutUrl = String(
    root?.checkoutUrl ||
      root?.paymentUrl ||
      root?.redirectUrl ||
      root?.checkout_url ||
      root?.url ||
      response?.checkoutUrl ||
      response?.paymentUrl ||
      response?.redirectUrl ||
      response?.url ||
      ''
  ).trim();

  if (!vpayOrderId || !checkoutUrl) {
    throw new VpayApiError(
      'A VPay não devolveu orderId ou URL de checkout válidos.',
      502,
      'INCOMPLETE_ORDER_RESPONSE'
    );
  }

  return {
    vpayOrderId,
    checkoutUrl,
    status: String(root?.status || 'pending').toLowerCase(),
    raw: response,
  };
}

export interface VpayOrderStatusResponse {
  orderId: string;
  status: string;
  amount?: number;
  transactionId?: string;
  lastUpdated?: string;
}

export async function getVpayOrderStatus(
  vpayOrderId: string,
  config: VpayConfig = getVpayConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<VpayOrderStatusResponse> {
  const cleanId = encodeURIComponent(String(vpayOrderId || '').trim());
  const response = await vpayAuthorizedRequest(
    `/v1/orders/${cleanId}/status`,
    { method: 'GET' },
    config,
    fetchImpl
  );
  const root = response?.data && typeof response.data === 'object' ? response.data : response;
  return {
    orderId: String(root?.orderId || root?.id || vpayOrderId),
    status: String(root?.status || 'pending').toLowerCase(),
    amount: root?.amount !== undefined ? Number(root.amount) : undefined,
    transactionId: root?.transactionId ? String(root.transactionId) : undefined,
    lastUpdated: root?.lastUpdated ? String(root.lastUpdated) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Webhook: verificação HMAC-SHA256 sobre os bytes exatos e contrato oficial
// ---------------------------------------------------------------------------

export interface VpayConfirmedEventPayload {
  event: string;
  orderId: string;
  status: string;
  amount: number;
  currency: string;
  timestamp?: string;
  transactionId?: string;
  transactionReference?: string;
  paymentMethod?: string;
  source?: string;
  sourceId?: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  metadata?: Record<string, any>;
}

export type WebhookHeaderMap = Headers | Record<string, string | undefined>;

export function readWebhookHeader(headers: WebhookHeaderMap, name: string): string | undefined {
  if (headers instanceof Headers || typeof (headers as any)?.get === 'function') {
    const val = (headers as Headers).get(name);
    return val === null ? undefined : val;
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * Valida a assinatura HMAC-SHA256 no formato `sha256=<hex>` sobre os bytes brutos exatos
 * do corpo HTTP usando comparação em tempo constante.
 */
export function verifyVpayWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined | null,
  secret: string
): boolean {
  if (!secret || !Buffer.isBuffer(rawBody) || !signatureHeader) {
    return false;
  }

  const trimmedSig = signatureHeader.trim();
  if (!/^sha256=[a-f0-9]{64}$/i.test(trimmedSig)) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(trimmedSig.slice('sha256='.length), 'hex');

  if (received.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(received, expected);
}

export type ParsedWebhookValidationResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      action: 'ignore';
      eventName: string;
      deliveryId: string;
      timestamp: string;
    }
  | {
      ok: true;
      action: 'confirm';
      eventName: 'payment.confirmed';
      deliveryId: string;
      timestamp: string;
      payload: VpayConfirmedEventPayload;
    };

export function parseAndValidateVpayWebhook(
  rawBody: Buffer,
  headers: WebhookHeaderMap,
  secret: string
): ParsedWebhookValidationResult {
  if (!secret || !secret.trim()) {
    return { ok: false, status: 401, error: 'Segredo de webhook VPay não configurado.' };
  }

  const signature = readWebhookHeader(headers, 'X-Voidpay-Signature');
  if (!verifyVpayWebhookSignature(rawBody, signature, secret.trim())) {
    return { ok: false, status: 401, error: 'Assinatura de webhook inválida ou ausente.' };
  }

  const headerEvent = readWebhookHeader(headers, 'X-Voidpay-Event')?.trim();
  const deliveryId = readWebhookHeader(headers, 'X-Voidpay-Delivery')?.trim();
  const headerTimestamp = readWebhookHeader(headers, 'X-Voidpay-Timestamp')?.trim();

  if (!headerEvent || !deliveryId || !headerTimestamp) {
    return {
      ok: false,
      status: 400,
      error: 'Headers obrigatórios X-Voidpay-Event, X-Voidpay-Delivery ou X-Voidpay-Timestamp ausentes.',
    };
  }

  if (Number.isNaN(Date.parse(headerTimestamp))) {
    return {
      ok: false,
      status: 400,
      error: 'Header X-Voidpay-Timestamp inválido (esperado ISO 8601).',
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { ok: false, status: 400, error: 'Corpo JSON inválido.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, status: 400, error: 'Payload de evento inválido.' };
  }

  const payloadEvent = typeof parsed.event === 'string' ? parsed.event.trim() : '';
  if (payloadEvent && payloadEvent !== headerEvent) {
    return {
      ok: false,
      status: 400,
      error: 'Divergência entre header X-Voidpay-Event e payload.event.',
    };
  }

  if (headerEvent !== 'payment.confirmed') {
    return {
      ok: true,
      action: 'ignore',
      eventName: headerEvent,
      deliveryId,
      timestamp: headerTimestamp,
    };
  }

  const orderId = typeof parsed.orderId === 'string' ? parsed.orderId.trim() : '';
  const status = typeof parsed.status === 'string' ? parsed.status.trim().toLowerCase() : '';
  const amount = typeof parsed.amount === 'number' ? parsed.amount : Number(parsed.amount);
  const currency = typeof parsed.currency === 'string' ? parsed.currency.trim().toUpperCase() : '';

  if (!orderId || status !== 'paid' || !Number.isFinite(amount) || amount <= 0 || !currency) {
    return {
      ok: false,
      status: 400,
      error: 'Payload payment.confirmed inválido: orderId, status=paid, amount e currency são obrigatórios.',
    };
  }

  return {
    ok: true,
    action: 'confirm',
    eventName: 'payment.confirmed',
    deliveryId,
    timestamp: headerTimestamp,
    payload: {
      ...parsed,
      event: 'payment.confirmed',
      orderId,
      status: 'paid',
      amount,
      currency,
    },
  };
}
