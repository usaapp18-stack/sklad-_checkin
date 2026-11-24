import React from 'react';
import { trackAnalyticsEvent } from '../../config/site';
import { navigate } from '../../utils/router';
import { ProductShowcasePreviews, SKLADIN_MODULES } from '../../components/public/ProductShowcasePreviews';
import { BrandWord } from '../../components/common/BrandLogo';
import { ArrowRight } from 'lucide-react';

export const FeaturesPage: React.FC = () => {
  return (
    <div className="py-14 sm:py-20 space-y-16">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="max-w-3xl space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[#2f63ff]">Функциональные модули <BrandWord /></div>
          <h1 className="text-3xl sm:text-5xl font-bold text-[#111111] tracking-tight text-balance">
            Единый контур управления сменами, графиком и оплатой на складе
          </h1>
          <p className="text-base text-[#5d6270] leading-relaxed">
            Каждый модуль <BrandWord /> закрывает реальный ежедневный участок работы начальника склада и сотрудника: от выхода на объект через QR и GPS до выгрузки табеля и ведомости в Excel.
          </p>
        </div>

        <ProductShowcasePreviews />
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#111111] tracking-tight">
            Все 9 модулей рабочей системы
          </h2>
          <p className="text-sm text-[#5d6270]">
            Полный набор инструментов доступен как во время 7-дневного триала, так и на всех тарифах.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SKLADIN_MODULES.map((mod, idx) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.id}
                className="bg-white border border-[#d9dbe0] rounded-lg p-6 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-[#5d6270]">
                    <span className="font-mono font-bold text-[#2f63ff]">0{idx + 1}.</span>
                    <span>{mod.roleTag}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-5 h-5 text-[#2f63ff] shrink-0" />
                    <h3 className="text-lg font-bold text-[#111111]">{mod.title}</h3>
                  </div>
                  <p className="text-sm text-[#5d6270] leading-relaxed">{mod.summary}</p>
                </div>

                <ul className="space-y-1.5 pt-3 border-t border-[#e5e7eb] text-xs text-[#111111]">
                  {mod.capabilities.map(c => (
                    <li key={c}>· {c}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="p-6 sm:p-10 bg-[#111111] text-white rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold">Протестируйте все модули на своём складе</h2>
            <p className="text-xs sm:text-sm text-neutral-300">
              Запустите 7 дней бесплатного доступа или изучите интерфейс в изолированном демо-кабинете.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <a
              href="/demo"
              onClick={e => {
                e.preventDefault();
                trackAnalyticsEvent('demo_open', { from: 'features' });
                navigate('/demo');
              }}
              className="min-h-[44px] px-5 py-2.5 bg-transparent hover:bg-white hover:text-[#111111] text-white border border-white/70 font-semibold text-xs rounded-full inline-flex items-center transition-colors"
            >
              Открыть демо
            </a>
            <a
              href="/register"
              onClick={e => {
                e.preventDefault();
                trackAnalyticsEvent('trial_cta_click', { placement: 'features_bottom' });
                navigate('/register');
              }}
              className="min-h-[44px] px-5 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-xs rounded-full inline-flex items-center gap-1.5 transition-colors"
            >
              <span>7 дней бесплатно</span>
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};
