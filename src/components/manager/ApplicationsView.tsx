import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ApplicationRequest, LocationType } from '../../types';
import { formatDisplayDate, parseDateSafe } from '../../utils/time';
import { copyToClipboard } from '../../utils/clipboard';
import { Check, X, Clock, CheckCircle2, XCircle, KeyRound, Copy } from 'lucide-react';

export const ApplicationsView: React.FC = () => {
  const { applications, handleApplication, pickupPoints = [] } = useApp();
  
  const [rejectModalApp, setRejectModalApp] = useState<ApplicationRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [acceptModalApp, setAcceptModalApp] = useState<ApplicationRequest | null>(null);
  const [assignLogin, setAssignLogin] = useState('');
  const [assignPassword, setAssignPassword] = useState('');
  const [assignLocations, setAssignLocations] = useState<LocationType[]>([]);
  const [copied, setCopied] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const availableLocations: string[] = pickupPoints.filter(p => !p.isArchived).map(p => p.code);

  const pendingApps = (applications || []).filter(a => a.status === 'pending');
  const pastApps = (applications || []).filter(a => a.status !== 'pending');

  const toggleLocationSelection = (loc: LocationType) => {
    if (assignLocations.includes(loc)) {
      if (assignLocations.length === 1) return;
      setAssignLocations(assignLocations.filter(l => l !== loc));
    } else {
      setAssignLocations([...assignLocations, loc]);
    }
  };

  const openAcceptModal = (app: ApplicationRequest) => {
    setAcceptModalApp(app);
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setAssignLogin(`emp_${randomSuffix}`);
    setAssignPassword(`pass${Math.floor(1000 + Math.random() * 9000)}`);
    setAssignLocations(availableLocations.length > 0 ? [availableLocations[0]] : []);
    setCopied(false);
  };

  const confirmAccept = async () => {
    if (acceptModalApp) {
      const res = await handleApplication(
        acceptModalApp.id,
        'accept',
        undefined,
        assignLogin.trim(),
        assignPassword.trim(),
        assignLocations
      );
      if (res.success) {
        setActionNotice(`Доступ для «${acceptModalApp.name}» успешно выдан! Логин: ${assignLogin}`);
        setTimeout(() => setActionNotice(null), 4000);
      }
      setAcceptModalApp(null);
    }
  };

  const confirmReject = async () => {
    if (rejectModalApp) {
      const res = await handleApplication(rejectModalApp.id, 'reject', rejectReason.trim());
      if (res.success) {
        setActionNotice(`Заявка кандидата «${rejectModalApp.name}» отклонена.`);
        setTimeout(() => setActionNotice(null), 3500);
      }
      setRejectModalApp(null);
      setRejectReason('');
    }
  };

  const handleCopy = async () => {
    const locsStr = assignLocations.join(', ');
    const text = `Логин: ${assignLogin}\nПароль: ${assignPassword}\nМесто работы: ${locsStr}\nВход: Система SKLADIN`;
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parseSafeDate = (isoStr?: string | null): { dateStr: string; timeStr: string } => {
    if (!isoStr) {
      const now = new Date();
      return {
        dateStr: formatDisplayDate(now.toISOString().slice(0, 10)),
        timeStr: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      };
    }
    try {
      const d = parseDateSafe(isoStr);
      return {
        dateStr: formatDisplayDate(d.toISOString().slice(0, 10)),
        timeStr: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      };
    } catch {
      return { dateStr: isoStr, timeStr: '' };
    }
  };

  return (
    <div className="space-y-6 text-[#111111]">

      {actionNotice && (
        <div className="p-3 bg-[#111111] text-white border border-[#2d313b] rounded-md text-xs flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#a9bcff]" />
          <span className="font-medium">{actionNotice}</span>
        </div>
      )}
      
      {/* Pending Applications Section */}
      <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
        <div className="p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#b45309]" />
            <h3 className="text-sm font-semibold text-[#111111]">Новые заявки на выдачу доступа</h3>
          </div>
          <span className="text-xs text-[#2f63ff] font-mono font-bold tabular-nums">
            {pendingApps.length}
          </span>
        </div>

        {pendingApps.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#5d6270] bg-white">
            Нет активных заявок, ожидающих решения
          </div>
        ) : (
          <div className="divide-y divide-[#e5e7eb]">
            {pendingApps.map(app => {
              const { dateStr, timeStr } = parseSafeDate(app.createdAt || app.submittedAt);

              return (
                <div key={app.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white hover:bg-[#f7f9ff] transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-[#111111]">{app.name}</span>
                      <span className="text-xs text-[#2f63ff] font-mono">
                        {app.telegramUsername ? `@${app.telegramUsername.replace('@', '')}` : 'Без Telegram'}
                      </span>
                    </div>
                    <div className="text-xs text-[#5d6270] flex items-center gap-2 flex-wrap">
                      <span>Подана: {dateStr} {timeStr ? `в ${timeStr}` : ''}</span>
                      {app.note && <span>· {app.note}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openAcceptModal(app)}
                      className="flex-1 sm:flex-initial py-2 px-3.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>Выдать логин и пароль</span>
                    </button>

                    <button
                      onClick={() => {
                        setRejectModalApp(app);
                        setRejectReason('');
                      }}
                      className="flex-1 sm:flex-initial py-2 px-3.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Отклонить</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History of Past Applications */}
      <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
        <div className="p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#111111]">История рассмотренных заявок</h3>
            <p className="text-xs text-[#5d6270]">Ранее принятые и отклоненные заявки кандидатов</p>
          </div>
          <span className="text-xs text-[#2d313b] font-semibold font-mono tabular-nums">
            Всего: {pastApps.length}
          </span>
        </div>

        {pastApps.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#5d6270] bg-white">
            История пуста
          </div>
        ) : (
          <div className="divide-y divide-[#e5e7eb]">
            {pastApps.map(app => {
              const { dateStr } = parseSafeDate(app.createdAt || app.submittedAt);
              const isAccepted = app.status === 'accepted' || app.status === 'approved';

              return (
                <div key={app.id} className="p-4 flex items-center justify-between gap-4 text-xs bg-white">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-[#111111] flex items-center gap-2 flex-wrap">
                      <span>{app.name}</span>
                      <span className="text-[#2f63ff] text-xs font-mono">{app.telegramUsername ? `@${app.telegramUsername.replace('@', '')}` : ''}</span>
                    </div>
                    <div className="text-xs text-[#5d6270]">
                      Дата: {dateStr}
                      {app.note && ` · ${app.note}`}
                    </div>
                  </div>

                  <div>
                    {isAccepted ? (
                      <span className="inline-flex items-center gap-1.5 text-[#2f63ff] font-semibold text-xs whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Доступ выдан</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-rose-700 font-semibold text-xs whitespace-nowrap">
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Отклонена</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Accept & Assign Credentials & Locations Modal */}
      {acceptModalApp && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setAcceptModalApp(null); }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto"
        >
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto text-[#111111]">
            
            <div className="flex items-center justify-between p-4 sm:p-5 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-4 h-4 text-[#2f63ff] shrink-0" />
                <div>
                  <h3 className="text-base font-semibold text-[#111111]">Выдача доступа работнику</h3>
                  <p className="text-xs text-[#5d6270]">Генерация учетных данных</p>
                </div>
              </div>
              <button
                onClick={() => setAcceptModalApp(null)}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto">
              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs text-[#2d313b]">
                Кандидат: <span className="font-bold text-[#111111]">{acceptModalApp.name}</span>
                {acceptModalApp.telegramUsername && <span className="text-[#2f63ff] font-mono"> ({acceptModalApp.telegramUsername})</span>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#2d313b] mb-1">
                  Логин работника *
                </label>
                <input
                  type="text"
                  required
                  value={assignLogin}
                  onChange={e => setAssignLogin(e.target.value)}
                  className="w-full h-10 min-h-[40px] px-3 py-2 bg-white border border-[#d9dbe0] hover:border-[#2f63ff] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/30 rounded text-xs text-[#111111] font-mono focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#2d313b] mb-1">
                  Пароль *
                </label>
                <input
                  type="text"
                  required
                  value={assignPassword}
                  onChange={e => setAssignPassword(e.target.value)}
                  className="w-full h-10 min-h-[40px] px-3 py-2 bg-white border border-[#d9dbe0] hover:border-[#2f63ff] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/30 rounded text-xs text-[#111111] font-mono focus:outline-none transition-colors"
                />
              </div>

              {/* Select Locations */}
              <div>
                <label className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                  Место работы (выберите склады) *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {availableLocations.map(loc => {
                    const isSelected = assignLocations.includes(loc);
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => toggleLocationSelection(loc)}
                        className={`py-2 px-3 rounded text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer border ${
                          isSelected
                            ? 'bg-[#eef2ff] text-[#2f63ff] border-[#2f63ff]'
                            : 'bg-[#f7f9ff] text-[#2d313b] border-[#d9dbe0] hover:bg-[#eef2ff]/70'
                        }`}
                      >
                        <div className={`w-3.5 h-3.5 rounded-xs flex items-center justify-center ${
                          isSelected ? 'bg-[#2f63ff] text-white' : 'bg-white border border-[#d9dbe0]'
                        }`}>
                          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className="font-mono">Склад {loc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="w-full py-2 px-3 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="text-emerald-700 font-semibold">Данные скопированы для отправки</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#2f63ff]" />
                    <span>Скопировать логин, пароль и локацию</span>
                  </>
                )}
              </button>

              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-[11px] text-[#2d313b] leading-relaxed">
                Работник будет создан со статусом «Активен». Вход осуществляется через общую страницу авторизации.
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-[#f7f9ff] border-t border-[#e5e7eb] flex items-center justify-end gap-2.5">
              <button
                onClick={() => setAcceptModalApp(null)}
                className="px-4 py-2 text-xs font-semibold text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={confirmAccept}
                disabled={!assignLogin.trim() || !assignPassword.trim() || assignLocations.length === 0}
                className={`px-5 py-2 text-xs font-bold rounded transition-colors ${
                  assignLogin.trim() && assignPassword.trim() && assignLocations.length > 0
                    ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white cursor-pointer'
                    : 'bg-[#eef2ff] text-[#5d6270] border border-[#d9dbe0] cursor-not-allowed'
                }`}
              >
                Подтвердить и открыть доступ
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Rejection Modal with Reason */}
      {rejectModalApp && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setRejectModalApp(null); }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto"
        >
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto text-[#111111]">
            
            <div className="flex items-center justify-between p-4 sm:p-5 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <h3 className="text-base font-semibold text-[#111111]">Отклонение заявки</h3>
              <button
                onClick={() => setRejectModalApp(null)}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3 flex-1 overflow-y-auto">
              <p className="text-xs text-[#2d313b]">
                Вы отклоняете заявку кандидата <strong className="text-[#111111] font-bold">{rejectModalApp.name}</strong>.
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#2d313b] mb-1">
                  Причина отклонения (необязательно)
                </label>
                <input
                  type="text"
                  placeholder="например, набор сотрудников временно закрыт"
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  className="w-full h-10 min-h-[40px] px-3 py-2 bg-white border border-[#d9dbe0] hover:border-[#2f63ff] focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30 rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-[#f7f9ff] border-t border-[#e5e7eb] flex items-center justify-end gap-3">
              <button
                onClick={() => setRejectModalApp(null)}
                className="px-4 py-2 text-xs font-semibold text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={confirmReject}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded transition-colors cursor-pointer"
              >
                Подтвердить отказ
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
