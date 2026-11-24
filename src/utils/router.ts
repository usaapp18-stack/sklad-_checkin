import { useEffect, useState } from 'react';
import { PUBLIC_SITE_CONFIG, SEO_META_BY_PATH } from '../config/site';
import { BillingPeriodMonths, TariffId, isValidTariffId, normalizeBillingPeriod } from '../config/tariffs';

export function normalizePathname(raw: string): string {
  if (!raw) return '/';
  const cleaned = raw.split('?')[0].split('#')[0];
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
}

export function navigate(to: string, options?: { replace?: boolean }): void {
  if (typeof window === 'undefined') return;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (current === to) return;

  if (options?.replace) {
    window.history.replaceState({}, '', to);
  } else {
    window.history.pushState({}, '', to);
  }

  window.dispatchEvent(new PopStateEvent('popstate'));

  const hashIdx = to.indexOf('#');
  if (hashIdx !== -1) {
    const targetId = to.slice(hashIdx + 1);
    setTimeout(() => {
      const el = document.getElementById(targetId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  } else {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

export function useRouterLocation(): { pathname: string; search: string } {
  const [loc, setLoc] = useState<{ pathname: string; search: string }>(() => {
    if (typeof window === 'undefined') return { pathname: '/', search: '' };
    return {
      pathname: normalizePathname(window.location.pathname),
      search: window.location.search,
    };
  });

  useEffect(() => {
    const handlePop = () => {
      setLoc({
        pathname: normalizePathname(window.location.pathname),
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  return loc;
}

export function useDocumentSeo(pathname: string, dynamicMetrikaId?: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const normalized = pathname.startsWith('/app') ? '/app' : normalizePathname(pathname);
    const meta = SEO_META_BY_PATH[normalized] || SEO_META_BY_PATH['/'];

    document.title = meta.title;

    const setMeta = (selector: string, attr: 'name' | 'property', key: string, content: string) => {
      let el = document.querySelector(selector) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    setMeta('meta[name="description"]', 'name', 'description', meta.description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', meta.title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', meta.description);
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', meta.title);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', meta.description);

    const canonicalUrl = `${window.location.origin}${normalized}`;
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', canonicalUrl);

    const metrikaId = dynamicMetrikaId || PUBLIC_SITE_CONFIG.yandexMetrikaId;
    const w = window as any;
    if (metrikaId && typeof w.ym === 'function') {
      try {
        w.ym(Number(metrikaId) || metrikaId, 'hit', window.location.href, { title: meta.title });
      } catch {
        // Non-blocking telemetry
      }
    }
  }, [pathname, dynamicMetrikaId]);
}

const PLAN_HINT_STORAGE_KEY = 'skladin_selected_plan_hint';

export interface PlanSelectionHint {
  plan: TariffId;
  period: BillingPeriodMonths;
}

export function savePlanSelectionHint(plan: TariffId, period: BillingPeriodMonths): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PLAN_HINT_STORAGE_KEY, JSON.stringify({ plan, period }));
  } catch {
    // ignore
  }
}

export function getPlanSelectionHint(): PlanSelectionHint {
  if (typeof window !== 'undefined') {
    try {
      const sp = new URLSearchParams(window.location.search);
      const urlPlan = sp.get('plan');
      const urlPeriod = sp.get('period');
      if (isValidTariffId(urlPlan)) {
        const hint: PlanSelectionHint = {
          plan: urlPlan,
          period: normalizeBillingPeriod(urlPeriod || 1),
        };
        savePlanSelectionHint(hint.plan, hint.period);
        return hint;
      }

      const raw = sessionStorage.getItem(PLAN_HINT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidTariffId(parsed?.plan)) {
          return {
            plan: parsed.plan,
            period: normalizeBillingPeriod(parsed.period || 1),
          };
        }
      }
    } catch {
      // ignore
    }
  }
  return { plan: 'business', period: 1 };
}

export function clearPlanSelectionHint(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PLAN_HINT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
