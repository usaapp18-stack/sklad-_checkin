import React, { useState } from 'react';
import {
  BILLING_PERIODS,
  BillingPeriodMonths,
  TARIFF_COMPARISON_ROWS,
  TARIFF_PLANS,
  TariffId,
  calculateTariffPrice,
  formatRub,
} from '../../config/tariffs';
import { trackAnalyticsEvent } from '../../config/site';
import { navigate, savePlanSelectionHint } from '../../utils/router';
import { Check, ArrowRight } from 'lucide-react';

interface TariffSectionProps {
  showComparisonTable?: boolean;
}

export const TariffSection: React.FC<TariffSectionProps> = ({ showComparisonTable = true }) => {
  const [period, setPeriod] = useState<BillingPeriodMonths>(1);

  const handleSelectPlan = (tariffId: TariffId) => {
    savePlanSelectionHint(tariffId, period);
    trackAnalyticsEvent('tariff_select', { tariff: tariffId, period_months: period });
    navigate(`/register?plan=${tariffId}&period=${period}`);
  };

  return (
    <div className="space-y-12">
      {/* Period Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white border border-[#d9dbe0] rounded-lg">
        <div className="space-y-0.5">
          <div className="text-sm font-bold text-[#111111]">Выберите период оплаты</div>
          <div className="text-xs text-[#5d6270]">
            При оплате за 3, 6 или 12 месяцев скидка применяется автоматически
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-1.5 bg-[#f7f9ff] p-1 rounded-md border border-[#d9dbe0]">
          {BILLING_PERIODS.map(p => {
            const active = period === p.months;
            return (
              <button
                key={p.months}
                type="button"
                onClick={() => {
                  setPeriod(p.months);
                  trackAnalyticsEvent('billing_period_switch', { period_months: p.months });
                }}
                className={`min-h-[40px] px-3 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                  active
                    ? 'bg-[#111111] text-white'
                    : 'text-[#2d313b] hover:text-[#111111] hover:bg-white'
                }`}
              >
                <span>{p.shortLabel}</span>
                {p.discountPercent > 0 && (
                  <span className={`font-mono text-[11px] ${active ? 'text-[#a9bcff]' : 'text-emerald-700'}`}>
                    −{p.discountPercent}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 Tariff Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {TARIFF_PLANS.map(plan => {
          const calc = calculateTariffPrice(plan.id, period);
          return (
            <div
              key={plan.id}
              className={`bg-white rounded-lg border p-6 sm:p-7 flex flex-col justify-between gap-6 ${
                plan.recommended ? 'border-[#2f63ff] ring-1 ring-[#2f63ff]' : 'border-[#d9dbe0]'
              }`}
            >
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-bold text-[#111111]">{plan.name}</h3>
                    {plan.recommended && (
                      <span className="text-xs font-semibold text-[#2f63ff]">Оптимальный выбор</span>
                    )}
                  </div>
                  <p className="text-sm text-[#5d6270] leading-relaxed">{plan.subtitle}</p>
                </div>

                {/* Price Block */}
                <div className="pt-4 border-t border-[#e5e7eb] space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold font-mono tabular-nums text-[#111111]">
                      {formatRub(calc.finalPriceRub)}
                    </span>
                    <span className="text-xs text-[#5d6270]">за {calc.months} мес</span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-[#2d313b]">
                    {formatRub(calc.effectiveMonthlyRub)} / мес
                    {calc.savingsRub > 0 && (
                      <span className="text-emerald-700 font-semibold ml-2">
                        · экономия {formatRub(calc.savingsRub)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Limits & Inclusions */}
                <ul className="space-y-2.5 pt-2 text-sm text-[#111111]">
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-[#2f63ff] shrink-0" />
                    <span>
                      До <strong className="font-mono tabular-nums">{plan.maxLocations}</strong> складов / ПВЗ
                    </span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-[#2f63ff] shrink-0" />
                    <span>
                      До <strong className="font-mono tabular-nums">{plan.maxStaff}</strong> сотрудников
                    </span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-[#2f63ff] shrink-0" />
                    <span>Все модули учёта смен, QR/GPS, графиков и расчёта ФОТ</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-[#2f63ff] shrink-0" />
                    <span>7 дней бесплатного пробного периода без привязки карты</span>
                  </li>
                </ul>
              </div>

              <button
                type="button"
                onClick={() => handleSelectPlan(plan.id)}
                className={`w-full min-h-[44px] px-4 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  plan.recommended
                    ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white'
                    : 'bg-[#111111] hover:bg-[#2a2d36] text-white'
                }`}
              >
                <span>Попробовать 7 дней бесплатно</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Transparent Comparison Table */}
      {showComparisonTable && (
        <div className="bg-white border border-[#d9dbe0] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e5e7eb]">
            <h3 className="text-base font-bold text-[#111111]">Сравнение тарифов по параметрам</h3>
            <p className="text-xs text-[#5d6270] mt-0.5">
              Все базовые модули SKLADIN доступны на каждом тарифе — тарифы отличаются масштабом по количеству объектов и сотрудников
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm text-left">
              <thead className="bg-[#f7f9ff] text-[#5d6270] border-b border-[#d9dbe0]">
                <tr>
                  <th className="py-3 px-5 font-semibold">Параметр</th>
                  <th className="py-3 px-4 font-bold text-[#111111]">Старт</th>
                  <th className="py-3 px-4 font-bold text-[#2f63ff]">Бизнес</th>
                  <th className="py-3 px-4 font-bold text-[#111111]">Максимум</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb]">
                {TARIFF_COMPARISON_ROWS.map(row => (
                  <tr key={row.id}>
                    <td className="py-3 px-5 font-medium text-[#111111]">{row.label}</td>
                    {(['start', 'business', 'maximum'] as const).map(tid => {
                      const val = row.values[tid];
                      return (
                        <td key={tid} className="py-3 px-4 text-[#2d313b]">
                          {val === true ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <Check className="w-4 h-4" />
                              <span>Включено</span>
                            </span>
                          ) : (
                            <span className="font-mono tabular-nums font-semibold text-[#111111]">{val}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
