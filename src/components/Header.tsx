import React from 'react';
import { useApp } from '../context/AppContext';
import { Bell, User, ShieldCheck, LogOut, CreditCard } from 'lucide-react';
import { formatDisplayDate } from '../utils/time';
import { PWAInstallButton } from './PWAInstallButton';
import { useAppBadge } from '../hooks/useAppBadge';
import { BrandLogo } from './common/BrandLogo';

interface HeaderProps {
  onOpenNotifications: () => void;
  onOpenUserSwitcher: () => void;
  onAfterLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenNotifications,
  onOpenUserSwitcher,
  onAfterLogout,
}) => {
  const {
    authSession,
    organization,
    subscription,
    setBillingModalOpen,
    currentRole,
    currentStaffId,
    currentStaff,
    mskTime,
    todayDate,
    notifications,
    messages,
    logout,
  } = useApp();

  // Calculate unread notifications specifically for the current role / user
  const relevantUnreadNotifs = notifications.filter(n => {
    if (n.read) return false;
    if (currentRole === 'manager') {
      return n.type === 'report' || n.type === 'system' || n.toEmployeeId === 'manager';
    } else {
      const isTargeted = n.toEmployeeId === currentStaffId || n.toEmployeeId === 'all';
      if (!isTargeted) return false;
      if (n.location && currentStaff) {
        const staffLocs = currentStaff.locations || (currentStaff.location ? [currentStaff.location] : []);
        return staffLocs.includes(n.location);
      }
      return true;
    }
  }).length;

  const unreadMessages = currentRole === 'manager' ? messages.filter(m => !m.read).length : 0;
  const totalAlerts = relevantUnreadNotifs + unreadMessages;

  // Sync unread notifications count with the home screen app icon (App Badging API)
  useAppBadge(totalAlerts);

  const handleLogout = async () => {
    await logout();
    onAfterLogout?.();
  };

  return (
    <header className="sticky top-0 z-30 bg-[#111111] border-b border-white/10 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-15 gap-4">

          {/* Brand Wordmark + Organization context */}
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center gap-2.5 shrink-0 whitespace-nowrap">
              <BrandLogo className="w-7 h-7 shrink-0" />
              <span className="kv-font-display text-xl tracking-[0.03em] text-white uppercase leading-none">
                SKLADIN
              </span>
            </span>
            {organization?.name && (
              <div className="hidden lg:flex items-center gap-2 text-xs text-neutral-400 min-w-0">
                <span className="text-white/20">/</span>
                <span className="truncate max-w-[200px] text-neutral-200 font-medium">{organization.name}</span>
              </div>
            )}
          </div>

          {/* Clock & Local warehouse time */}
          <div className="hidden md:flex items-center gap-2 text-xs shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/6 border border-white/12 rounded">
              <span className="text-neutral-400">МСК</span>
              <span className="font-mono tabular-nums font-semibold text-white">{mskTime.slice(0, 5)}</span>
              <span className="text-white/25">·</span>
              <span className="text-neutral-300">{formatDisplayDate(todayDate)}</span>
            </div>
          </div>

          {/* Action buttons & User info */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

            {/* Manager Subscription / Tariff trigger */}
            {currentRole === 'manager' && subscription && subscription.status !== 'demo' && (
              <button
                type="button"
                onClick={() => setBillingModalOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:text-white bg-white/6 hover:bg-white/12 rounded transition-colors cursor-pointer border border-white/12 whitespace-nowrap"
                title="Тариф и оплата подписки"
              >
                <CreditCard className="w-3.5 h-3.5 text-[#2f63ff]" />
                <span>{subscription.status === 'trial' ? 'Триал' : subscription.tariffName}</span>
              </button>
            )}

            {/* Add to home screen / PWA Install */}
            <PWAInstallButton isHeader />

            {/* Notifications Button */}
            <button
              onClick={onOpenNotifications}
              className="relative p-2 text-neutral-300 hover:text-white bg-white/6 hover:bg-white/12 rounded transition-colors cursor-pointer border border-white/12"
              aria-label="Уведомления"
              title="Уведомления и сообщения"
            >
              <Bell className="w-4 h-4" />
              {totalAlerts > 0 && (
                <span className="notification-badge absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#2f63ff] text-white text-[10px] font-mono font-bold rounded flex items-center justify-center tabular-nums">
                  {totalAlerts}
                </span>
              )}
            </button>

            {/* User Badge / Persona Selector */}
            <button
              onClick={onOpenUserSwitcher}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-white/6 hover:bg-white/12 text-white rounded transition-colors cursor-pointer border border-white/12"
              title="Информация об аккаунте"
            >
              {currentRole === 'manager' ? (
                <ShieldCheck className="w-4 h-4 text-[#2f63ff] shrink-0" />
              ) : (
                <User className="w-4 h-4 text-[#a9bcff] shrink-0" />
              )}
              <div className="text-left hidden sm:block">
                <span className="font-semibold block truncate max-w-[130px] text-white">
                  {authSession?.name || (currentRole === 'manager' ? 'Руководитель' : currentStaff?.name)}
                </span>
              </div>
            </button>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-white/6 hover:bg-white/12 rounded transition-colors cursor-pointer border border-white/12"
              title="Выйти из аккаунта (закрыть сессию)"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Выйти</span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};

