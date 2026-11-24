import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { LocationType } from '../../types';
import { calculateShiftBreakdown, formatCurrency, formatDateDDMMYYYY, getShiftLabel } from '../../utils/calculations';
import { formatDisplayDate } from '../../utils/time';
import { CheckInModal } from './CheckInModal';
import { CheckOutModal } from './CheckOutModal';
import { MessageManagerModal } from './MessageManagerModal';
import { ShiftStatsView } from './ShiftStatsView';
import { AvailabilityModal } from './AvailabilityModal';
import { EmployeeSwapModal } from './EmployeeSwapModal';
import {
  CheckCircle2,
  Clock,
  MessageSquare,
  BarChart3,
  Edit3,
  Calendar,
  ShieldAlert,
  Check,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Coins,
  ArrowLeftRight,
  Moon,
  Sun,
} from 'lucide-react';

export const EmployeeDashboard: React.FC = () => {
  const {
    currentStaff,
    currentStaffId,
    records,
    cancelledDates = [],
    availability,
    swaps,
    schedules = [],
    todayDate,
    performCheckIn,
    performCheckOut,
    cancelCheckIn,
    rates,
    pickupPoints = [],
  } = useApp();

  const [isCheckInOpen, setIsCheckInOpen] = useState(false);
  const [isCheckOutOpen, setIsCheckOutOpen] = useState(false);
  const [isMessageOpen, setIsMessageOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isAvailOpen, setIsAvailOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);

  const [calendarYear, setCalendarYear] = useState<number>(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(new Date().getMonth());
  const [selectedDayNum, setSelectedDayNum] = useState<number | null>(new Date().getDate());

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(prev => prev - 1);
    } else {
      setCalendarMonth(prev => prev - 1);
    }
    setSelectedDayNum(null);
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(prev => prev + 1);
    } else {
      setCalendarMonth(prev => prev + 1);
    }
    setSelectedDayNum(null);
  };

  const monthNamesRu = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  if (!currentStaff || currentStaff.status !== 'active') {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center">
        <div className="p-8 bg-white border border-[#d9dbe0] rounded-md space-y-3">
          <ShieldAlert className="w-7 h-7 text-[#b45309] mx-auto" />
          <h2 className="text-lg font-semibold text-[#111111]">Доступ к учетной записи ограничен</h2>
          <p className="text-xs text-[#2d313b] leading-relaxed max-w-md mx-auto">
            Ваш аккаунт находится в статусе «{currentStaff?.status || 'Ожидает'}». Обратитесь к руководителю для открытия доступа.
          </p>
        </div>
      </div>
    );
  }

  const todayRecords = records
    .filter(r => r.employeeId === currentStaffId && r.date === todayDate)
    .sort((a, b) => new Date(b.checkedInAt || b.timestamp || 0).getTime() - new Date(a.checkedInAt || a.timestamp || 0).getTime());
  const todayRecord = todayRecords.length > 0 ? todayRecords[0] : undefined;
  const hasCheckedIn = !!todayRecord?.shiftType;
  const editCount = Number(todayRecord?.editCount || 0);
  const hasUsedEdit = editCount >= 1;
  const cancelCount = Math.max(Number(todayRecord?.cancelCount || 0), cancelledDates.includes(todayDate) ? 1 : 0);
  const hasUsedCancel = cancelCount >= 1;

  const calendarMonthStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`;
  const empMonthRecords = records.filter(r => 
    r.employeeId === currentStaffId && 
    r.date.startsWith(calendarMonthStr)
  );

  const empMonthRecordsMap = new Map<string, any>();
  empMonthRecords.forEach(r => {
    empMonthRecordsMap.set(r.date, r);
  });

  const empMonthPlannedShifts = schedules.filter(s =>
    String(s.employeeId) === String(currentStaffId) &&
    s.date.startsWith(calendarMonthStr)
  );

  const formatShiftCountRu = (cnt: number) => {
    const mod10 = cnt % 10;
    const mod100 = cnt % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${cnt} смен`;
    if (mod10 === 1) return `${cnt} смена`;
    if (mod10 >= 2 && mod10 <= 4) return `${cnt} смены`;
    return `${cnt} смен`;
  };

  const calendarDaysCount = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  let firstDayIdx = new Date(calendarYear, calendarMonth, 1).getDay();
  firstDayIdx = firstDayIdx === 0 ? 6 : firstDayIdx - 1;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayIdx; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= calendarDaysCount; d++) {
    cells.push(d);
  }

  const isSameDate = (d1?: string, d2?: string) => {
    if (!d1 || !d2) return false;
    const clean1 = d1.split('T')[0].trim();
    const clean2 = d2.split('T')[0].trim();
    if (clean1 === clean2) return true;
    const p1 = clean1.split(/[-.]/);
    const p2 = clean2.split(/[-.]/);
    if (p1.length === 3 && p2.length === 3) {
      const y1 = p1[0].length === 4 ? p1[0] : p1[2];
      const m1 = p1[1].padStart(2, '0');
      const day1 = p1[0].length === 4 ? p1[2].padStart(2, '0') : p1[0].padStart(2, '0');

      const y2 = p2[0].length === 4 ? p2[0] : p2[2];
      const m2 = p2[1].padStart(2, '0');
      const day2 = p2[0].length === 4 ? p2[2].padStart(2, '0') : p2[0].padStart(2, '0');

      return y1 === y2 && m1 === m2 && day1 === day2;
    }
    return false;
  };

  const selectedDateString = selectedDayNum
    ? `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(selectedDayNum).padStart(2, '0')}`
    : '';
  const selectedDayRecord = empMonthRecordsMap.get(selectedDateString);

  const selectedDayAvail = availability.find(
    a => String(a.employeeId) === String(currentStaffId) && isSameDate(a.date, selectedDateString)
  );

  const activePickupPointCodes = new Set<string>(
    (pickupPoints || [])
      .filter((p: any) => p.active !== false && !p.isArchived)
      .map((p: any) => p.code)
  );

  const rawStaffLocations = currentStaff.locations || (currentStaff.location ? [currentStaff.location] : []);
  const staffLocations = rawStaffLocations.filter(locCode => activePickupPointCodes.has(locCode));
  const effectiveStaffLocations: LocationType[] = staffLocations.length > 0 ? staffLocations : Array.from(activePickupPointCodes);

  const openMarketSwapsCount = swaps.filter(s => s.status === 'open' && s.requesterId !== currentStaffId).length;
  const todayPlannedShift = schedules.find(
    s => String(s.employeeId) === String(currentStaffId) && isSameDate(s.date, todayDate)
  );
  const empMonthPlannedOrSwapCount = empMonthPlannedShifts.length + swaps.filter(
    s => s.candidateId === currentStaffId && s.status === 'approved' && s.date.startsWith(calendarMonthStr)
  ).length;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 space-y-5 text-[#111111]">
      
      {/* Welcome & Profile Header */}
      <div className="p-4 sm:p-5 bg-white border border-[#d9dbe0] rounded-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs text-[#5d6270] font-medium flex items-center gap-1.5 flex-wrap">
              <span>Рабочее место сотрудника</span>
              {staffLocations.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#2d313b] font-semibold">Склад {staffLocations.join(', ')}</span>
                </>
              )}
              {currentStaff.isSenior && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#2f63ff] font-semibold">Старший смены</span>
                </>
              )}
              {currentStaff.isPartTime && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#b45309] font-semibold">Подработчик</span>
                </>
              )}
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-[#111111] mt-0.5">
              {currentStaff.name}
            </h1>
            <p className="text-xs text-[#5d6270] mt-0.5">
              Сегодня: <span className="text-[#111111] font-medium font-mono tabular-nums">{formatDisplayDate(todayDate)}</span>
            </p>
          </div>

          {/* Quick Toolbar */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setIsAvailOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Пожелания по графику и отпускам"
            >
              <Calendar className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Пожелания</span>
            </button>

            <button
              onClick={() => setIsSwapOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Биржа смен и подмен"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Биржа смен</span>
              {openMarketSwapsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-xs bg-[#2f63ff] text-white text-[10px] font-bold font-mono tabular-nums leading-none">
                  {openMarketSwapsCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setIsStatsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <BarChart3 className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Показатели</span>
            </button>

            <button
              onClick={() => setIsMessageOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Сообщение</span>
            </button>
          </div>
        </div>
      </div>

      {/* Action-First Main Grid (Above the fold on mobile & desktop) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        
        {/* Primary Card: Check-in / Check-out */}
        <div className={`rounded-md border bg-white overflow-hidden flex flex-col justify-between ${
          hasCheckedIn
            ? todayRecord?.checkOutAt
              ? 'border-[#2f63ff]'
              : 'border-amber-400'
            : 'border-[#d9dbe0]'
        }`}>
          <div>
            <div className="px-4 sm:px-5 py-3 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#2d313b]">
                <Clock className="w-4 h-4 text-[#2f63ff] shrink-0" />
                <span>Учёт рабочего времени склада</span>
              </div>
              {hasCheckedIn ? (
                todayRecord?.checkOutAt ? (
                  <span className="text-xs font-semibold text-[#2f63ff] inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff]" />
                    Смена завершена
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-[#b45309] inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-xs bg-[#b45309]" />
                    На смене
                  </span>
                )
              ) : (
                <span className="text-xs font-semibold text-[#b45309] inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-xs bg-[#b45309]" />
                  Ожидает чекина
                </span>
              )}
            </div>

            {hasCheckedIn ? (
              <div className="divide-y divide-[#e5e7eb] px-4 sm:px-5">
                <div className="py-2.5 flex items-center justify-between text-xs gap-2">
                  <span className="text-[#5d6270]">Склад смены:</span>
                  <span className="font-mono text-[#111111] font-bold text-right">
                    {todayRecord.location}{todayRecord.zone ? ` · ${todayRecord.zone}` : ''}
                  </span>
                </div>
                
                <div className="py-2.5 text-sm font-bold text-[#111111] flex items-center justify-between gap-2 flex-wrap">
                  <span>{getShiftLabel(todayRecord.shiftType, rates)}</span>
                  <span className={`text-xs font-semibold ${
                    todayRecord.checkOutAt ? 'text-[#2f63ff]' : 'text-[#b45309]'
                  }`}>
                    {todayRecord.checkOutAt ? '✓ Зафиксирована' : 'Активна'}
                  </span>
                </div>

                <div className="py-2.5 grid grid-cols-2 gap-2 text-xs text-[#2d313b] font-mono tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#2f63ff] shrink-0" />
                    <span>Приход: {todayRecord.checkedInAt ? new Date(todayRecord.checkedInAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <LogOut className="w-3.5 h-3.5 text-[#2f63ff] shrink-0" />
                    <span>Уход: {todayRecord.checkOutAt ? new Date(todayRecord.checkOutAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'в работе'}</span>
                  </div>
                </div>

                {todayRecord.workedHours && (
                  <div className="py-2.5 flex items-center justify-between text-xs">
                    <span className="text-[#2d313b] font-medium">Отработано часов:</span>
                    <span className="font-bold text-[#2f63ff] font-mono tabular-nums">{todayRecord.workedHours} ч</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="px-4 sm:px-5 py-4 text-xs text-[#2d313b] leading-relaxed">
                Откройте смену на проходной: внутри формы доступны выбор участка, сканирование QR-кода склада и автоматическая проверка GPS.
              </div>
            )}
          </div>

          {/* Primary Action */}
          <div className="px-4 sm:px-5 py-3.5 border-t border-[#e5e7eb] bg-[#f7f9ff]/60">
            {hasCheckedIn ? (
              todayRecord.checkOutAt ? (
                <div className="py-1 text-xs text-[#2f63ff] text-center font-semibold">
                  ✓ Смена на сегодня закрыта. Данные переданы в табель.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => setIsCheckOutOpen(true)}
                    className="w-full py-2.5 px-3 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white cursor-pointer whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    <span>Завершить смену (Check-out)</span>
                  </button>

                  <button
                    onClick={() => setIsCheckInOpen(true)}
                    disabled={hasUsedEdit}
                    className={`w-full py-2.5 px-3 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                      hasUsedEdit
                        ? 'bg-[#e5e7eb] text-[#5d6270] cursor-not-allowed border border-[#d9dbe0]'
                        : 'bg-white hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] cursor-pointer'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5 shrink-0" />
                    <span>{hasUsedEdit ? 'Изменено (1/1)' : 'Изменить параметры'}</span>
                  </button>
                </div>
              )
            ) : (
              <button
                onClick={() => setIsCheckInOpen(true)}
                className="w-full py-2.5 px-4 rounded text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white cursor-pointer whitespace-nowrap"
              >
                <Check className="w-4 h-4 stroke-[2.5] shrink-0" />
                <span>Начать смену (Check-in)</span>
              </button>
            )}
          </div>
        </div>

        {/* Secondary Card: Warehouse Profile & Today's Schedule */}
        <div className="rounded-md border border-[#d9dbe0] bg-white overflow-hidden flex flex-col justify-between">
          <div className="px-4 sm:px-5 py-3 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#2d313b]">Текущий склад и ставка</span>
            <span className="text-xs font-semibold text-[#2f63ff] truncate">
              {currentStaff?.position || 'Работник склада'}
            </span>
          </div>

          <div className="px-4 sm:px-5 divide-y divide-[#e5e7eb] text-xs flex-1 flex flex-col justify-center">
            <div className="py-3 flex items-center justify-between text-[#2d313b]">
              <span>Назначенный склад:</span>
              <span className="font-bold text-[#111111] font-mono">
                {todayRecord?.location || currentStaff?.location || (currentStaff?.locations && currentStaff.locations[0]) || 'Не выбран'}
              </span>
            </div>
            <div className="py-3 flex items-center justify-between text-[#2d313b]">
              <span>Формат оплаты:</span>
              <span className="font-bold text-[#2f63ff] font-mono tabular-nums">
                {currentStaff?.payType === 'hourly'
                  ? `${currentStaff.hourlyRate || 350} ₽ / час`
                  : `${currentStaff?.shiftRate || 3500} ₽ / смена`}
              </span>
            </div>
            <div className="py-3 flex items-center justify-between text-[#2d313b] gap-2">
              <span>График на сегодня:</span>
              <span className="font-semibold text-[#111111] text-right truncate">
                {todayPlannedShift
                  ? `${getShiftLabel(todayPlannedShift.shiftType, rates)} · ${todayPlannedShift.location}`
                  : 'Не запланирована'}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Worked Days Calendar */}
      <div className="p-4 sm:p-5 bg-white border border-[#d9dbe0] rounded-md space-y-4">
        {/* Calendar Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#e5e7eb] pb-3.5">
          <div>
            <h3 className="text-sm font-semibold text-[#111111]">Календарь смен</h3>
            <p className="text-xs text-[#5d6270] mt-0.5">
              Плановые и отработанные смены, начисления по дням
            </p>
          </div>

          {/* Controls & Mini Counter */}
          <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
            <span className="text-xs font-semibold text-[#111111] font-mono tabular-nums">
              Смен: {empMonthRecordsMap.size}
            </span>

            <div className="flex items-center bg-[#f7f9ff] p-0.5 rounded border border-[#d9dbe0]">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-white rounded transition-colors cursor-pointer"
                title="Предыдущий месяц"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold text-[#111111] px-3 min-w-[100px] text-center font-mono">
                {monthNamesRu[calendarMonth]} {calendarYear}
              </span>
              <button
                onClick={handleNextMonth}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-white rounded transition-colors cursor-pointer"
                title="Следующий месяц"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Calendar Grid & Details side-by-side */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
          
          {/* Left Column: Calendar Grid */}
          <div className="md:col-span-7">
            <div className="grid grid-cols-7 gap-1 text-center">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, idx) => (
                <div
                  key={day}
                  className={`text-[11px] font-semibold py-1 font-mono ${
                    idx >= 5 ? 'text-rose-600' : 'text-[#5d6270]'
                  }`}
                >
                  {day}
                </div>
              ))}

              {cells.map((dayNum, idx) => {
                if (dayNum === null) {
                  return <div key={`empty-${idx}`} className="aspect-square" />;
                }

                const cellDateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const hasShift = empMonthRecordsMap.has(cellDateStr);
                const isSelected = selectedDayNum === dayNum;
                const isToday =
                  new Date().getDate() === dayNum &&
                  new Date().getMonth() === calendarMonth &&
                  new Date().getFullYear() === calendarYear;

                const myAvail = availability.find(
                  a => String(a.employeeId) === String(currentStaffId) && isSameDate(a.date, cellDateStr)
                );
                const myApprovedSwap = swaps.find(s => s.candidateId === currentStaffId && s.status === 'approved' && s.date === cellDateStr);
                const myPlannedShift = schedules.find(s => s.employeeId === currentStaffId && s.date === cellDateStr);
                const isPlannedOrSwap = Boolean(myApprovedSwap || myPlannedShift);

                let cellStyle = 'bg-white border border-[#d9dbe0] text-[#111111] hover:bg-[#f7f9ff]';
                if (hasShift) {
                  cellStyle = 'bg-[#eef2ff] border border-[#2f63ff] text-[#111111] font-semibold';
                } else if (isPlannedOrSwap) {
                  cellStyle = 'bg-[#f7f9ff] border border-[#111111] text-[#111111] font-semibold';
                } else if (myAvail) {
                  cellStyle = 'bg-amber-50 border border-amber-300 text-[#b45309] font-medium';
                }

                if (isSelected) {
                  cellStyle += ' ring-2 ring-[#111111] ring-offset-1 ring-offset-white';
                } else if (isToday) {
                  cellStyle += ' ring-2 ring-[#2f63ff]';
                }

                // Single clean primary marker bar under the date number
                let markerColor = '';
                if (hasShift) markerColor = 'bg-[#2f63ff]';
                else if (isPlannedOrSwap) markerColor = 'bg-[#111111]';
                else if (myAvail) markerColor = 'bg-amber-400';

                return (
                  <button
                    key={`day-${dayNum}`}
                    onClick={() => setSelectedDayNum(dayNum)}
                    className={`aspect-square rounded flex flex-col items-center justify-center relative cursor-pointer transition-colors select-none ${cellStyle}`}
                  >
                    <span className={`text-xs font-mono tabular-nums ${isToday ? 'font-bold underline decoration-[#2f63ff] decoration-2 underline-offset-2' : ''}`}>
                      {dayNum}
                    </span>

                    {markerColor && (
                      <span className={`mt-1 w-3.5 h-1 rounded-xs ${markerColor}`} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Simplified 4-item Calendar Legend Bar */}
            <div className="flex items-center gap-3.5 text-[11px] text-[#2d313b] flex-wrap pt-3 mt-3 border-t border-[#e5e7eb]">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-3 h-1.5 rounded-xs bg-[#2f63ff]" />
                <span>Отработана ({formatShiftCountRu(empMonthRecordsMap.size)})</span>
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-3 h-1.5 rounded-xs bg-[#111111]" />
                <span>План / Биржа ({formatShiftCountRu(empMonthPlannedOrSwapCount)})</span>
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-3 h-1.5 rounded-xs bg-amber-400" />
                <span>Пожелание</span>
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs ring-2 ring-[#2f63ff] bg-[#eef2ff]" />
                <span>Сегодня</span>
              </span>
            </div>
          </div>

          {/* Right Column: Selected Day Details */}
          <div className="md:col-span-5 space-y-3">
            {selectedDayAvail && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-md text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[#b45309] flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#b45309]" />
                    <span>Пожелание на день</span>
                  </span>
                  <strong className="font-semibold text-[#111111]">
                    {
                      {
                        study: 'Учёба / Сессия',
                        vacation: 'Отпуск / Отгул',
                        sick: 'Больничный',
                        unavailable: 'Личные дела (не могу)',
                        preferred: 'Желаемый день (хочу смену)',
                      }[selectedDayAvail.type] || selectedDayAvail.type
                    }
                  </strong>
                </div>
                {selectedDayAvail.comment && (
                  <p className="text-[11px] text-[#2d313b] italic pt-0.5">&ldquo;{selectedDayAvail.comment}&rdquo;</p>
                )}
              </div>
            )}

            {selectedDayRecord ? (() => {
              const breakdown = calculateShiftBreakdown(selectedDayRecord, currentStaff, rates);
              return (
                <div className="border border-[#d9dbe0] rounded-md bg-white overflow-hidden">
                  {/* Header info */}
                  <div className="p-3.5 bg-[#f7f9ff] flex items-center justify-between border-b border-[#e5e7eb] gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-[#5d6270]">Детали смены</div>
                      <div className="text-sm font-bold text-[#111111] font-mono tabular-nums">{formatDateDDMMYYYY(selectedDayRecord.date)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-semibold text-[#2f63ff]">
                        {getShiftLabel(selectedDayRecord.shiftType, rates)}
                      </div>
                      <div className="text-[11px] text-[#5d6270] font-mono">
                        {selectedDayRecord.location || 'Склад'}{selectedDayRecord.zone ? ` · ${selectedDayRecord.zone}` : ''}
                      </div>
                    </div>
                  </div>

                  {/* Warehouse Breakdown Rows */}
                  <div className="divide-y divide-[#e5e7eb] text-xs">
                    <div className="p-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-[#111111] flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#2f63ff]" />
                          <span>Базовая оплата</span>
                        </div>
                        <div className="text-[11px] text-[#5d6270] font-mono tabular-nums mt-0.5">
                          {breakdown.workedHours} ч · чекин {selectedDayRecord.checkedInAt ? selectedDayRecord.checkedInAt.slice(11, 16) : '08:00'}
                        </div>
                      </div>
                      <div className="font-bold font-mono tabular-nums text-[#111111]">
                        {formatCurrency(breakdown.basePay)}
                      </div>
                    </div>

                    <div className="p-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-[#111111] flex items-center gap-1.5">
                          {breakdown.isNight ? (
                            <Moon className="w-3.5 h-3.5 text-indigo-700" />
                          ) : (
                            <Sun className="w-3.5 h-3.5 text-[#b45309]" />
                          )}
                          <span>Надбавки и доплаты</span>
                        </div>
                        <div className="text-[11px] text-[#5d6270] mt-0.5">
                          {breakdown.isNight ? 'Ночная смена' : 'Дневная смена'}
                        </div>
                      </div>
                      <div className="font-bold font-mono tabular-nums text-[#111111]">
                        {breakdown.nightBonus > 0 ? `+${formatCurrency(breakdown.nightBonus)}` : '0 ₽'}
                      </div>
                    </div>

                    <div className="p-3 bg-[#eef2ff] flex items-center justify-between gap-2">
                      <div className="font-bold text-[#2f63ff] flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-[#2f63ff]" />
                        <span>Итого за смену</span>
                      </div>
                      <div className="text-sm font-bold font-mono tabular-nums text-[#2f63ff]">
                        {formatCurrency(breakdown.total)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })() : selectedDateString && swaps.find(s => s.candidateId === currentStaffId && s.status === 'approved' && s.date === selectedDateString) ? (() => {
              const approvedSwap = swaps.find(s => s.candidateId === currentStaffId && s.status === 'approved' && s.date === selectedDateString)!;
              return (
                <div className="p-4 bg-[#f7f9ff] border border-[#2f63ff] rounded-md space-y-3">
                  <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-2.5 gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-[#2f63ff] flex items-center gap-1">
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>Смена с Биржи</span>
                      </div>
                      <div className="text-sm font-bold text-[#111111] font-mono tabular-nums">{formatDateDDMMYYYY(selectedDateString)}</div>
                    </div>
                    <span className="text-xs font-semibold font-mono text-[#111111]">
                      Склад {approvedSwap.location}
                    </span>
                  </div>

                  <div className="text-xs space-y-1.5 text-[#2d313b]">
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5d6270]">Категория:</span>
                      <span className="font-semibold text-[#111111] text-right">{getShiftLabel(approvedSwap.shiftType, rates)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5d6270]">Передал замену:</span>
                      <span className="font-semibold text-[#111111] text-right">{approvedSwap.requesterName}</span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium rounded text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Замена согласована. Выход на склад {approvedSwap.location}.</span>
                  </div>
                </div>
              );
            })() : selectedDateString && schedules.find(s => s.employeeId === currentStaffId && s.date === selectedDateString) ? (() => {
              const planned = schedules.find(s => s.employeeId === currentStaffId && s.date === selectedDateString)!;
              return (
                <div className="p-4 bg-[#f7f9ff] border border-[#111111] rounded-md space-y-2.5">
                  <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-2.5 gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-[#111111] flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#2f63ff]" />
                        <span>Плановая смена</span>
                      </div>
                      <div className="text-sm font-bold text-[#111111] font-mono tabular-nums">{formatDateDDMMYYYY(selectedDateString)}</div>
                    </div>
                    <span className="text-xs font-semibold font-mono text-[#2f63ff]">
                      Склад {planned.location}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="text-[#5d6270]">Категория смены:</span>
                    <span className="font-semibold text-[#111111]">{getShiftLabel(planned.shiftType, rates)}</span>
                  </div>
                </div>
              );
            })() : (
              <div className="p-5 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-center text-xs text-[#5d6270] h-full flex flex-col justify-center min-h-[180px] space-y-2">
                {selectedDayNum ? (
                  <div>
                    <p className="font-bold text-[#111111] font-mono tabular-nums">
                      {String(selectedDayNum).padStart(2, '0')}.{String(calendarMonth + 1).padStart(2, '0')}.{calendarYear}
                    </p>
                    {!selectedDayAvail && (
                      <p className="text-[11px] text-[#5d6270] my-1">Смена не зафиксирована.</p>
                    )}
                    <button
                      onClick={() => setIsAvailOpen(true)}
                      className="mt-2 text-xs text-[#2f63ff] hover:text-[#1f4fe0] underline font-semibold cursor-pointer"
                    >
                      + Указать пожелание на этот день
                    </button>
                  </div>
                ) : (
                  <p>Выберите день на календаре для просмотра деталей смены</p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Modals */}
      <CheckInModal
        isOpen={isCheckInOpen}
        onClose={() => setIsCheckInOpen(false)}
        onCheckIn={(shiftType, location, initialCash, cashNotes, options) =>
          performCheckIn(currentStaffId, shiftType, location, undefined, initialCash, cashNotes, options)
        }
        onCancelCheckIn={() => cancelCheckIn(currentStaffId)}
        currentShift={todayRecord?.shiftType || null}
        currentLocation={todayRecord?.location || null}
        currentZone={todayRecord?.zone || null}
        currentQrVerified={Boolean(todayRecord?.qrVerified)}
        currentGeoVerified={Boolean(todayRecord?.geoVerified)}
        availableLocations={effectiveStaffLocations}
        initialCashVal={todayRecord?.initialCash}
        editCount={editCount}
        cancelCount={cancelCount}
        hasCancelledToday={hasUsedCancel}
        onContactManager={() => setIsMessageOpen(true)}
      />

      <CheckOutModal
        isOpen={isCheckOutOpen}
        onClose={() => setIsCheckOutOpen(false)}
        todayRecord={todayRecord || null}
        currentStaff={currentStaff}
        onConfirmCheckOut={(data) => performCheckOut(currentStaffId, todayRecord?.id, data)}
      />

      <AvailabilityModal
        isOpen={isAvailOpen}
        onClose={() => setIsAvailOpen(false)}
        defaultDate={selectedDateString}
      />

      <EmployeeSwapModal
        isOpen={isSwapOpen}
        onClose={() => setIsSwapOpen(false)}
        defaultDate={selectedDateString}
      />

      <MessageManagerModal
        isOpen={isMessageOpen}
        onClose={() => setIsMessageOpen(false)}
      />

      <ShiftStatsView
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
      />

    </div>
  );
};
