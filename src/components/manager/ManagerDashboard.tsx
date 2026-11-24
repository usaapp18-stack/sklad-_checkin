import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { TodayView } from './TodayView';
import { StaffManagementView } from './StaffManagementView';
import { ApplicationsView } from './ApplicationsView';
import { ReportsView } from './ReportsView';
import { ExcelExportView } from './ExcelExportView';
import { SchedulePlannerView } from './SchedulePlannerView';
import { ShiftSwapManagerView } from './ShiftSwapManagerView';
import { PickupPointsManagementView } from './PickupPointsManagementView';
import { ScheduledNotificationsView } from './ScheduledNotificationsView';
import { TelegramSettingsView } from './TelegramSettingsView';
import {
  CalendarDays,
  Building2,
  Users,
  UserPlus,
  BarChart3,
  FileSpreadsheet,
  Bell,
  Send,
  CalendarCheck,
  ArrowLeftRight,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  X,
  Clock,
  Settings2,
} from 'lucide-react';

type ActiveViewId =
  | 'today'
  | 'schedule'
  | 'swaps'
  | 'staff'
  | 'applications'
  | 'pvz'
  | 'reports'
  | 'excel'
  | 'telegram'
  | 'notifications';

type PrimaryGroupId = 'today' | 'scheduleGroup' | 'staffGroup' | 'pvz' | 'financeGroup' | 'automationGroup';

