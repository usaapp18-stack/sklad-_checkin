import React from 'react';
import { Building2, CheckCircle2, Lock, ShieldCheck, ArrowRight } from 'lucide-react';
import { BrandWord } from '../../components/common/BrandLogo';
import { navigate } from '../../utils/router';

export const AboutPage: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 space-y-14">
      <section className="space-y-4 max-w-3xl">
        <div className="text-xs font-bold uppercase tracking-wider text-[#2f63ff]">О системе <BrandWord /></div>
        <h1 className="text-3xl sm:text-5xl font-bold text-[#111111] tracking-tight text-balance">
          Продукт для операционного контроля смен и оплаты труда на складах
        </h1>
        <p className="text-base text-[#5d6270] leading-relaxed">
          <BrandWord /> создавался для реальных процессов складов, сортировочных центров, фулфилмента и пунктов выдачи заказов, где важна точность каждого выхода на смену и прозрачный расчёт оплаты персонала.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            icon: Building2,
            title: 'Единый контур для сети точек',
            desc: 'От одного склада с двумя сотрудниками до сети из тридцати объектов и ста пятидесяти работников в одном кабинете.',
          },
          {
            icon: CheckCircle2,
            title: 'Достоверный табель без дублей',
            desc: 'Правило одного активного чекина за дату, QR-проходная и контроль геозоны убирают ошибки ручного учёта.',
          },
          {
            icon: Lock,
            title: 'Строгая изоляция компаний',
            desc: 'Данные каждой организации отделены на уровне серверного API и базы данных. Другие клиенты не имеют доступа к вашим записям.',
          },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="bg-white border border-[#d9dbe0] rounded-lg p-6 space-y-3">
              <Icon className="w-5 h-5 text-[#2f63ff]" />
              <h2 className="text-lg font-bold text-[#111111]">{card.title}</h2>
              <p className="text-sm text-[#5d6270] leading-relaxed">{card.desc}</p>
            </div>
          );
        })}
      </section>

      <section className="bg-[#f7f9ff] border border-[#dce4f8] rounded-lg p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#2f63ff]">
          <ShieldCheck className="w-4 h-4" />
          <span>Принципы работы сервиса</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm text-[#5d6270] leading-relaxed">
          <div className="space-y-2">
            <h3 className="font-bold text-[#111111]">Прозрачные условия без скрытых ограничений</h3>
            <p>
              Все основные рабочие модули <BrandWord /> доступны с первого дня на каждом тарифе — от пробного периода до тарифа «Максимум». Выбор тарифа зависит только от числа активных складов и сотрудников.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-bold text-[#111111]">Сохранность истории смен и отчётов</h3>
            <p>
              Даже по завершении пробного периода или оплаченного месяца данные организации остаются в безопасности: кабинет переходит в режим чтения с сохранением доступа к табелю и экспорту в Excel.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <a
          href="/register"
          onClick={e => {
            e.preventDefault();
            navigate('/register');
          }}
          className="min-h-[44px] px-6 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-sm rounded-full inline-flex items-center gap-2 transition-colors"
        >
          <span>Начать 7 дней бесплатно</span>
          <ArrowRight className="w-4 h-4" />
        </a>
        <a
          href="/contacts"
          onClick={e => {
            e.preventDefault();
            navigate('/contacts');
          }}
          className="min-h-[44px] px-6 py-2.5 bg-white hover:bg-[#f7f9ff] text-[#111111] border border-[#d9dbe0] font-semibold text-sm rounded-full inline-flex items-center transition-colors"
        >
          Связаться с командой
        </a>
      </div>
    </div>
  );
};
