import React, { useEffect, useState } from 'react';
import { DemoAppProvider } from '../../context/DemoContext';
import { Header } from '../../components/Header';
import { ManagerDashboard } from '../../components/manager/ManagerDashboard';
import { EmployeeDashboard } from '../../components/employee/EmployeeDashboard';
import { NotificationModal } from '../../components/NotificationModal';
import { trackAnalyticsEvent } from '../../config/site';
import { navigate } from '../../utils/router';
import { ArrowLeft, ArrowRight, Eye, Info, ShieldCheck, User, X } from 'lucide-react';

export const DemoPage: React.FC = () => {
  const [demoRole, setDemoRole] = useState<'manager' | 'employee'>('manager');
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  useEffect(() => {
    trackAnalyticsEvent('demo_open', { from: 'demo_page' });
  }, []);

  return (
    <DemoAppProvider demoRole={demoRole} onBlockedAction={msg => setBlockedNotice(msg)}>
      <div className="min-h-screen min-h-[100dvh] bg-[#f7f9ff] text-[#111111] flex flex-col">
        {/* Top Demo Sandbox Control Bar */}
        <div className="bg-white border-b border-[#d9dbe0] px-4 sm:px-6 lg:px-8 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <a
                href="/"
                onClick={e => {
                  e.preventDefault();
                  navigate('/');
                }}
                className="inline-flex items-center gap-1 font-semibold text-[#111111] hover:text-[#2f63ff] mr-1 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>На сайт</span>
              </a>
              <span className="text-[#d9dbe0]">|</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-[#111111]">
                <Eye className="w-4 h-4 text-[#2f63ff]" />
                <span>Изолированный демо-режим (только чтение)</span>
              </span>
              <span className="text-[#5d6270] hidden sm:inline">
                · Демо-данные не сохраняются в базу и не попадают в ваш рабочий кабинет
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="inline-flex items-center bg-[#f7f9ff] border border-[#d9dbe0] rounded-md p-0.5">
                <button
                  type="button"
                  onClick={() => setDemoRole('manager')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors ${
                    demoRole === 'manager'
                      ? 'bg-[#111111] text-white'
                      : 'text-[#5d6270] hover:text-[#111111]'
                  }`}
                >
                  <ShieldCheck className={`w-3.5 h-3.5 ${demoRole === 'manager' ? 'text-[#2f63ff]' : ''}`} />
                  <span>Кабинет руководителя</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDemoRole('employee')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors ${
                    demoRole === 'employee'
                      ? 'bg-[#111111] text-white'
                      : 'text-[#5d6270] hover:text-[#111111]'
                  }`}
                >
                  <User className={`w-3.5 h-3.5 ${demoRole === 'employee' ? 'text-[#2f63ff]' : ''}`} />
                  <span>Кабинет работника</span>
                </button>
              </div>

              <a
                href="/register"
                onClick={e => {
                  e.preventDefault();
                  trackAnalyticsEvent('trial_cta_click', { placement: 'demo_bar' });
                  navigate('/register');
                }}
                className="min-h-[36px] px-4 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-xs rounded-full inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <span>Запустить 7 дней бесплатно</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Non-blocking feedback banner when user clicks a write action inside read-only demo */}
        {blockedNotice && (
          <div className="bg-[#111111] text-white px-4 py-2.5 text-xs border-b border-white/10">
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#2f63ff] shrink-0" />
                <span>{blockedNotice}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href="/register"
                  onClick={e => {
                    e.preventDefault();
                    navigate('/register');
                  }}
                  className="px-3 py-1 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded-full text-[11px] whitespace-nowrap transition-colors"
                >
                  Начать триал
                </a>
                <button
                  type="button"
                  onClick={() => setBlockedNotice(null)}
                  className="p-1 text-white/60 hover:text-white cursor-pointer"
                  aria-label="Закрыть уведомление"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Real SKLADIN Header & Dashboard */}
        <Header
          onOpenNotifications={() => setIsNotifOpen(true)}
          onOpenUserSwitcher={() => setDemoRole(r => (r === 'manager' ? 'employee' : 'manager'))}
          onAfterLogout={() => navigate('/')}
        />

        <main className="flex-1 pb-12">
          {demoRole === 'manager' ? <ManagerDashboard /> : <EmployeeDashboard />}
        </main>

        <NotificationModal isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
      </div>
    </DemoAppProvider>
  );
};
