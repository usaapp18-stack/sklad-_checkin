import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index';
import {
  BillingPeriodMonths,
  TARIFF_BY_ID,
  TariffId,
  isValidTariffId,
  normalizeBillingPeriod,
} from '../../src/config/tariffs';
import type { OrganizationInfo, SubscriptionInfo, SubscriptionStatus } from '../../src/types';

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  max: number;
  tariffId: TariffId;
  tariffName: string;
  message?: string;
}

function addDaysIso(from: Date, days: number): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function addMonthsIso(from: Date, months: number): string {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function formatDateRu(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export async function getOrganizationById(organizationId: string): Promise<OrganizationInfo | null> {
  const res = await db.query<{
    id: string;
    name: string;
    slug?: string;
    inn?: string;
    timezone: string;
    owner_user_id?: string;
    created_at?: string;
  }>(
    'SELECT id, name, slug, inn, timezone, owner_user_id, created_at FROM organizations WHERE id = $1',
    [organizationId]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug || undefined,
    inn: row.inn || undefined,
    timezone: row.timezone || 'Europe/Moscow',
    ownerUserId: row.owner_user_id || undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
  };
}

export async function getOrganizationSubscription(organizationId: string): Promise<SubscriptionInfo | null> {
  const res = await db.query<{
    id: string;
    organization_id: string;
    tariff_id: string;
    status: SubscriptionStatus;
    billing_period_months: number;
    trial_started_at?: string;
    trial_ends_at?: string;
    current_period_start?: string;
    current_period_end?: string;
    trial_day4_notified_at?: string;
    expired_notified_at?: string;
    selected_tariff_id?: string;
    selected_period_months?: number;
  }>(
    `SELECT id, organization_id, tariff_id, status, billing_period_months,
            trial_started_at, trial_ends_at, current_period_start, current_period_end,
            trial_day4_notified_at, expired_notified_at, selected_tariff_id, selected_period_months
     FROM subscriptions
     WHERE organization_id = $1`,
    [organizationId]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const now = new Date();
  let status = row.status;

  // Automatic status lifecycle synchronization
  if (status === 'trial' && row.trial_ends_at && new Date(row.trial_ends_at) <= now) {
    status = 'expired_readonly';
    const nowIso = now.toISOString();
    await db.query(
      `UPDATE subscriptions
       SET status = 'expired_readonly', expired_notified_at = COALESCE(expired_notified_at, $1), updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'trial'`,
      [nowIso, row.id]
    );
    await db.query(
      `INSERT INTO subscription_history (id, organization_id, subscription_id, previous_status, new_status, tariff_id, billing_period_months, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`subh-${uuidv4()}`, organizationId, row.id, 'trial', 'expired_readonly', row.tariff_id, Number(row.billing_period_months || 1), 'TRIAL_EXPIRED']
    );
    if (!row.expired_notified_at) {
      await notifyOrgManagers(
        organizationId,
        'Пробный период завершён',
        '7-дневный пробный период завершён. Кабинет переведён в режим чтения, ваши данные сохранены. Оформите подписку, чтобы продолжить вносить изменения.'
      );
    }
  } else if (status === 'active' && row.current_period_end && new Date(row.current_period_end) <= now) {
    status = 'expired_readonly';
    const nowIso = now.toISOString();
    await db.query(
      `UPDATE subscriptions
       SET status = 'expired_readonly', expired_notified_at = COALESCE(expired_notified_at, $1), updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'active'`,
      [nowIso, row.id]
    );
    await db.query(
      `INSERT INTO subscription_history (id, organization_id, subscription_id, previous_status, new_status, tariff_id, billing_period_months, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`subh-${uuidv4()}`, organizationId, row.id, 'active', 'expired_readonly', row.tariff_id, Number(row.billing_period_months || 1), 'PERIOD_EXPIRED']
    );
    if (!row.expired_notified_at) {
      await notifyOrgManagers(
        organizationId,
        'Срок действия подписки истёк',
        'Оплаченный период подписки завершился. Доступен просмотр и выгрузка данных; для продолжения работы продлите подписку.'
      );
    }
  }

  const tariffId: TariffId = isValidTariffId(row.tariff_id) ? row.tariff_id : 'business';
  const tariffCfg = TARIFF_BY_ID[tariffId];

  const endAnchor = status === 'trial' ? row.trial_ends_at : row.current_period_end;
  let daysRemaining: number | undefined;
  let hoursRemaining: number | undefined;
  if (endAnchor) {
    const diffMs = Math.max(0, new Date(endAnchor).getTime() - now.getTime());
    hoursRemaining = Math.ceil(diffMs / (60 * 60 * 1000));
    daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  }

  let showTrialDay4Warning = false;
  if (status === 'trial' && row.trial_started_at) {
    const elapsedMs = now.getTime() - new Date(row.trial_started_at).getTime();
    if (elapsedMs >= 3 * 24 * 60 * 60 * 1000) {
      // Day 4+ of 7-day trial (72+ hours elapsed or <= 4 days left)
      showTrialDay4Warning = true;
    }
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    tariffId,
    tariffName: tariffCfg.name,
    status,
    billingPeriodMonths: normalizeBillingPeriod(row.billing_period_months),
    maxLocations: tariffCfg.maxLocations,
    maxStaff: tariffCfg.maxStaff,
    trialStartedAt: row.trial_started_at ? new Date(row.trial_started_at).toISOString() : undefined,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : undefined,
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start).toISOString() : undefined,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : undefined,
    daysRemaining,
    hoursRemaining,
    showTrialDay4Warning,
    isReadOnly: status === 'expired_readonly',
    selectedTariffId: isValidTariffId(row.selected_tariff_id) ? row.selected_tariff_id : undefined,
    selectedPeriodMonths: row.selected_period_months ? normalizeBillingPeriod(row.selected_period_months) : undefined,
  };
}

export async function getOrganizationUsage(organizationId: string): Promise<{
  locationsCount: number;
  staffCount: number;
}> {
  const locRes = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) as count FROM locations WHERE organization_id = $1 AND (is_archived IS NULL OR is_archived = FALSE)',
    [organizationId]
  );
  const staffRes = await db.query<{ count: string | number }>(
    "SELECT COUNT(*) as count FROM users WHERE active_organization_id = $1 AND role = 'employee' AND status NOT IN ('archived', 'deleted')",
    [organizationId]
  );

  return {
    locationsCount: Number(locRes.rows[0]?.count || 0),
    staffCount: Number(staffRes.rows[0]?.count || 0),
  };
}