export const ManagerDashboard: React.FC = () => {
  const {
    staffList,
    applications,
    swaps,
    pickupPoints,
    telegramSettings,
  } = useApp();

  const [activeTab, setActiveTab] = useState<ActiveViewId>('today');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAutomationMenuOpen, setIsAutomationMenuOpen] = useState(false);
  const automationMenuRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  const pendingAppsCount = applications.filter(a => a.status === 'pending').length;
  const pendingSwapsCount = swaps.filter(s => s.status === 'open' || s.status === 'claimed').length;
  const activeStaffCount = staffList.filter((s: any) => s.status === 'active').length;

  const getPrimaryGroup = (tab: ActiveViewId): PrimaryGroupId => {
    if (tab === 'schedule' || tab === 'swaps') return 'scheduleGroup';
    if (tab === 'staff' || tab === 'applications') return 'staffGroup';
    if (tab === 'reports' || tab === 'excel') return 'financeGroup';
    if (tab === 'telegram' || tab === 'notifications') return 'automationGroup';
    if (tab === 'pvz') return 'pvz';
    return 'today';
  };

  const activeGroup = getPrimaryGroup(activeTab);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (automationMenuRef.current && !automationMenuRef.current.contains(event.target as Node)) {
        setIsAutomationMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAutomationMenuOpen(false);
    };
    if (isAutomationMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAutomationMenuOpen]);

  useEffect(() => {
    if (mobileNavRef.current) {
      const activeEl = mobileNavRef.current.querySelector('[data-active="true"]') as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeGroup]);

  const primaryNavItems: {
    id: PrimaryGroupId;
    defaultTab: ActiveViewId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    alertCount?: number;
    countLabel?: number;
    desc: string;
  }[] = [
    {
      id: 'today',
      defaultTab: 'today',
      label: 'Сегодня',
      icon: CalendarDays,
      desc: 'Оперативная сводка явок и открытых смен за день',
    },
    {
      id: 'scheduleGroup',
      defaultTab: 'schedule',
      label: 'График и биржа',
      icon: CalendarCheck,
      alertCount: pendingSwapsCount > 0 ? pendingSwapsCount : undefined,
      desc: 'Планирование смен и биржа замен сотрудников',
    },
    {
      id: 'staffGroup',
      defaultTab: 'staff',
      label: 'Персонал',
      icon: Users,
      alertCount: pendingAppsCount > 0 ? pendingAppsCount : undefined,
      countLabel: activeStaffCount,
      desc: 'Штат склада, ставки, выработка и анкеты кандидатов',
    },
    {
      id: 'pvz',
      defaultTab: 'pvz',
      label: 'Склады',
      icon: Building2,
      countLabel: pickupPoints.length,
      desc: 'Складские объекты, QR-коды проходной и геозоны',
    },
    {
      id: 'financeGroup',
      defaultTab: 'reports',
      label: 'Табель и выплаты',
      icon: BarChart3,
      desc: 'Сводный табель часов, тарифы и экспорт в Excel',
    },
  ];

  const subTabsByGroup: Partial<
    Record<
      PrimaryGroupId,
      {
        id: ActiveViewId;
        label: string;
        icon: React.ComponentType<{ className?: string }>;
        badge?: number | string;
        badgeVariant?: 'amber' | 'sky';
      }[]
    >
  > = {
    scheduleGroup: [
      { id: 'schedule', label: 'График смен', icon: CalendarCheck },
      {
        id: 'swaps',
        label: 'Биржа смен',
        icon: ArrowLeftRight,
        badge: pendingSwapsCount > 0 ? pendingSwapsCount : undefined,
        badgeVariant: 'amber',
      },
    ],
    staffGroup: [
      {
        id: 'staff',
        label: 'Работники склада',
        icon: Users,
        badge: activeStaffCount,
        badgeVariant: 'sky',
      },
      {
        id: 'applications',
        label: 'Анкеты кандидатов',
        icon: UserPlus,
        badge: pendingAppsCount > 0 ? pendingAppsCount : undefined,
        badgeVariant: 'amber',
      },
    ],
    financeGroup: [
      { id: 'reports', label: 'Табель и расчёт ФОТ', icon: BarChart3 },
      { id: 'excel', label: 'Экспорт в Excel (.xlsx)', icon: FileSpreadsheet },
    ],
    automationGroup: [
      {
        id: 'telegram',
        label: 'Telegram-бот и отчёты',
        icon: Send,
        badge: telegramSettings?.isConfigured ? 'Активен' : 'Не настроен',
        badgeVariant: telegramSettings?.isConfigured ? 'sky' : 'amber',
      },
      {
        id: 'notifications',
        label: 'Планировщик рассылок',
        icon: Clock,
      },
    ],
  };

  const navSections = [
    {
      id: 'today' as const,
      label: 'Сегодня на складах',
      category: 'operations' as const,
      categoryLabel: 'Операции дня',
      desc: 'Явки, открытые смены и присутствие рабочих онлайн',
      icon: CalendarDays,
    },
    {
      id: 'schedule' as const,
      label: 'График смен',
      category: 'operations' as const,
      categoryLabel: 'График и биржа',
      desc: 'Планирование и назначение смен по складам',
      icon: CalendarCheck,
    },
    {
      id: 'swaps' as const,
      label: 'Биржа смен',
      category: 'operations' as const,
      categoryLabel: 'График и биржа',
      desc: 'Запросы рабочих на взаимный обмен сменами',
      icon: ArrowLeftRight,
      badge: pendingSwapsCount > 0 ? pendingSwapsCount : undefined,
      badgeVariant: 'amber' as const,
    },
    {
      id: 'staff' as const,
      label: 'Работники склада',
      category: 'network' as const,
      categoryLabel: 'Персонал и склады',
      desc: 'Список рабочих, должности, ставки и выработка',
      icon: Users,
      badge: activeStaffCount,
      badgeVariant: 'sky' as const,
    },
    {
      id: 'applications' as const,
      label: 'Анкеты кандидатов',
      category: 'network' as const,
      categoryLabel: 'Персонал и склады',
      desc: 'Анкеты соискателей на складские должности',
      icon: UserPlus,
      badge: pendingAppsCount > 0 ? pendingAppsCount : undefined,
      badgeVariant: 'amber' as const,
    },
    {
      id: 'pvz' as const,
      label: 'Склады и объекты',
      category: 'network' as const,
      categoryLabel: 'Персонал и склады',
      desc: 'Склады, геозоны и QR-коды проходной',
      icon: Building2,
      badge: pickupPoints.length,
      badgeVariant: 'sky' as const,
    },
    {
      id: 'reports' as const,
      label: 'Табель и расчёт ФОТ',
      category: 'finance' as const,
      categoryLabel: 'Табель и выплаты',
      desc: 'Сводный табель часов, тарифы и начисления',
      icon: BarChart3,
    },
    {
      id: 'excel' as const,
      label: 'Экспорт в Excel',
      category: 'finance' as const,
      categoryLabel: 'Табель и выплаты',
      desc: 'Выгрузка расчётных ведомостей .xlsx',
      icon: FileSpreadsheet,
    },
    {
      id: 'telegram' as const,
      label: 'Telegram-бот',
      category: 'system' as const,
      categoryLabel: 'Автоматизация',
      desc: 'Подключение бота и чата руководителя',
      icon: Send,
      badge: telegramSettings?.isConfigured ? 'Активен' : 'Не настроен',
      badgeVariant: telegramSettings?.isConfigured ? ('sky' as const) : ('amber' as const),
    },
    {
      id: 'notifications' as const,
      label: 'Планировщик рассылок',
      category: 'system' as const,
      categoryLabel: 'Автоматизация',
      desc: 'Авто-напоминания сотрудникам по расписанию',
      icon: Bell,
    },
  ];

  const categories = [
    { id: 'operations', title: 'Смены и график' },
    { id: 'network', title: 'Персонал и склады' },
    { id: 'finance', title: 'Табель и выплаты' },
    { id: 'system', title: 'Автоматизация' },
  ] as const;

  const currentSection = navSections.find(s => s.id === activeTab) || navSections[0];
  const CurrentIcon = currentSection.icon;
  const activeSubTabs = subTabsByGroup[activeGroup];

  return (
    <div className="max-w-7xl mx-auto py-5 sm:py-6 px-4 sm:px-6 lg:px-8 space-y-5 text-[#111111]">

      {/* DESKTOP CONSOLIDATED NAVIGATION (5 Primary Sections + Automation Menu) */}
      <div className="hidden md:flex items-center justify-between gap-3 border-b border-[#d9dbe0]">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {primaryNavItems.map(item => {
            const Icon = item.icon;
            const isActive = activeGroup === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.defaultTab)}
                title={item.desc}
                className={`flex items-center gap-2 px-3 py-2.5 text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0 border-b-2 -mb-px ${
                  isActive
                    ? 'border-[#2f63ff] text-[#111111] font-semibold'
                    : 'border-transparent text-[#5d6270] hover:text-[#111111] hover:bg-[#f7f9ff] font-medium rounded-t'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                <span>{item.label}</span>
                {item.alertCount !== undefined ? (
                  <span className="px-1.5 py-0.5 rounded-xs bg-[#2f63ff] text-white text-[10px] font-bold font-mono tabular-nums leading-none">
                    {item.alertCount}
                  </span>
                ) : item.countLabel !== undefined ? (
                  <span className={`text-[11px] font-mono tabular-nums font-semibold ${isActive ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`}>
                    {item.countLabel}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Secondary Admin Setup Menu: Automation (Telegram & Reminders) */}
        <div ref={automationMenuRef} className="relative shrink-0 pl-2 border-l border-[#d9dbe0]">
          <button
            type="button"
            onClick={() => setIsAutomationMenuOpen(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 -mb-px ${
              activeGroup === 'automationGroup'
                ? 'border-[#2f63ff] text-[#111111] font-semibold'
                : 'border-transparent text-[#5d6270] hover:text-[#111111] hover:bg-[#f7f9ff] font-medium rounded-t'
            }`}
            aria-haspopup="menu"
            aria-expanded={isAutomationMenuOpen}
            title="Настройка Telegram-бота и авто-рассылок"
          >
            <Settings2 className={`w-3.5 h-3.5 shrink-0 ${activeGroup === 'automationGroup' ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
            <span>Автоматизация</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isAutomationMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isAutomationMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1.5 w-64 bg-white border border-[#d9dbe0] rounded-md shadow-sm py-1 z-40"
            >
              <div className="px-3 py-1.5 border-b border-[#e5e7eb] bg-[#f7f9ff] text-[11px] font-semibold text-[#5d6270]">
                Бот и уведомления
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActiveTab('telegram');
                  setIsAutomationMenuOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  activeTab === 'telegram'
                    ? 'bg-[#eef2ff] text-[#111111] font-semibold'
                    : 'text-[#2d313b] hover:bg-[#f7f9ff] hover:text-[#111111]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Send className="w-3.5 h-3.5 text-[#2f63ff]" />
                  <span>Telegram-бот</span>
                </span>
                <span className={`text-[11px] font-medium ${telegramSettings?.isConfigured ? 'text-emerald-700' : 'text-[#b45309]'}`}>
                  {telegramSettings?.isConfigured ? 'Активен' : 'Настроить'}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActiveTab('notifications');
                  setIsAutomationMenuOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  activeTab === 'notifications'
                    ? 'bg-[#eef2ff] text-[#111111] font-semibold'
                    : 'text-[#2d313b] hover:bg-[#f7f9ff] hover:text-[#111111]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Bell className="w-3.5 h-3.5 text-[#2f63ff]" />
                  <span>Планировщик рассылок</span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MOBILE NAVIGATION */}
      <div className="block md:hidden space-y-2">
        <div className="p-3.5 bg-white border border-[#d9dbe0] rounded-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <CurrentIcon className="w-4 h-4 text-[#2f63ff] shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#5d6270]">
                  <span>{currentSection.categoryLabel}</span>
                  {currentSection.badge !== undefined && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-bold text-[#2f63ff] tabular-nums">
                        {currentSection.badge}
                      </span>
                    </>
                  )}
                </div>
                <h3 className="text-sm font-semibold text-[#111111] truncate">
                  {currentSection.label}
                </h3>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="flex items-center gap-1.5 py-1.5 px-3 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] rounded text-xs font-semibold shrink-0 transition-colors cursor-pointer border border-[#d9dbe0]"
              title="Открыть все разделы"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Разделы</span>
              {(pendingAppsCount > 0 || pendingSwapsCount > 0) && (
                <span className="px-1.5 py-0.5 rounded-xs bg-[#2f63ff] text-white text-[10px] font-bold font-mono tabular-nums leading-none">
                  {pendingAppsCount + pendingSwapsCount}
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-[#5d6270]" />
            </button>
          </div>
        </div>

        <div
          ref={mobileNavRef}
          className="flex items-center gap-1 p-1 bg-white border border-[#d9dbe0] rounded-md overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {primaryNavItems.map(item => {
            const Icon = item.icon;
            const isActive = activeGroup === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.defaultTab)}
                data-active={isActive}
                className={`relative shrink-0 px-2.5 h-8 flex items-center justify-center gap-1.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#111111] text-white'
                    : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#f7f9ff]'
                }`}
                title={item.label}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                <span>{item.label}</span>
                {item.alertCount !== undefined && (
                  <span className="px-1 py-0.5 rounded-xs bg-[#2f63ff] text-white text-[10px] font-bold font-mono tabular-nums leading-none">
                    {item.alertCount}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setActiveTab('telegram')}
            data-active={activeGroup === 'automationGroup'}
            className={`relative shrink-0 px-2.5 h-8 flex items-center justify-center gap-1.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeGroup === 'automationGroup'
                ? 'bg-[#111111] text-white'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#f7f9ff]'
            }`}
            title="Автоматизация"
          >
            <Settings2 className={`w-3.5 h-3.5 shrink-0 ${activeGroup === 'automationGroup' ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
            <span>Бот</span>
          </button>
        </div>
      </div>

      {/* CONTEXTUAL SUB-NAVIGATION BAR FOR GROUPED SECTIONS */}
      {activeSubTabs && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
            {activeSubTabs.map(sub => {
              const SubIcon = sub.icon;
              const isSubActive = activeTab === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setActiveTab(sub.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isSubActive
                      ? 'bg-white text-[#111111] border border-[#d9dbe0]'
                      : 'text-[#5d6270] hover:text-[#111111] border border-transparent'
                  }`}
                >
                  <SubIcon className={`w-3.5 h-3.5 shrink-0 ${isSubActive ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                  <span>{sub.label}</span>
                  {sub.badge !== undefined && (
                    <span
                      className={`text-[11px] font-mono tabular-nums font-bold ${
                        sub.badgeVariant === 'amber'
                          ? 'text-[#b45309]'
                          : 'text-[#5d6270]'
                      }`}
                    >
                      {sub.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* MOBILE FULL NAVIGATION DRAWER */}
      {isMobileMenuOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setIsMobileMenuOpen(false); }}
          className="fixed inset-0 bg-[#111111]/55 z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white border-t sm:border border-[#d9dbe0] rounded-t-md sm:rounded-md w-full max-w-lg mx-auto overflow-hidden flex flex-col max-h-[88vh] animate-in slide-in-from-bottom duration-200 text-[#111111]">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-white/10 bg-[#111111] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <LayoutGrid className="w-5 h-5 text-[#2f63ff] shrink-0" />
                <div>
                  <h3 className="text-base font-semibold text-white">Разделы управления</h3>
                  <p className="text-xs text-white/70">Выберите раздел для перехода</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1.5 text-white/70 hover:text-white rounded hover:bg-white/10 transition-colors cursor-pointer"
                title="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto space-y-4">
              {categories.map(cat => {
                const items = navSections.filter(s => s.category === cat.id);
                return (
                  <div key={cat.id} className="space-y-1.5">
                    <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[#5d6270]">
                      {cat.title}
                    </div>
                    <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] overflow-hidden">
                      {items.map(item => {
                        const ItemIcon = item.icon;
                        const isSelected = activeTab === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setActiveTab(item.id);
                              setIsMobileMenuOpen(false);
                            }}
                            className={`w-full flex items-center justify-between p-3 text-left transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-[#eef2ff] text-[#111111]'
                                : 'bg-white hover:bg-[#f7f9ff] text-[#2d313b]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <ItemIcon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-[#111111]">
                                    {item.label}
                                  </span>
                                  {item.badge !== undefined && (
                                    <span
                                      className={`text-xs font-mono tabular-nums font-bold ${
                                        item.badgeVariant === 'amber'
                                          ? 'text-[#b45309]'
                                          : 'text-[#2f63ff]'
                                      }`}
                                    >
                                      {item.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-[#5d6270] truncate">{item.desc}</p>
                              </div>
                            </div>

                            <div className="shrink-0 ml-2">
                              {isSelected ? (
                                <span className="text-[11px] font-semibold text-[#2f63ff]">Активен</span>
                              ) : (
                                <ChevronRight className="w-4 h-4 text-[#5d6270]" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-[#d9dbe0] bg-[#f7f9ff] flex justify-end">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full py-2.5 bg-[#111111] hover:bg-[#2f63ff] text-white rounded text-xs font-semibold transition-colors text-center cursor-pointer"
              >
                Закрыть меню
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Content Sections */}
      <div>
        {activeTab === 'today' && <TodayView />}
        {activeTab === 'pvz' && <PickupPointsManagementView />}
        {activeTab === 'notifications' && <ScheduledNotificationsView />}
        {activeTab === 'telegram' && <TelegramSettingsView />}
        {activeTab === 'schedule' && <SchedulePlannerView />}
        {activeTab === 'swaps' && <ShiftSwapManagerView />}
        {activeTab === 'staff' && <StaffManagementView />}
        {activeTab === 'applications' && <ApplicationsView />}
        {activeTab === 'reports' && <ReportsView />}
        {activeTab === 'excel' && <ExcelExportView />}
      </div>

    </div>
  );
};
