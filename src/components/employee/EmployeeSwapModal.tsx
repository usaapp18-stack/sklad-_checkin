import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { ShiftType, LocationType, ShiftSwapRequest } from '../../types';
import { CustomSelect } from '../common/CustomSelect';
import { CustomDatePicker } from '../common/CustomDatePicker';
import { formatDateDDMMYYYY, getShiftLabel } from '../../utils/calculations';
import {
  CheckCircle,
  Check,
  AlertCircle,
  Calendar
} from 'lucide-react';
import { AccessibleModal } from '../common/AccessibleModal';

interface EmployeeSwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDate?: string;
}

export const EmployeeSwapModal: React.FC<EmployeeSwapModalProps> = ({
  isOpen,
  onClose,
  defaultDate,
}) => {
  const {
    swaps,
    currentStaffId,
    currentStaff,
    authSession,
    pickupPoints = [],
    createSwapRequest,
    claimSwapRequest,
    approveSwapRequest,
    rejectSwapRequest,
    cancelSwapRequest,
    rates,
  } = useApp();

  const activePickupPointCodes = new Set(
    (pickupPoints || [])
      .filter(p => p.active !== false && !p.isArchived)
      .map(p => p.code)
  );

  const rawLocations = currentStaff?.locations && currentStaff.locations.length > 0
    ? currentStaff.locations
    : currentStaff?.location
    ? [currentStaff.location]
    : Array.from(activePickupPointCodes);

  const filteredLocations = rawLocations.filter(code => activePickupPointCodes.has(code));
  const userLocations = filteredLocations.length > 0 ? filteredLocations : Array.from(activePickupPointCodes);

  const [activeTab, setActiveTab] = useState<'open_market' | 'my_requests' | 'claimed_by_me'>('open_market');
  const [date, setDate] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [shiftType, setShiftType] = useState<ShiftType>('day12');
  const [location, setLocation] = useState<LocationType>(userLocations[0] || (pickupPoints[0]?.code || ''));
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && defaultDate) {
      setDate(defaultDate);
    }
  }, [isOpen, defaultDate]);

  if (!isOpen) return null;

  const isCandidateMe = (s: ShiftSwapRequest) =>
    s.candidateId === currentStaffId ||
    (authSession?.staffId && s.candidateId === authSession.staffId) ||
    (currentStaff?.name && s.candidateName === currentStaff.name);

  const openMarketSwaps = swaps
    .filter(
      s =>
        s.requesterId !== currentStaffId &&
        (s.status === 'open' || (isCandidateMe(s) && s.status === 'claimed'))
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const mySwaps = swaps
    .filter(s => s.requesterId === currentStaffId)
    .sort((a, b) => a.date.localeCompare(b.date));

  const myClaimedSwaps = swaps
    .filter(s => isCandidateMe(s) && (s.status === 'claimed' || s.status === 'approved'))
    .sort((a, b) => a.date.localeCompare(b.date));

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setActionSuccess(null);

    const existingOnDate = mySwaps.find(
      s => s.date === date && s.status !== 'rejected' && s.status !== 'cancelled'
    );
    if (existingOnDate) {
      setFormError(`У вас уже выведена смена на биржу на дату ${formatDateDDMMYYYY(date)}. Можно выставлять не более одной смены на одну дату.`);
      setTimeout(() => setFormError(null), 1700);
      return;
    }

    setLoading(true);
    const res = await createSwapRequest(date, shiftType, location, reason);
    setLoading(false);
    if (res.success) {
      setActionSuccess('Запрос на подмену опубликован на бирже смен! Все сотрудники получили уведомление.');
      setReason('');
      setTimeout(() => setActionSuccess(null), 3500);
    } else {
      setFormError(res.error || 'Ошибка при создании заявки');
      setTimeout(() => setFormError(null), 2000);
    }
  };

  const handleClaimShift = async (swapId: string) => {
    setLoading(true);
    setActionSuccess(null);
    setFormError(null);
    const res = await claimSwapRequest(swapId);
    setLoading(false);
    if (res.success) {
      setActionSuccess('Вы успешно откликнулись на смену! Автор смены получил уведомление для подтверждения.');
      setTimeout(() => setActionSuccess(null), 4000);
    } else {
      setFormError(res.error || 'Не удалось откликнуться на смену');
      setTimeout(() => setFormError(null), 4000);
    }
  };

  const handleApprove = async (swapId: string) => {
    setLoading(true);
    setActionSuccess(null);
    const res = await approveSwapRequest(swapId);
    setLoading(false);
    if (res.success) {
      setActionSuccess('Договорились! Смена успешно зафиксирована за откликнувшимся коллегой.');
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleReject = async (swapId: string) => {
    setLoading(true);
    setActionSuccess(null);
    const res = await rejectSwapRequest(swapId);
    setLoading(false);
    if (res.success) {
      setActionSuccess('Отклик отклонен. Смена снова открыта на бирже для других коллег.');
      setTimeout(() => setActionSuccess(null), 3500);
    }
  };

  const handleCancel = async (swapId: string) => {
    setLoading(true);
    await cancelSwapRequest(swapId);
    setLoading(false);
  };

  const groupSwapsByDate = (list: ShiftSwapRequest[]) => {
    const groups: { [date: string]: ShiftSwapRequest[] } = {};
    list.forEach(item => {
      if (!groups[item.date]) groups[item.date] = [];
      groups[item.date].push(item);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const openGroups = groupSwapsByDate(openMarketSwaps);
  const myGroups = groupSwapsByDate(mySwaps);
  const myClaimedGroups = groupSwapsByDate(myClaimedSwaps);

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Биржа смен и подмен"
      subtitle="Обмен, передача и взятие смен"
      maxWidthClass="max-w-2xl"
    >
      {/* Tab switch */}
      <div className="pt-1 pb-2 shrink-0">
        <div className="flex bg-[#f7f9ff] p-1 gap-1 rounded-md text-xs font-semibold border border-[#d9dbe0]">
          <button
            type="button"
            onClick={() => setActiveTab('open_market')}
            className={`flex-1 py-2 px-2.5 rounded transition-colors cursor-pointer text-center truncate ${
              activeTab === 'open_market'
                ? 'bg-[#111111] text-white font-semibold'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
            }`}
          >
            Открытые смены ({openMarketSwaps.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('my_requests')}
            className={`flex-1 py-2 px-2.5 rounded transition-colors cursor-pointer text-center truncate ${
              activeTab === 'my_requests'
                ? 'bg-[#111111] text-white font-semibold'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
            }`}
          >
            Мои заявки ({mySwaps.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('claimed_by_me')}
            className={`flex-1 py-2 px-2.5 rounded transition-colors cursor-pointer text-center truncate ${
              activeTab === 'claimed_by_me'
                ? 'bg-[#111111] text-white font-semibold'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
            }`}
          >
            Забранные смены ({myClaimedSwaps.length})
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {actionSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-md text-xs flex items-center gap-2 animate-fade-in">
            <CheckCircle className="w-4 h-4 shrink-0 text-emerald-700" />
            <span className="font-medium">{actionSuccess}</span>
          </div>
        )}

        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-md text-xs flex items-center gap-2 animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="font-medium">{formError}</span>
          </div>
        )}

        {activeTab === 'open_market' ? (
          <div className="space-y-4">
            <div className="text-xs text-[#2d313b]">
              Коллеги, которые ищут замену на свои смены. Нажмите «Выйти на замену», чтобы забрать смену:
            </div>

            {openMarketSwaps.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                Сейчас нет открытых смен для подмены. Все смены закрыты!
              </div>
            ) : (
              <div className="space-y-4">
                {openGroups.map(([grpDate, items]) => (
                  <div key={grpDate} className="space-y-1.5">
                    <div className="flex items-center gap-2 px-1 text-xs font-semibold text-[#5d6270]">
                      <Calendar className="w-3.5 h-3.5 text-[#2f63ff]" />
                      <span className="text-[#111111] font-mono tabular-nums">{formatDateDDMMYYYY(grpDate)}</span>
                      <span className="text-[#5d6270] font-normal">· {items.length} смен</span>
                    </div>

                    <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                      {items.map(sw => {
                        const isMyClaim = isCandidateMe(sw) && sw.status === 'claimed';

                        return (
                          <div
                            key={sw.id}
                            className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-[#f7f9ff] transition-colors"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-[#111111] font-mono tabular-nums">
                                  {formatDateDDMMYYYY(sw.date)}
                                </span>
                                <span className="text-[#d9dbe0]">·</span>
                                <span className="text-[#2f63ff] font-semibold font-mono">
                                  {sw.location}
                                </span>
                                <span className="text-[#d9dbe0]">·</span>
                                <span className="text-[#2d313b] font-medium">
                                  {getShiftLabel(sw.shiftType, rates)}
                                </span>
                                <span className="text-[#d9dbe0]">·</span>
                                {isMyClaim ? (
                                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#2f63ff]">
                                    <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff]" />
                                    Ждёт подтверждения
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#b45309]">
                                    <span className="w-1.5 h-1.5 rounded-xs bg-[#b45309]" />
                                    Открыта на бирже
                                  </span>
                                )}
                              </div>
                              <div className="text-[#2d313b] flex items-center gap-1.5 truncate text-xs">
                                <span className="text-[#5d6270] min-w-[65px] shrink-0">Передает:</span>
                                <strong className="text-[#111111] font-semibold truncate">{sw.requesterName}</strong>
                              </div>
                              <div className="flex items-center gap-1.5 truncate text-xs">
                                <span className="text-[#5d6270] min-w-[65px] shrink-0">Причина:</span>
                                <span className={`truncate ${sw.reason ? 'text-[#2d313b] italic' : 'text-[#5d6270]'}`}>
                                  {sw.reason ? `«${sw.reason}»` : '—'}
                                </span>
                              </div>
                            </div>

                            {isMyClaim ? (
                              <span className="text-xs font-semibold text-[#2f63ff] shrink-0 inline-flex items-center gap-1.5">
                                <Check className="w-3.5 h-3.5" />
                                Отклик отправлен
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleClaimShift(sw.id)}
                                disabled={loading}
                                className="py-2 px-3.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded text-xs transition-colors self-start sm:self-auto cursor-pointer disabled:opacity-50 shrink-0"
                              >
                                Выйти на замену
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'claimed_by_me' ? (
          <div className="space-y-4">
            <div className="text-xs text-[#2d313b]">
              Смены коллег, на которые вы откликнулись и выйдете на замену:
            </div>

            {myClaimedSwaps.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                У вас пока нет забранных смен с биржи. Вы можете забрать открытую смену коллеги на первой вкладке!
              </div>
            ) : (
              <div className="space-y-4">
                {myClaimedGroups.map(([grpDate, items]) => (
                  <div key={grpDate} className="space-y-1.5">
                    <div className="flex items-center gap-2 px-1 text-xs font-semibold text-[#5d6270]">
                      <Calendar className="w-3.5 h-3.5 text-[#2f63ff]" />
                      <span className="text-[#111111] font-mono tabular-nums">{formatDateDDMMYYYY(grpDate)}</span>
                    </div>

                    <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                      {items.map(sw => {
                        const isPending = sw.status === 'claimed';

                        return (
                          <div
                            key={sw.id}
                            className="p-3.5 space-y-2 text-xs hover:bg-[#f7f9ff] transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-[#111111] font-mono tabular-nums">
                                  {formatDateDDMMYYYY(sw.date)}
                                </span>
                                <span className="text-[#d9dbe0]">·</span>
                                <span className="text-[#2f63ff] font-semibold font-mono">
                                  {sw.location}
                                </span>
                                <span className="text-[#d9dbe0]">·</span>
                                <span className="text-[#2d313b] font-medium">
                                  {getShiftLabel(sw.shiftType, rates)}
                                </span>
                              </div>

                              {isPending ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#b45309]">
                                  <span className="w-1.5 h-1.5 rounded-xs bg-[#b45309]" />
                                  Ждёт подтверждения
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Договорились (Утверждено)</span>
                                </span>
                              )}
                            </div>

                            <div className="space-y-1 text-xs text-[#2d313b] pt-0.5">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="text-[#5d6270] shrink-0 min-w-[125px]">Выходите вместо:</span>
                                <strong className="text-[#111111] font-semibold truncate">{sw.requesterName}</strong>
                              </div>
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="text-[#5d6270] shrink-0 min-w-[125px]">Причина передачи:</span>
                                <span className={`truncate ${sw.reason ? 'text-[#2d313b] italic' : 'text-[#5d6270]'}`}>
                                  {sw.reason ? `«${sw.reason}»` : '—'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            
            <form onSubmit={handleCreateRequest} className="p-4 sm:p-5 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-3.5 text-xs">
              <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
                Выставить мою смену на биржу:
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[#2d313b] font-semibold mb-1">Дата смены:</label>
                  <CustomDatePicker
                    value={date}
                    onChange={v => setDate(v)}
                  />
                </div>

                <div>
                  <label className="block text-[#2d313b] font-semibold mb-1">Склад:</label>
                  <CustomSelect<LocationType>
                    value={location}
                    onChange={v => setLocation(v)}
                    menuHeaderTitle="Склад"
                    options={userLocations.map(loc => {
                      const pt = pickupPoints.find(p => p.code === loc || p.id === loc);
                      return {
                        value: loc,
                        label: loc,
                        sublabel: pt?.name && pt.name !== loc ? pt.name : undefined,
                      };
                    })}
                  />
                </div>

                <div>
                  <label className="block text-[#2d313b] font-semibold mb-1">Категория:</label>
                  <CustomSelect<ShiftType>
                    value={shiftType}
                    onChange={v => setShiftType(v)}
                    align="right"
                    menuHeaderTitle="Категория смены"
                    options={(rates?.shiftTypes || []).filter((t: any) => !t.isArchived).length > 0
                      ? (rates.shiftTypes || []).filter((t: any) => !t.isArchived).map((t: any) => ({
                          value: t.code as ShiftType,
                          label: t.name,
                        }))
                      : [
                          { value: 'day12', label: 'Дневная смена (12ч)' },
                          { value: 'night12', label: 'Ночная смена (12ч)' },
                          { value: 'standard8', label: 'Стандартная (8ч)' },
                          { value: 'part6', label: 'Подработка (6ч)' },
                          { value: 'part4', label: 'Подработка (4ч)' },
                          { value: 'daily24', label: 'Суточная (24ч)' },
                        ]}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#2d313b] font-semibold mb-1">Причина замены (для коллег):</label>
                <input
                  type="text"
                  placeholder="Например, зачёт в университете / срочные дела"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  required
                  className="w-full h-10 min-h-[40px] px-3 py-2 bg-white border border-[#d9dbe0] focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs focus:outline-none transition-colors"
                />
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Публикация...' : 'Опубликовать на бирже'}
                </button>
              </div>
            </form>

            {/* My active requests */}
            <div className="space-y-3 pt-2">
              <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider flex items-center justify-between">
                <span>Мои запросы на подмену ({mySwaps.length})</span>
              </div>

              {mySwaps.length === 0 ? (
                <div className="p-4 text-center text-xs text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                  У вас нет активных запросов на бирже.
                </div>
              ) : (
                <div className="space-y-3">
                  {myGroups.map(([grpDate, items]) => (
                    <div key={grpDate} className="space-y-1.5">
                      <div className="flex items-center gap-2 px-1 text-xs font-semibold text-[#5d6270]">
                        <Calendar className="w-3.5 h-3.5 text-[#2f63ff]" />
                        <span className="text-[#111111] font-mono tabular-nums">{formatDateDDMMYYYY(grpDate)}</span>
                      </div>

                      <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                        {items.map(sw => {
                          const isClaimed = sw.status === 'claimed';
                          const isApproved = sw.status === 'approved';

                          return (
                            <div
                              key={sw.id}
                              className="p-3.5 text-xs space-y-2.5 transition-colors hover:bg-[#f7f9ff]"
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-[#111111] font-mono tabular-nums">
                                    {formatDateDDMMYYYY(sw.date)}
                                  </span>
                                  <span className="text-[#d9dbe0]">·</span>
                                  <span className="text-[#2f63ff] font-semibold font-mono">
                                    {sw.location}
                                  </span>
                                  <span className="text-[#d9dbe0]">·</span>
                                  <span className="text-[#2d313b] font-medium">
                                    {getShiftLabel(sw.shiftType, rates)}
                                  </span>
                                </div>

                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                                    sw.status === 'open'
                                      ? 'text-[#b45309]'
                                      : isClaimed
                                      ? 'text-[#2f63ff]'
                                      : isApproved
                                      ? 'text-emerald-700'
                                      : 'text-rose-700'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-xs ${
                                      sw.status === 'open'
                                        ? 'bg-[#b45309]'
                                        : isClaimed
                                        ? 'bg-[#2f63ff]'
                                        : isApproved
                                        ? 'bg-emerald-600'
                                        : 'bg-rose-600'
                                    }`}
                                  />
                                  {sw.status === 'open'
                                    ? 'На бирже (ждёт отклика)'
                                    : isClaimed
                                    ? `Откликнулся: ${sw.candidateName}`
                                    : isApproved
                                    ? `Договорились: ${sw.candidateName || 'Утверждено'}`
                                    : 'Отклонено'}
                                </span>
                              </div>

                              <div className="space-y-1 text-xs text-[#2d313b]">
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="text-[#5d6270] shrink-0 min-w-[65px]">Передает:</span>
                                  <strong className="text-[#111111] font-semibold truncate">{sw.requesterName}</strong>
                                </div>
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="text-[#5d6270] shrink-0 min-w-[65px]">Забирает:</span>
                                  {sw.candidateName ? (
                                    <strong className="text-[#2f63ff] font-semibold truncate">{sw.candidateName}</strong>
                                  ) : (
                                    <span className="text-[#5d6270] italic truncate">— (ожидает отклика)</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="text-[#5d6270] shrink-0 min-w-[65px]">Причина:</span>
                                  <span className={`truncate ${sw.reason ? 'text-[#2d313b] italic' : 'text-[#5d6270]'}`}>
                                    {sw.reason ? `«${sw.reason}»` : '—'}
                                  </span>
                                </div>
                              </div>

                              {/* When someone claimed, initiator confirms or rejects */}
                              {isClaimed && (
                                <div className="p-3 bg-[#eef2ff] border border-[#a9bcff] rounded-md space-y-2 mt-2">
                                  <div className="text-xs text-[#111111] font-semibold">
                                    Коллега <strong className="font-bold">{sw.candidateName}</strong> готов выйти за вас на смену!
                                  </div>
                                  <p className="text-[11px] text-[#2d313b]">
                                    Зафиксируйте договоренность, чтобы закрыть заявку статусом «Договорились» и передать смену:
                                  </p>
                                  <div className="flex items-center justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => handleReject(sw.id)}
                                      disabled={loading}
                                      className="py-1.5 px-3 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 rounded text-xs font-semibold transition-colors cursor-pointer"
                                    >
                                      Отклонить
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleApprove(sw.id)}
                                      disabled={loading}
                                      className="py-1.5 px-3.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                                    >
                                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                                      <span>Подтвердить замену</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {sw.status === 'open' && (
                                <div className="flex justify-end pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleCancel(sw.id)}
                                    disabled={loading}
                                    className="text-xs font-medium text-[#5d6270] hover:text-rose-700 transition-colors cursor-pointer"
                                  >
                                    Снять с биржи
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </AccessibleModal>
  );
};