export async function checkLocationQuota(organizationId: string): Promise<QuotaCheckResult> {
  const [sub, usage] = await Promise.all([
    getOrganizationSubscription(organizationId),
    getOrganizationUsage(organizationId),
  ]);
  const tariffId = sub?.tariffId || 'start';
  const tariff = TARIFF_BY_ID[tariffId];
  const max = sub?.maxLocations ?? tariff.maxLocations;
  const current = usage.locationsCount;
  const allowed = current < max;

  return {
    allowed,
    current,
    max,
    tariffId,
    tariffName: tariff.name,
    message: allowed
      ? undefined
      : `Достигнут лимит вашего тарифа «${tariff.name}»: ${current} из ${max} ПВЗ/складов. Перейдите на более высокий тариф или архивируйте неиспользуемый объект.`,
  };
}

export async function checkStaffQuota(organizationId: string): Promise<QuotaCheckResult> {
  const [sub, usage] = await Promise.all([
    getOrganizationSubscription(organizationId),
    getOrganizationUsage(organizationId),
  ]);
  const tariffId = sub?.tariffId || 'start';
  const tariff = TARIFF_BY_ID[tariffId];
  const max = sub?.maxStaff ?? tariff.maxStaff;
  const current = usage.staffCount;
  const allowed = current < max;

  return {
    allowed,
    current,
    max,
    tariffId,
    tariffName: tariff.name,
    message: allowed
      ? undefined
      : `Достигнут лимит вашего тарифа «${tariff.name}»: ${current} из ${max} сотрудников. Перейдите на более высокий тариф или архивируйте неактивных сотрудников.`,
  };
}

export async function validateTariffDowngrade(
  organizationId: string,
  targetTariffId: TariffId
): Promise<{ allowed: boolean; reason?: string }> {
  const target = TARIFF_BY_ID[targetTariffId];
  const usage = await getOrganizationUsage(organizationId);

  if (usage.locationsCount > target.maxLocations) {
    return {
      allowed: false,
      reason: `На тарифе «${target.name}» доступно до ${target.maxLocations} ПВЗ/складов, но сейчас активно ${usage.locationsCount}. Сначала архивируйте лишние объекты.`,
    };
  }
  if (usage.staffCount > target.maxStaff) {
    return {
      allowed: false,
      reason: `На тарифе «${target.name}» доступно до ${target.maxStaff} сотрудников, но сейчас активно ${usage.staffCount}. Сначала архивируйте лишних сотрудников.`,
    };
  }
  return { allowed: true };
}

