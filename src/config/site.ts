export interface PublicSiteConfig {
  brandName: string;
  contactEmail: string;
  contactPhone: string;
  contactTelegram: string;
  legalEntityName: string;
  yandexMetrikaId: string;
  hasRealContacts: boolean;
}

const env = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};

export const PUBLIC_SITE_CONFIG: PublicSiteConfig = {
  brandName: 'SKLADIN',
  contactEmail: env.VITE_CONTACT_EMAIL || '',
  contactPhone: env.VITE_CONTACT_PHONE || '',
  contactTelegram: env.VITE_CONTACT_TELEGRAM || '',
  legalEntityName: env.VITE_COMPANY_NAME || 'SKLADIN',
  yandexMetrikaId: env.VITE_YANDEX_METRIKA_ID || '',
  hasRealContacts: Boolean(env.VITE_CONTACT_EMAIL || env.VITE_CONTACT_PHONE || env.VITE_CONTACT_TELEGRAM),
};

export interface PageSeoMeta {
  path: string;
  title: string;
  description: string;
  h1?: string;
}

export const SEO_META_BY_PATH: Record<string, PageSeoMeta> = {
  '/': {
    path: '/',
    title: 'SKLADIN — Учёт смен, сотрудников и зарплаты склада в одной системе',
    description:
      'SKLADIN помогает контролировать выходы на работу, вести графики смен, учитывать отработанное время с QR и GPS и рассчитывать оплату сотрудников склада и ПВЗ.',
  },
  '/features': {
    path: '/features',
    title: 'Возможности SKLADIN — Check-in, QR-проходная, графики, ФОТ и табель',
    description:
      'Подробный обзор модулей SKLADIN: контроль выхода сотрудников, QR-проходная и GPS-геозоны, планирование графиков, биржа смен, расчёт зарплаты и отчётность.',
  },
  '/pricing': {
    path: '/pricing',
    title: 'Тарифы SKLADIN — от 1 900 ₽/мес, скидки до 20% и 7 дней бесплатно',
    description:
      'Тарифы Старт, Бизнес и Максимум для учёта смен на складах и ПВЗ. Динамический расчёт стоимости за 1, 3, 6 и 12 месяцев и бесплатный пробный период 7 дней.',
  },
  '/about': {
    path: '/about',
    title: 'О сервисе SKLADIN — система управления сменами и персоналом склада',
    description:
      'Как устроен SKLADIN, какие операционные задачи складов, логистических терминалов и ПВЗ решает система и как организована безопасность данных.',
  },
  '/contacts': {
    path: '/contacts',
    title: 'Контакты SKLADIN — обратная связь и консультация по внедрению',
    description:
      'Свяжитесь с командой SKLADIN для консультации по запуску учёта смен и зарплаты на вашем складе или сети ПВЗ.',
  },
  '/faq': {
    path: '/faq',
    title: 'Частые вопросы (FAQ) — SKLADIN',
    description:
      'Ответы на вопросы о работе SKLADIN: учёт нескольких складов, Check-in/Check-out, расчёт зарплаты, демо-режим, 7-дневный триал, сохранность данных и оплата.',
  },
  '/privacy': {
    path: '/privacy',
    title: 'Политика обработки персональных данных — SKLADIN',
    description:
      'Условия сбора, хранения, защиты и обработки персональных данных пользователей сервиса SKLADIN.',
  },
  '/terms': {
    path: '/terms',
    title: 'Условия использования сервиса — SKLADIN',
    description:
      'Пользовательское соглашение, правила предоставления доступа, пробного периода и подписок сервиса SKLADIN.',
  },
  '/login': {
    path: '/login',
    title: 'Вход в личный кабинет — SKLADIN',
    description:
      'Авторизация руководителей и сотрудников склада в рабочем кабинете SKLADIN.',
  },
  '/register': {
    path: '/register',
    title: 'Регистрация руководителя и 7 дней бесплатно — SKLADIN',
    description:
      'Создайте учётную запись руководителя в SKLADIN и получите 7 дней бесплатного пробного доступа к системе учёта смен и зарплаты.',
  },
  '/demo': {
    path: '/demo',
    title: 'Демонстрация интерфейса SKLADIN — ознакомительный режим',
    description:
      'Изучите реальный интерфейс кабинета руководителя и сотрудника SKLADIN в изолированном режиме просмотра без регистрации.',
  },
  '/app': {
    path: '/app',
    title: 'Рабочий кабинет — SKLADIN',
    description: 'Личный кабинет управления сменами, сотрудниками, складами и зарплатой SKLADIN.',
  },
};

export type AnalyticsEventName =
  | 'pricing_view'
  | 'tariff_select'
  | 'billing_period_switch'
  | 'trial_cta_click'
  | 'demo_open'
  | 'registration_start'
  | 'registration_success'
  | 'checkout_start'
  | 'payment_success';

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'card', 'cvv', 'cvc', 'csrf'];

export function sanitizeAnalyticsParams(params?: Record<string, unknown>): Record<string, string | number | boolean> {
  if (!params) return {};
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some(s => lower.includes(s))) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      clean[k] = v;
    }
  }
  return clean;
}

export function captureUtmParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const sp = new URLSearchParams(window.location.search);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    const captured: Record<string, string> = {};
    for (const k of utmKeys) {
      const val = sp.get(k);
      if (val) captured[k] = val.slice(0, 120);
    }
    if (Object.keys(captured).length > 0) {
      sessionStorage.setItem('skladin_utm', JSON.stringify(captured));
      return captured;
    }
    const stored = sessionStorage.getItem('skladin_utm');
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  params?: Record<string, unknown>,
  dynamicMetrikaId?: string
): void {
  if (typeof window === 'undefined') return;
  const metrikaId = dynamicMetrikaId || PUBLIC_SITE_CONFIG.yandexMetrikaId;
  const safeParams = {
    ...captureUtmParams(),
    ...sanitizeAnalyticsParams(params),
  };

  try {
    const w = window as any;
    if (metrikaId && typeof w.ym === 'function') {
      w.ym(Number(metrikaId) || metrikaId, 'reachGoal', eventName, safeParams);
    }
    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event: eventName, ...safeParams });
    }
  } catch {
    // Non-blocking telemetry
  }
}
