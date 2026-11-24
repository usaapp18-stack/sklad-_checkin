import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  formatCurrency,
  calculateShiftBreakdown,
  getShiftLabel,
} from '../../utils/calculations';
import { formatDisplayDate, parseDateSafe } from '../../utils/time';
import { CustomSelect } from '../common/CustomSelect';
import {
  Users,
  Clock,
  QrCode,
  MapPin,
  ShieldCheck,
  Building2,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Search,
  X,
} from 'lucide-react';

type StatusFilter = 'all' | 'attention' | 'on_shift' | 'completed';

export const TodayView: React.FC = () => {
  const { staffList, records, todayDate, rates, pickupPoints = [], schedules = [] } = useApp();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const activeStaff = staffList.filter(s => s.status === 'active');
  const hasAnyScheduleToday = schedules.some(s => s.date === todayDate);

  const {
    staffRows,
    dayTotalSalary,
    dayTotalBaseSalary,
    dayTotalNightBonus,
    dayTotalWorkedHours,
    checkedInCount,
    onShiftCount,
    completedCount,
    attentionCount,
    dayQrVerifiedCount,
    dayGpsVerifiedCount,
  } = useMemo(() => {
    let totalSalarySum = 0;
    let totalBaseSum = 0;
    let totalNightSum = 0;
    let totalHoursSum = 0;
    let checkedIn = 0;
    let onShift = 0;
    let completed = 0;
    let attention = 0;
    let qrCount = 0;
    let gpsCount = 0;

    const rows = activeStaff.map(staff => {
      const employeeRecords = records.filter(r => r.employeeId === staff.id && r.date === todayDate);
      const record = employeeRecords.length > 0 ? employeeRecords[employeeRecords.length - 1] : undefined;
      const scheduledToday = schedules.find(
        s => String(s.employeeId) === String(staff.id) && s.date === todayDate
      );

      const hasCheckedIn = !!record?.shiftType;
      const isCompleted = hasCheckedIn && !!record?.checkOutAt;
      const isMissingScheduled = hasAnyScheduleToday ? (!!scheduledToday && !hasCheckedIn) : !hasCheckedIn;
      const isUnverifiedCheckIn = hasCheckedIn && !record?.qrVerified && !record?.geoVerified;
      const needsAttention = isMissingScheduled || isUnverifiedCheckIn;

      if (needsAttention) attention++;

      let baseSalary = 0;
      let nightBonus = 0;
      let totalSalary = 0;
      let workedHours = 0;

      if (hasCheckedIn && record?.shiftType) {
        checkedIn++;
        if (isCompleted) completed++;
        else onShift++;

        if (record.qrVerified) qrCount++;
        if (record.geoVerified) gpsCount++;

        const breakdown = calculateShiftBreakdown(record, staff, rates);
        baseSalary = breakdown.basePay;
        nightBonus = breakdown.nightBonus;
        totalSalary = breakdown.total;
        workedHours = breakdown.workedHours;

        totalBaseSum += baseSalary;
        totalNightSum += nightBonus;
        totalSalarySum += totalSalary;
        totalHoursSum += workedHours;
      }

      // Exception-First priority:
      // 0: scheduled today (or expected) & missing check-in
      // 1: checked in without QR and without GPS
      // 2: active on shift
      // 3: off-schedule & not checked in
      // 4: completed
      let priority = 3;
      if (isMissingScheduled) priority = 0;
      else if (isUnverifiedCheckIn) priority = 1;
      else if (hasCheckedIn && !isCompleted) priority = 2;
      else if (!hasCheckedIn) priority = 3;
      else priority = 4;

      const pos =
        staff.position ||
        (staff.isSenior ? 'Старший смены' : staff.isPartTime ? 'Подработчик' : 'Работник склада');

      const warehouseCode =
        (hasCheckedIn && record?.location) ||
        scheduledToday?.location ||
        staff.location ||
        (staff.locations && staff.locations[0]) ||
        '';

      return {
        staff,
        record,
        scheduledToday,
        hasCheckedIn,
        isCompleted,
        isMissingScheduled,
        isUnverifiedCheckIn,
        needsAttention,
        priority,
        pos,
        warehouseCode,
        baseSalary,
        nightBonus,
        totalSalary,
        workedHours,
      };
    });

    rows.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.staff.name.localeCompare(b.staff.name, 'ru');
    });

    return {
      staffRows: rows,
      dayTotalSalary: totalSalarySum,
      dayTotalBaseSalary: totalBaseSum,
      dayTotalNightBonus: totalNightSum,
      dayTotalWorkedHours: totalHoursSum,
      checkedInCount: checkedIn,
      onShiftCount: onShift,
      completedCount: completed,
      attentionCount: attention,
      dayQrVerifiedCount: qrCount,
      dayGpsVerifiedCount: gpsCount,
    };
  }, [activeStaff, records, todayDate, schedules, rates, hasAnyScheduleToday]);

  const warehouseOptions = useMemo(() => {
    const activePoints = pickupPoints.filter((p: any) => p.active !== false && !p.isArchived);
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [{ value: 'all', label: 'Все склады' }];
    activePoints.forEach((p: any) => {
      if (p.code && !seen.has(p.code)) {
        seen.add(p.code);
        opts.push({ value: p.code, label: `${p.code} — ${p.name}` });
      }
    });
    return opts;
  }, [pickupPoints]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staffRows.filter(row => {
      if (statusFilter === 'attention' && !row.needsAttention) return false;
      if (statusFilter === 'on_shift' && !(row.hasCheckedIn && !row.isCompleted)) return false;
      if (statusFilter === 'completed' && !row.isCompleted) return false;

      if (selectedWarehouse !== 'all') {
        const staffLocs = row.staff.locations || (row.staff.location ? [row.staff.location] : []);
        const matchesPrimary = row.warehouseCode === selectedWarehouse;
        const matchesAssigned = staffLocs.includes(selectedWarehouse);
        if (!matchesPrimary && !matchesAssigned) return false;
      }

      if (q) {
        const matchesName = row.staff.name.toLowerCase().includes(q);
        const matchesPos = row.pos.toLowerCase().includes(q);
        const matchesZone = (row.record?.zone || '').toLowerCase().includes(q);
        const matchesWh = row.warehouseCode.toLowerCase().includes(q);
        if (!matchesName && !matchesPos && !matchesZone && !matchesWh) return false;
      }

      return true;
    });
  }, [staffRows, statusFilter, selectedWarehouse, searchQuery]);

  const hasActiveFilters = statusFilter !== 'all' || selectedWarehouse !== 'all' || searchQuery.trim() !== '';

  const filteredSalaryTotal = filteredRows.reduce((sum, r) => sum + r.totalSalary, 0);
  const filteredHoursTotal = filteredRows.reduce((sum, r) => sum + r.workedHours, 0);
  const filteredQrCount = filteredRows.filter(r => r.hasCheckedIn && r.record?.qrVerified).length;
  const filteredGpsCount = filteredRows.filter(r => r.hasCheckedIn && r.record?.geoVerified).length;

  return (
    <div className="space-y-5 text-[#111111]">

      {/* Top Unified Warehouse KPI Summary Strip */}
      <div className="bg-white border border-[#d9dbe0] rounded-md grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#d9dbe0] overflow-hidden">

        {/* KPI 1: Presence & Attendance */}
        <div className="p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#5d6270] font-semibold">
            <span>Явка на смену</span>
            <Users className="w-4 h-4 text-[#2f63ff]" />
          </div>
          <div className="text-2xl font-bold text-[#111111] font-mono tabular-nums tracking-tight mt-1">
            {checkedInCount} <span className="text-xs font-normal text-[#5d6270] font-sans">из {activeStaff.length}</span>
          </div>
          <div className="text-xs text-[#5d6270] mt-1.5 flex items-center gap-1.5 font-mono flex-wrap">
            <span className="text-[#111111] font-semibold">На смене: {onShiftCount}</span>
            <span>·</span>
            <span className="text-[#2d313b]">Завершили: {completedCount}</span>
          </div>
        </div>

        {/* KPI 2: Worked Hours */}
        <div className="p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#5d6270] font-semibold">
            <span>Отработано часов сегодня</span>
            <Clock className="w-4 h-4 text-[#2f63ff]" />
          </div>
          <div className="text-2xl font-bold text-[#111111] font-mono tabular-nums tracking-tight mt-1">
            {dayTotalWorkedHours} ч
          </div>
          <div className="text-xs text-[#5d6270] mt-1.5 truncate">
            {checkedInCount > 0 ? `В среднем ${(dayTotalWorkedHours / checkedInCount).toFixed(1)} ч / работник` : 'Ожидание выходов'}
          </div>
        </div>

        {/* KPI 3: Checkpoint Verification */}
        <div className="p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#5d6270] font-semibold">
            <span>Аудит проходной</span>
            <ShieldCheck className="w-4 h-4 text-[#2f63ff]" />
          </div>
          <div className="text-2xl font-bold text-[#111111] font-mono tabular-nums tracking-tight mt-1 flex items-center gap-3">
            <span className="flex items-center gap-1 text-[#111111] text-xl" title="Явок с QR">
              <QrCode className="w-4 h-4 text-[#2f63ff]" /> {dayQrVerifiedCount}
            </span>
            <span className="text-[#d9dbe0]">/</span>
            <span className="flex items-center gap-1 text-[#2d313b] text-xl" title="Явок с GPS">
              <MapPin className="w-4 h-4 text-[#5d6270]" /> {dayGpsVerifiedCount}
            </span>
          </div>
          <div className="text-xs text-[#5d6270] mt-1.5">
            {attentionCount > 0 ? (
              <span className="text-[#b45309] font-medium">Требуют внимания: {attentionCount}</span>
            ) : (
              <span>QR проходная и GPS геопозиция</span>
            )}
          </div>
        </div>

        {/* KPI 4: Today's Payroll */}
        <div className="p-4 sm:p-5 flex flex-col justify-between bg-[#eef2ff]/60">
          <div className="flex items-center justify-between text-xs text-[#2f63ff] font-semibold">
            <span>ФОТ за сегодня</span>
            <DollarSign className="w-4 h-4 text-[#2f63ff]" />
          </div>
          <div className="text-2xl font-bold text-[#2f63ff] font-mono tabular-nums tracking-tight mt-1">
            {formatCurrency(dayTotalSalary)}
          </div>
          <div className="text-xs text-[#2d313b] mt-1.5 font-mono tabular-nums">
            База {formatCurrency(dayTotalBaseSalary)} · Ночь +{formatCurrency(dayTotalNightBonus)}
          </div>
        </div>

      </div>

      {/* Staff Warehouse Shifts Online Monitoring Table */}
      <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
        {/* Header & Controls */}
        <div className="p-4 border-b border-[#d9dbe0] space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#2f63ff]" />
                <span>Оперативный мониторинг смены склада</span>
              </h3>
              <p className="text-xs text-[#5d6270] mt-0.5">{formatDisplayDate(todayDate)} (МСК)</p>
            </div>
            <span className="text-xs text-[#5d6270] font-mono tabular-nums">
              Показано: <strong className="text-[#111111]">{filteredRows.length}</strong> из {activeStaff.length}
            </span>
          </div>

          {/* Filter & Search Toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pt-1">
            {/* Status Segmented Tabs */}
            <div className="inline-flex items-center gap-1 p-1 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  statusFilter === 'all'
                    ? 'bg-[#111111] text-white'
                    : 'text-[#5d6270] hover:text-[#111111]'
                }`}
              >
                Все ({activeStaff.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('attention')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  statusFilter === 'attention'
                    ? 'bg-[#111111] text-white'
                    : 'text-[#5d6270] hover:text-[#111111]'
                }`}
              >
                <span>Требуют внимания</span>
                <span className={`font-mono tabular-nums ${
                  statusFilter === 'attention'
                    ? 'text-amber-300'
                    : attentionCount > 0
                    ? 'text-[#b45309] font-bold'
                    : 'text-[#5d6270]'
                }`}>
                  {attentionCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('on_shift')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  statusFilter === 'on_shift'
                    ? 'bg-[#111111] text-white'
                    : 'text-[#5d6270] hover:text-[#111111]'
                }`}
              >
                На смене ({onShiftCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('completed')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  statusFilter === 'completed'
                    ? 'bg-[#111111] text-white'
                    : 'text-[#5d6270] hover:text-[#111111]'
                }`}
              >
                Завершили ({completedCount})
              </button>
            </div>

            {/* Warehouse & Search Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {warehouseOptions.length > 1 && (
                <div className="sm:w-52 shrink-0">
                  <CustomSelect
                    size="sm"
                    value={selectedWarehouse}
                    onChange={setSelectedWarehouse}
                    options={warehouseOptions}
                    menuHeaderTitle="Фильтр по складу"
                  />
                </div>
              )}

              <div className="relative flex-1 sm:w-56">
                <Search className="w-3.5 h-3.5 text-[#5d6270] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Имя, должность или участок..."
                  className="w-full h-8 pl-8 pr-7 bg-[#f7f9ff] border border-[#d9dbe0] focus:border-[#2f63ff] rounded text-xs text-[#111111] placeholder:text-[#5d6270]/75 outline-none transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Очистить поиск"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5d6270] hover:text-[#111111] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {filteredRows.length === 0 ? (
            <div className="p-8 text-center space-y-2.5">
              <p className="text-xs font-medium text-[#5d6270]">
                По выбранным фильтрам сотрудников не найдено.
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('all');
                    setSelectedWarehouse('all');
                    setSearchQuery('');
                  }}
                  className="px-3 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] rounded text-xs font-semibold text-[#111111] cursor-pointer transition-colors"
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#d9dbe0] text-xs font-semibold text-[#5d6270] bg-[#f7f9ff] uppercase tracking-wider">
                  <th className="py-2.5 px-4 font-semibold">Сотрудник и роль</th>
                  <th className="py-2.5 px-4 font-semibold">Склад / Зона</th>
                  <th className="py-2.5 px-4 font-semibold">Статус смены</th>
                  <th className="py-2.5 px-4 font-semibold">Тип смены</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Отработано</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Проходная</th>
                  <th className="py-2.5 px-4 font-semibold text-right whitespace-nowrap min-w-[110px]">Начислено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb] text-xs">
                {filteredRows.map(({
                  staff,
                  record,
                  scheduledToday,
                  hasCheckedIn,
                  isCompleted,
                  isMissingScheduled,
                  isUnverifiedCheckIn,
                  pos,
                  warehouseCode,
                  totalSalary,
                  workedHours,
                }) => {
                  const checkInTime = record?.checkedInAt || record?.timestamp;
                  const checkOutTime = record?.checkOutAt;

                  return (
                    <tr
                      key={staff.id}
                      className={`transition-colors hover:bg-[#f7f9ff] ${
                        isMissingScheduled || isUnverifiedCheckIn ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      {/* Staff & Role (clean unboxed metadata) */}
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-[#111111]">{staff.name}</div>
                        <div className="text-[11px] text-[#5d6270] flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[#2d313b]">{pos}</span>
                          {staff.isSenior && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-[#2f63ff]">Старший</span>
                            </>
                          )}
                          {staff.isPartTime && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-[#b45309]">Подработчик</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Workplace Location & Zone */}
                      <td className="py-2.5 px-4">
                        {hasCheckedIn && record?.location ? (
                          <div>
                            <div className="font-mono font-semibold text-[#111111]">{record.location}</div>
                            <div className="text-[11px] text-[#5d6270]">{record.zone || 'Основная зона'}</div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-mono text-[#5d6270]">{warehouseCode || '—'}</div>
                            {scheduledToday && (
                              <div className="text-[11px] text-[#b45309]">По плану на сегодня</div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Check-in / Shift Status */}
                      <td className="py-2.5 px-4">
                        {hasCheckedIn ? (
                          isCompleted ? (
                            <div className="flex items-center gap-1.5 text-[#2d313b] font-medium whitespace-nowrap">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              <span>
                                Закрыта · <span className="font-mono tabular-nums">{checkOutTime ? parseDateSafe(checkOutTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-[#2f63ff] font-semibold whitespace-nowrap">
                              <Clock className="w-3.5 h-3.5 text-[#2f63ff] shrink-0" />
                              <span>
                                На смене · с <span className="font-mono tabular-nums">{checkInTime ? parseDateSafe(checkInTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                              </span>
                            </div>
                          )
                        ) : isMissingScheduled ? (
                          <div className="flex items-center gap-1.5 text-[#b45309] font-semibold whitespace-nowrap">
                            <AlertTriangle className="w-3.5 h-3.5 text-[#b45309] shrink-0" />
                            <span>{hasAnyScheduleToday ? 'По графику, нет чекина' : 'Ожидает чекина'}</span>
                          </div>
                        ) : (
                          <span className="text-[#5d6270]">Нет отметки</span>
                        )}
                      </td>

                      {/* Shift Type */}
                      <td className="py-2.5 px-4">
                        {hasCheckedIn && record?.shiftType ? (
                          <span className="font-semibold text-[#111111]">
                            {getShiftLabel(record.shiftType, rates)}
                          </span>
                        ) : scheduledToday?.shiftType ? (
                          <span className="text-[#5d6270]">
                            План: {getShiftLabel(scheduledToday.shiftType, rates)}
                          </span>
                        ) : (
                          <span className="text-[#5d6270]">—</span>
                        )}
                      </td>

                      {/* Worked Hours & Break */}
                      <td className="py-2.5 px-4 text-center">
                        {hasCheckedIn ? (
                          <div>
                            <div className="font-mono tabular-nums font-bold text-[#111111]">
                              {workedHours} ч
                            </div>
                            <div className="text-[11px] text-[#5d6270]">
                              Перерыв {record?.breakMinutes !== undefined ? record.breakMinutes : 60} мин
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#5d6270] font-mono">—</span>
                        )}
                      </td>

                      {/* Checkpoint Verification (clean text, no boxed pills) */}
                      <td className="py-2.5 px-4 text-center font-mono tabular-nums text-[11px]">
                        {hasCheckedIn ? (
                          isUnverifiedCheckIn ? (
                            <span className="text-[#b45309] font-semibold font-sans" title="Нет подтверждения ни по QR, ни по GPS">
                              Без QR и GPS
                            </span>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 ${record?.qrVerified ? 'text-[#2f63ff] font-semibold' : 'text-[#5d6270]'}`}
                                title={record?.qrVerified ? 'QR склада подтверждён' : 'Без QR'}
                              >
                                <QrCode className="w-3 h-3" />
                                <span>{record?.qrVerified ? 'Да' : 'Нет'}</span>
                              </span>
                              <span className="text-[#d9dbe0]">·</span>
                              <span
                                className={`inline-flex items-center gap-1 ${record?.geoVerified ? 'text-[#2f63ff] font-semibold' : 'text-[#5d6270]'}`}
                                title={record?.geoVerified ? 'GPS координаты подтверждены' : 'Без GPS'}
                              >
                                <MapPin className="w-3 h-3" />
                                <span>{record?.geoVerified ? 'Да' : 'Нет'}</span>
                              </span>
                            </div>
                          )
                        ) : (
                          <span className="text-[#5d6270]">—</span>
                        )}
                      </td>

                      {/* Shift Salary */}
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-[#111111] whitespace-nowrap">
                        {hasCheckedIn ? (
                          <div>
                            <div className="whitespace-nowrap">{formatCurrency(totalSalary)}</div>
                            <div className="text-[11px] text-[#5d6270] font-normal">
                              {staff.payType === 'hourly'
                                ? `${staff.hourlyRate || 350} ₽/ч`
                                : `${staff.shiftRate || 3500} ₽/см`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#5d6270] font-normal">—</span>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#d9dbe0] bg-[#f7f9ff] font-semibold text-xs">
                  <td colSpan={4} className="py-3 px-4 text-[#2d313b]">
                    {hasActiveFilters ? 'Итого по выборке:' : 'Итого за сегодня по складу:'}
                  </td>
                  <td className="py-3 px-4 text-center font-mono tabular-nums text-[#111111] font-bold">
                    {filteredHoursTotal} ч
                  </td>
                  <td className="py-3 px-4 text-center font-mono tabular-nums text-[#5d6270] text-[11px]">
                    QR: {filteredQrCount} · GPS: {filteredGpsCount}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-[#2f63ff] text-sm font-bold whitespace-nowrap">
                    {formatCurrency(filteredSalaryTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

    </div>
  );
};