export async function createOrganizationWithTrial(params: {
  ownerUserId: string;
  name: string;
  inn?: string;
  timezone?: string;
  selectedTariffId?: TariffId;
  selectedPeriodMonths?: BillingPeriodMonths;
}): Promise<{ organization: OrganizationInfo; subscription: SubscriptionInfo }> {
  const orgId = `org-${uuidv4()}`;
  const cleanName = params.name.trim().slice(0, 120);
  const cleanInn = params.inn ? params.inn.trim().slice(0, 20) : null;
  const timezone = params.timezone?.trim() || 'Europe/Moscow';
  const selectedTariff: TariffId = isValidTariffId(params.selectedTariffId) ? params.selectedTariffId : 'business';
  const selectedPeriod: BillingPeriodMonths = normalizeBillingPeriod(params.selectedPeriodMonths || 1);

  const now = new Date();
  const trialStartIso = now.toISOString();
  const trialEndIso = addDaysIso(now, 7);
  const subId = `sub-${uuidv4()}`;

  // During 7-day trial, workspace gets 'maximum' operational limits so manager can test multi-warehouse & teams freely,
  // while storing their chosen landing tariff in selected_tariff_id / selected_period_months.
  const trialTariffId: TariffId = 'maximum';

  await db.transaction(async client => {
    await client.query(
      `INSERT INTO organizations (id, name, inn, timezone, owner_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, cleanName, cleanInn, timezone, params.ownerUserId]
    );

    await client.query(
      `INSERT INTO organization_members (id, organization_id, user_id, org_role, status)
       VALUES ($1, $2, $3, 'owner', 'active')`,
      [`mem-${uuidv4()}`, orgId, params.ownerUserId]
    );

    await client.query(
      `UPDATE users SET active_organization_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [orgId, params.ownerUserId]
    );

    await client.query(
      `INSERT INTO subscriptions (
         id, organization_id, tariff_id, status, billing_period_months,
         trial_started_at, trial_ends_at, selected_tariff_id, selected_period_months
       ) VALUES ($1, $2, $3, 'trial', $4, $5, $6, $7, $8)`,
      [subId, orgId, trialTariffId, selectedPeriod, trialStartIso, trialEndIso, selectedTariff, selectedPeriod]
    );

    await client.query(
      `INSERT INTO subscription_history (
         id, organization_id, subscription_id, previous_status, new_status,
         tariff_id, billing_period_months, reason, actor_user_id
       ) VALUES ($1, $2, $3, NULL, 'trial', $4, $5, 'TRIAL_STARTED', $6)`,
      [`subh-${uuidv4()}`, orgId, subId, trialTariffId, selectedPeriod, params.ownerUserId]
    );

    await client.query(
      `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
       VALUES ($1, $2, $3, $4, $5, 'system', 'system')`,
      [
        `notif-${uuidv4()}`,
        orgId,
        params.ownerUserId,
        'Добро пожаловать в SKLADIN!',
        `Пробный период 7 дней активирован до ${formatDateRu(trialEndIso)}. Начните с добавления первого склада и команды.`,
      ]
    );
  });

  const [organization, subscription] = await Promise.all([
    getOrganizationById(orgId),
    getOrganizationSubscription(orgId),
  ]);

  return {
    organization: organization!,
    subscription: subscription!,
  };
}

