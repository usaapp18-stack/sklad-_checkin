import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ShiftSwapRequest, ShiftType, LocationType } from '../../types';
import { CustomSelect } from '../common/CustomSelect';
import { CustomDatePicker } from '../common/CustomDatePicker';
import { formatDateDDMMYYYY, getShiftLabel } from '../../utils/calculations';
import {
  ArrowLeftRight,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Plus,
  X,
  Pencil,
  RotateCcw,
} from 'lucide-react';

export const ShiftSwapManagerView: React.FC = () => {
  const {
    swaps,
    staffList,
    approveSwapRequest,
    rejectSwapRequest,
    createSwapRequest,
    cancelSwapRequest,
    updateSwapRequest,
    pickupPoints = [],
    rates,
  } = useApp();

  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'claimed' | 'approved' | 'open'>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState(new Date().toISOString().slice(0, 10));
  const [createShiftType, setCreateShiftType] = useState<ShiftType>('day12');
  const [createLocation, setCreateLocation] = useState<LocationType>(pickupPoints[0]?.code || '');
  const [createReason, setCreateReason] = useState('Открытая смена от руководителя');
  const [loading, setLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Manager Editing Modal State
  const [editingSwap, setEditingSwap] = useState<ShiftSwapRequest | null>(null);
  const [cancelConfirmSwap, setCancelConfirmSwap] = useState<ShiftSwapRequest | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editLocation, setEditLocation] = useState<LocationType>(pickupPoints[0]?.code || '');
  const [editShiftType, setEditShiftType] = useState<ShiftType>('day12');
  const [editReason, setEditReason] = useState('');
  const [editStatus, setEditStatus] = useState<ShiftSwapRequest['status']>('approved');
  const [editRequesterId, setEditRequesterId] = useState('');
  const [editCandidateId, setEditCandidateId] = useState('');

  const openEditModal = (sw: ShiftSwapRequest) => {
    setEditingSwap(sw);
    setEditDate(sw.date);
    setEditLocation(sw.location);
    setEditShiftType(sw.shiftType);
    setEditReason(sw.reason || '');
    setEditStatus(sw.status);
    setEditRequesterId(sw.requesterId);
    setEditCandidateId(sw.candidateId || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSwap) return;
    setLoading(true);
    setActionNotice(null);

    const reqUser = staffList.find(s => s.id === editRequesterId);
    const candUser = staffList.find(s => s.id === editCandidateId);

    const res = await updateSwapRequest(editingSwap.id, {
      date: editDate,
      location: editLocation,
      shiftType: editShiftType,
      reason: editReason,
      status: editStatus,
      requesterId: editRequesterId || editingSwap.requesterId,
      requesterName: reqUser ? reqUser.name : editingSwap.requesterName,
      candidateId: editCandidateId || undefined,
      candidateName: editCandidateId ? (candUser ? candUser.name : editingSwap.candidateName) : undefined,
    });
    setLoading(false);
    if (res.success) {
      setActionNotice('Заявка успешно отредактирована!');
      setEditingSwap(null);
      setTimeout(() => setActionNotice(null), 3500);
    }
  };

  const handleReopenToMarket = async (id: string) => {
    setLoading(true);
    setActionNotice(null);
    const res = await updateSwapRequest(id, {
      status: 'open',
      candidateId: undefined,
      candidateName: undefined,
      clearCandidate: true,
    } as any);
    setLoading(false);
    if (res.success) {
      setActionNotice('Заявка переоткрыта и снова размещена на бирже смен!');
      setTimeout(() => setActionNotice(null), 3500);
    }
  };

  const handleCancelByManager = async (id: string) => {
    setLoading(true);
    setActionNotice(null);
    const res = await updateSwapRequest(id, {
      status: 'cancelled',
    });
    setLoading(false);
    if (res.success) {
      setActionNotice('Заявка аннулирована руководителем.');
      setTimeout(() => setActionNotice(null), 3500);
    }
  };

  const claimedSwaps = swaps.filter(s => s.status === 'claimed');
  const approvedSwaps = swaps.filter(s => s.status === 'approved');
  const openSwaps = swaps.filter(s => s.status === 'open');

  const filteredSwaps = swaps.filter(s => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'pending') return s.status === 'open' || s.status === 'claimed';
    if (filterStatus === 'claimed') return s.status === 'claimed';
    if (filterStatus === 'approved') return s.status === 'approved';
    if (filterStatus === 'open') return s.status === 'open';
    return true;
  });

  const groupSwapsByDateAscending = (list: ShiftSwapRequest[]) => {
    const groups: { [date: string]: ShiftSwapRequest[] } = {};
    list.forEach(item => {
      if (!groups[item.date]) groups[item.date] = [];
      groups[item.date].push(item);
    });
    const sortedEntries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));

    sortedEntries.forEach(([, items]) => {
      items.sort((a, b) => {
        if (a.status === 'claimed' && b.status !== 'claimed') return -1;
        if (b.status === 'claimed' && a.status !== 'claimed') return 1;
        return 0;
      });
    });

    return sortedEntries;
  };

  const activeList = filteredSwaps.filter(s => s.status === 'open' || s.status === 'claimed');
  const completedList = filteredSwaps.filter(s => s.status === 'approved' || s.status === 'rejected' || s.status === 'cancelled');

  const activeGrouped = groupSwapsByDateAscending(activeList);
  const completedGrouped = groupSwapsByDateAscending(completedList);
  const allFilteredGrouped = groupSwapsByDateAscending(filteredSwaps);

  const handleApprove = async (id: string) => {
    setLoading(true);
    setActionNotice(null);
    const res = await approveSwapRequest(id);
    setLoading(false);
    if (res.success) {
      setActionNotice('Смена успешно утверждена и закреплена за сотрудником!');
      setTimeout(() => setActionNotice(null), 3500);
    }
  };

  const handleReject = async (id: string) => {
    setLoading(true);
    setActionNotice(null);
    const res = await rejectSwapRequest(id);
    setLoading(false);
    if (res.success) {
      setActionNotice('Отклик отклонен. Смена возвращена в открытый статус на биржу.');
      setTimeout(() => setActionNotice(null), 3500);
    }
  };

  const handleCreateOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setActionNotice(null);
    const res = await createSwapRequest(createDate, createShiftType, createLocation, createReason);
    setLoading(false);
    if (res.success) {
      setActionNotice('Открытая смена успешно выставлена! Все сотрудники получили push-уведомление.');
      setIsCreateOpen(false);
      setTimeout(() => setActionNotice(null), 3500);
    }
  };

  const handleCancel = async (id: string) => {
    setLoading(true);
    await cancelSwapRequest(id);
    setLoading(false);
  };

  const renderGroupedList = (grouped: [string, ShiftSwapRequest[]][]) => {
    return grouped.map(([grpDate, items]) => (
      <div key={grpDate} className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Calendar className="w-3.5 h-3.5 text-[#2f63ff] shrink-0" />
          <h3 className="text-xs font-semibold text-[#111111] font-mono tabular-nums tracking-wide">
            Дата смены: {formatDateDDMMYYYY(grpDate)}
          </h3>
          <span className="text-xs text-[#5d6270] font-mono tabular-nums">({items.length} заявок)</span>
        </div>

        <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] overflow-hidden w-full">
          {items.map(sw => {
            const isClaimed = sw.status === 'claimed';
            const isApproved = sw.status === 'approved';
            const isOpenStatus = sw.status === 'open';

            return (
              <div
                key={sw.id}
                className="p-3 sm:p-3.5 bg-white hover:bg-[#f7f9ff] transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 w-full"
              >
                {/* Column 1: Inline Metadata & Dot Status */}
                <div className="shrink-0 md:w-[360px] lg:w-[400px] space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <span className="font-mono tabular-nums font-semibold text-[#111111]">
                      {formatDateDDMMYYYY(sw.date)}
                    </span>
                    <span className="text-[#d9dbe0]" aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-[#2f63ff]" title={sw.location}>
                      {sw.location}
                    </span>
                    <span className="text-[#d9dbe0]" aria-hidden="true">·</span>
                    <span className="text-[#2d313b] font-medium">
                      {getShiftLabel(sw.shiftType, rates)}
                    </span>
                  </div>

                  <div
                    className={`text-xs font-semibold flex items-center gap-1.5 ${
                      isOpenStatus
                        ? 'text-[#2f63ff]'
                        : isClaimed
                        ? 'text-[#b45309]'
                        : isApproved
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                    title={
                      isOpenStatus
                        ? 'Открыта на бирже'
                        : isClaimed
                        ? `Откликнулся: ${sw.candidateName}`
                        : isApproved
                        ? `Договорились: ${sw.candidateName || 'Утверждено'}`
                        : 'Отклонено'
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-xs shrink-0 ${
                        isOpenStatus
                          ? 'bg-[#2f63ff]'
                          : isClaimed
                          ? 'bg-[#b45309]'
                          : isApproved
                          ? 'bg-emerald-600'
                          : 'bg-rose-600'
                      }`}
                    />
                    <span className="truncate">
                      {isOpenStatus
                        ? 'Открыта на бирже'
                        : isClaimed
                        ? `Откликнулся: ${sw.candidateName}`
                        : isApproved
                        ? `Договорились: ${sw.candidateName || 'Утверждено'}`
                        : 'Отклонено'}
                    </span>
                  </div>
                </div>

                {/* Column 2: Participants & Reason Block */}
                <div className="flex-1 min-w-0 space-y-1 px-1 text-xs text-[#2d313b]">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-[#5d6270] shrink-0 min-w-[65px]">Передает:</span>
                    <strong className="text-[#111111] font-semibold truncate max-w-[180px]" title={sw.requesterName}>
                      {sw.requesterName}
                    </strong>
                  </div>

                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-[#5d6270] shrink-0 min-w-[65px]">
                      {isApproved ? 'Смену забрал:' : 'Откликнулся:'}
                    </span>
                    {sw.candidateName ? (
                      <strong className="text-[#2f63ff] font-semibold truncate max-w-[180px]" title={sw.candidateName}>
                        {sw.candidateName}
                      </strong>
                    ) : (
                      <span className="text-[#5d6270] italic truncate">— (ожидает отклика)</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 truncate text-[11px]">
                    <span className="text-[#5d6270] shrink-0 min-w-[65px]">Причина:</span>
                    <span className={`truncate max-w-[240px] ${sw.reason ? 'text-[#2d313b] italic' : 'text-[#5d6270]'}`} title={sw.reason || '—'}>
                      {sw.reason ? `«${sw.reason}»` : '—'}
                    </span>
                  </div>
                </div>

                {/* Column 3: Manager Action Buttons */}
                <div className="pt-2 md:pt-0 flex items-center justify-end gap-1.5 shrink-0 flex-wrap text-xs">
                  <button
                    type="button"
                    onClick={() => openEditModal(sw)}
                    disabled={loading}
                    className="py-1.5 px-2.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                    title="Редактировать параметры заявки"
                  >
                    <Pencil className="w-3.5 h-3.5 text-[#2f63ff]" />
                    <span>Редактировать</span>
                  </button>

                  {isApproved && (
                    <button
                      type="button"
                      onClick={() => handleReopenToMarket(sw.id)}
                      disabled={loading}
                      className="py-1.5 px-2.5 bg-amber-50 hover:bg-amber-100 text-[#b45309] border border-amber-300 rounded text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="Отменить договоренность и вернуть смену на биржу"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#b45309]" />
                      <span>Вернуть на биржу</span>
                    </button>
                  )}

                  {isClaimed && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleReject(sw.id)}
                        disabled={loading}
                        className="py-1.5 px-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Отклонить
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(sw.id)}
                        disabled={loading}
                        className="py-1.5 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold rounded text-xs flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Утвердить</span>
                      </button>
                    </>
                  )}

                  {isOpenStatus && (
                    <button
                      type="button"
                      onClick={() => setCancelConfirmSwap(sw)}
                      disabled={loading}
                      className="py-1.5 px-2.5 text-xs text-[#2d313b] hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded transition-colors cursor-pointer"
                    >
                      Снять с биржи
                    </button>
                  )}

                  {isApproved && (
                    <button
                      type="button"
                      onClick={() => setCancelConfirmSwap(sw)}
                      disabled={loading}
                      className="py-1.5 px-2.5 text-xs text-[#2d313b] hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded transition-colors cursor-pointer"
                      title="Аннулировать закрытую заявку"
                    >
                      Аннулировать
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ));
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#111111] tracking-tight flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-[#2f63ff]" />
            <span>Биржа смен и подмен</span>
          </h2>
          <p className="text-xs text-[#5d6270] mt-0.5">
            Все запросы сотрудников на обмен сменами, отклики, согласования и открытые смены сети
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 py-1.5 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Выставить открытую смену</span>
        </button>
      </div>

      {actionNotice && (
        <div className="p-3 bg-[#eef2ff] text-[#111111] border border-[#a9bcff] rounded-md text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#2f63ff]" />
          <span className="text-[#111111] font-medium">{actionNotice}</span>
        </div>
      )}

      {/* KPI & Status Filter Tabs: Segmented Control */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] w-fit">
        <button
          type="button"
          onClick={() => setFilterStatus('all')}
          className={`py-1.5 px-3 rounded text-xs font-semibold transition-colors cursor-pointer ${
            filterStatus === 'all'
              ? 'bg-[#111111] text-white'
              : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
          }`}
        >
          Все заявки ({swaps.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterStatus('claimed')}
          className={`py-1.5 px-3 rounded text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
            filterStatus === 'claimed'
              ? 'bg-[#111111] text-white'
              : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
          }`}
        >
          <span>Есть отклики ({claimedSwaps.length})</span>
          {claimedSwaps.length > 0 && filterStatus !== 'claimed' && (
            <span className="w-1.5 h-1.5 rounded-xs bg-amber-400" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setFilterStatus('open')}
          className={`py-1.5 px-3 rounded text-xs font-semibold transition-colors cursor-pointer ${
            filterStatus === 'open'
              ? 'bg-[#111111] text-white'
              : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
          }`}
        >
          Ищут замену ({openSwaps.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterStatus('approved')}
          className={`py-1.5 px-3 rounded text-xs font-semibold transition-colors cursor-pointer ${
            filterStatus === 'approved'
              ? 'bg-[#111111] text-white'
              : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
          }`}
        >
          Договорились / Одобрено ({approvedSwaps.length})
        </button>
      </div>

      {/* Grouped Requests by Date */}
      <div className="space-y-6">
        {filterStatus === 'all' ? (
          <>
            {/* Active Requests Section at TOP */}
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2">
                <div className="text-xs font-semibold text-[#b45309] uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-xs bg-amber-400" />
                  <span>Активные заявки (на бирже и ждут подтверждения) — {activeList.length}</span>
                </div>
              </div>

              {activeGrouped.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#5d6270] bg-white border border-[#d9dbe0] rounded-md">
                  Активных заявок в данный момент нет.
                </div>
              ) : (
                renderGroupedList(activeGrouped)
              )}
            </div>

            {/* Completed Requests Section BELOW */}
            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between pb-2">
                <div className="text-xs font-semibold text-[#111111] uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#2f63ff]" />
                  <span>Завершённые и закрытые заявки — {completedList.length}</span>
                </div>
              </div>

              {completedGrouped.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#5d6270] bg-white border border-[#d9dbe0] rounded-md">
                  Завершённых и закрытых заявок пока нет.
                </div>
              ) : (
                renderGroupedList(completedGrouped)
              )}
            </div>
          </>
        ) : (
          allFilteredGrouped.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#5d6270] bg-white border border-[#d9dbe0] rounded-md">
              Заявок по выбранному фильтру не найдено.
            </div>
          ) : (
            renderGroupedList(allFilteredGrouped)
          )
        )}
      </div>

      {/* Create Open Shift Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto text-[#111111]">
            <div className="flex items-center justify-between p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <div className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-[#2f63ff]" />
                <span>Выставить открытую смену на биржу</span>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="p-1 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOpenShift} className="p-4 space-y-3.5 text-xs flex-1 overflow-y-auto">
              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Дата смены:</label>
                <CustomDatePicker
                  value={createDate}
                  onChange={v => setCreateDate(v)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Склад:</label>
                  <CustomSelect<LocationType>
                    value={createLocation}
                    onChange={v => setCreateLocation(v)}
                    menuHeaderTitle="Склад"
                    options={(pickupPoints || []).map(pt => ({
                      value: pt.code as LocationType,
                      label: pt.code,
                      sublabel: pt.name && pt.name !== pt.code ? pt.name : undefined,
                    }))}
                  />
                </div>
                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Категория:</label>
                  <CustomSelect<ShiftType>
                    value={createShiftType}
                    onChange={v => setCreateShiftType(v)}
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
                <label className="block text-[#2d313b] font-medium mb-1">Описание / Примечание:</label>
                <input
                  type="text"
                  value={createReason}
                  onChange={e => setCreateReason(e.target.value)}
                  placeholder="Заметка или причина создания смены"
                  className="w-full h-9 px-3 py-1.5 bg-white border border-[#d9dbe0] hover:border-[#2f63ff]/60 focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20 rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs focus:outline-none transition-colors"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-3.5 py-1.5 text-xs font-bold bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Публикация...' : 'Опубликовать смену'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Swap Modal */}
      {editingSwap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto text-[#111111]">
            <div className="flex items-center justify-between p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <div className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                <Pencil className="w-4 h-4 text-[#2f63ff]" />
                <span>Редактирование заявки биржи</span>
              </div>
              <button
                onClick={() => setEditingSwap(null)}
                className="p-1 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-4 space-y-3.5 text-xs flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Дата смены:</label>
                  <CustomDatePicker
                    value={editDate}
                    onChange={v => setEditDate(v)}
                  />
                </div>

                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Склад:</label>
                  <CustomSelect<LocationType>
                    value={editLocation}
                    onChange={v => setEditLocation(v)}
                    menuHeaderTitle="Склад"
                    options={(pickupPoints || []).map(pt => ({
                      value: pt.code as LocationType,
                      label: pt.code,
                      sublabel: pt.name && pt.name !== pt.code ? pt.name : undefined,
                    }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Категория смены:</label>
                  <CustomSelect<ShiftType>
                    value={editShiftType}
                    onChange={v => setEditShiftType(v)}
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

                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Статус заявки:</label>
                  <CustomSelect<ShiftSwapRequest['status']>
                    value={editStatus}
                    onChange={v => setEditStatus(v)}
                    menuHeaderTitle="Статус заявки"
                    options={[
                      { value: 'approved', label: 'Договорились (Утверждено)' },
                      { value: 'claimed', label: 'Откликнулся (Ожидает)' },
                      { value: 'open', label: 'Открыта на бирже' },
                      { value: 'cancelled', label: 'Аннулирована' },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Инициатор (кто передает):</label>
                  <CustomSelect<string>
                    value={editRequesterId}
                    onChange={v => setEditRequesterId(v)}
                    menuHeaderTitle="Инициатор смены"
                    options={staffList.map(st => ({
                      value: st.id,
                      label: st.name,
                      sublabel: st.isSenior ? 'Старший сотрудник' : st.login,
                    }))}
                  />
                </div>

                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Кто забирает / выходит:</label>
                  <CustomSelect<string>
                    value={editCandidateId}
                    onChange={v => setEditCandidateId(v)}
                    menuHeaderTitle="Исполнитель смены"
                    options={[
                      { value: '', label: '— Без исполнителя (Открытая) —' },
                      ...staffList.map(st => ({
                        value: st.id,
                        label: st.name,
                        sublabel: st.isSenior ? 'Старший сотрудник' : st.login,
                      })),
                    ]}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Причина / Заметка:</label>
                <input
                  type="text"
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="Заметка или причина изменения"
                  className="w-full h-9 px-3 py-1.5 bg-white border border-[#d9dbe0] hover:border-[#2f63ff]/60 focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20 rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs focus:outline-none transition-colors"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => setEditingSwap(null)}
                  className="px-3.5 py-1.5 text-xs font-medium bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-3.5 py-1.5 text-xs font-bold bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Annul Confirmation Modal */}
      {cancelConfirmSwap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden p-5 space-y-4 my-auto text-[#111111]">
            <div className="flex items-center gap-2.5 text-rose-700 font-semibold text-sm pb-2 border-b border-[#e5e7eb] shrink-0">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>Подтверждение аннулирования заявки</span>
            </div>

            <p className="text-xs text-[#2d313b] leading-relaxed">
              Вы действительно хотите аннулировать заявку на смену за{' '}
              <strong className="text-[#111111] font-mono tabular-nums">{formatDateDDMMYYYY(cancelConfirmSwap.date)}</strong>{' '}
              на складе <strong className="text-[#111111] font-mono">{cancelConfirmSwap.location}</strong>?
              {cancelConfirmSwap.candidateName && (
                <span className="block mt-1.5 text-[#5d6270]">
                  Закрепленный сотрудник: <strong className="text-[#2f63ff]">{cancelConfirmSwap.candidateName}</strong>.
                </span>
              )}
            </p>

            <div className="pt-2 border-t border-[#e5e7eb] flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setCancelConfirmSwap(null)}
                disabled={loading}
                className="px-3.5 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] font-medium rounded transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = cancelConfirmSwap;
                  setCancelConfirmSwap(null);
                  if (target.status === 'approved') {
                    await handleCancelByManager(target.id);
                  } else {
                    await handleCancel(target.id);
                  }
                }}
                disabled={loading}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Аннулирование...' : 'Да, аннулировать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
