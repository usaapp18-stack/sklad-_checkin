import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { BrandWord } from '../../components/common/BrandLogo';
import { navigate } from '../../utils/router';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'multi-warehouse',
    question: 'Подойдёт ли система для нескольких складов или ПВЗ?',
    answer:
      'Да. В SKLADIN можно вести от 1 объекта на тарифе «Старт» до 2 на тарифе «Бизнес» и до 30 складов или ПВЗ на тарифе «Максимум». Для каждого склада задаются свои участки работ, график смен, QR-код проходной и радиус геозоны.',
  },
  {
    id: 'checkins',
    question: 'Как работает Check-in и Check-out и защита от повторных отметок?',
    answer:
      'Сотрудник открывает смену через Check-in (с подтверждением по QR-коду объекта и GPS-геозоне при включении) и завершает её через Check-out с указанием перерыва. На уровне базы данных действует строгое правило: один сотрудник может иметь только один активный чекин за одну календарную дату.',
  },
  {
    id: 'payroll',
    question: 'Как рассчитывается зарплата (ФОТ) и можно ли учитывать ночные смены?',
    answer:
      'Для каждого работника или типа смены задаётся сменная или почасовая ставка, а также надбавка за ночные часы и статус старшего смены. Система автоматически суммирует отработанное время и формирует начисления по сменам без ручного переноса в таблицы.',
  },
  {
    id: 'schedules-swaps',
    question: 'Можно ли вести график смен, пожелания сотрудников и биржу замен?',
    answer:
      'Да. Руководитель планирует смены по календарю или шаблонам (2/2, 3/3, 5/2) и публикует график команде. Сотрудники могут заранее отмечать пожелания по выходным и выставлять смены на биржу замен с обязательным подтверждением руководителя.',
  },
  {
    id: 'demo-mode',
    question: 'Как устроен бесплатный демо-режим и попадают ли демо-данные в рабочий кабинет?',
    answer:
      'Страница /demo работает в полностью изолированном режиме чтения (read-only) на вымышленной демонстрационной организации в памяти браузера. Никакие демо-записи не сохраняются в базу данных и не попадают в ваш реальный рабочий кабинет после регистрации.',
  },
  {
    id: 'trial-7-days',
    question: 'Что включено в 7 дней бесплатного доступа и нужна ли банковская карта?',
    answer:
      'После регистрации руководителя и создания организации вы получаете 7 дней бесплатного пробного доступа ко всем рабочим модулям SKLADIN без привязки банковской карты. Можно протестировать учёт смен, графики, QR-проходную и расчёт зарплаты на реальных объектах.',
  },
  {
    id: 'after-trial',
    question: 'Что произойдёт с моими данными после окончания 7 дней триала?',
    answer:
      'Все склады, сотрудники, табель смен и расчёты полностью сохраняются. Если тариф не оплачен вовремя, кабинет переводится в безопасный режим чтения: вы можете просматривать историю и выгружать табель в Excel, а после оплаты тарифа ограничения на добавление смен сразу снимаются.',
  },
  {
    id: 'payment-methods',
    question: 'Какие способы оплаты доступны и как работают скидки?',
    answer:
      'При оплате на 3, 6 или 12 месяцев действует скидка 5%, 10% и 20%. Вы можете оплатить подписку банковской картой или по СБП (при подключённом платёжном шлюзе ЮKassa), а также сформировать счёт для юридических лиц и ИП по реквизитам компании.',
  },
  {
    id: 'upgrade-downgrade',
    question: 'Как сменить тариф и как проверяются лимиты?',
    answer:
      'Повысить тариф можно в любой момент из окна «Тарифы и оплата» в личном кабинете. Понизить тариф на более младший можно при условии, что текущее число активных складов и сотрудников укладывается в лимиты выбранного тарифа.',
  },
  {
    id: 'isolation-security',
    question: 'Как обеспечивается изоляция данных разных компаний?',
    answer:
      'Каждая компания работает в собственной изолированной организации (multi-tenant изоляция по organization_id). Сотрудники, склады, графики, смены и финансовые отчёты одной организации полностью недоступны пользователям других компаний.',
  },
];

export const FaqPage: React.FC = () => {
  const [openId, setOpenId] = useState<string>(FAQ_ITEMS[0].id);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 space-y-10">
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6270]">Ответы на частые вопросы</div>
        <h1 className="text-3xl sm:text-5xl font-bold text-[#111111] tracking-tight text-balance">
          Всё о работе <BrandWord />, тарифах и сохранности данных
        </h1>
        <p className="text-base text-[#2d313b] leading-relaxed">
          Собрали подробные ответы по запуску складов, правилам чекинов, расчёту оплаты и подключению подписки.
        </p>
      </div>

      <div className="divide-y divide-[#d9dbe0] bg-white border border-[#d9dbe0] rounded-lg overflow-hidden">
        {FAQ_ITEMS.map(item => {
          const isOpen = openId === item.id;
          return (
            <div key={item.id}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? '' : item.id)}
                className="w-full px-5 sm:px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-[#f7f9ff] transition-colors cursor-pointer"
                aria-expanded={isOpen}
              >
                <span className="text-sm sm:text-base font-bold text-[#111111]">{item.question}</span>
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-[#2f63ff] shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#5d6270] shrink-0" />
                )}
              </button>
              {isOpen && (
                <div className="px-5 sm:px-6 pb-5 text-sm text-[#2d313b] leading-relaxed">
                  {item.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-6 sm:p-8 bg-[#111111] text-white rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">Остались вопросы по вашему складу?</h2>
          <p className="text-xs sm:text-sm text-white/75">
            Напишите нам через форму обратной связи или проверьте систему бесплатно в демо-режиме.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <a
            href="/contacts"
            onClick={e => {
              e.preventDefault();
              navigate('/contacts');
            }}
            className="min-h-[44px] px-5 py-2.5 bg-white text-[#111111] hover:bg-[#f7f9ff] font-semibold text-xs rounded-full inline-flex items-center transition-colors"
          >
            Написать нам
          </a>
          <a
            href="/register"
            onClick={e => {
              e.preventDefault();
              navigate('/register');
            }}
            className="min-h-[44px] px-5 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-xs rounded-full inline-flex items-center transition-colors"
          >
            7 дней бесплатно
          </a>
        </div>
      </div>
    </div>
  );
};
