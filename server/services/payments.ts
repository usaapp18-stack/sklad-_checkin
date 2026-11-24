import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index';
import {
  BillingPeriodMonths,
  TARIFF_BY_ID,
  TariffId,
  calculateTariffPrice,
} from '../../src/config/tariffs';
import {
  activatePaidSubscription,
  validateTariffDowngrade,
} from './subscription';
import type { BillingPaymentItem } from '../../src/types';

export type PaymentMethodType = 'card' | 'sbp' | 'invoice' | 'yandex_split';

export interface ProviderStatus {
  method: PaymentMethodType;
  label: string;
  configured: boolean;
  provider: string;
  reason?: string;
}

export interface CreateCheckoutInput {
  organizationId: string;
  organizationName: string;
  userId: string;
  userEmail?: string;
  tariffId: TariffId;
  periodMonths: BillingPeriodMonths;
  paymentMethod: PaymentMethodType;
  returnUrl?: string;
  companyRequisites?: {
    companyName?: string;
    inn?: string;
    kpp?: string;
    address?: string;
  };
}

export interface CheckoutResult {
  ok: boolean;
  code?: 'PROVIDER_NOT_CONFIGURED' | 'DOWNGRADE_BLOCKED' | 'PROVIDER_ERROR';
  message?: string;
  payment?: BillingPaymentItem & {
    companyRequisites?: Record<string, string>;
  };
}

export function getPaymentProvidersStatus(): ProviderStatus[] {
  const yookassaConfigured = Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);

  return [
    {
      method: 'card',
      label: 'Банковская карта (МИР / Visa / Mastercard)',
      configured: yookassaConfigured,
      provider: 'yookassa',
      reason: yookassaConfigured
        ? undefined
        : 'Платёжный шлюз ЮKassa не подключён: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в конфигурации сервера.',
    },
    {
      method: 'sbp',
      label: 'СБП (Система быстрых платежей)',
      configured: yookassaConfigured,
      provider: 'yookassa',
      reason: yookassaConfigured
        ? undefined
        : 'Оплата через СБП не подключена: требуются учётные данные шлюза ЮKassa или СБП.',
    },
    {
      method: 'invoice',
      label: 'Безналичный счёт для юрлиц и ИП',
      configured: true,
      provider: 'manual_invoice',
    },
    {
      method: 'yandex_split',
      label: 'Оплата частями (Яндекс Сплит)',
      configured: false,
      provider: 'yandex_split',
      reason: 'Модуль Яндекс Сплит не подключён: требуются ключ продавца и договор Яндекс Пэй.',
    },
  ];
}

