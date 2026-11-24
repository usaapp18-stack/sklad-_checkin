import React from 'react';
import { useApp } from '../context/AppContext';
import { Shield, UserCheck, X, Check, RefreshCw, AlertCircle, Lock, LogOut } from 'lucide-react';
import { useBottomSheetGesture } from '../hooks/useBottomSheetGesture';

interface UserSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenRegistration: () => void;
}

export const UserSwitcher: React.FC<UserSwitcherProps> = ({
  isOpen,
  onClose,
}) => {
  const { dragOffset, handleProps } = useBottomSheetGesture({ isOpen, onClose });
  const {
    authSession,
    organization,
    subscription,
    setBillingModalOpen,
    currentRole,
    currentStaff,
    staffList,
    logout,
    resetLocalUIState,
  } = useApp();

  if (!isOpen) return null;

  const activeStaff = staffList.filter(s => s.status === 'active' && s.hasAccess);
  const otherStaff = staffList.filter(s => s.status !== 'active' || !s.hasAccess);
  const staffLocs = currentStaff?.locations || (currentStaff?.location ? [currentStaff.location] : []);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-hidden"
    >
      <div
        style={{
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset === 0 ? 'transform 0.2s ease-out' : 'none',
        }}
        className="bg-white border-t sm:border border-[#d9dbe0] rounded-t-md sm:rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden text-[#111111]"
      >
        
        {/* Mobile Drag Handle */}
        <div
          {...handleProps}
          className="sm:hidden pt-3 pb-3 px-8 flex justify-center shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
          title="Потяните вниз, чтобы закрыть"
        >
          <div className="w-12 h-1 bg-[#d9dbe0] rounded pointer-events-none" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0">
          <div>
            <h3 className="text-base font-semibold text-[#111111]">
              {currentRole === 'manager' ? 'Профиль руководителя' : 'Профиль сотрудника'}
            </h3>
            <p className="text-xs text-[#5d6270]">
              {currentRole === 'manager' ? 'Управление доступом' : 'Данные учетной записи'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto overscroll-contain touch-pan-y">
          
          {/* If Employee is logged in */}
          {currentRole === 'employee' ? (
            <div className="space-y-4">
              <div className="p-4 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[#111111] text-sm flex items-center gap-1.5 flex-wrap">
                      <UserCheck className="w-4 h-4 text-[#2f63ff] shrink-0" />
                      <span>{currentStaff?.name}</span>
                      {currentStaff?.isSenior && (
                        <span className="text-xs font-semibold text-[#2f63ff]">
                          · Ст.С.
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#5d6270] flex items-center gap-1 mt-1 flex-wrap">
                      <span>Место работы:</span>
                      <span className="text-[#111111] font-semibold">{staffLocs.join(', ')}</span>
                    </div>
                  </div>
                  <span className="text-xs text-emerald-700 font-semibold inline-flex items-center gap-1.5 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-xs bg-emerald-600 shrink-0" />
                    Доступ активен
                  </span>
                </div>

                <div className="pt-2.5 border-t border-[#e5e7eb] text-xs space-y-1.5 font-mono">
                  <div className="flex justify-between text-[#5d6270]">
                    <span>Логин:</span>
                    <span className="text-[#111111] font-semibold tabular-nums">{currentStaff?.login}</span>
                  </div>
                  <div className="flex justify-between text-[#5d6270]">
                    <span>Telegram:</span>
                    <span className="text-[#111111] font-sans font-medium">{currentStaff?.telegramUsername || 'Не указан'}</span>
                  </div>
                </div>
              </div>

              {/* Strict Notice */}
              <div className="p-3.5 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs text-[#2d313b] flex items-start gap-2.5 leading-relaxed">
                <Lock className="w-4 h-4 text-[#2f63ff] shrink-0 mt-0.5" />
                <span>
                  Работник не может менять логин и пароль. Изменение учетных данных или отзыв доступа производится только руководителем.
                </span>
              </div>

              <button
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="w-full py-2.5 px-4 bg-[#111111] hover:bg-[#2d313b] text-white rounded text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Выйти из системы</span>
              </button>
            </div>
          ) : (
            /* If Manager is logged in */
            <>
              <div>
                <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider mb-2">
                  Текущая сессия руководителя
                </div>
                <div className="p-3.5 rounded-md bg-[#eef2ff] border border-[#a9bcff] text-[#111111] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-[#111111]">
                      <Shield className="w-4 h-4 text-[#2f63ff] shrink-0" />
                      <span className="truncate">{authSession?.name || 'Руководитель'}</span>
                    </div>
                    <div className="text-xs text-[#2d313b] mt-0.5 truncate">
                      {authSession?.email || authSession?.login || '—'}
                    </div>
                    {organization && (
                      <div className="text-xs text-[#5d6270] mt-1">
                        Организация: <span className="font-semibold text-[#111111]">{organization.name}</span>
                        {subscription && (
                          <>
                            {' '}· Тариф: <span className="font-semibold text-[#2f63ff]">{subscription.tariffName}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <Check className="w-4 h-4 text-[#2f63ff] shrink-0" />
                </div>
                {subscription && subscription.status !== 'demo' && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      setBillingModalOpen(true);
                    }}
                    className="mt-2 w-full py-2 px-3 bg-white hover:bg-[#f7f9ff] text-[#2f63ff] border border-[#d9dbe0] hover:border-[#2f63ff] rounded text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Управление тарифом и оплатой
                  </button>
                )}
              </div>

              {/* Active Employees List */}
              <div>
                <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider mb-2">
                  Работники с выданным доступом
                </div>
                {activeStaff.length === 0 ? (
                  <div className="p-3 text-center text-xs text-[#5d6270] bg-[#f7f9ff] rounded-md border border-[#d9dbe0]">
                    Работники еще не добавлены
                  </div>
                ) : (
                  <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                    {activeStaff.map(staff => {
                      const locs = staff.locations && staff.locations.length > 0 ? staff.locations : (staff.location ? [staff.location] : []);
                      return (
                        <div
                          key={staff.id}
                          className="flex items-center justify-between gap-2 p-2.5 text-[#111111] hover:bg-[#f7f9ff] transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#111111] flex items-center gap-1.5 flex-wrap">
                              <span>{staff.name}</span>
                              {locs.length > 0 && (
                                <span className="text-[11px] text-[#2f63ff] font-medium">
                                  · {locs.join(', ')}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-[#5d6270] mt-0.5">
                              Логин: {staff.login}
                            </div>
                          </div>

                          <span className="text-[11px] text-emerald-700 font-semibold inline-flex items-center gap-1.5 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-xs bg-emerald-600 shrink-0" />
                            Активен
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Inactive Staff */}
              {otherStaff.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider mb-2">
                    Без доступа / Архив
                  </div>
                  <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-[#f7f9ff] overflow-hidden">
                    {otherStaff.map(staff => (
                      <div
                        key={staff.id}
                        className="flex items-center justify-between p-2.5 text-[#2d313b] text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertCircle className="w-3.5 h-3.5 text-[#5d6270] shrink-0" />
                          <span className="truncate">{staff.name}</span>
                        </div>
                        <span className="text-[11px] text-[#5d6270] font-medium shrink-0">
                          {staff.status === 'blocked' || staff.status === 'deactivated' ? 'Заблокирован' : 'В архиве'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reset Local UI State */}
              <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                <button
                  onClick={() => {
                    resetLocalUIState();
                    onClose();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-[#2d313b] hover:text-[#111111] bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] rounded text-xs font-medium transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Обновить данные с сервера</span>
                </button>

                <button
                  onClick={() => {
                    onClose();
                    logout();
                  }}
                  className="w-full py-2.5 px-4 bg-[#111111] hover:bg-[#2d313b] text-white rounded text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Выйти из учетной записи</span>
                </button>
              </div>
            </>
          )}

        </div>

      </div>
    </div>
  );
};
