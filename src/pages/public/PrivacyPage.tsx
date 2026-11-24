import React from 'react';
import { PUBLIC_SITE_CONFIG } from '../../config/site';
import { BrandWord } from '../../components/common/BrandLogo';

export const PrivacyPage: React.FC = () => {
  const company = PUBLIC_SITE_CONFIG.legalEntityName || 'SKLADIN';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 space-y-8">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6270]">Юридическая документация</div>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#111111] tracking-tight">
          Политика обработки персональных данных
        </h1>
      </div>

      <div className="bg-white border border-[#d9dbe0] rounded-lg p-6 sm:p-8 space-y-6 text-sm text-[#2d313b] leading-relaxed">
        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">1. Общие положения</h2>
          <p>
            Настоящая Политика определяет порядок обработки и защиты персональных данных пользователей сервиса <BrandWord /> (далее — «Оператор», правообладатель {company}) в соответствии с законодательством Российской Федерации о персональных данных.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">2. Какие данные обрабатываются</h2>
          <p>
            При регистрации руководителя и работе в системе обрабатываются: фамилия, имя и отчество (ФИО), адрес электронной почты, номер телефона, сведения об организации и её объектах, данные табеля смен и времени Check-in / Check-out, а также обращения через форму обратной связи.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">3. Цели обработки данных</h2>
          <p>
            Данные используются исключительно для предоставления доступа к личному кабинету <BrandWord />, идентификации пользователей, учёта смен и расчёта оплаты труда внутри изолированной организации, выставления счетов, оплаты тарифов и ответа на обращения пользователей.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">4. Хранение, защита и изоляция</h2>
          <p>
            Пароли пользователей хранятся в виде стойких криптографических хэшей (bcrypt). Каждая организация логически изолирована на уровне базы данных и серверного API. Оператор не передаёт персональные данные третьим лицам без законных оснований, за исключением платёжных операторов в объёме, необходимом для проведения оплаты.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#111111]">5. Контактная информация и отзыв согласия</h2>
          <p>
            Пользователь вправе направить запрос об уточнении, удалении данных или отзыве согласия через страницу контактов сервиса{PUBLIC_SITE_CONFIG.contactEmail ? ` или на электронную почту ${PUBLIC_SITE_CONFIG.contactEmail}` : ''}.
          </p>
        </section>
      </div>
    </div>
  );
};
