import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { LocationType, ShiftType, StaffMember, PlannedShift, ScheduleTemplate } from '../../types';
import { formatCurrency, calculateShiftTotalSalary } from '../../utils/calculations';
import { formatMonthName } from '../../utils/time';
import { CustomSelect } from '../common/CustomSelect';
import { ScheduleGeneratorWizardModal } from './ScheduleGeneratorWizardModal';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Clock,
  CalendarCheck,
  X,
  SlidersHorizontal,
  Send,
  Bookmark,
  Layers,
  CheckCircle2,
  Info,
  Calendar as CalendarIcon,
  RefreshCw,
  Search,
  Check,
  FileDown,
  Loader2,
} from 'lucide-react';
import { exportExistingPvzScheduleToPdf } from '../../utils/schedulePdfExporter';

function formatShortName(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1][0]}.`;
  }
  return parts[0];
}

export const SchedulePlannerView: React.FC = () => {
  const {
    staffList,
    records,
    schedules,
    scheduleTemplates,
    availability,
    rates,
    pickupPoints,
    swaps = [],
    saveSlotShifts,
    deletePlannedShift,
    clearMonthSchedules,
    saveScheduleBatch,
    publishSchedule,
    saveScheduleTemplate,
    deleteScheduleTemplate,
    updateAvailabilityStatus,
  } = useApp();

  const now = new Date();
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedPvzCode, setSelectedPvzCode] = useState<string>('ALL');
  const [searchPvzQuery, setSearchPvzQuery] = useState('');
  const viewMode = 'matrix';

  // Modals state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [isEditingSlot, setIsEditingSlot] = useState(false);
  const [modalDate, setModalDate] = useState('');
  const [modalLocation, setModalLocation] = useState<LocationType>('');
  const [modalEmployeeIds, setModalEmployeeIds] = useState<string[]>([]);
  const [modalShiftType, setModalShiftType] = useState<ShiftType>('day12');
  const [modalNote, setModalNote] = useState('');
  const [slotModalError, setSlotModalError] = useState<string | null>(null);
  const [viewPvzCalendar, setViewPvzCalendar] = useState<any | null>(null);

  // Generator Wizard State
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genLocation, setGenLocation] = useState<string>("");

  // Scenarios Modal state
  const [tplModalOpen, setTplModalOpen] = useState(false);

  // Publish Modal state
  const [pubModalOpen, setPubModalOpen] = useState(false);
  const [pubSuccessMsg, setPubSuccessMsg] = useState('');
  const [wishesModalOpen, setWishesModalOpen] = useState(false);
  const [wishesFilterStatus, setWishesFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [updatingWishId, setUpdatingWishId] = useState<string | null>(null);

  // Auto-dismiss publication & generator success messages after 3.5 seconds
  useEffect(() => {
    if (pubSuccessMsg) {
      const timer = setTimeout(() => {
        setPubSuccessMsg('');
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [pubSuccessMsg]);

  // Human-readable reason helper for employee wishes with smart reason detection
  const getWishCategoryInfo = (type: string, comment?: string) => {
    const c = (comment || '').toLowerCase();
    let resolvedType = type;
    if (resolvedType === 'unavailable' || !resolvedType) {
      if (c.includes('учеб') || c.includes('сесси') || c.includes('экзамен') || c.includes('пар') || c.includes('институт')) {
        resolvedType = 'study';
      } else if (c.includes('отпуск') || c.includes('отгул') || c.includes('море') || c.includes('поездк') || c.includes('дач')) {
        resolvedType = 'vacation';
      } else if (c.includes('больнич') || c.includes('боле') || c.includes('врач') || c.includes('клиник') || c.includes('температур')) {
        resolvedType = 'sick';
      }
    }

    switch (resolvedType) {
      case 'vacation':
        return { label: 'Отпуск / Отгул', badgeClass: 'text-[#b45309]' };
      case 'study':
        return { label: 'Учёба / Сессия', badgeClass: 'text-[#111111]' };
      case 'sick':
        return { label: 'Больничный', badgeClass: 'text-rose-700' };
      case 'preferred':
        return { label: 'Желаемая смена', badgeClass: 'text-[#2f63ff]' };
      case 'unavailable':
      default:
        return { label: 'Личные обстоятельства', badgeClass: 'text-orange-800' };
    }
  };

  const getWishReasonLabel = (type: string, comment?: string) => {
    const info = getWishCategoryInfo(type, comment);
    const trimmed = (comment || '').trim();
    if (trimmed && trimmed.toLowerCase() !== info.label.toLowerCase() && !trimmed.toLowerCase().includes('не могу') && !trimmed.toLowerCase().includes('не может')) {
      return `${info.label} • «${trimmed}»`;
    }
    return info.label;
  };

  const handleSetWishStatus = async (availId: string, status: 'approved' | 'rejected' | 'pending') => {
    setUpdatingWishId(availId);
    try {
      await updateAvailabilityStatus(availId, status);
    } catch (e) {
      console.error('Error updating wish status:', e);
    } finally {
      setUpdatingWishId(null);
    }
  };

  const handleBatchSetWishesStatus = async (wishIds: string[], status: 'approved' | 'rejected') => {
    for (const id of wishIds) {
      await updateAvailabilityStatus(id, status);
    }
  };

  // Confirmation dialogs state (safe for iframes, avoids window.confirm)
  const [shiftToDelete, setShiftToDelete] = useState<{ id: string; employeeName: string; date: string } | null>(null);
  const [clearMonthConfirmPvz, setClearMonthConfirmPvz] = useState<{ code: string; name: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [isExportingPvzPdf, setIsExportingPvzPdf] = useState(false);

  // PDF Export for viewed PVZ Calendar
  const handleExportPvzCalendarPdf = async () => {
    if (!viewPvzCalendar || isExportingPvzPdf) return;
    setIsExportingPvzPdf(true);
    try {
      const targetCode = viewPvzCalendar.code;
      const targetName = viewPvzCalendar.name || viewPvzCalendar.code;
      const targetId = (viewPvzCalendar as any).id;

      // Filter all shifts for this PVZ in the current month matching code, name, id or address
      const pvzShifts = monthPlannedShifts.filter(s => {
        if (!s) return false;
        if (s.location === targetCode) return true;
        if (s.location === targetName) return true;
        if (targetId && s.location === targetId) return true;
        if (viewPvzCalendar.address && s.location === viewPvzCalendar.address) return true;
        return false;
      });

      await exportExistingPvzScheduleToPdf({
        location: targetName,
        locationCode: targetCode,
        monthStr,
        monthName,
        daysList,
        plannedShifts: pvzShifts,
        staffList,
      });
    } catch (err) {
      console.error('Failed to export PVZ calendar to PDF:', err);
    } finally {
      setIsExportingPvzPdf(false);
    }
  };

  const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const monthName = formatMonthName(monthStr);

  const activePvzs = useMemo(() => {
    return pickupPoints.filter(p => p.active && !p.isArchived);
  }, [pickupPoints]);

  const activeStaff = useMemo(() => {
    return staffList.filter(s => s.status === 'active');
  }, [staffList]);

  // Filter PVZs by code or search query
  const filteredPvzs = useMemo(() => {
    let list = activePvzs;
    if (selectedPvzCode !== 'ALL') {
      list = list.filter(p => p.code === selectedPvzCode || p.name === selectedPvzCode);
    }
    if (searchPvzQuery.trim()) {
      const q = searchPvzQuery.toLowerCase().trim();
      list = list.filter(
        p => p.code.toLowerCase().includes(q) ||
             p.name.toLowerCase().includes(q) ||
             (p.address && p.address.toLowerCase().includes(q))
      );
    }
    return list;
  }, [activePvzs, selectedPvzCode, searchPvzQuery]);

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // Days list for selected month
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysList = useMemo(() => {
    const list: { dateStr: string; dayNum: number; dayOfWeek: number; dayName: string }[] = [];
    const weekDayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${monthStr}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(currentYear, currentMonth, d);
      const dayOfWeek = dateObj.getDay();
      list.push({
        dateStr: dStr,
        dayNum: d,
        dayOfWeek,
        dayName: weekDayNames[dayOfWeek],
      });
    }
    return list;
  }, [currentYear, currentMonth, daysInMonth, monthStr]);

  // Month planned shifts
  const monthPlannedShifts = useMemo(() => {
    return schedules.filter(s => s.date.startsWith(monthStr));
  }, [schedules, monthStr]);

  // Filter staff by location access
  const getStaffForPvz = (pvzCode: string) => {
    if (!pvzCode || pvzCode === 'ALL') return activeStaff;
    const targetPvz = activePvzs.find(p => p.code === pvzCode || p.id === pvzCode);
    const codeToMatch = targetPvz ? targetPvz.code : pvzCode;
    const idToMatch = targetPvz ? targetPvz.id : pvzCode;

    return activeStaff.filter(s => {
      const locs = s.locations || (s.location ? [s.location] : []);
      return locs.includes(codeToMatch) || locs.includes(idToMatch);
    });
  };

  // Estimated FOT
  const estimatedFOT = useMemo(() => {
    let sum = 0;
    monthPlannedShifts.forEach(p => {
      const staff = staffList.find(s => s.id === p.employeeId);
      sum += calculateShiftTotalSalary(p, staff, rates);
    });
    return sum;
  }, [monthPlannedShifts, staffList, rates]);

  // Open Edit Slot Modal (supporting multiple employees)
  const openEditSlotModal = (dateStr: string, locationCode: string) => {
    setModalDate(dateStr);
    setModalLocation(locationCode);
    setSlotModalError(null);

    const existing = schedules.filter(
      s => s.date === dateStr && (s.location === locationCode || s.location === activePvzs.find(p => p.code === locationCode)?.name)
    );

    setIsEditingSlot(existing.length > 0);

    if (existing.length > 0) {
      setModalEmployeeIds(existing.map(s => s.employeeId));
      setModalShiftType(existing[0].shiftType);
      setModalNote(existing[0].note || '');
    } else {
      setModalEmployeeIds([]);
      setModalShiftType('day12');
      setModalNote('');
    }
    setEditModalOpen(true);
  };

  // Save Slots (Delete existing for date/location, and save selected)
  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlotModalError(null);

    const targetPvz = activePvzs.find(p => p.code === modalLocation || p.name === modalLocation || p.id === modalLocation);
    const targetLocCode = targetPvz?.code || modalLocation;
    const targetLocName = targetPvz?.name || modalLocation;

    // Enforce Rule: An employee cannot have a shift at another PVZ on the same date!
    for (const empId of modalEmployeeIds) {
      const busyOther = schedules.find(
        sch => sch.employeeId === empId &&
               sch.date === modalDate &&
               sch.location !== targetLocCode &&
               sch.location !== targetLocName &&
               sch.location !== targetPvz?.id
      );
      if (busyOther) {
        const staff = staffList.find(s => s.id === empId);
        setSlotModalError(
          `Невозможно назначить: сотрудник ${staff?.name || 'Сотрудник'} уже имеет смену на складе «${busyOther.location}» на эту дату (${modalDate}). Один сотрудник не может работать на двух складах одновременно!`
        );
        return;
      }
    }

    setLoading(true);

    const shiftPayload = modalEmployeeIds.map(empId => {
      const staff = staffList.find(s => s.id === empId);
      return {
        employeeId: empId,
        employeeName: staff ? staff.name : 'Сотрудник',
        shiftType: modalShiftType,
        note: modalNote,
      };
    });

    const res = await saveSlotShifts(modalDate, modalLocation, shiftPayload);
    setLoading(false);

    if (!res.success) {
      setSlotModalError(res.error || 'Ошибка сохранения смен');
      return;
    }

    setEditModalOpen(false);
  };

  // Open Generator Modal
  const openGeneratorModal = (pvzCode?: string) => {
    if (activePvzs.length === 0) {
      setPubSuccessMsg('Для верстки графика необходимо сначала добавить хотя бы один склад в разделе «Мои склады».');
      return;
    }
    const targetCode = pvzCode && pvzCode !== "ALL" ? pvzCode : (activePvzs[0]?.code || "");
    setGenLocation(targetCode);
    setGenModalOpen(true);
  };

  // Run Saved Scenario Template
  const handleApplyTemplate = async (tpl: ScheduleTemplate) => {
    const staffAId = tpl.mainStaffIds[0] || activeStaff[0]?.id || '';
    const staffBId = tpl.mainStaffIds[1] || staffAId;
    const partTimeId = tpl.partTimeStaffIds?.[0] || '';

    const staffA = staffList.find(s => s.id === staffAId);
    const staffB = staffList.find(s => s.id === staffBId) || staffA;
    const staffPart = staffList.find(s => s.id === partTimeId);

    const batch: PlannedShift[] = [];

    daysList.forEach((d, idx) => {
      let chosenStaff: StaffMember | undefined = undefined;
      const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;

      if (tpl.scenarioType === '2/2') {
        const cycleDay = idx % 4;
        chosenStaff = cycleDay < 2 ? staffA : staffB;
      } else if (tpl.scenarioType === '3/3') {
        const cycleDay = idx % 6;
        chosenStaff = cycleDay < 3 ? staffA : staffB;
      } else if (tpl.scenarioType === '2/2+P') {
        const cycleDay = idx % 4;
        chosenStaff = cycleDay < 2 ? staffA : staffB;
        if (!isWeekend && staffPart) {
          const isUnavail = availability.some(a => a.employeeId === chosenStaff?.id && a.date === d.dateStr);
          if (isUnavail) chosenStaff = staffPart;
        }
      } else if (tpl.scenarioType === '5/2') {
        chosenStaff = isWeekend ? (staffPart || staffB) : staffA;
      }

      if (chosenStaff) {
        // Enforce rule: never assign employee if they already have a shift at another PVZ today!
        const busyAtOther = schedules.find(
          s => s.employeeId === chosenStaff?.id && s.date === d.dateStr && s.location !== tpl.location
        );
        if (!busyAtOther) {
          batch.push({
            id: `tpl-${d.dateStr}-${tpl.location}`,
            date: d.dateStr,
            location: tpl.location,
            employeeId: chosenStaff.id,
            employeeName: chosenStaff.name,
            shiftType: tpl.defaultShiftType || 'day12',
            note: `Шаблон: ${tpl.name}`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    });

    setLoading(true);
    await saveScheduleBatch(batch, { replaceMonth: monthStr, replaceLocation: tpl.location });
    setLoading(false);
    setTplModalOpen(false);
  };

  // Publish to Staff
  const handlePublishSchedule = async () => {
    setLoading(true);
    const targetLoc = selectedPvzCode === 'ALL' ? undefined : selectedPvzCode;
    const count = monthPlannedShifts.filter(s => selectedPvzCode === 'ALL' || s.location === selectedPvzCode).length;

    const res = await publishSchedule(monthName, targetLoc, count);
    setLoading(false);
    if (res.success) {
      setPubSuccessMsg(`График смен на ${monthName} (${count} смен) успешно опубликован! Все сотрудники получили уведомления.`);
      setPubModalOpen(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      
      {/* Success Notification Toast - Auto-dismissing after 3.5 seconds */}
      {pubSuccessMsg && (
        <div className="toast-banner fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-[100] p-3.5 bg-[#111111] border border-[#2d313b] rounded-md shadow-sm flex items-center justify-between text-xs text-white animate-slide-in">
          <div className="flex items-center gap-2.5 font-medium min-w-0">
            <CheckCircle2 className="w-4 h-4 text-[#a9bcff] shrink-0" />
            <div className="truncate">
              <span className="font-semibold text-white block">Успешно</span>
              <span className="text-[11px] text-[#a9bcff] font-medium truncate">{pubSuccessMsg}</span>
            </div>
          </div>
          <button
            onClick={() => setPubSuccessMsg('')}
            className="p-1 hover:bg-[#2d313b] text-[#a9bcff] hover:text-white rounded cursor-pointer transition-colors shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header & Actions - Compact and Responsive for Mobile */}
      <div className="bg-white border border-[#d9dbe0] p-3 sm:p-5 rounded-md space-y-3 text-[#111111]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[#5d6270] text-[11px] font-semibold uppercase tracking-wider mb-0.5">
              <CalendarCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-[#2f63ff]" />
              <span>Управление расписанием</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-xl font-semibold text-[#111111] tracking-tight">
                График смен сотрудникам
              </h2>
              <span className="text-sm font-mono font-normal text-[#5d6270] ml-1">
                {monthName}
              </span>
            </div>
          </div>

          {/* Month Selector */}
          <div className="flex items-center justify-between sm:justify-start bg-[#f7f9ff] border border-[#d9dbe0] p-1 rounded-md shrink-0 self-start sm:self-auto w-full sm:w-auto">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 text-[#2d313b] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
              title="Предыдущий месяц"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-[#111111] px-3 font-mono text-center flex-1 sm:flex-initial">
              {monthName}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1.5 text-[#2d313b] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
              title="Следующий месяц"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Controls Group: 3 Clean ERP Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          {/* 1. Generator Wizard Button */}
          <button
            type="button"
            onClick={() => openGeneratorModal(selectedPvzCode !== 'ALL' ? selectedPvzCode : undefined)}
            disabled={activePvzs.length === 0}
            className={`h-8.5 px-3 rounded text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer border ${
              activePvzs.length === 0
                ? 'bg-[#eef2ff] border-[#d9dbe0] text-[#5d6270] cursor-not-allowed'
                : 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white border-[#2f63ff]'
            }`}
            title={activePvzs.length === 0 ? 'Сначала добавьте хотя бы один склад в разделе «Мои склады»' : 'Сверстать график смен'}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0 stroke-[2.5]" />
            <span>Сверстать график</span>
          </button>

          {/* 2. Saved Scenarios Button */}
          <button
            type="button"
            onClick={() => setTplModalOpen(true)}
            className="h-8.5 px-3 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] font-semibold text-xs rounded transition-colors cursor-pointer flex items-center justify-center gap-2"
            title="Сценарии и шаблоны смен склада"
          >
            <Bookmark className="w-3.5 h-3.5 text-[#5d6270] shrink-0" />
            <span>Сценарии склада</span>
            {scheduleTemplates.length > 0 && (
              <span className="text-[11px] text-[#2f63ff] font-mono ml-0.5 font-bold tabular-nums">
                ({scheduleTemplates.length})
              </span>
            )}
          </button>

          {/* 3. Publish & Send Button */}
          <button
            type="button"
            onClick={() => setPubModalOpen(true)}
            disabled={monthPlannedShifts.length === 0}
            className="h-8.5 px-3 bg-[#111111] hover:bg-[#2d313b] border border-[#111111] text-white font-semibold text-xs rounded transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:bg-[#eef2ff] disabled:border-[#d9dbe0] disabled:text-[#5d6270] disabled:cursor-not-allowed"
            title="Отправить и опубликовать график"
          >
            <Send className={`w-3.5 h-3.5 shrink-0 ${monthPlannedShifts.length === 0 ? 'text-[#5d6270]' : 'text-[#a9bcff]'}`} />
            <span>Отправить график</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip (ERP Standard) */}
      <div className="bg-white border border-[#d9dbe0] rounded-md grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#e5e7eb] overflow-hidden">
        <div className="p-4 sm:p-4.5">
          <div className="text-xs text-[#5d6270] font-medium">Запланировано смен</div>
          <div className="text-2xl font-semibold text-[#111111] font-mono tabular-nums tracking-tight mt-1">
            {monthPlannedShifts.length} <span className="text-xs font-normal text-[#5d6270] font-sans">смен</span>
          </div>
          <div className="text-xs text-[#5d6270] mt-1 truncate">
            На текущий месяц
          </div>
        </div>

        <div className="p-4 sm:p-4.5">
          <div className="text-xs text-[#5d6270] font-medium">Плановый ФОТ (Оклады)</div>
          <div className="text-2xl font-semibold text-[#2f63ff] font-mono tabular-nums tracking-tight mt-1">
            {formatCurrency(estimatedFOT)}
          </div>
          <div className="text-xs text-[#5d6270] mt-1 truncate">
            Базовые ставки сотрудников
          </div>
        </div>

        {(() => {
          const monthWishes = availability.filter(a => a.date.startsWith(monthStr) && a.type !== 'preferred');
          const approvedCount = monthWishes.filter(a => a.status === 'approved').length;
          const pendingCount = monthWishes.filter(a => !a.status || a.status === 'pending').length;

          return (
            <div
              onClick={() => setWishesModalOpen(true)}
              className="p-4 sm:p-4.5 cursor-pointer hover:bg-[#f7f9ff] transition-colors group"
              title="Нажмите, чтобы посмотреть пожелания сотрудников"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#5d6270] font-medium group-hover:text-[#111111] transition-colors">
                  Пожелания сотрудников
                </span>
                {pendingCount > 0 && (
                  <span className="w-2 h-2 rounded-xs bg-amber-400" />
                )}
              </div>
              <div className="text-2xl font-bold text-[#111111] font-mono tabular-nums tracking-tight mt-1">
                {monthWishes.length} <span className="text-xs font-normal text-[#5d6270] font-sans">запросов</span>
              </div>
              <div className="text-xs text-[#2d313b] mt-1 truncate">
                {pendingCount > 0 ? (
                  <span className="text-[#b45309] font-semibold">{pendingCount} ждут решения · Реестр →</span>
                ) : approvedCount > 0 ? (
                  <span className="text-[#2f63ff] font-medium">{approvedCount} одобрено · Реестр →</span>
                ) : (
                  <span className="text-[#5d6270]">Нет ограничений · Реестр →</span>
                )}
              </div>
            </div>
          );
        })()}

        <div className="p-4 sm:p-4.5">
          <div className="text-xs text-[#5d6270] font-medium">Склады</div>
          <div className="text-2xl font-bold text-[#111111] font-mono tabular-nums tracking-tight mt-1">
            {activePvzs.length} <span className="text-xs font-normal text-[#5d6270] font-sans">активных</span>
          </div>
          <div className="text-xs text-[#5d6270] mt-1 truncate">
            Всего складов в системе
          </div>
        </div>
      </div>

      {/* Control Panel: Warehouse Search, Filters & View Switcher */}
      <div className="bg-white border border-[#d9dbe0] p-3 sm:p-4 rounded-md space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Warehouse Search & Filters */}
          <div className="flex items-center gap-2 flex-wrap flex-1">
            
            {/* Search Input for warehouses */}
            <div className="relative min-w-[200px] max-w-xs flex-1">
              <Search className="w-3.5 h-3.5 text-[#5d6270] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск склада по названию или коду..."
                value={searchPvzQuery}
                onChange={e => setSearchPvzQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff]"
              />
              {searchPvzQuery && (
                <button
                  onClick={() => setSearchPvzQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#5d6270] hover:text-[#111111] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Quick PVZ Dropdown/Buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setSelectedPvzCode('ALL')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  selectedPvzCode === 'ALL'
                    ? 'bg-[#111111] text-white font-bold'
                    : 'bg-[#f7f9ff] text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff] border border-[#d9dbe0]'
                }`}
              >
                Все ({activePvzs.length})
              </button>

              {activePvzs.slice(0, 6).map(pvz => {
                const countForPvz = monthPlannedShifts.filter(s => s.location === pvz.code || s.location === pvz.name).length;
                return (
                  <button
                    key={pvz.id}
                    onClick={() => setSelectedPvzCode(pvz.code)}
                    className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                      selectedPvzCode === pvz.code
                        ? 'bg-[#111111] text-white font-bold'
                        : 'bg-[#f7f9ff] text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff] border border-[#d9dbe0]'
                    }`}
                  >
                    <span>{pvz.code || pvz.name}</span>
                    <span className={`text-[11px] font-mono tabular-nums ${
                      selectedPvzCode === pvz.code ? 'text-[#a9bcff] font-bold' : 'text-[#5d6270]'
                    }`}>
                      {countForPvz}
                    </span>
                  </button>
                );
              })}

              {activePvzs.length > 6 && (
                <div className="min-w-[140px]">
                  <CustomSelect
                    size="sm"
                    value={selectedPvzCode}
                    onChange={setSelectedPvzCode}
                    placeholder="Ещё склад..."
                    options={[
                      { value: 'ALL', label: `Все склады (${activePvzs.length})` },
                      ...activePvzs.map(p => ({
                        value: p.code,
                        label: p.name || p.code,
                        sublabel: p.code,
                      }))
                    ]}
                  />
                </div>
              )}
            </div>

          </div>

        </div>
      </div>

      {/* VIEW 1: Ultra-Compact PVZ Matrix Spreadsheet Table */}
      {viewMode === 'matrix' && (
        <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
          
          {/* Matrix Header Bar */}
          <div className="p-3.5 sm:p-4 border-b border-[#d9dbe0] flex items-center justify-between flex-wrap gap-2 bg-[#f7f9ff]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#2f63ff] shrink-0" />
              <span className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                Матрица смен складов ({filteredPvzs.length} складов · {monthName})
              </span>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-[#2d313b] flex-wrap font-medium">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500"></span> Вышел (Факт)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#2f63ff]"></span> Запланирован (План)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#5d6270]"></span> Пожелание / Занят
              </span>
            </div>
          </div>

          {/* Matrix Table Container with Fixed Headers */}
          <div className="overflow-x-auto max-w-full">
            <table className="w-full border-collapse text-left text-xs">
              
              {/* Table Header: Days of Month (1..31) */}
              <thead>
                <tr className="border-b border-[#d9dbe0] bg-[#f7f9ff] text-[#5d6270] font-mono text-[10px]">
                  {/* Sticky Column: Warehouse Title */}
                  <th className="sticky left-0 z-20 bg-[#f7f9ff] p-2.5 min-w-[180px] max-w-[200px] border-r border-[#d9dbe0] font-semibold uppercase tracking-wider text-[#111111]">
                    Склад
                  </th>

                  {/* Day Columns */}
                  {daysList.map(d => {
                    const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
                    return (
                      <th
                        key={d.dateStr}
                        className="p-2 text-center min-w-[90px] w-[90px] border-r border-[#d9dbe0] font-medium"
                      >
                        <div className={`font-semibold text-xs ${isWeekend ? 'text-rose-600' : 'text-[#111111]'}`}>
                          {d.dayNum}
                        </div>
                        <div className={`text-[9px] uppercase font-sans font-medium ${isWeekend ? 'text-rose-600' : 'text-[#5d6270]'}`}>
                          {d.dayName}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Table Body: 1 Row per Warehouse */}
              <tbody className="divide-y divide-[#e5e7eb]">
                {filteredPvzs.length === 0 ? (
                  <tr>
                    <td colSpan={daysList.length + 1} className="p-8 text-center text-[#5d6270] text-xs italic">
                      Склад по запросу не найден. Измените поиск или сбросьте фильтр.
                    </td>
                  </tr>
                ) : (
                  filteredPvzs.map(pvz => {
                    const eligibleStaff = getStaffForPvz(pvz.code);

                    return (
                      <tr key={pvz.id} className="hover:bg-[#f7f9ff] transition-colors">
                        
                        {/* Sticky Left Warehouse Cell */}
                        <td className="sticky left-0 z-20 bg-white border-r border-[#d9dbe0] p-2.5 min-w-[180px] max-w-[200px] space-y-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-semibold text-[#111111] text-xs truncate" title={pvz.name || pvz.code}>
                              {pvz.name || pvz.code}
                            </span>
                            <span className="text-[#5d6270] font-mono text-[10px] font-semibold shrink-0">
                              {pvz.code}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-[#5d6270] pt-0.5 flex-wrap gap-1">
                            <span className="truncate">Доступно: {eligibleStaff.length} чел.</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => openGeneratorModal(pvz.code)}
                                className="text-[10px] text-[#2f63ff] hover:underline font-semibold flex items-center gap-0.5 cursor-pointer"
                                title="Сверстать график для этого склада"
                              >
                                <SlidersHorizontal className="w-2.5 h-2.5" />
                                <span>Сверстать</span>
                              </button>
                              <button
                                onClick={() => setViewPvzCalendar(pvz)}
                                className="text-[10px] text-[#111111] hover:underline font-semibold flex items-center gap-0.5 cursor-pointer"
                                title="Посмотреть график склада в виде календаря"
                              >
                                <CalendarIcon className="w-2.5 h-2.5" />
                                <span>Посмотреть</span>
                              </button>
                            </div>
                          </div>
                        </td>

                        {/* Day Cells for this PVZ */}
                        {daysList.map(d => {
                          const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;

                          // Find all shifts for this date & PVZ
                          const plans = monthPlannedShifts.filter(
                            s => s.date === d.dateStr && (s.location === pvz.code || s.location === pvz.name)
                          );

                          return (
                            <td
                              key={d.dateStr}
                              onClick={() => openEditSlotModal(d.dateStr, pvz.code)}
                              className={`p-1.5 text-center min-w-[95px] w-[95px] border-r border-[#d9dbe0] align-middle cursor-pointer transition-all hover:bg-[#eef2ff]/60 group ${
                                isWeekend ? 'bg-[#f7f9ff]' : ''
                              }`}
                            >
                              {plans.length > 0 ? (
                                <div className="space-y-1 w-full h-full flex flex-col justify-center">
                                  {plans.map(plan => {
                                    const fact = records.find(
                                      r => r.date === d.dateStr && r.employeeId === plan.employeeId && (r.location === pvz.code || r.location === pvz.name)
                                    );
                                    const staff = staffList.find(s => s.id === plan.employeeId);
                                    return (
                                      <div key={plan.id} className={`p-1 rounded border text-left flex flex-col justify-between transition-colors ${
                                        fact
                                          ? 'bg-emerald-50 border-emerald-300 text-[#111111]'
                                          : 'bg-white border-[#d9dbe0] group-hover:border-[#2f63ff] text-[#111111]'
                                      }`}>
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="font-semibold text-[10px] truncate" title={plan.employeeName}>
                                            {formatShortName(plan.employeeName)}
                                          </span>
                                          {fact ? (
                                            <CheckCircle className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                          ) : (
                                            <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff] shrink-0" />
                                          )}
                                        </div>
                                        <div className="flex items-center justify-between text-[9px] text-[#5d6270] font-mono mt-0.5">
                                          <span>{plan.shiftType.slice(0, 5)}</span>
                                          {staff?.isSenior && (
                                            <span className="text-[#111111] font-semibold">С</span>
                                          )}
                                          {staff?.isPartTime && (
                                            <span className="text-[#b45309] font-semibold">П</span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="h-10 flex flex-col items-center justify-center text-[#5d6270] hover:text-[#2f63ff] hover:bg-[#f7f9ff] rounded border border-transparent hover:border-[#d9dbe0] transition-colors">
                                  <Plus className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  <span className="text-[10px] text-[#5d6270] font-mono group-hover:hidden">—</span>
                                </div>
                              )}
                            </td>
                          );
                        })}

                      </tr>
                    );
                  })
                )}
              </tbody>

            </table>
          </div>

        </div>
      )}

      {/* MODAL 1: Generator Wizard («Сверстать график») */}
      {genModalOpen && (
        <ScheduleGeneratorWizardModal
          isOpen={genModalOpen}
          onClose={() => {
            setGenModalOpen(false);
            setGenLocation("");
          }}
          monthStr={monthStr}
          monthName={monthName}
          daysList={daysList}
          activePvzs={activePvzs}
          staffList={staffList}
          availability={availability}
          getStaffForPvz={getStaffForPvz}
          existingShifts={schedules}
          swapRequests={swaps}
          initialPvz={genLocation}
          loading={loading}
          onApplySchedule={async (shifts, tpl) => {
            setLoading(true);
            try {
              const targetLoc = shifts[0]?.location || genLocation;
              const promises: Promise<any>[] = [
                saveScheduleBatch(shifts, { replaceMonth: monthStr, replaceLocation: targetLoc })
              ];
              if (tpl) {
                promises.push(saveScheduleTemplate(tpl));
              }
              const [res] = await Promise.all(promises);
              if (res?.success) {
                const msg = `График смен успешно сверстан и сохранен (${shifts.length} смен)!`;
                setPubSuccessMsg(msg);
                setTimeout(() => {
                  setPubSuccessMsg(prev => prev === msg ? '' : prev);
                }, 3500);
              }
            } finally {
              setLoading(false);
              setGenModalOpen(false);
              setGenLocation("");
            }
          }}
        />
      )}

      {/* MODAL 2: Saved Scenarios Modal */}
      {tplModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto">
            
            <div className="flex items-center justify-between p-4 sm:p-5 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <div className="flex items-center gap-2 text-base font-semibold text-[#111111]">
                <Bookmark className="w-5 h-5 text-[#2f63ff]" />
                <span>Сохраненные сценарии графиков складов</span>
              </div>
              <button
                onClick={() => setTplModalOpen(false)}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 text-xs flex-1 overflow-y-auto bg-white">
              {scheduleTemplates.length === 0 ? (
                <div className="p-8 text-center text-[#5d6270] text-xs italic bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                  Сохраненных сценариев пока нет. При верстке графика через Мастер отметьте галочку «Сохранить сценарий», чтобы быстро применять его в будущем.
                </div>
              ) : (
                <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] overflow-hidden">
                  {scheduleTemplates.map(tpl => (
                    <div key={tpl.id} className="p-3.5 hover:bg-[#f7f9ff]/60 flex items-center justify-between gap-3 transition-colors">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-[#111111] text-xs">{tpl.name}</span>
                          <span className="text-[#5d6270]">·</span>
                          <span className="text-[#2f63ff] text-xs font-mono font-semibold">
                            Склад {tpl.location}
                          </span>
                          <span className="text-[#5d6270]">·</span>
                          <span className="text-xs text-[#2d313b] font-medium">{tpl.scenarioType}</span>
                        </div>
                        <div className="text-[11px] text-[#5d6270]">
                          Сотрудники: {tpl.mainStaffIds.map((id: string) => staffList.find(s => s.id === id)?.name || id).join(', ')}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleApplyTemplate(tpl)}
                          className="px-3 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold rounded transition-colors cursor-pointer text-xs"
                        >
                          Запустить
                        </button>
                        <button
                          onClick={() => deleteScheduleTemplate(tpl.id)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded cursor-pointer transition-colors"
                          title="Удалить сценарий"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* MODAL: Employee Wishes Registry with Approval / Rejection Controls */}
      {wishesModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-3xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto">
            
            {/* Modal Header */}
            <div className="p-3.5 sm:p-5 shrink-0 bg-[#f7f9ff] border-b border-[#e5e7eb] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-[#b45309] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm sm:text-base font-semibold text-[#111111] flex items-center gap-2 flex-wrap">
                      <span>Пожелания сотрудников по графику</span>
                      <span className="text-xs font-mono font-medium text-[#5d6270] tabular-nums">
                        · {monthName}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#5d6270]">
                      Одобряйте или отклоняйте пожелания. В график попадут только одобренные даты!
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setWishesModalOpen(false)}
                  className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status Filter Tabs & Bulk Actions */}
              {(() => {
                const monthWishes = availability.filter(a => a.date.startsWith(monthStr) && a.type !== 'preferred');
                const pendingWishes = monthWishes.filter(a => !a.status || a.status === 'pending');
                const approvedWishes = monthWishes.filter(a => a.status === 'approved');
                const rejectedWishes = monthWishes.filter(a => a.status === 'rejected');

                return (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                    {/* Filter Tabs */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                      {[
                        { id: 'all', label: 'Все', count: monthWishes.length },
                        { id: 'pending', label: 'Ожидают', count: pendingWishes.length },
                        { id: 'approved', label: 'Одобрены', count: approvedWishes.length },
                        { id: 'rejected', label: 'Отклонены', count: rejectedWishes.length },
                      ].map(tab => {
                        const active = wishesFilterStatus === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setWishesFilterStatus(tab.id as any)}
                            className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                              active
                                ? 'bg-[#111111] text-white font-semibold'
                                : 'bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2d313b]'
                            }`}
                          >
                            <span>{tab.label}</span>
                            <span className={`font-mono text-[11px] tabular-nums ${
                              active ? 'text-[#a9bcff]' : 'text-[#5d6270]'
                            }`}>
                              {tab.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Quick Batch Actions */}
                    {pendingWishes.length > 0 && (
                      <div className="flex items-center gap-1.5 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => handleBatchSetWishesStatus(pendingWishes.map(w => w.id), 'approved')}
                          className="px-3 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                          title="Одобрить все оставшиеся нерассмотренные пожелания"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Одобрить все ({pendingWishes.length})</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Modal Body */}
            <div className="p-3.5 sm:p-5 space-y-4 text-xs flex-1 overflow-y-auto bg-white">
              {(() => {
                const monthWishes = availability.filter(a => a.date.startsWith(monthStr) && a.type !== 'preferred');
                if (monthWishes.length === 0) {
                  return (
                    <div className="p-8 text-center text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-2">
                      <CheckCircle2 className="w-8 h-8 text-[#2f63ff] mx-auto opacity-80" />
                      <div className="text-sm font-semibold text-[#111111]">В этом месяце пожеланий нет</div>
                      <p className="text-xs text-[#5d6270] max-w-sm mx-auto">
                        Все сотрудники доступны для работы в любые дни месяца без ограничений.
                      </p>
                    </div>
                  );
                }

                // Filter by selected tab
                const filteredWishes = monthWishes.filter(w => {
                  if (wishesFilterStatus === 'pending') return !w.status || w.status === 'pending';
                  if (wishesFilterStatus === 'approved') return w.status === 'approved';
                  if (wishesFilterStatus === 'rejected') return w.status === 'rejected';
                  return true;
                });

                if (filteredWishes.length === 0) {
                  return (
                    <div className="p-8 text-center text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-2">
                      <Info className="w-8 h-8 text-[#5d6270] mx-auto opacity-80" />
                      <div className="text-sm font-semibold text-[#111111]">Нет записей в этой категории</div>
                      <p className="text-xs text-[#5d6270]">
                        {wishesFilterStatus === 'pending'
                          ? 'Все пожелания сотрудников уже рассмотрены!'
                          : wishesFilterStatus === 'approved'
                          ? 'Пока нет одобренных пожеланий.'
                          : 'Нет отклоненных пожеланий.'}
                      </p>
                    </div>
                  );
                }

                // Group by employee
                const wishesByStaff: Record<string, typeof filteredWishes> = {};
                filteredWishes.forEach(w => {
                  if (!wishesByStaff[w.employeeId]) {
                    wishesByStaff[w.employeeId] = [];
                  }
                  wishesByStaff[w.employeeId].push(w);
                });

                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-[#5d6270] px-0.5">
                      <span>Сотрудников в списке: <strong className="font-semibold text-[#111111] font-mono tabular-nums">{Object.keys(wishesByStaff).length}</strong></span>
                      <span>Отображено заявок: <strong className="font-semibold text-[#2f63ff] font-mono tabular-nums">{filteredWishes.length}</strong></span>
                    </div>

                    <div className="space-y-3">
                      {Object.entries(wishesByStaff).map(([stId, stWishes]) => {
                        const staff = staffList.find(s => s.id === stId);
                        const sortedWishes = [...stWishes].sort((a, b) => a.date.localeCompare(b.date));
                        const staffPending = sortedWishes.filter(w => !w.status || w.status === 'pending');

                        return (
                          <div
                            key={stId}
                            className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden"
                          >
                            {/* Staff Header + Quick Actions */}
                            <div className="px-3.5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <div className="font-semibold text-[#111111] text-sm flex items-center gap-1.5 flex-wrap">
                                  <span>{staff?.name || 'Сотрудник'}</span>
                                  {staff?.isSenior && (
                                    <span className="text-[11px] text-[#b45309] font-medium">
                                      · Старший
                                    </span>
                                  )}
                                  {staff?.isPartTime && (
                                    <span className="text-[11px] text-indigo-700 font-medium">
                                      · Подработка
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[#5d6270] font-mono">
                                  {staff?.login || '—'}
                                </div>
                              </div>

                              {/* Staff Batch Actions */}
                              <div className="flex items-center gap-2.5 self-start sm:self-auto">
                                {staffPending.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleBatchSetWishesStatus(staffPending.map(w => w.id), 'approved')}
                                    className="px-2.5 py-1 rounded bg-white hover:bg-[#2f63ff] border border-[#d9dbe0] hover:border-[#2f63ff] text-[#111111] hover:text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                                    title="Одобрить все нерассмотренные даты этого сотрудника"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>Одобрить все ({staffPending.length})</span>
                                  </button>
                                )}
                                <span className="text-xs font-mono font-semibold text-[#b45309] tabular-nums">
                                  {sortedWishes.length} дн.
                                </span>
                              </div>
                            </div>

                            {/* Wish Items List */}
                            <div className="divide-y divide-[#e5e7eb]">
                              {sortedWishes.map(w => {
                                const d = daysList.find(day => day.dateStr === w.date);
                                const isApproved = w.status === 'approved';
                                const isRejected = w.status === 'rejected';
                                const isPending = !w.status || w.status === 'pending';
                                const isUpdating = updatingWishId === w.id;
                                const catInfo = getWishCategoryInfo(w.type, w.comment);
                                const commentText = (w.comment || '').trim();
                                const hasDistinctComment = commentText && !commentText.toLowerCase().includes('не мог') && !commentText.toLowerCase().includes('не мож');

                                return (
                                  <div
                                    key={w.id}
                                    className={`px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                                      isRejected
                                        ? 'bg-rose-50/40 text-rose-800 opacity-75'
                                        : 'bg-white hover:bg-[#f7f9ff]/60'
                                    }`}
                                  >
                                    {/* Date & Reason Info */}
                                    <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <CalendarIcon className="w-3.5 h-3.5 text-[#5d6270] shrink-0" />
                                        <span className="font-mono font-semibold text-[#111111] text-xs sm:text-sm tabular-nums">
                                          {w.date.slice(8)} {monthName.slice(0, 3)}
                                        </span>
                                        {d && (
                                          <span className={`text-xs font-medium ${
                                            d.dayOfWeek === 0 || d.dayOfWeek === 6 ? 'text-rose-600' : 'text-[#5d6270]'
                                          }`}>
                                            ({d.dayName})
                                          </span>
                                        )}
                                      </div>

                                      <span className="text-[#d9dbe0]">·</span>

                                      {/* Clear Reason Category */}
                                      <span className={`text-xs shrink-0 ${catInfo.badgeClass}`}>
                                        {catInfo.label}
                                      </span>
                                      {hasDistinctComment && (
                                        <span className="text-xs text-[#2d313b] italic truncate max-w-[260px]" title={commentText}>
                                          «{commentText}»
                                        </span>
                                      )}

                                      <span className="text-[#d9dbe0]">·</span>

                                      {/* Status Indicator */}
                                      {isApproved && (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#2f63ff]">
                                          <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff]" />
                                          <span>Одобрено</span>
                                        </span>
                                      )}
                                      {isRejected && (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-700">
                                          <span className="w-1.5 h-1.5 rounded-xs bg-rose-600" />
                                          <span>Отклонено</span>
                                        </span>
                                      )}
                                      {isPending && (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#b45309]">
                                          <span className="w-1.5 h-1.5 rounded-xs bg-amber-500" />
                                          <span>Ожидает</span>
                                        </span>
                                      )}
                                    </div>

                                    {/* Action Buttons: Одобрить / Отклонить */}
                                    <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                                      {/* Approve Button */}
                                      <button
                                        type="button"
                                        disabled={isUpdating || isApproved}
                                        onClick={() => handleSetWishStatus(w.id, 'approved')}
                                        className={`h-7 w-7 sm:w-auto px-0 sm:px-2.5 py-0.5 rounded text-[11px] flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                                          isApproved
                                            ? 'bg-[#111111] text-white font-semibold cursor-default'
                                            : 'bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] font-medium'
                                        }`}
                                        title="Одобрить пожелание (будет учтено в мастере верстки)"
                                      >
                                        <Check className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                        <span className="hidden sm:inline">Одобрить</span>
                                      </button>

                                      {/* Reject Button */}
                                      <button
                                        type="button"
                                        disabled={isUpdating || isRejected}
                                        onClick={() => handleSetWishStatus(w.id, 'rejected')}
                                        className={`h-7 w-7 sm:w-auto px-0 sm:px-2.5 py-0.5 rounded text-[11px] flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                                          isRejected
                                            ? 'bg-rose-600 text-white font-semibold cursor-default'
                                            : 'bg-[#f7f9ff] hover:bg-rose-50 border border-[#d9dbe0] text-[#5d6270] hover:text-rose-700 font-medium'
                                        }`}
                                        title="Отклонить пожелание (не будет учитываться при верстке)"
                                      >
                                        <X className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                        <span className="hidden sm:inline">Отклонить</span>
                                      </button>

                                      {/* Reset to Pending if already decided */}
                                      {!isPending && (
                                        <button
                                          type="button"
                                          disabled={isUpdating}
                                          onClick={() => handleSetWishStatus(w.id, 'pending')}
                                          className="h-7 w-7 p-0 text-[#5d6270] hover:text-[#b45309] hover:bg-[#f7f9ff] rounded transition-colors cursor-pointer flex items-center justify-center shrink-0"
                                          title="Вернуть на рассмотрение (сбросить выбор)"
                                        >
                                          <RefreshCw className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 sm:p-4 border-t border-[#e5e7eb] bg-[#f7f9ff] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
              <div className="text-[11px] text-[#2d313b] flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-[#2f63ff] shrink-0" />
                <span>Одобренные пожелания сразу исключаются из назначения смен на Шаге 3</span>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setWishesModalOpen(false)}
                  className="px-4 py-2 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-medium cursor-pointer transition-colors"
                >
                  Закрыть
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWishesModalOpen(false);
                    setGenLocation(selectedPvzCode === 'ALL' ? '' : selectedPvzCode);
                    setGenModalOpen(true);
                  }}
                  className="px-4 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded text-xs cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Сверстать график с учётом пожеланий</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MODAL 3: Quick Edit Slot Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto">
            
            <div className="flex items-center justify-between p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <div className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-[#2f63ff]" />
                <span>Назначение смены: {modalDate} (Склад {modalLocation})</span>
              </div>
              <button
                onClick={() => setEditModalOpen(false)}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSlot} className="p-4 space-y-3.5 text-xs flex-1 overflow-y-auto bg-white">
              {slotModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-md flex items-center gap-2 text-xs text-rose-800 animate-fade-in">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{slotModalError}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[#2d313b] font-semibold">
                    Назначить сотрудников (Склад {modalLocation}):
                  </label>
                  <button
                    type="button"
                    onClick={() => setModalEmployeeIds([])}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold hover:underline cursor-pointer"
                  >
                    Сбросить / Отменить всех
                  </button>
                </div>

                <div className="p-2 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md overflow-y-auto max-h-48 space-y-1.5">
                  {getStaffForPvz(modalLocation).length === 0 ? (
                    <div className="text-[#5d6270] italic p-4 text-center">
                      Нет закрепленных сотрудников за складом {modalLocation}
                    </div>
                  ) : (
                    getStaffForPvz(modalLocation).map(s => {
                      const isSelected = modalEmployeeIds.includes(s.id);
                      const isUnavail = availability.some(a => a.employeeId === s.id && a.date === modalDate);

                      const targetPvz = activePvzs.find(p => p.code === modalLocation || p.name === modalLocation || p.id === modalLocation);
                      const targetLocCode = targetPvz?.code || modalLocation;
                      const targetLocName = targetPvz?.name || modalLocation;

                      // Enforce rule: if employee already has a shift on modalDate at another PVZ
                      const otherPvzShift = schedules.find(
                        sch => sch.employeeId === s.id &&
                               sch.date === modalDate &&
                               sch.location !== targetLocCode &&
                               sch.location !== targetLocName &&
                               sch.location !== targetPvz?.id
                      );

                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={Boolean(otherPvzShift)}
                          onClick={() => {
                            if (otherPvzShift) return;
                            if (isSelected) {
                              setModalEmployeeIds(prev => prev.filter(id => id !== s.id));
                            } else {
                              setModalEmployeeIds(prev => [...prev, s.id]);
                            }
                          }}
                          className={`w-full py-2 px-3 rounded border transition-colors flex items-center justify-between text-xs ${
                            otherPvzShift
                              ? 'bg-rose-50 border-rose-200 text-rose-700 cursor-not-allowed opacity-75'
                              : isSelected
                              ? 'bg-[#111111] border-[#111111] text-white font-semibold cursor-pointer'
                              : 'bg-white border-[#d9dbe0] text-[#111111] hover:border-[#2f63ff] cursor-pointer'
                          }`}
                          title={
                            otherPvzShift
                              ? `Сотрудник уже назначен на смену на складе ${otherPvzShift.location} на дату ${modalDate}. Добавление на другой склад невозможно!`
                              : undefined
                          }
                        >
                          <div className="flex flex-col items-start min-w-0">
                            <span className="truncate font-semibold">{s.name}</span>
                            {otherPvzShift ? (
                              <span className="text-[10px] text-rose-700 font-medium flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                                <span>На смене в {otherPvzShift.location}</span>
                              </span>
                            ) : isUnavail ? (
                              <span className={`text-[10px] font-medium truncate max-w-[220px] flex items-center gap-1 ${isSelected ? 'text-amber-300' : 'text-[#b45309]'}`}>
                                <AlertTriangle className={`w-3 h-3 shrink-0 ${isSelected ? 'text-amber-300' : 'text-[#b45309]'}`} />
                                <span>{(() => {
                                  const wishObj = availability.find(a => a.employeeId === s.id && a.date === modalDate);
                                  if (!wishObj) return 'Пожелание по графику';
                                  return getWishReasonLabel(wishObj.type, wishObj.comment);
                                })()}</span>
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {s.isSenior && (
                              <span className={`text-[11px] font-semibold ${isSelected ? 'text-[#a9bcff]' : 'text-[#2f63ff]'}`}>
                                Ст.С.
                              </span>
                            )}
                            {otherPvzShift ? (
                              <span className="text-[10px] text-rose-700 font-mono font-semibold">
                                Занят
                              </span>
                            ) : isSelected ? (
                              <CheckCircle2 className="w-4 h-4 text-[#a9bcff] shrink-0" />
                            ) : (
                              <div className="w-4 h-4 rounded-xs border border-[#d9dbe0] shrink-0" />
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[#2d313b] font-semibold mb-1.5">Тип смены склада:</label>
                <CustomSelect<ShiftType>
                  value={modalShiftType}
                  onChange={v => setModalShiftType(v)}
                  menuHeaderTitle="Тип смены склада"
                  options={[
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
                <label className="block text-[#2d313b] font-semibold mb-1.5">Заметка / комментарий:</label>
                <input
                  type="text"
                  placeholder="Например, усиление в час пик"
                  value={modalNote}
                  onChange={e => setModalNote(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] focus:border-[#2f63ff] rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded cursor-pointer font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Сохранение...' : (isEditingSlot ? 'Сохранить' : 'Назначить смену')}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODAL 4: Publish Confirmation Modal */}
      {pubModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto">
            
            <div className="p-5 space-y-4 text-xs">
              <div className="flex items-start gap-2.5">
                <Send className="w-5 h-5 text-[#2f63ff] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111111]">Опубликовать график сотрудникам?</h3>
                  <p className="text-[11px] text-[#5d6270] mt-0.5">
                    Утверждение графиков смен на {monthName}
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-1.5 text-[#2d313b]">
                <div className="flex items-center justify-between font-medium">
                  <span>Запланировано смен:</span>
                  <strong className="text-[#111111] font-mono tabular-nums">{monthPlannedShifts.length}</strong>
                </div>
                <div className="flex items-center justify-between font-medium">
                  <span>Охват складов:</span>
                  <strong className="text-[#111111]">{selectedPvzCode === 'ALL' ? 'Все склады' : selectedPvzCode}</strong>
                </div>
                <div className="text-[11px] text-[#5d6270] pt-1 border-t border-[#e5e7eb]">
                  После публикации все сотрудники моментально увидят свои плановые смены в мобильном личном кабинете в «Календаре отработанных смен».
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPubModalOpen(false)}
                  className="px-4 py-2 text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded cursor-pointer font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handlePublishSchedule}
                  className="px-5 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded cursor-pointer transition-colors disabled:opacity-50"
                >
                  {loading ? 'Рассылка...' : 'Утвердить и отправить'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MODAL 5: PVZ Calendar Viewer with editing/deleting controls */}
      {viewPvzCalendar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-4xl max-h-[95dvh] sm:max-h-[92vh] flex flex-col overflow-hidden my-auto">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0 flex items-center justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <CalendarIcon className="w-5 h-5 text-[#2f63ff] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm sm:text-base font-semibold text-[#111111]">
                    График смен склада «{viewPvzCalendar.name || viewPvzCalendar.code}»
                  </h3>
                  <p className="text-[11px] text-[#5d6270]">
                    Режим просмотра календаря · {monthName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewPvzCalendar(null)}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded cursor-pointer bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] transition-colors"
                title="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-4 sm:p-5 flex-1 overflow-y-auto space-y-4 bg-white">
              
              {/* Calendar Days Grid */}
              <div className="grid grid-cols-7 gap-1 text-center shrink-0">
                {/* Days of Week Row */}
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
                  <div key={day} className="py-1 text-[10px] font-semibold text-[#5d6270] uppercase tracking-wider">
                    {day}
                  </div>
                ))}

                {/* Padding Empty Cells */}
                {Array.from({ length: (daysList[0]?.dayOfWeek === 0) ? 6 : (daysList[0]?.dayOfWeek - 1) }).map((_, idx) => (
                  <div key={`pad-${idx}`} className="bg-[#f7f9ff]/60 rounded min-h-[64px] border border-transparent" />
                ))}

                {/* Day Cells */}
                {daysList.map(d => {
                  const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
                  const plans = monthPlannedShifts.filter(
                    s => s.date === d.dateStr && (s.location === viewPvzCalendar.code || s.location === viewPvzCalendar.name)
                  );

                  return (
                    <div
                      key={d.dateStr}
                      className={`p-1.5 rounded border min-h-[84px] text-left flex flex-col justify-between transition-colors ${
                        plans.length > 0
                          ? 'bg-[#f7f9ff] border-[#d9dbe0] hover:border-[#2f63ff]'
                          : 'bg-white border-[#e5e7eb] hover:border-[#2f63ff]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-semibold font-mono tabular-nums ${isWeekend ? 'text-rose-600' : 'text-[#111111]'}`}>
                          {d.dayNum}
                        </span>
                        {plans.length > 0 && (
                          <span className="text-[11px] text-[#2f63ff] font-semibold font-mono tabular-nums">
                            {plans.length}
                          </span>
                        )}
                      </div>

                      {/* List of Shifts for this Day */}
                      <div className="space-y-1 mt-1 flex-1 overflow-y-auto">
                        {plans.map(plan => (
                          <div
                            key={plan.id}
                            className="px-1.5 py-0.5 bg-[#111111] border border-[#111111] rounded text-[9px] font-semibold text-white flex items-center justify-between gap-1"
                          >
                            <span className="truncate max-w-[56px] text-white" title={plan.employeeName}>
                              {formatShortName(plan.employeeName)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShiftToDelete({ id: plan.id, employeeName: plan.employeeName, date: d.dateStr });
                              }}
                              className="p-0.5 text-[#a9bcff] hover:text-rose-300 hover:bg-[#2d313b] rounded transition-colors shrink-0 cursor-pointer"
                              title="Убрать смену"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Add Slot Button */}
                      <button
                        onClick={() => openEditSlotModal(d.dateStr, viewPvzCalendar.code)}
                        className="mt-1 w-full py-0.5 px-1 bg-white hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#2f63ff] text-[9px] font-semibold rounded flex items-center justify-center gap-0.5 transition-colors cursor-pointer border border-[#d9dbe0] hover:border-[#a9bcff]"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>Добавить</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 border-t border-[#e5e7eb] shrink-0 bg-[#f7f9ff] flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setClearMonthConfirmPvz({
                    code: viewPvzCalendar.code,
                    name: viewPvzCalendar.name || viewPvzCalendar.code
                  });
                }}
                disabled={monthPlannedShifts.filter(s => s.location === viewPvzCalendar.code || s.location === viewPvzCalendar.name).length === 0}
                className="px-4 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-semibold rounded text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Очистить весь месяц</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportPvzCalendarPdf}
                  disabled={isExportingPvzPdf}
                  className="group px-4 py-2 bg-[#111111] hover:bg-[#2f63ff] text-white border border-[#111111] hover:border-[#2f63ff] font-semibold rounded text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Скачать график смен данного склада в PDF (Календарь, Матрица, Баланс)"
                >
                  {isExportingPvzPdf ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#a9bcff] group-hover:text-white" />
                      <span>Формирование...</span>
                    </>
                  ) : (
                    <>
                      <FileDown className="w-3.5 h-3.5 text-[#a9bcff] group-hover:text-white transition-colors" />
                      <span>Сохранить в PDF</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setViewPvzCalendar(null)}
                  className="px-5 py-2 bg-white hover:bg-[#eef2ff] text-[#111111] font-semibold text-xs rounded transition-colors cursor-pointer border border-[#d9dbe0]"
                >
                  Закрыть
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* CONFIRM MODAL: Single Shift Deletion */}
      {shiftToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[#111111]/55 animate-fade-in">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-sm p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <Trash2 className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-[#111111]">Снять со смены?</h4>
                <p className="text-xs text-[#2d313b] mt-0.5">
                  Сотрудник: <strong className="text-[#111111]">{shiftToDelete.employeeName}</strong>
                </p>
                <p className="text-[11px] text-[#5d6270] font-mono tabular-nums">
                  Дата: {shiftToDelete.date}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShiftToDelete(null)}
                className="px-3.5 py-2 text-xs font-semibold text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded cursor-pointer transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  await deletePlannedShift(shiftToDelete.id);
                  setLoading(false);
                  setShiftToDelete(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Удаление...' : 'Да, снять со смены'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM MODAL: Clear All Month Shifts for PVZ */}
      {clearMonthConfirmPvz && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[#111111]/55 animate-fade-in">
          <div className="bg-white border border-rose-200 rounded-md w-full max-w-md p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-[#111111]">Очистить весь месяц?</h4>
                <p className="text-xs text-[#2d313b] mt-0.5">
                  Склад «{clearMonthConfirmPvz.name}» · {monthName}
                </p>
              </div>
            </div>

            <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-md">
              Внимание: Все запланированные смены для этого склада на данный месяц будут удалены. Это действие необратимо.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setClearMonthConfirmPvz(null)}
                className="px-4 py-2 text-xs font-semibold text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded cursor-pointer transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  await clearMonthSchedules(monthStr, clearMonthConfirmPvz.code);
                  setLoading(false);
                  setClearMonthConfirmPvz(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Очистка...' : 'Удалить все смены'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