export async function activatePaidSubscription(params: {
  organizationId: string;
  tariffId: TariffId;
  periodMonths: BillingPeriodMonths;
  actorUserId?: string | null;
  reason?: string;
}): Promise<SubscriptionInfo | null> {
  const existing = await db.query<{
    id: string;
    status: SubscriptionStatus;
    current_period_end?: string;
  }>(
    'SELECT id, status, current_period_end FROM subscriptions WHERE organization_id = $1',
    [params.organizationId]
  );

  const now = new Date();
  const baseDate =
    existing.rows[0]?.status === 'active' &&
    existing.rows[0]?.current_period_end &&
    new Date(existing.rows[0].current_period_end) > now
      ? new Date(existing.rows[0].current_period_end)
      : now;

  const periodStartIso = now.toISOString();
  const periodEndIso = addMonthsIso(baseDate, params.periodMonths);

  if (existing.rows.length === 0) {
    const subId = `sub-${uuidv4()}`;
    await db.query(
      `INSERT INTO subscriptions (
         id, organization_id, tariff_id, status, billing_period_months,
         current_period_start, current_period_end, selected_tariff_id, selected_period_months
       ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $3, $4)`,
      [subId, params.organizationId, params.tariffId, params.periodMonths, periodStartIso, periodEndIso]
    );
    await db.query(
      `INSERT INTO subscription_history (
         id, organization_id, subscription_id, previous_status, new_status,
         tariff_id, billing_period_months, reason, actor_user_id
       ) VALUES ($1, $2, $3, NULL, 'active', $4, $5, $6, $7)`,
      [`subh-${uuidv4()}`, params.organizationId, subId, params.tariffId, params.periodMonths, params.reason || 'PAYMENT_CONFIRMED', params.actorUserId || null]
    );
  } else {
    const sub = existing.rows[0];
    await db.query(
      `UPDATE subscriptions
       SET tariff_id = $1,
           status = 'active',
           billing_period_months = $2,
           current_period_start = $3,
           current_period_end = $4,
           selected_tariff_id = $1,
           selected_period_months = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [params.tariffId, params.periodMonths, periodStartIso, periodEndIso, sub.id]
    );
    await db.query(
      `INSERT INTO subscription_history (
         id, organization_id, subscription_id, previous_status, new_status,
         tariff_id, billing_period_months, reason, actor_user_id
       ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8)`,
      [`subh-${uuidv4()}`, params.organizationId, sub.id, sub.status, params.tariffId, params.periodMonths, params.reason || 'PAYMENT_CONFIRMED', params.actorUserId || null]
    );
  }

  const tariffName = TARIFF_BY_ID[params.tariffId].name;
  await notifyOrgManagers(
    params.organizationId,
    `Подписка «${tariffName}» активна`,
    `Оплата подтверждена. Тариф «${tariffName}» активен до ${formatDateRu(periodEndIso)}.`
  );

  return getOrganizationSubscription(params.organizationId);
}

export async function runTrialLifecycleChecks(): Promise<void> {
  try {
    const subs = await db.query<{
      id: string;
      organization_id: string;
      status: string;
      trial_started_at?: string;
      trial_ends_at?: string;
      current_period_end?: string;
      trial_day4_notified_at?: string;
    }>(
      `SELECT id, organization_id, status, trial_started_at, trial_ends_at, current_period_end, trial_day4_notified_at
       FROM subscriptions
       WHERE status IN ('trial', 'active')`
    );

    const now = new Date();
    for (const row of subs.rows) {
      // Sync expiration transitions cleanly
      if (
        (row.status === 'trial' && row.trial_ends_at && new Date(row.trial_ends_at) <= now) ||
        (row.status === 'active' && row.current_period_end && new Date(row.current_period_end) <= now)
      ) {
        await getOrganizationSubscription(row.organization_id);
        continue;
      }

      // Day 4 warning notification once per trial
      if (
        row.status === 'trial' &&
        !row.trial_day4_notified_at &&
        row.trial_started_at &&
        now.getTime() - new Date(row.trial_started_at).getTime() >= 3 * 24 * 60 * 60 * 1000
      ) {
        const nowIso = now.toISOString();
        await db.query(
          'UPDATE subscriptions SET trial_day4_notified_at = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND trial_day4_notified_at IS NULL',
          [nowIso, row.id]
        );
        await notifyOrgManagers(
          row.organization_id,
          'Пробный период подходит к концу',
          `До завершения бесплатного 7-дневного периода осталось менее 4 дней (до ${formatDateRu(row.trial_ends_at)}). Выберите тариф, чтобы сохранить непрерывный доступ.`
        );
      }
    }
  } catch (err) {
    console.warn('[Subscription Lifecycle] Check warning:', err);
  }
}

async function notifyOrgManagers(organizationId: string, title: string, text: string): Promise<void> {
  try {
    const mgrs = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE active_organization_id = $1 AND role = 'manager' AND status = 'active'",
      [organizationId]
    );
    for (const m of mgrs.rows) {
      await db.query(
        `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
         VALUES ($1, $2, $3, $4, $5, 'system', 'system')`,
        [`notif-${uuidv4()}`, organizationId, m.id, title, text]
      );
    }
  } catch (err) {
    console.warn('[Subscription Notify] Error:', err);
  }
}
