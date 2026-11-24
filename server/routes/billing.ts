import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireManager, requireOrganization } from '../middleware/auth';
import {
  BILLING_PERIODS,
  TARIFF_PLANS,
  isValidTariffId,
  normalizeBillingPeriod,
} from '../../src/config/tariffs';
import {
  createCheckout,
  getPaymentProvidersStatus,
  listOrganizationPayments,
  processYooKassaWebhook,
} from '../services/payments';
import {
  getOrganizationSubscription,
  getOrganizationUsage,
} from '../services/subscription';
import { logAudit } from '../services/audit';

export const billingRouter = Router();

// GET /api/v1/billing/plans (Public tariff & period metadata)
billingRouter.get('/plans', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    plans: TARIFF_PLANS,
    periods: BILLING_PERIODS,
    providers: getPaymentProvidersStatus(),
  });
});

// GET /api/v1/billing/subscription
billingRouter.get('/subscription', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const [subscription, usage, payments] = await Promise.all([
      getOrganizationSubscription(orgId),
      getOrganizationUsage(orgId),
      listOrganizationPayments(orgId),
    ]);

    res.json({
      success: true,
      subscription,
      usage,
      payments,
      providers: getPaymentProvidersStatus(),
    });
  } catch (err) {
    console.error('[Billing] Subscription fetch error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка загрузки данных подписки' } });
  }
});

// POST /api/v1/billing/select-hint (Persist chosen tariff/period during trial)
billingRouter.post('/select-hint', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const { tariffId, periodMonths } = req.body || {};
    if (!isValidTariffId(tariffId)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Некорректный тариф' } });
      return;
    }
    const cleanPeriod = normalizeBillingPeriod(periodMonths);
    const orgId = req.user!.organizationId!;

    await db.query(
      `UPDATE subscriptions
       SET selected_tariff_id = $1, selected_period_months = $2, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $3`,
      [tariffId, cleanPeriod, orgId]
    );

    const subscription = await getOrganizationSubscription(orgId);
    res.json({ success: true, subscription });
  } catch (err) {
    console.error('[Billing] Select hint error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка сохранения выбора тарифа' } });
  }
});

const checkoutSchema = z.object({
  tariffId: z.enum(['start', 'business', 'maximum']),
  periodMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  paymentMethod: z.enum(['card', 'sbp', 'invoice', 'yandex_split']),
  returnUrl: z.string().optional(),
  companyRequisites: z
    .object({
      companyName: z.string().max(180).optional(),
      inn: z.string().max(20).optional(),
      kpp: z.string().max(20).optional(),
      address: z.string().max(300).optional(),
    })
    .optional(),
});

// POST /api/v1/billing/checkout
billingRouter.post('/checkout', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = checkoutSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Некорректные параметры оплаты' },
      });
      return;
    }

    const orgId = req.user!.organizationId!;
    const orgName = req.user!.organization?.name || 'Организация SKLADIN';
    const { tariffId, periodMonths, paymentMethod, returnUrl, companyRequisites } = parse.data;

    const result = await createCheckout({
      organizationId: orgId,
      organizationName: orgName,
      userId: req.user!.id,
      userEmail: req.user!.email,
      tariffId,
      periodMonths,
      paymentMethod,
      returnUrl,
      companyRequisites,
    });

    if (!result.ok) {
      const status =
        result.code === 'DOWNGRADE_BLOCKED'
          ? 400
          : result.code === 'PROVIDER_NOT_CONFIGURED'
          ? 503
          : 502;
      res.status(status).json({
        success: false,
        error: { code: result.code, message: result.message || 'Не удалось создать платёж' },
      });
      return;
    }

    await logAudit(req, req.user!.id, 'CREATE_CHECKOUT', 'payment', result.payment!.id, {
      tariffId,
      periodMonths,
      paymentMethod,
      amountRub: result.payment!.amountRub,
    });

    res.status(201).json({ success: true, payment: result.payment });
  } catch (err) {
    console.error('[Billing] Checkout error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка инициализации оплаты' } });
  }
});

// POST /api/v1/billing/webhooks/yookassa
billingRouter.post('/webhooks/yookassa', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.headers['x-yookassa-webhook-token'] as string) || (req.query.token as string) || undefined;
    const outcome = await processYooKassaWebhook({
      rawBody: req.body,
      webhookHeaderToken: token,
    });
    res.status(outcome.status).json({ success: outcome.ok, message: outcome.message });
  } catch (err) {
    console.error('[Billing] Webhook error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Webhook processing error' } });
  }
});
