import React from 'react';
import { PUBLIC_SITE_CONFIG } from '../../config/site';
import { BrandWord } from '../../components/common/BrandLogo';

export const TermsPage: React.FC = () => {
  const company = PUBLIC_SITE_CONFIG.legalEntityName || 'SKLADIN';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 space-y-8">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6270]">Юридическая документация</div>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#111111] tracking-tight">
          Условия использования сервиса <BrandWord />
        </h1>
      </div>

      <div className="bg-white border border-[#d9dbe0] rounded-lg p-6 sm:p-8 space-y-6 text-sm text-[#2d313b] leading-relaxed">
        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">1. Предмет соглашения</h2>
          <p>
            Правообладатель ({company}) предоставляет пользователям (руководителям организаций и уполномоченным сотрудникам) право использования веб-сервиса <BrandWord /> на условиях простой (неисключительной) лицензии в соответствии с выбранным тарифом.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">2. Пробный период 7 дней</h2>
          <p>
            При создании новой организации руководитель получает бесплатный пробный период длительностью 7 календарных дней для ознакомления с функциональностью системы без требования привязки банковской карты.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">3. Тарифы, лимиты и режим чтения</h2>
          <p>
            Тарифы («Старт», «Бизнес», «Максимум») различаются количеством активных складов / ПВЗ и сотрудников, а также сроком оплаты (1, 3, 6 или 12 месяцев). По истечении пробного периода или оплаченного срока при отсутствии продления учётная запись переходит в режим чтения (read-only): накопленные данные сохраняются и доступны для просмотра и экспорта.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">4. Обязанности пользователя</h2>
          <p>
            Пользователь обязуется сохранять конфиденциальность учётных данных для входа и самостоятельно определять права доступа сотрудников своей организации в рабочем кабинете.
          </p>
        </section>
      </div>
    </div>
  );
};