export async function createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
  // 1. Validate tariff downgrade safety against active org usage
  const downgradeCheck = await validateTariffDowngrade(input.organizationId, input.tariffId);
  if (!downgradeCheck.allowed) {
    return {
      ok: false,
      code: 'DOWNGRADE_BLOCKED',
      message: downgradeCheck.reason,
    };
  }

  // 2. Server-side authoritative pricing calculation
  const calc = calculateTariffPrice(input.tariffId, input.periodMonths);
  const tariff = TARIFF_BY_ID[input.tariffId];

  if (input.paymentMethod === 'yandex_split') {
    return {
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message: 'Оплата через Яндекс Сплит не подключена (отсутствуют настройки мерчанта Яндекс Пэй). Выберите другой способ оплаты.',
    };
  }

  // 3. Invoice for B2B legal entities (stays pending until verified bank receipt)
  if (input.paymentMethod === 'invoice') {
    const paymentId = `pay-${uuidv4()}`;
    const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const invoiceNumber = `СЧ-${todayCompact}-${paymentId.slice(-4).toUpperCase()}`;
    const reqPayload = {
      companyName: input.companyRequisites?.companyName?.trim() || input.organizationName,
      inn: input.companyRequisites?.inn?.trim() || '',
      kpp: input.companyRequisites?.kpp?.trim() || '',
      address: input.companyRequisites?.address?.trim() || '',
    };

    await db.query(
      `INSERT INTO payments (
         id, organization_id, user_id, tariff_id, period_months, discount_percent,
         amount_rub, payment_method, provider, status, invoice_number, company_requisites, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'invoice', 'manual_invoice', 'pending', $8, $9, $10)`,
      [
        paymentId,
        input.organizationId,
        input.userId,
        calc.tariffId,
        calc.months,
        calc.discountPercent,
        calc.finalPriceRub,
        invoiceNumber,
        JSON.stringify(reqPayload),
        JSON.stringify({ tariffName: tariff.name, note: 'Awaiting bank settlement confirmation' }),
      ]
    );

    return {
      ok: true,
      payment: {
        id: paymentId,
        tariffId: calc.tariffId,
        periodMonths: calc.months,
        discountPercent: calc.discountPercent,
        amountRub: calc.finalPriceRub,
        paymentMethod: 'invoice',
        provider: 'manual_invoice',
        status: 'pending',
        invoiceNumber,
        companyRequisites: reqPayload,
        createdAt: new Date().toISOString(),
      },
    };
  }

  // 4. Online card / SBP via YooKassa v3 API (requires configured credentials, NEVER fakes payment success)
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();

  if (!shopId || !secretKey) {
    return {
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        input.paymentMethod === 'sbp'
          ? 'Оплата через СБП временно недоступна: не настроены реквизиты платёжного провайдера (ЮKassa / СБП). Вы можете сформировать счёт на оплату.'
          : 'Онлайн-оплата картой не подключена: не заданы ключи платёжного провайдера ЮKassa на сервере. Вы можете сформировать счёт на оплату.',
    };
  }

  const paymentId = `pay-${uuidv4()}`;
  const idempotenceKey = uuidv4();
  const authHeader = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
  const amountFormatted = calc.finalPriceRub.toFixed(2);
  const returnUrl = input.returnUrl || 'http://localhost:3000/app?billing=return';

  const payload: Record<string, any> = {
    amount: {
      value: amountFormatted,
      currency: 'RUB',
    },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: returnUrl,
    },
    description: `SKLADIN: тариф «${tariff.name}» на ${calc.months} мес. (${input.organizationName})`,
    metadata: {
      internal_payment_id: paymentId,
      organization_id: input.organizationId,
      tariff_id: calc.tariffId,
      period_months: String(calc.months),
    },
  };

  if (input.paymentMethod === 'sbp') {
    payload.payment_method_data = { type: 'sbp' };
  } else if (input.paymentMethod === 'card') {
    payload.payment_method_data = { type: 'bank_card' };
  }

  try {
    const response = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data: any = await response.json();
    if (!response.ok || !data?.id) {
      console.error('[Payments] YooKassa API error:', response.status, data);
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: data?.description || 'Платёжный шлюз отклонил создание платежа. Попробуйте позже.',
      };
    }

    const confirmationUrl = data.confirmation?.confirmation_url || undefined;
    const providerPaymentId = String(data.id);

    await db.query(
      `INSERT INTO payments (
         id, organization_id, user_id, tariff_id, period_months, discount_percent,
         amount_rub, payment_method, provider, provider_payment_id, status, confirmation_url, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'yookassa', $9, 'pending', $10, $11)`,
      [
        paymentId,
        input.organizationId,
        input.userId,
        calc.tariffId,
        calc.months,
        calc.discountPercent,
        calc.finalPriceRub,
        input.paymentMethod,
        providerPaymentId,
        confirmationUrl || null,
        JSON.stringify({ idempotenceKey }),
      ]
    );

    return {
      ok: true,
      payment: {
        id: paymentId,
        tariffId: calc.tariffId,
        periodMonths: calc.months,
        discountPercent: calc.discountPercent,
        amountRub: calc.finalPriceRub,
        paymentMethod: input.paymentMethod,
        provider: 'yookassa',
        status: 'pending',
        confirmationUrl,
        createdAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error('[Payments] YooKassa network failure:', err);
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: 'Не удалось связаться с платёжным шлюзом. Повторите попытку позже.',
    };
  }
}

