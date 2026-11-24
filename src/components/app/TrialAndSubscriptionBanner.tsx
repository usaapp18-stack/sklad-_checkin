import React from 'react';
import { useApp } from '../../context/AppContext';
import { TARIFF_BY_ID } from '../../config/tariffs';
import { AlertTriangle, Clock, CreditCard, Lock } from 'lucide-react';

export const TrialAndSubscriptionBanner: React.FC = () => {
  const { subscription, currentRole, setBillingModalOpen } = useApp();

  if (!subscription || subscription.status === 'demo') {
    return null;
  }

  // Only show prominent billing controls cleanly without clutter
  if (subscription.status === 'expired_readonly') {
    return (
      <div className="bg-amber-50 border-b border-amber-300 text-[#111111]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start sm:items-center gap-2.5 text-xs">
            <Lock className="w-4 h-4 text-[#b45309] shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span className="font-bold">Доступ ограничен режимом чтения (подписка или пробный период завершились). </span>
              <span className="text-[#2d313b]">
                Все данные сохранены и доступны для просмотра и выгрузки. Для добавления смен и редактирования активируйте тариф.
              </span>
            </div>
          </div>
          {currentRole === 'manager' && (
            <button
              type="button"
              onClick={() => setBillingModalOpen(true)}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-xs rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Выбрать и оплатить тариф</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (subscription.status === 'trial') {
    const days = subscription.daysRemaining ?? 0;
    const isUrgent = Boolean(subscription.showTrialDay4Warning) || days <= 3;
    const chosenName = subscription.selectedTariffId
      ? TARIFF_BY_ID[subscription.selectedTariffId]?.name
      : subscription.tariffName;

    return (
      <div
        className={`border-b ${
          isUrgent ? 'bg-amber-50/90 border-amber-200' : 'bg-[#eef2ff] border-[#d9dbe0]'
        } text-[#111111]`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            {isUrgent ? (
              <AlertTriangle className="w-4 h-4 text-[#b45309] shrink-0" />
            ) : (
              <Clock className="w-4 h-4 text-[#2f63ff] shrink-0" />
            )}
            <span>
              <strong>Пробный период 7 дней</strong>
              <span className="text-[#5d6270] mx-1.5">·</span>
              <span className="font-mono tabular-nums font-semibold">
                {days > 0 ? `осталось ${days} дн.` : `осталось ${subscription.hoursRemaining ?? 0} ч.`}
              </span>
              {chosenName && (
                <>
                  <span className="text-[#5d6270] mx-1.5">·</span>
                  <span className="text-[#2d313b]">выбранный тариф: {chosenName}</span>
                </>
              )}
            </span>
          </div>

          {currentRole === 'manager' && (
            <button
              type="button"
              onClick={() => setBillingModalOpen(true)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#f7f9ff] text-[#111111] border border-[#d9dbe0] font-semibold text-xs rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              <CreditCard className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Тарифы и оплата</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
};
