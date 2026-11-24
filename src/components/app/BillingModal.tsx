import React, { useEffect, useId, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  BILLING_PERIODS,
  BillingPeriodMonths,
  TARIFF_PLANS,
  TariffId,
  calculateTariffPrice,
  formatRub,
} from '../../config/tariffs';
import { BillingPaymentItem } from '../../types';
import { trackAnalyticsEvent } from '../../config/site';
import { getPlanSelectionHint } from '../../utils/router';
import {
  AlertCircle,
  Building2,
  Check,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  QrCode,
  Split,
  X,
} from 'lucide-react';

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PaymentMethodKey = 'card' | 'sbp' | 'invoice' | 'yandex_split';

interface ProvidersStatus {
  yookassaConfigured: boolean;
  sbpConfigured: boolean;
  invoiceConfigured: boolean;
  yandexSplitConfigured: boolean;
}

export const BillingModal: React.FC<BillingModalProps> = ({ isOpen, onClose }) => {
  const companyNameId = useId();
  const companyInnId = useId();
  const companyKppId = useId();
  const companyAddressId = useId();
  const { apiFetch, subscription, organization, refreshOrganization } = useApp();
  const initialHint = getPlanSelectionHint();

  const [selectedTariff, setSelectedTariff] = useState<TariffId>(
    subscription?.selectedTariffId || subscription?.tariffId || initialHint.plan
  );
  const [selectedPeriod, setSelectedPeriod] = useState<BillingPeriodMonths>(
    subscription?.selectedPeriodMonths || subscription?.billingPeriodMonths || initialHint.period
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodKey>('card');

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successPayment, setSuccessPayment] = useState<BillingPaymentItem | null>(null);

  const [usage, setUsage] = useState<{ locationsCount: number; staffCount: number }>({
    locationsCount: 0,
    staffCount: 0,
  });
  const [payments, setPayments] = useState<BillingPaymentItem[]>([]);
  const [providers, setProviders] = useState<ProvidersStatus>({
    yookassaConfigured: false,
    sbpConfigured: false,
    invoiceConfigured: true,
    yandexSplitConfigured: false,
  });

  // B2B Invoice fields
  const [companyName, setCompanyName] = useState(organization?.name || '');
  const [companyInn, setCompanyInn] = useState(organization?.inn || '');
  const [companyKpp, setCompanyKpp] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccessPayment(null);
    setCompanyName(organization?.name || '');
    setCompanyInn(organization?.inn || '');

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await apiFetch('/api/v1/billing/subscription');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.success) {
          if (data.usage) setUsage(data.usage);
          if (Array.isArray(data.payments)) setPayments(data.payments);
          if (data.providers) setProviders(data.providers);
          if (data.subscription?.selectedTariffId) {
            setSelectedTariff(data.subscription.selectedTariffId);
          }
          if (data.subscription?.selectedPeriodMonths) {
            setSelectedPeriod(data.subscription.selectedPeriodMonths);
          }
        }
      } catch {
        // non-blocking
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, apiFetch, organization?.name, organization?.inn]);

  if (!isOpen) return null;

  const priceCalc = calculateTariffPrice(selectedTariff, selectedPeriod);
  const chosenPlan = TARIFF_PLANS.find(p => p.id === selectedTariff)!;

  const exceedsLocationLimit = usage.locationsCount > chosenPlan.maxLocations;
  const exceedsStaffLimit = usage.staffCount > chosenPlan.maxStaff;
  const isDowngradeBlocked = exceedsLocationLimit || exceedsStaffLimit;

  const isMethodReady =
    paymentMethod === 'invoice'
      ? providers.invoiceConfigured
      : paymentMethod === 'card'
      ? providers.yookassaConfigured
      : paymentMethod === 'sbp'
      ? providers.sbpConfigured
      : providers.yandexSplitConfigured;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessPayment(null);

    if (isDowngradeBlocked) {
      setError(
        `Невозможно перейти на тариф «${chosenPlan.name}»: текущее использование (${usage.locationsCount} ПВЗ, ${usage.staffCount} сотр.) превышает лимиты тарифа.`
      );
      return;
    }

    setSubmitting(true);
    trackAnalyticsEvent('checkout_start', {
      tariff: selectedTariff,
      period_months: selectedPeriod,
      payment_method: paymentMethod,
      amount_rub: priceCalc.finalPriceRub,
    });

    try {
      const res = await apiFetch('/api/v1/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          tariffId: selectedTariff,
          periodMonths: selectedPeriod,
          paymentMethod,
          returnUrl: typeof window !== 'undefined' ? `${window.location.origin}/app` : undefined,
          companyRequisites:
            paymentMethod === 'invoice'
              ? {
                  companyName: companyName.trim() || organization?.name,
                  inn: companyInn.trim() || undefined,
                  kpp: companyKpp.trim() || undefined,
                  address: companyAddress.trim() || undefined,
                }
              : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error?.message || 'Не удалось создать платёж');
        return;
      }

      const created: BillingPaymentItem = data.payment;
      setSuccessPayment(created);
      setPayments(prev => [created, ...prev]);

      // Note: Do not use window.open; show explicit clickable confirmation link in UI
      refreshOrganization().catch(() => {});
    } catch (err: any) {
      setError(err?.message || 'Ошибка соединения при создании платежа');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#111111]/55 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-modal-title"
    >
      <div className="w-full max-w-4xl bg-white border border-[#d9dbe0] rounded-md overflow-hidden my-auto max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-[#111111] text-white flex items-center justify-between shrink-0">
          <div>
            <h2 id="billing-modal-title" className="text-base sm:text-lg font-bold">
              Тарифы и оплата подписки
            </h2>
            <p className="text-xs text-white/70">
              {organization?.name || 'Организация'} ·{' '}
              {subscription?.status === 'trial'
                ? `Пробный период (осталось ${subscription.daysRemaining ?? 0} дн.)`
                : subscription?.status === 'active'
                ? `Активен тариф «${subscription.tariffName}»`
                : 'Режим чтения'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white rounded cursor-pointer transition-colors"
            aria-label="Закрыть окно тарифов"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
          {/* Current Quota & Usage Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs">
            <div>
              <div className="text-[#5d6270]">Текущий тариф</div>
              <div className="font-bold text-[#111111] mt-0.5 text-sm">
                {subscription?.tariffName || 'Пробный период'}
              </div>
            </div>
            <div>
              <div className="text-[#5d6270]">Активные склады / ПВЗ</div>
              <div className="font-mono tabular-nums font-bold text-[#111111] mt-0.5 text-sm">
                {loading ? '...' : `${usage.locationsCount} / ${subscription?.maxLocations ?? 30}`}
              </div>
            </div>
            <div>
              <div className="text-[#5d6270]">Активные сотрудники</div>
              <div className="font-mono tabular-nums font-bold text-[#111111] mt-0.5 text-sm">
                {loading ? '...' : `${usage.staffCount} / ${subscription?.maxStaff ?? 150}`}
              </div>
            </div>
          </div>

          {/* Period Selector */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#2d313b]">Период оплаты и скидка за длительность</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BILLING_PERIODS.map(p => {
                const active = selectedPeriod === p.months;
                return (
                  <button
                    key={p.months}
                    type="button"
                    onClick={() => setSelectedPeriod(p.months)}
                    className={`min-h-[44px] px-3 py-2 rounded border text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                      active
                        ? 'bg-[#111111] text-white border-[#111111]'
                        : 'bg-white text-[#111111] border-[#d9dbe0] hover:bg-[#f7f9ff]'
                    }`}
                  >
                    <span>{p.label}</span>
                    {p.discountPercent > 0 && (
                      <span
                        className={`font-mono text-[11px] ${
                          active ? 'text-[#2f63ff]' : 'text-emerald-700'
                        }`}
                      >
                        −{p.discountPercent}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3 Tariff Plans */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {TARIFF_PLANS.map(plan => {
              const calc = calculateTariffPrice(plan.id, selectedPeriod);
              const isSelected = selectedTariff === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedTariff(plan.id)}
                  className={`text-left p-4 rounded border transition-colors cursor-pointer flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#eef2ff] border-[#2f63ff] ring-1 ring-[#2f63ff]'
                      : 'bg-white border-[#d9dbe0] hover:border-[#111111]'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-bold text-[#111111]">{plan.name}</span>
                      {plan.recommended && (
                        <span className="text-[11px] font-semibold text-[#1d4ed8]">Рекомендуемый</span>
                      )}
                    </div>
                    <p className="text-xs text-[#2d313b] leading-snug">{plan.subtitle}</p>
                  </div>

                  <div className="space-y-1 pt-2 border-t border-[#e5e7eb]">
                    <div className="text-lg font-bold font-mono tabular-nums text-[#111111]">
                      {formatRub(calc.finalPriceRub)}
                    </div>
                    <div className="text-[11px] text-[#5d6270] font-mono tabular-nums">
                      {formatRub(calc.effectiveMonthlyRub)} / мес
                      {calc.savingsRub > 0 ? ` · экономия ${formatRub(calc.savingsRub)}` : ''}
                    </div>
                    <div className="text-xs font-medium text-[#111111] pt-1">
                      до {plan.maxLocations} ПВЗ · до {plan.maxStaff} сотрудников
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {isDowngradeBlocked && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-md text-xs text-[#111111] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-[#b45309] shrink-0 mt-0.5" />
              <div>
                <strong>Переход на тариф «{chosenPlan.name}» сейчас заблокирован:</strong> у вас активно{' '}
                {usage.locationsCount} ПВЗ и {usage.staffCount} сотрудников (лимит выбранного тарифа: до{' '}
                {chosenPlan.maxLocations} ПВЗ и до {chosenPlan.maxStaff} сотрудников). Перенесите лишние объекты или
                сотрудников в архив либо выберите более старший тариф.
              </div>
            </div>
          )}

          {/* Payment Method Selector + Checkout Form */}
          <form onSubmit={handleCheckout} className="space-y-4 border-t border-[#e5e7eb] pt-5">
            <div className="text-xs font-semibold text-[#2d313b]">Способ оплаты</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                {
                  id: 'card' as const,
                  label: 'Банковская карта',
                  icon: CreditCard,
                  ready: providers.yookassaConfigured,
                  note: providers.yookassaConfigured ? 'ЮKassa подключена' : 'Требуются ключи ЮKassa',
                },
                {
                  id: 'sbp' as const,
                  label: 'СБП (QR-код)',
                  icon: QrCode,
                  ready: providers.sbpConfigured,
                  note: providers.sbpConfigured ? 'ЮKassa СБП готова' : 'Не подключено (ЮKassa)',
                },
                {
                  id: 'invoice' as const,
                  label: 'Счёт для юрлиц',
                  icon: Landmark,
                  ready: providers.invoiceConfigured,
                  note: 'Выставление счёта PDF/реквизиты',
                },
                {
                  id: 'yandex_split' as const,
                  label: 'Яндекс Сплит',
                  icon: Split,
                  ready: providers.yandexSplitConfigured,
                  note: 'Не подключено',
                },
              ].map(m => {
                const Icon = m.icon;
                const active = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(m.id);
                      setError(null);
                    }}
                    className={`p-3 rounded border text-left transition-colors cursor-pointer space-y-1 ${
                      active
                        ? 'bg-[#eef2ff] border-[#2f63ff] ring-1 ring-[#2f63ff]'
                        : 'bg-white border-[#d9dbe0] hover:bg-[#f7f9ff]'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-[#111111]">
                      <Icon className={`w-4 h-4 ${active ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                      <span>{m.label}</span>
                    </div>
                    <div className={`text-[11px] ${m.ready ? 'text-emerald-700' : 'text-[#5d6270]'}`}>
                      {m.note}
                    </div>
                  </button>
                );
              })}
            </div>

            {paymentMethod === 'invoice' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                <div>
                  <label htmlFor={companyNameId} className="block text-xs font-medium text-[#2d313b] mb-1">Наименование юрлица / ИП</label>
                  <input
                    id={companyNameId}
                    type="text"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="ООО «Логистика»"
                    className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
                <div>
                  <label htmlFor={companyInnId} className="block text-xs font-medium text-[#2d313b] mb-1">ИНН</label>
                  <input
                    id={companyInnId}
                    type="text"
                    value={companyInn}
                    onChange={e => setCompanyInn(e.target.value)}
                    placeholder="7700000000"
                    className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-xs font-mono text-[#111111] focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
                <div>
                  <label htmlFor={companyKppId} className="block text-xs font-medium text-[#2d313b] mb-1">КПП (для ООО)</label>
                  <input
                    id={companyKppId}
                    type="text"
                    value={companyKpp}
                    onChange={e => setCompanyKpp(e.target.value)}
                    placeholder="770001001"
                    className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-xs font-mono text-[#111111] focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
                <div>
                  <label htmlFor={companyAddressId} className="block text-xs font-medium text-[#2d313b] mb-1">Юридический адрес</label>
                  <input
                    id={companyAddressId}
                    type="text"
                    value={companyAddress}
                    onChange={e => setCompanyAddress(e.target.value)}
                    placeholder="г. Москва..."
                    className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
              </div>
            )}

            {!isMethodReady && (
              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs text-[#2d313b]">
                Онлайн-приём для метода «{paymentMethod === 'yandex_split' ? 'Яндекс Сплит' : 'ЮKassa'}» не активирован в текущих переменных окружения сервера. Вы можете прямо сейчас сформировать «Счёт для юрлиц» или подключить ключи ЮKassa (`YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY`).
              </div>
            )}

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {successPayment && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-950 space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <Check className="w-4 h-4 text-emerald-700" />
                  <span>
                    {successPayment.paymentMethod === 'invoice'
                      ? `Счёт ${successPayment.invoiceNumber} сформирован (ожидает оплаты)`
                      : 'Заявка на оплату создана'}
                  </span>
                </div>
                <div className="font-mono tabular-nums">
                  Сумма к оплате: <strong>{formatRub(successPayment.amountRub)}</strong> · Тариф «{chosenPlan.name}» на{' '}
                  {selectedPeriod} мес.
                </div>
                {successPayment.confirmationUrl && (
                  <a
                    href={successPayment.confirmationUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#111111] text-white font-semibold rounded hover:bg-[#2f63ff] transition-colors"
                  >
                    <span>Перейти к оплате в ЮKassa</span>
                  </a>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="text-xs text-[#2d313b]">
                Итого к оплате:{' '}
                <strong className="text-base font-mono tabular-nums text-[#111111]">
                  {formatRub(priceCalc.finalPriceRub)}
                </strong>{' '}
                за {selectedPeriod} мес.
              </div>
              <button
                type="submit"
                disabled={submitting || isDowngradeBlocked || !isMethodReady}
                className="min-h-[44px] px-5 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] disabled:bg-[#e5e7eb] disabled:text-[#5d6270] text-white font-semibold text-xs rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {paymentMethod === 'invoice'
                    ? 'Сформировать счёт на оплату'
                    : 'Перейти к оплате'}
                </span>
              </button>
            </div>
          </form>

          {/* Payment History */}
          {payments.length > 0 && (
            <div className="space-y-2 border-t border-[#e5e7eb] pt-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#2d313b]">
                <FileText className="w-4 h-4 text-[#2f63ff]" />
                <span>История счетов и платежей</span>
              </div>
              <div className="overflow-x-auto border border-[#d9dbe0] rounded-md">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#f7f9ff] text-[#2d313b] border-b border-[#d9dbe0]">
                    <tr>
                      <th className="py-2 px-3">Дата</th>
                      <th className="py-2 px-3">Тариф / срок</th>
                      <th className="py-2 px-3">Способ</th>
                      <th className="py-2 px-3">Сумма</th>
                      <th className="py-2 px-3">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5e7eb]">
                    {payments.map(p => (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-mono tabular-nums">
                          {new Date(p.createdAt).toLocaleDateString('ru-RU')}
                        </td>
                        <td className="py-2 px-3">
                          {p.tariffId} · {p.periodMonths} мес.
                        </td>
                        <td className="py-2 px-3">
                          {p.invoiceNumber ? `Счёт ${p.invoiceNumber}` : p.paymentMethod}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums font-semibold">
                          {formatRub(p.amountRub)}
                        </td>
                        <td className="py-2 px-3">
                          {p.status === 'succeeded'
                            ? 'Оплачен'
                            : p.status === 'pending'
                            ? 'Ожидает оплаты'
                            : p.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
