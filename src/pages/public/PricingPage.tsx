import React, { useEffect } from 'react';
import { TariffSection } from '../../components/public/TariffSection';
import { trackAnalyticsEvent } from '../../config/site';
import { CreditCard, Landmark, QrCode, ShieldCheck, Split } from 'lucide-react';
import { BrandWord } from '../../components/common/BrandLogo';
import { navigate } from '../../utils/router';

export const PricingPage: React.FC = () => {
  useEffect(() => {
    trackAnalyticsEvent('pricing_view');
  }, []);

  return (
    <div className="py-14 sm:py-20 space-y-16">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="max-w-3xl space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[#2f63ff]">Тарифы и оплата <BrandWord /></div>
          <h1 className="text-3xl sm:text-5xl font-bold text-[#111111] tracking-tight text-balance">
            Прозрачные тарифы по числу складов и сотрудников
          </h1>
          <p className="text-base text-[#5d6270] leading-relaxed">
            Начинайте с 7 дней бесплатного пробного периода без привязки карты. При оплате сразу за 3, 6 или 12 месяцев действует скидка 5%, 10% или 20%.
          </p>
        </div>

        <TariffSection showComparisonTable />
      </section>

      {/* Payment Methods Transparency */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-bold text-[#111111]">Способы оплаты подписки</h2>
          <p className="text-sm text-[#5d6270]">
            Оплата оформляется после регистрации внутри рабочего кабинета в разделе «Тарифы и оплата».
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: CreditCard,
              title: 'Банковская карта',
              desc: 'Оплата картами российских банков через платёжный шлюз ЮKassa с автоматическим продлением периода.',
            },
            {
              icon: QrCode,
              title: 'СБП (Быстрый платёж)',
              desc: 'Моментальная оплата по QR-коду Системы быстрых платежей через шлюз ЮKassa.',
            },
            {
              icon: Landmark,
              title: 'Счёт для юрлиц и ИП',
              desc: 'Мгновенное выставление счёта на безналичную оплату по реквизитам вашей организации.',
            },
            {
              icon: Split,
              title: 'Яндекс Сплит',
              desc: 'Архитектура биллинга готова к подключению оплаты частями при активации договора с провайдером.',
            },
          ].map(pm => {
            const Icon = pm.icon;
            return (
              <div key={pm.title} className="bg-white border border-[#d9dbe0] rounded-lg p-5 space-y-2">
                <Icon className="w-5 h-5 text-[#2f63ff]" />
                <div className="font-bold text-sm text-[#111111]">{pm.title}</div>
                <p className="text-xs text-[#5d6270] leading-relaxed">{pm.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Trial & Read-only Guarantee */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-[#f7f9ff] border border-[#dce4f8] rounded-lg p-6 sm:p-8 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          <div className="md:col-span-2 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#2f63ff]">
              <ShieldCheck className="w-4 h-4" />
              <span>Честные правила пробного периода и сохранности данных</span>
            </div>
            <h3 className="text-xl font-bold text-[#111111]">
              Данные не удаляются даже после окончания триала
            </h3>
            <p className="text-sm text-[#5d6270] leading-relaxed">
              Если через 7 дней подписка ещё не оплачена, рабочий кабинет переходит в режим чтения и экспорта в Excel. Как только вы активируете любой подходящий тариф, работа с новыми сменами продолжится без повторной настройки.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row md:flex-col gap-3">
            <a
              href="/register"
              onClick={e => {
                e.preventDefault();
                navigate('/register');
              }}
              className="min-h-[44px] px-5 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-xs rounded-full inline-flex items-center justify-center text-center transition-colors"
            >
              Начать 7 дней бесплатно
            </a>
            <a
              href="/demo"
              onClick={e => {
                e.preventDefault();
                navigate('/demo');
              }}
              className="min-h-[44px] px-5 py-2.5 bg-white hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] font-semibold text-xs rounded-full inline-flex items-center justify-center text-center transition-colors"
            >
              Посмотреть демо-кабинет
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};
