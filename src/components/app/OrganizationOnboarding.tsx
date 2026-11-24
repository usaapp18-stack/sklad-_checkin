import React, { useId, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TARIFF_BY_ID, calculateTariffPrice, formatRub } from '../../config/tariffs';
import { getPlanSelectionHint } from '../../utils/router';
import { BrandLogo, BrandWord } from '../common/BrandLogo';
import { AlertCircle, ArrowRight, Building2, CheckCircle2, LogOut } from 'lucide-react';

const TIMEZONE_OPTIONS = [
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
];

export const OrganizationOnboarding: React.FC = () => {
  const orgNameId = useId();
  const orgInnId = useId();
  const orgTzId = useId();
  const { authSession, createOrganization, logout } = useApp();
  const hint = getPlanSelectionHint();
  const plan = TARIFF_BY_ID[hint.plan] || TARIFF_BY_ID.business;
  const price = calculateTariffPrice(plan.id, hint.period);

  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [timezone, setTimezone] = useState('Europe/Moscow');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Укажите название вашей компании или первого склада');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createOrganization({
        name: name.trim(),
        inn: inn.trim() || undefined,
        timezone,
        selectedPlan: plan.id,
        selectedPeriod: hint.period,
      });
      if (!res.success) {
        setError(res.error || 'Не удалось создать организацию');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#f7f9ff] text-[#111111] flex flex-col">
      <header className="sticky top-0 z-30 bg-[#111111] border-b border-white/10 px-4 sm:px-8 h-15 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-white">
          <BrandLogo className="w-7 h-7 shrink-0" />
          <BrandWord className="text-xl text-white leading-none" />
        </div>
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/8 hover:bg-white/15 border border-white/12 rounded cursor-pointer transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Выйти</span>
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-2xl bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-[#e5e7eb] space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6270]">
              Шаг 2 из 2 · Создание рабочего пространства
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
              Создайте организацию для запуска 7-дневного пробного периода
            </h1>
            <p className="text-sm text-[#2d313b] leading-relaxed">
              {authSession?.name ? `${authSession.name}, ` : ''}после создания организации вы сразу попадёте в рабочий кабинет и сможете добавить склады, ПВЗ, сотрудников и настроить графики смен. Все данные изолированы внутри вашей компании.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5">
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor={orgNameId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                  Название компании или склада <span className="text-rose-600">*</span>
                </label>
                <input
                  id={orgNameId}
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Например: Фулфилмент Восток или ИП Иванов А.С."
                  className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded text-sm text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                />
              </div>

              <div>
                <label htmlFor={orgInnId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                  ИНН организации (необязательно)
                </label>
                <input
                  id={orgInnId}
                  type="text"
                  value={inn}
                  onChange={e => setInn(e.target.value)}
                  placeholder="Для выставления счетов юрлицам"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded text-sm font-mono text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                />
              </div>

              <div>
                <label htmlFor={orgTzId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                  Основной часовой пояс
                </label>
                <select
                  id={orgTzId}
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded text-sm text-[#111111] focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                >
                  {TIMEZONE_OPTIONS.map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#111111]">
                  <Building2 className="w-4 h-4 text-[#2f63ff]" />
                  <span>Условия пробного периода на 7 дней</span>
                </div>
                <span className="text-xs font-mono font-semibold text-[#2f63ff] tabular-nums">
                  {formatRub(0)} на 7 дней
                </span>
              </div>
              <p className="text-xs text-[#2d313b] leading-relaxed">
                Выбранный ориентир тарифа после триала: <strong className="text-[#111111]">{plan.name}</strong> ({price.months} мес · <span className="font-mono tabular-nums">{formatRub(price.finalPriceRub)}</span>). Во время 7-дневного пробного периода доступны все функции без привязки карты.
              </p>
              <div className="flex items-center gap-2 text-xs text-emerald-800 pt-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>После окончания 7 дней данные не удаляются — при необходимости включится режим чтения</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || name.trim().length < 2}
              className="w-full min-h-[44px] px-5 py-3 bg-[#2f63ff] hover:bg-[#1f4fe0] disabled:bg-[#e5e7eb] disabled:text-[#5d6270] text-white font-semibold text-sm rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{isSubmitting ? 'Создаём организацию...' : 'Создать организацию и начать 7 дней бесплатно'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
