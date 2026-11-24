# Integração VPay (VOIDpay Moçambique) — WEHOSTHERE

Esta integração implementa pagamentos online em **MZN** via **VPay** (`https://api.vpay.co.mz`), seguindo os contratos oficiais da API (`https://vpay.co.mz/docs/api-reference`, `/docs/api-reference/polling`, `/docs/api-reference/api-collection`) e de Webhooks (`https://vpay.co.mz/docs/webhooks`).

---

## 1. Variáveis de Ambiente (apenas servidor)

Adicione as variáveis abaixo ao seu `.env.local` (desenvolvimento) e às variáveis de ambiente seguras da **Render** e **Vercel** (produção). **Nunca** exponha segredos com prefixo `NEXT_PUBLIC_*`:

```env
VPAY_BASE_URL="https://api.vpay.co.mz"
VPAY_CLIENT_ID="app_8792a492ed599bc467db57d6679ff7e9"
VPAY_CLIENT_SECRET=""
VPAY_WEBHOOK_SECRET=""
VPAY_ENVIRONMENT="development"
```

> **Nota sobre `environment` (`development` vs `production`):**
> A documentação oficial da VPay confirma apenas o endpoint base `https://api.vpay.co.mz` (não há URL de sandbox separado documentado). O campo `environment` (`development` ou `production`) está associado à aplicação/credenciais configuradas no painel VPay.

---

## 2. Arquitetura Implementada

- **`src/lib/vpayPricing.ts`**: Cálculo e validação autoritativa de preços exclusivamente no servidor (`MZN`), consultando planos (`hostingPlans`), tipos de site (`websiteTypes`), extensões de domínio (`DOMAIN_PRICES`), cursos (`CourseModel`), cupons (`CouponModel`) e encomendas pendentes (`OrderModel`). Ignora valores ou moedas manipuladas no browser.
- **`src/lib/vpay.ts`**: Cliente REST VPay (`POST /v1/auth/token`, `POST /v1/auth/token/refresh`, `POST /v1/orders`, `GET /v1/orders/{order_id}/status`) com cache/renovação automática de token, timeout de 15s, tratamento de respostas não-JSON e verificação criptográfica HMAC-SHA256 (`sha256=<hex>`) sobre os bytes exatos do corpo HTTP.
- **`src/lib/vpayWebhookHandler.ts` & `src/lib/vpayMongoStore.ts`**: Processador idempotente por `X-Voidpay-Delivery` e `orderId` (com índice único `(provider, deliveryId)` em `WebhookEventModel` e transição atómica em `OrderModel`). Só confirma após validar assinatura, cabeçalhos (`X-Voidpay-Event`, `X-Voidpay-Delivery`, `X-Voidpay-Timestamp`), evento `payment.confirmed`, estado `paid`, montante e moeda (`MZN`).
- **Endpoints Next.js App Router:**
  - `POST /api/payments/vpay/checkout` — Cria ordem pendente no MongoDB e inicia ordem na VPay retornando `checkoutUrl`.
  - `GET /api/payments/vpay/status` — Consulta o estado persistido no servidor (e faz fallback via `GET /v1/orders/{order_id}/status` quando ainda `pending`).
  - `POST /api/webhooks/vpay` — Recebe os webhooks da VPay lendo o corpo bruto (`req.arrayBuffer()`) antes de fazer `JSON.parse`.
- **`src/app/checkout/page.tsx`**: Opção **VPay Moçambique** no checkout com estados de carregamento, redirecionamento, verificação/polling ao retornar (`?vpay_order_ref=...&vpay_status=return`), cancelamento e erro. A página de retorno **nunca** marca a compra como paga por si só.

---

## 3. Configuração do Webhook no Painel VPay (Passos Manuais)

A API pública documentada da VPay não expõe um endpoint para registar a URL do webhook programaticamente. Após publicar a aplicação com HTTPS público:

1. Aceda ao **Dashboard VPay** (`https://vpay.co.mz`) e selecione a aplicação **Wehosthere** (`app_8792a492ed599bc467db57d6679ff7e9`).
2. Vá às definições de **Webhooks** da aplicação.
3. Configure a URL pública HTTPS:
   `https://www.wehosthere.com/api/webhooks/vpay`
   *(Nota: a URL só fica acessível pela VPay depois de publicar a aplicação num domínio HTTPS público; em desenvolvimento local utilize um túnel HTTPS apenas se precisar testar entregas externas.)*
4. Defina um **Segredo de Webhook** forte, ative os webhooks para a aplicação e guarde exatamente esse segredo em `VPAY_WEBHOOK_SECRET` no servidor.

---

## 4. Limitações Documentadas pela VPay

- Segundo a documentação oficial de webhooks da VPay (`https://vpay.co.mz/docs/webhooks`), apenas o evento `payment.confirmed` está atualmente ligado ao fluxo de compra. Eventos de falha de pagamento ou reembolso não são assumidos no webhook; eventos desconhecidos recebem `200` sem alterar o estado da ordem.
- A VPay tenta entregar o webhook até 3 vezes (timeout de 15s por tentativa) em erros de rede ou códigos `408`, `425`, `429`, `5xx`, sem fila persistente após interrupção. Por isso `GET /api/payments/vpay/status` também implementa fallback via polling oficial (`GET /v1/orders/{order_id}/status`).

---

## 5. Migrações / Base de Dados

Não são necessárias migrações manuais destrutivas. Os modelos existentes (`Order` em `src/lib/models/Order.ts` e `WebhookEvent` em `src/lib/models/WebhookEvent.ts`) foram estendidos de forma retrocompatível com índices esparsos (`vpayOrderId`, `reference` e índice único composto `(provider, deliveryId)` em `WebhookEvent`), criados automaticamente pelo Mongoose ao conectar ao MongoDB.

---

## 6. Testes e Verificação

Execute na pasta `wehosthere/`:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```