export async function listOrganizationPayments(organizationId: string): Promise<BillingPaymentItem[]> {
  const res = await db.query<{
    id: string;
    tariff_id: string;
    period_months: number;
    discount_percent: number;
    amount_rub: number | string;
    payment_method: string;
    provider: string;
    status: string;
    invoice_number?: string;
    confirmation_url?: string;
    created_at: string;
    paid_at?: string;
  }>(
    `SELECT id, tariff_id, period_months, discount_percent, amount_rub, payment_method, provider,
            status, invoice_number, confirmation_url, created_at, paid_at
     FROM payments
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [organizationId]
  );

  return res.rows.map(r => ({
    id: r.id,
    tariffId: (r.tariff_id as TariffId) || 'business',
    periodMonths: (Number(r.period_months) as BillingPeriodMonths) || 1,
    discountPercent: Number(r.discount_percent || 0),
    amountRub: Number(r.amount_rub || 0),
    paymentMethod: (r.payment_method as PaymentMethodType) || 'card',
    provider: r.provider,
    status: (r.status as BillingPaymentItem['status']) || 'pending',
    invoiceNumber: r.invoice_number || undefined,
    confirmationUrl: r.confirmation_url || undefined,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : undefined,
  }));
}

export async function processYooKassaWebhook(params: {
  rawBody: any;
  webhookHeaderToken?: string;
}): Promise<{ ok: boolean; status: number; message: string }> {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  const configuredWebhookSecret = process.env.YOOKASSA_WEBHOOK_SECRET?.trim();

  if (!shopId || !secretKey) {
    return { ok: false, status: 503, message: 'YooKassa credentials are not configured' };
  }

  if (configuredWebhookSecret && params.webhookHeaderToken) {
    const a = Buffer.from(configuredWebhookSecret);
    const b = Buffer.from(params.webhookHeaderToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, status: 403, message: 'Invalid webhook secret' };
    }
  }

  const eventType = String(params.rawBody?.event || '');
  const providerPaymentId = String(params.rawBody?.object?.id || '');
  if (!eventType || !providerPaymentId) {
    return { ok: false, status: 400, message: 'Invalid webhook payload' };
  }

  const externalEventId = `yk:${eventType}:${providerPaymentId}`;

  // Idempotency check
  const dupRes = await db.query('SELECT id FROM payment_events WHERE external_event_id = $1', [externalEventId]);
  if (dupRes.rows.length > 0) {
    return { ok: true, status: 200, message: 'Duplicate event ignored' };
  }

  // Authoritative verification against YooKassa API
  const authHeader = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
  let verifiedPayment: any = null;
  let signatureValid = false;

  try {
    const verifyRes = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(providerPaymentId)}`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });
    if (verifyRes.ok) {
      verifiedPayment = await verifyRes.json();
      signatureValid = Boolean(verifiedPayment?.id === providerPaymentId);
    }
  } catch (err) {
    console.error('[Webhook YooKassa] Verification fetch error:', err);
  }

  const payRes = await db.query<{
    id: string;
    organization_id: string;
    user_id?: string;
    tariff_id: string;
    period_months: number;
    amount_rub: number | string;
    status: string;
  }>(
    'SELECT id, organization_id, user_id, tariff_id, period_months, amount_rub, status FROM payments WHERE provider_payment_id = $1',
    [providerPaymentId]
  );

  const localPayment = payRes.rows[0];

  await db.query(
    `INSERT INTO payment_events (id, provider, external_event_id, payment_id, event_type, payload_json, signature_valid)
     VALUES ($1, 'yookassa', $2, $3, $4, $5, $6)`,
    [
      `pevt-${uuidv4()}`,
      externalEventId,
      localPayment?.id || null,
      eventType,
      JSON.stringify(params.rawBody || {}),
      signatureValid,
    ]
  );

  if (!signatureValid || !localPayment) {
    return { ok: false, status: 400, message: 'Payment verification failed or unknown payment' };
  }

  const remoteStatus = String(verifiedPayment.status || '');
  const remoteAmount = Number(verifiedPayment.amount?.value || 0);
  const expectedAmount = Number(localPayment.amount_rub || 0);

  if (remoteStatus === 'succeeded' && Math.abs(remoteAmount - expectedAmount) < 0.01) {
    if (localPayment.status !== 'succeeded') {
      const paidAt = new Date().toISOString();
      await db.query(
        `UPDATE payments SET status = 'succeeded', paid_at = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [paidAt, localPayment.id]
      );
      await activatePaidSubscription({
        organizationId: localPayment.organization_id,
        tariffId: (localPayment.tariff_id as TariffId) || 'business',
        periodMonths: (Number(localPayment.period_months) as BillingPeriodMonths) || 1,
        actorUserId: localPayment.user_id || null,
        reason: `YOOKASSA_PAYMENT_${localPayment.id}`,
      });
    }
  } else if (remoteStatus === 'canceled') {
    await db.query(
      `UPDATE payments SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending'`,
      [localPayment.id]
    );
  }

  return { ok: true, status: 200, message: 'Webhook processed' };
}
