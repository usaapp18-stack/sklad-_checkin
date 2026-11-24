import React, { useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  MapPin,
  QrCode,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';

export interface ShowcaseModuleItem {
  id: string;
  shortTitle: string;
  title: string;
  roleTag: string;
  summary: string;
  capabilities: string[];
  icon: React.ComponentType<{ className?: string }>;
}

export const SKLADIN_MODULES: ShowcaseModuleItem[] = [
  {
    id: 'today',
    shortTitle: 'Сводка дня',
    title: 'Главный экран руководителя',
    roleTag: 'Руководитель',
    summary:
      'Оперативная картина по всем складам и ПВЗ за текущие сутки: кто открыл смену, на какой точке и с каким типом смены, оповещения о невыходе.',
    capabilities: [
      'Сводка присутствия по каждому складу в реальном времени',
      'Контроль открытых и завершённых смен за день',
      'Проверка невыхода на объект и оперативные уведомления',
    ],
    icon: ShieldCheck,
  },
  {
    id: 'staff',
    shortTitle: 'Сотрудники',
    title: 'Штат, ставки и анкеты',
    roleTag: 'Руководитель',
    summary:
      'Единый реестр сотрудников и подработчиков с привязкой к складам, должностям и индивидуальным условиям оплаты.',
    capabilities: [
      'Почасовая или сменная ставка и ночные доплаты',
      'Назначение ролей: старший смены, основной сотрудник, подработчик',
      'Приём анкет кандидатов и выдача логина с паролем в один клик',
    ],
    icon: Users,
  },
  {
    id: 'warehouses',
    shortTitle: 'Склады и ПВЗ',
    title: 'Объекты, зоны и геопараметры',
    roleTag: 'Руководитель',
    summary:
      'Управление одним складом или сетью до 30 объектов с отдельными участками работ, кодами точек и ответственными сотрудниками.',
    capabilities: [
      'Справочник складов и ПВЗ с зонами: приёмка, сборка, упаковка, отгрузка',
      'Настройка радиуса геозоны и индивидуального QR-ключа проходной',
      'Архивация закрытых точек без потери истории смен',
    ],
    icon: Building2,
  },
  {
    id: 'schedules',
    shortTitle: 'Графики и биржа',
    title: 'Планирование смен и биржа замен',
    roleTag: 'Руководитель и сотрудник',
    summary:
      'Календарь назначений по шаблонам 2/2, 3/3, 5/2 с учётом пожеланий работников и биржа подмен для быстрого закрытия окон.',
    capabilities: [
      'Массовое заполнение графика по шаблону смены и публикация персоналу',
      'Пожелания сотрудников по доступности и выходным',
      'Биржа смен с откликом коллеги и подтверждением руководителем',
    ],
    icon: CalendarCheck,
  },
  {
    id: 'checkins',
    shortTitle: 'Check-in / Out',
    title: 'Фиксация начала и конца смены',
    roleTag: 'Сотрудник',
    summary:
      'Учёт реального выхода на объект без дубликатов: правило «1 чекин в дату» на уровне базы данных и расчёт чистого отработанного времени.',
    capabilities: [
      'Фиксация времени начала смены (Check-in) и завершения (Check-out)',
      'Вычет длительности перерыва и учёт ночных смен',
      'Жёсткая защита от повторных чекинов за одну дату',
    ],
    icon: Clock,
  },
  {
    id: 'qr_geo',
    shortTitle: 'QR и геозона',
    title: 'QR-проходная и GPS-верификация',
    roleTag: 'Контроль присутствия',
    summary:
      'Подтверждение фактического присутствия сотрудника на объекте при отметке начала смены по QR-метке точки и координатам.',
    capabilities: [
      'Генерация QR-кода для печати на входе или зоне проходной склада',
      'Автоматический расчёт расстояния по координатам (геозона в метрах)',
      'Отображение статусов QR и GPS прямо в журнале смен руководителя',
    ],
    icon: QrCode,
  },
  {
    id: 'timesheet',
    shortTitle: 'Табель часов',
    title: 'Табель учёта рабочего времени',
    roleTag: 'Руководитель и сотрудник',
    summary:
      'Автоматически собираемый табель смен по датам, складам, часам и статусам за любой календарный период.',
    capabilities: [
      'Просмотр отработанных смен и часов в разрезе каждого работника',
      'Сверка планового графика с фактическими выходами',
      'Корректировка смен руководителем с сохранением истории аудита',
    ],
    icon: CheckCircle2,
  },
  {
    id: 'payroll',
    shortTitle: 'Зарплата и ФОТ',
    title: 'Автоматический расчёт оплаты (ФОТ)',
    roleTag: 'Руководитель и сотрудник',
    summary:
      'Прозрачное начисление выплат по отработанным сменам и часам с учётом ночных смен, доплат старшего и персональных целей дохода.',
    capabilities: [
      'Расчёт по сменным и почасовым тарифам без ручных таблиц',
      'Видимость текущего начисленного дохода в кабинете сотрудника',
      'Сводный расчёт ФОТ по складу и всей организации за месяц',
    ],
    icon: Wallet,
  },
  {
    id: 'reports',
    shortTitle: 'Отчётность',
    title: 'Выгрузка в Excel и окупаемость',
    roleTag: 'Руководитель',
    summary:
      'Экспорт табеля и ведомостей выплат в .xlsx, учёт доходов и расходов по складам и ежедневные отчёты в Telegram.',
    capabilities: [
      'Готовая выгрузка табеля и начислений в Excel (.xlsx)',
      'Модуль экономики склада: доходы, аренда, ФОТ и маржинальность',
      'Telegram-уведомления и ежедневная сводка для руководителя',
    ],
    icon: BarChart3,
  },
];

interface ProductShowcasePreviewsProps {
  compact?: boolean;
}

export const ProductShowcasePreviews: React.FC<ProductShowcasePreviewsProps> = ({ compact = false }) => {
  const [activeId, setActiveId] = useState<string>('today');
  const current = SKLADIN_MODULES.find(m => m.id === activeId) || SKLADIN_MODULES[0];

  const renderPreviewScreen = (id: string) => {
    switch (id) {
      case 'today':
      case 'warehouses':
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e5e7eb]">
              <div>
                <div className="text-xs text-[#5d6270]">Оперативная сводка · Москва</div>
                <div className="text-sm font-bold text-[#111111]">Активные объекты и смены на линии</div>
              </div>
              <div className="text-xs font-mono tabular-nums text-[#2f63ff] font-semibold">
                На смене: 14 из 15 чел.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { code: 'СК-СЕВЕР', name: 'Склад Север (Фулфилмент)', active: '8 чел.', status: 'Смена открыта в 08:56', qr: 'QR + GPS ок' },
                { code: 'СК-ЮГ', name: 'Терминал Юг (ПВЗ и сортировка)', active: '6 чел.', status: 'Смена открыта в 09:00', qr: 'QR ок' },
              ].map(w => (
                <div key={w.code} className="p-3.5 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#111111]">{w.code}</span>
                    <span className="text-xs font-mono tabular-nums font-semibold text-emerald-700">{w.active}</span>
                  </div>
                  <div className="text-xs font-semibold text-[#111111]">{w.name}</div>
                  <div className="text-[11px] text-[#5d6270] flex items-center justify-between pt-1 border-t border-[#e5e7eb]">
                    <span>{w.status}</span>
                    <span className="font-mono text-[#2f63ff] font-semibold">{w.qr}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto border border-[#d9dbe0] rounded-md">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#f7f9ff] text-[#5d6270] border-b border-[#d9dbe0]">
                  <tr>
                    <th className="py-2 px-3">Сотрудник</th>
                    <th className="py-2 px-3">Объект</th>
                    <th className="py-2 px-3">Зона</th>
                    <th className="py-2 px-3">Приход</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb] bg-white">
                  <tr>
                    <td className="py-2 px-3 font-medium text-[#111111]">Алексей Смирнов</td>
                    <td className="py-2 px-3 font-mono text-[#2d313b]">СК-СЕВЕР</td>
                    <td className="py-2 px-3 text-[#5d6270]">Приёмка</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-emerald-700">08:56</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium text-[#111111]">Мария Козлова</td>
                    <td className="py-2 px-3 font-mono text-[#2d313b]">СК-СЕВЕР</td>
                    <td className="py-2 px-3 text-[#5d6270]">Сборка</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-emerald-700">09:02</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium text-[#111111]">Елена Соколова</td>
                    <td className="py-2 px-3 font-mono text-[#2d313b]">СК-ЮГ</td>
                    <td className="py-2 px-3 text-[#5d6270]">Упаковка</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-emerald-700">08:59</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'checkins':
      case 'qr_geo':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#111111]">Пропуск на смену</span>
                <span className="font-mono text-emerald-700 font-semibold">Верифицирован</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-white border border-[#d9dbe0] rounded-md">
                <QrCode className="w-10 h-10 text-[#2f63ff] shrink-0" />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[#111111]">QR-проходная · СК-СЕВЕР</div>
                  <div className="text-[#5d6270] flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Геозона: 38 м от входа (лимит 300 м)</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                <div className="p-2.5 bg-white border border-[#e5e7eb] rounded">
                  <div className="text-[11px] text-[#5d6270] font-sans">Начало смены</div>
                  <div className="font-bold text-[#111111]">09:00 МСК</div>
                </div>
                <div className="p-2.5 bg-white border border-[#e5e7eb] rounded">
                  <div className="text-[11px] text-[#5d6270] font-sans">Участок</div>
                  <div className="font-bold text-[#111111] font-sans">Сборка</div>
                </div>
              </div>
            </div>
            <div className="space-y-3 text-xs">
              <div className="font-bold text-sm text-[#111111]">Контроль 1 чекина в дату</div>
              <p className="text-[#5d6270] leading-relaxed">
                Система фиксирует ровно одну активную смену на сотрудника за календарную дату. Случайное повторное сканирование не создаёт дубль в табеле и выплатах.
              </p>
              <div className="p-3 bg-white border border-[#d9dbe0] rounded-md space-y-1.5 font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-[#5d6270] font-sans">Перерыв:</span>
                  <span className="text-[#111111] font-semibold">60 мин</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5d6270] font-sans">Чистое время:</span>
                  <span className="text-[#2f63ff] font-bold">11.0 ч</span>
                </div>
              </div>
            </div>
          </div>
        );

      case 'schedules':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-[#e5e7eb]">
              <span className="font-bold text-[#111111]">График смен 2/2 · Склад Север</span>
              <span className="inline-flex items-center gap-1 text-[#2f63ff] font-semibold">
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Биржа: 1 заявка на замену
              </span>
            </div>
            <div className="overflow-x-auto border border-[#d9dbe0] rounded-md">
              <table className="w-full text-xs text-left font-mono tabular-nums">
                <thead className="bg-[#f7f9ff] text-[#5d6270] font-sans border-b border-[#d9dbe0]">
                  <tr>
                    <th className="py-2 px-3">Сотрудник</th>
                    <th className="py-2 px-2 text-center">Пн</th>
                    <th className="py-2 px-2 text-center">Вт</th>
                    <th className="py-2 px-2 text-center">Ср</th>
                    <th className="py-2 px-2 text-center">Чт</th>
                    <th className="py-2 px-2 text-center">Пт</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb] bg-white">
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium text-[#111111]">А. Смирнов</td>
                    <td className="py-2 px-2 text-center text-[#2f63ff] font-bold">12ч</td>
                    <td className="py-2 px-2 text-center text-[#2f63ff] font-bold">12ч</td>
                    <td className="py-2 px-2 text-center text-[#a9bcff]">—</td>
                    <td className="py-2 px-2 text-center text-[#a9bcff]">—</td>
                    <td className="py-2 px-2 text-center text-[#2f63ff] font-bold">12ч</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium text-[#111111]">М. Козлова</td>
                    <td className="py-2 px-2 text-center text-[#a9bcff]">—</td>
                    <td className="py-2 px-2 text-center text-[#a9bcff]">—</td>
                    <td className="py-2 px-2 text-center text-[#2f63ff] font-bold">8ч</td>
                    <td className="py-2 px-2 text-center text-amber-700 font-bold">Обмен</td>
                    <td className="py-2 px-2 text-center text-[#a9bcff]">—</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium text-[#111111]">Д. Волков</td>
                    <td className="py-2 px-2 text-center text-[#111111] font-bold">Ночь</td>
                    <td className="py-2 px-2 text-center text-[#111111] font-bold">Ночь</td>
                    <td className="py-2 px-2 text-center text-[#a9bcff]">—</td>
                    <td className="py-2 px-2 text-center text-[#2f63ff] font-bold">12ч</td>
                    <td className="py-2 px-2 text-center text-[#a9bcff]">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'payroll':
      case 'timesheet':
      case 'reports':
      case 'staff':
      default:
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#e5e7eb]">
              <div className="text-xs font-bold text-[#111111]">
                Сводный табель и расчёт ФОТ · Текущий месяц
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2f63ff]">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Экспорт ведомости .xlsx</span>
              </div>
            </div>
            <div className="overflow-x-auto border border-[#d9dbe0] rounded-md">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#f7f9ff] text-[#5d6270] border-b border-[#d9dbe0]">
                  <tr>
                    <th className="py-2 px-3">Сотрудник</th>
                    <th className="py-2 px-3">Должность</th>
                    <th className="py-2 px-3 text-right">Смен / ч</th>
                    <th className="py-2 px-3 text-right">Начислено</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e7eb] bg-white font-mono tabular-nums">
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium text-[#111111]">Алексей Смирнов</td>
                    <td className="py-2 px-3 font-sans text-[#5d6270]">Старший кладовщик</td>
                    <td className="py-2 px-3 text-right">14 / 154 ч</td>
                    <td className="py-2 px-3 text-right font-bold text-[#111111]">63 000 ₽</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium text-[#111111]">Мария Козлова</td>
                    <td className="py-2 px-3 font-sans text-[#5d6270]">Сборщик заказов</td>
                    <td className="py-2 px-3 text-right">15 / 148 ч</td>
                    <td className="py-2 px-3 text-right font-bold text-[#111111]">53 280 ₽</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-sans font-medium text-[#111111]">Дмитрий Волков</td>
                    <td className="py-2 px-3 font-sans text-[#5d6270]">Водитель погрузчика</td>
                    <td className="py-2 px-3 text-right">12 / 132 ч</td>
                    <td className="py-2 px-3 text-right font-bold text-[#111111]">56 400 ₽</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="bg-white border border-[#d9dbe0] rounded-lg overflow-hidden shadow-xs">
      {/* Interactive Module Selector Tabs */}
      <div className="p-2.5 bg-[#f7f9ff] border-b border-[#d9dbe0] flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SKLADIN_MODULES.map(mod => {
          const Icon = mod.icon;
          const active = mod.id === activeId;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => setActiveId(mod.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-[#111111] text-white'
                  : 'bg-white text-[#2d313b] border border-[#d9dbe0] hover:text-[#111111] hover:border-[#2f63ff]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
              <span>{mod.shortTitle}</span>
            </button>
          );
        })}
      </div>

      {/* Screen Preview + Module Description */}
      <div className={`grid grid-cols-1 ${compact ? 'lg:grid-cols-12' : 'lg:grid-cols-12'} divide-y lg:divide-y-0 lg:divide-x divide-[#e5e7eb]`}>
        <div className="lg:col-span-5 p-6 sm:p-8 flex flex-col justify-between space-y-5">
          <div className="space-y-3">
            <div className="text-xs font-semibold text-[#2f63ff] uppercase tracking-wider">
              Модуль SKLADIN · {current.roleTag}
            </div>
            <h3 className="text-xl font-bold text-[#111111] tracking-tight">{current.title}</h3>
            <p className="text-sm text-[#5d6270] leading-relaxed">{current.summary}</p>
          </div>
          <ul className="space-y-2.5 pt-2 border-t border-[#e5e7eb]">
            {current.capabilities.map(cap => (
              <li key={cap} className="flex items-start gap-2.5 text-xs text-[#111111]">
                <CheckCircle2 className="w-4 h-4 text-[#2f63ff] shrink-0 mt-0.5" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-7 p-5 sm:p-8 bg-[#f7f9ff]">
          <div className="bg-white border border-[#d9dbe0] rounded-md p-4 sm:p-5 shadow-xs">
            {renderPreviewScreen(current.id)}
          </div>
        </div>
      </div>
    </div>
  );
};
