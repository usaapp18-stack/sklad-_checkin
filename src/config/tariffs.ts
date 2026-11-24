export type TariffId = 'start' | 'business' | 'maximum';
export type BillingPeriodMonths = 1 | 3 | 6 | 12;

export interface TariffPlanConfig {
  id: TariffId;
  name: string;
  subtitle: string;
  maxLocations: number;
  maxStaff: number;
  monthlyPriceRub: number;
  recommended?: boolean;
}

export interface BillingPeriodConfig {
  months: BillingPeriodMonths;
  label: string;
  shortLabel: string;
  discountPercent: number;
}

export interface TariffPriceCalculation {
  tariffId: TariffId;
  months: BillingPeriodMonths;
  monthlyPriceRub: number;
  baseTotalRub: number;
  discountPercent: number;
  finalPriceRub: number;
  effectiveMonthlyRub: number;
  savingsRub: number;
}

export const TARIFF_PLANS: TariffPlanConfig[] = [
  {
    id: 'start',
    name: 'Старт',
    subtitle: 'Для одного склада или ПВЗ с небольшой командой',
    maxLocations: 1,
    maxStaff: 2,
    monthlyPriceRub: 1900,
  },
  {
    id: 'business',
    name: 'Бизнес',
    subtitle: 'Для двух объектов и слаженной смены до 5 человек',
    maxLocations: 2,
    maxStaff: 5,
    monthlyPriceRub: 3900,
    recommended: true,
  },
  {
    id: 'maximum',
    name: 'Максимум',
    subtitle: 'Для сети складов, фулфилмента и крупных команд',
    maxLocations: 30,
    maxStaff: 150,
    monthlyPriceRub: 4900,
  },
];

export const BILLING_PERIODS: BillingPeriodConfig[] = [
  { months: 1, label: '1 месяц', shortLabel: '1 мес', discountPercent: 0 },
  { months: 3, label: '3 месяца', shortLabel: '3 мес', discountPercent: 5 },
  { months: 6, label: '6 месяцев', shortLabel: '6 мес', discountPercent: 10 },
  { months: 12, label: '12 месяцев', shortLabel: '12 мес', discountPercent: 20 },
];

export const TARIFF_BY_ID: Record<TariffId, TariffPlanConfig> = {
  start: TARIFF_PLANS[0],
  business: TARIFF_PLANS[1],
  maximum: TARIFF_PLANS[2],
};

export const PERIOD_BY_MONTHS: Record<BillingPeriodMonths, BillingPeriodConfig> = {
  1: BILLING_PERIODS[0],
  3: BILLING_PERIODS[1],
  6: BILLING_PERIODS[2],
  12: BILLING_PERIODS[3],
};

export function isValidTariffId(val: unknown): val is TariffId {
  return val === 'start' || val === 'business' || val === 'maximum';
}

export function normalizeBillingPeriod(val: unknown): BillingPeriodMonths {
  const n = Number(val);
  if (n === 3 || n === 6 || n === 12) return n;
  return 1;
}

/**
 * Exact pricing calculation without arbitrary rounding:
 * Итоговая стоимость = месячная цена × количество месяцев × (1 − скидка)
 */
export function calculateTariffPrice(
  tariffId: TariffId,
  months: BillingPeriodMonths
): TariffPriceCalculation {
  const plan = TARIFF_BY_ID[tariffId] || TARIFF_BY_ID.business;
  const period = PERIOD_BY_MONTHS[months] || PERIOD_BY_MONTHS[1];

  const baseTotalRub = plan.monthlyPriceRub * period.months;
  const discountPercent = period.discountPercent;
  const finalPriceRub = (baseTotalRub * (100 - discountPercent)) / 100;
  const savingsRub = baseTotalRub - finalPriceRub;
  const effectiveMonthlyRub = finalPriceRub / period.months;

  return {
    tariffId: plan.id,
    months: period.months,
    monthlyPriceRub: plan.monthlyPriceRub,
    baseTotalRub,
    discountPercent,
    finalPriceRub,
    effectiveMonthlyRub,
    savingsRub,
  };
}

export function formatRub(amount: number): string {
  const isInteger = Number.isInteger(amount);
  return (
    amount.toLocaleString('ru-RU', {
      minimumFractionDigits: isInteger ? 0 : 2,
      maximumFractionDigits: 2,
    }) + ' ₽'
  );
}

export interface TariffComparisonRow {
  id: string;
  label: string;
  values: Record<TariffId, string | boolean>;
  note?: string;
}

/**
 * Factual tariff comparison matrix — strictly reflecting confirmed quantitative limits
 * and real SKLADIN modules without invented feature differences.
 */
export const TARIFF_COMPARISON_ROWS: TariffComparisonRow[] = [
  {
    id: 'locations',
    label: 'Количество ПВЗ / складов',
    values: { start: 'До 1', business: 'До 2', maximum: 'До 30' },
  },
  {
    id: 'staff',
    label: 'Количество сотрудников',
    values: { start: 'До 2', business: 'До 5', maximum: 'До 150' },
  },
  {
    id: 'core_modules',
    label: 'Доступ к основным модулям SKLADIN',
    values: { start: true, business: true, maximum: true },
  },
  {
    id: 'schedules',
    label: 'Управление графиками смен и биржей',
    values: { start: true, business: true, maximum: true },
  },
  {
    id: 'checkins',
    label: 'Check-in / Check-out и контроль смен',
    values: { start: true, business: true, maximum: true },
  },
  {
    id: 'payroll',
    label: 'Расчёт заработной платы (ФОТ) и ставок',
    values: { start: true, business: true, maximum: true },
  },
  {
    id: 'reports',
    label: 'Табель рабочего времени, отчётность и Excel',
    values: { start: true, business: true, maximum: true },
  },
  {
    id: 'qr_gate',
    label: 'QR-проходная и GPS-геоверификация',
    values: { start: true, business: true, maximum: true },
  },
  {
    id: 'extra_limits',
    label: 'Дополнительные ограничения',
    values: {
      start: 'Только по числу ПВЗ и сотрудников',
      business: 'Только по числу ПВЗ и сотрудников',
      maximum: 'Только по числу ПВЗ и сотрудников',
    },
  },
];
