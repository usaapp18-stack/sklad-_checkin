import React, { useState, useMemo, useEffect } from 'react';
import { PickupPoint, StaffMember, PlannedShift, ShiftType, AvailabilityRequest, ShiftSwapRequest } from '../../types';
import { CustomSelect } from '../common/CustomSelect';
import {
  X,
  MapPin,
  AlertTriangle,
  Info,
  CheckCircle2,
  Users,
  Layers,
  Calendar as CalendarIcon,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  FileDown,
  ArrowLeftRight,
  ChevronDown,
} from 'lucide-react';
import {
  generateSchedulePlan,
  DayInfo,
  ScheduleType,
  Weekend52Mode,
  ReinforcementMode,
  ThreeStaffScenario,
  GeneratorResult,
} from '../../utils/scheduleGenerator';
import { exportScheduleToPdf } from '../../utils/schedulePdfExporter';

function formatShortName(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1][0]}.`;
  }
  return parts[0];
}

interface ScheduleGeneratorWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthStr: string;
  monthName: string;
  daysList: DayInfo[];
  activePvzs: PickupPoint[];
  staffList: StaffMember[];
  availability: AvailabilityRequest[];
  getStaffForPvz: (pvzCode: string) => StaffMember[];
  existingShifts?: PlannedShift[];
  swapRequests?: ShiftSwapRequest[];
  onApplySchedule: (
    shifts: PlannedShift[],
    template?: {
      name: string;
      location: string;
      scenarioType: any;
      mainStaffIds: string[];
      defaultShiftType: ShiftType;
      notes: string;
    }
  ) => Promise<void>;
  loading: boolean;
  initialPvz?: string;
}

export const ScheduleGeneratorWizardModal: React.FC<ScheduleGeneratorWizardModalProps> = ({
  isOpen,
  onClose,
  monthStr,
  monthName,
  daysList,
  activePvzs,
  staffList,
  availability,
  getStaffForPvz,
  existingShifts = [],
  swapRequests = [],
  onApplySchedule,
  loading,
  initialPvz,
}) => {
  // Stepper: 1..3 (1: Склад и схема, 2: Команда и правила, 3: Предпросмотр и правка)
  const [step, setStep] = useState<number>(1);

  // Step 1: Location
  const [location, setLocation] = useState<string>(() => {
    return initialPvz && initialPvz !== 'ALL' ? initialPvz : (activePvzs[0]?.code || '');
  });

  // Step 2: Schedule Type & Cycle
  const [scheduleType, setScheduleType] = useState<ScheduleType>('2/2');
  const [startCycleDay, setStartCycleDay] = useState<number>(1);
  const [customWorkDays, setCustomWorkDays] = useState<number>(4);
  const [customRestDays, setCustomRestDays] = useState<number>(2);
  const [weekend52Mode, setWeekend52Mode] = useState<Weekend52Mode>('floating');
  const [manualWeekends52, setManualWeekends52] = useState<Record<string, number[]>>({});

  // Step 3: Staff Selection
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(() => {
    const loc = initialPvz && initialPvz !== 'ALL' ? initialPvz : (activePvzs[0]?.code || '');
    return getStaffForPvz(loc).slice(0, 2).map(s => s.id);
  });
  const [hybridConfig, setHybridConfig] = useState<
    Record<string, { type: '2/2' | '3/3' | '5/2' | 'custom'; workDays?: number; restDays?: number }>
  >({});
  const [expandedStaffWishes, setExpandedStaffWishes] = useState<string | null>(null);
  const [expandedStaffOtherShifts, setExpandedStaffOtherShifts] = useState<string | null>(null);

  // Step 4: Coverage & Reinforcement
  const [baseCoverage, setBaseCoverage] = useState<number>(1);
  const [reinforcementMode, setReinforcementMode] = useState<ReinforcementMode>('none');
  const [reinforcementCoverage, setReinforcementCoverage] = useState<number>(2);
  const [reinforcementDaysOfWeek, setReinforcementDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [threeStaffMode, setThreeStaffMode] = useState<ThreeStaffScenario>('queue');

  // Step 5: Wishes
  const [respectWishes, setRespectWishes] = useState<boolean>(true);
  const [ignoredWishKeys, setIgnoredWishKeys] = useState<string[]>([]);

  // Step 6: Preview & Overrides (Day 12h shift by default)
  const shiftType: ShiftType = 'day12';
  const [manualOverrides, setManualOverrides] = useState<Record<string, string[]>>({});
  const [crossConflictAlert, setCrossConflictAlert] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'calendar' | 'matrix' | 'balance' | 'conflicts'>('calendar');
  const [filterStaffId, setFilterStaffId] = useState<string>('all');
  const [staffDropdownOpen, setStaffDropdownOpen] = useState<boolean>(false);
  const [saveTemplate, setSaveTemplate] = useState<boolean>(false);
  const [templateName, setTemplateName] = useState<string>('');

  // Synchronize when modal is opened for a specific PVZ
  useEffect(() => {
    if (isOpen) {
      const target = initialPvz && initialPvz !== 'ALL' ? initialPvz : (activePvzs[0]?.code || '');
      setLocation(target);
      const eligible = getStaffForPvz(target);
      setSelectedStaffIds(eligible.slice(0, 2).map(s => s.id));
      setStep(1);
      setManualOverrides({});
      setIgnoredWishKeys([]);
    }
  }, [isOpen, initialPvz]);

  // Handle PVZ change
  const handleLocationChange = (newLoc: string) => {
    setLocation(newLoc);
    const eligible = getStaffForPvz(newLoc);
    setSelectedStaffIds(eligible.slice(0, 2).map(s => s.id));
    setManualOverrides({});
  };

  // Toggle ignoring a wish
  const toggleIgnoreWish = (staffId: string, dateStr: string) => {
    const key = `${staffId}_${dateStr}`;
    setIgnoredWishKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  // Manual shift override on calendar click
  const toggleStaffOnDate = (dateStr: string, staffId: string) => {
    const currentAssigned = generatorResult?.dayAnalysis[dateStr]?.assignedStaffIds || [];
    const isCurrentlyAssigned = currentAssigned.includes(staffId);

    // Enforce Rule: If attempting to ADD an employee, check if they already have a shift at another PVZ!
    if (!isCurrentlyAssigned) {
      const busyAtOther = existingShifts.find(
        s => s.employeeId === staffId &&
             s.date === dateStr &&
             s.location !== location &&
             s.location !== activePvzs.find(p => p.code === location)?.name
      );
      if (busyAtOther) {
        const staff = staffList.find(s => s.id === staffId);
        setCrossConflictAlert(
          `Невозможно назначить: сотрудник ${staff?.name || 'Сотрудник'} уже имеет смену на складе «${busyAtOther.location}» на эту дату. Один сотрудник не может работать на двух складах одновременно!`
        );
        return;
      }
    }

    const nextAssigned = isCurrentlyAssigned
      ? currentAssigned.filter(id => id !== staffId)
      : [...currentAssigned, staffId];

    setCrossConflictAlert(null);
    setManualOverrides(prev => ({
      ...prev,
      [dateStr]: nextAssigned,
    }));
  };

  // Compute Generated Plan with full priority logic
  const generatorResult: GeneratorResult | null = useMemo(() => {
    if (!isOpen || !location || selectedStaffIds.length === 0) return null;
    return generateSchedulePlan({
      location,
      monthStr,
      daysList,
      scheduleType,
      startCycleDay,
      customWorkDays,
      customRestDays,
      weekend52Mode,
      manualWeekends52,
      selectedStaffIds,
      staffList,
      hybridStaffConfig: hybridConfig,
      baseCoverage,
      reinforcementMode,
      reinforcementCoverage,
      reinforcementDaysOfWeek,
      threeStaffMode,
      respectWishes,
      availabilityList: availability.filter(a => a.status === 'approved'),
      ignoredWishKeys,
      swapRequests,
      shiftType,
      manualOverrides,
      otherExistingShifts: existingShifts,
    });
  }, [
    isOpen,
    location,
    monthStr,
    daysList,
    scheduleType,
    startCycleDay,
    customWorkDays,
    customRestDays,
    weekend52Mode,
    manualWeekends52,
    selectedStaffIds,
    staffList,
    hybridConfig,
    baseCoverage,
    reinforcementMode,
    reinforcementCoverage,
    reinforcementDaysOfWeek,
    threeStaffMode,
    respectWishes,
    availability,
    ignoredWishKeys,
    swapRequests,
    shiftType,
    manualOverrides,
    existingShifts,
  ]);

  // All Cross-PVZ conflicts occurring in generated shifts for this PVZ
  const allCrossPvzConflicts = useMemo(() => {
    if (!isOpen || !generatorResult) return [];
    const list: {
      dateStr: string;
      dayNum: number;
      dayName: string;
      employeeId: string;
      employeeName: string;
      otherLocation: string;
    }[] = [];

    daysList.forEach(d => {
      const analysis = generatorResult.dayAnalysis[d.dateStr];
      if (analysis?.crossPvzConflicts && analysis.crossPvzConflicts.length > 0) {
        analysis.crossPvzConflicts.forEach(c => {
          list.push({
            dateStr: d.dateStr,
            dayNum: d.dayNum,
            dayName: d.dayName,
            employeeId: c.employeeId,
            employeeName: c.employeeName,
            otherLocation: c.location,
          });
        });
      }
    });

    return list;
  }, [isOpen, generatorResult, daysList]);

  const [isApplying, setIsApplying] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  if (!isOpen) return null;

  const eligibleStaff = getStaffForPvz(location);

  // Download PDF Handler
  const handleDownloadPdf = async () => {
    if (!generatorResult || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const scenarioMap: Record<string, string> = {
        '2/2': 'График 2/2',
        '3/3': 'График 3/3',
        '5/2': 'График 5/2',
        'hybrid': 'Гибридный график',
        'custom': `Пользовательский (${customWorkDays}/${customRestDays})`,
      };
      await exportScheduleToPdf({
        location,
        monthStr,
        monthName,
        daysList,
        generatorResult,
        staffList,
        scenarioTitle: templateName.trim() || scenarioMap[scheduleType] || scheduleType,
      });
    } catch (err) {
      console.error('[ScheduleGenerator] PDF export error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Apply Handler
  const handleApply = async () => {
    if (!generatorResult || generatorResult.shifts.length === 0 || isApplying) return;

    let tplConfig: any = undefined;
    if (saveTemplate && templateName.trim()) {
      tplConfig = {
        name: templateName.trim(),
        location,
        scenarioType: scheduleType === 'hybrid' ? 'custom' : scheduleType,
        mainStaffIds: selectedStaffIds,
        defaultShiftType: shiftType,
        notes: `Сценарий ${scheduleType}, покрытие ${baseCoverage}, усиление ${reinforcementMode}`,
      };
    }

    setIsApplying(true);
    try {
      await onApplySchedule(generatorResult.shifts, tplConfig);
      onClose();
    } catch (err) {
      console.error('[ScheduleGenerator] Apply error:', err);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-hidden">
      <div className="bg-white border-t sm:border border-[#d9dbe0] rounded-t-md sm:rounded-md w-full max-w-5xl max-h-[96dvh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Mobile Drag Handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0 bg-[#f7f9ff]">
          <div className="w-10 h-1 bg-[#d9dbe0] rounded-xs" />
        </div>

        {/* Modal Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-[#e5e7eb] shrink-0 bg-[#f7f9ff]">
          <div>
            <div className="text-sm sm:text-base font-semibold text-[#111111] flex items-center gap-2 flex-wrap">
              <span>Мастер верстки графика смен</span>
              <span className="text-xs font-mono font-medium text-[#5d6270] tabular-nums">
                · {monthName}
              </span>
            </div>
            <div className="text-[11px] text-[#5d6270]">
              Построение графика, учёт пожеланий и ручная корректировка
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded cursor-pointer transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper Bar (3 Consolidated Steps) */}
        <div className="px-3 sm:px-5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            {[
              { num: 1, label: 'Склад и схема' },
              { num: 2, label: 'Команда и правила' },
              { num: 3, label: 'Предпросмотр' },
            ].map(st => {
              const isActive = step === st.num;
              const isDone = step > st.num;
              const isDisabled = (st.num === 2 && !location) || (st.num === 3 && (!location || selectedStaffIds.length === 0));
              return (
                <button
                  key={st.num}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && setStep(st.num)}
                  className={`flex items-center justify-center sm:justify-start gap-2 px-2.5 sm:px-3.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    isDisabled
                      ? 'opacity-45 cursor-not-allowed text-[#5d6270]'
                      : isActive
                      ? 'bg-[#2f63ff] text-white font-semibold cursor-pointer'
                      : isDone
                      ? 'bg-[#111111] text-white hover:bg-[#2d313b] cursor-pointer'
                      : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff] cursor-pointer'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-xs flex items-center justify-center text-xs font-semibold shrink-0 font-mono ${
                      isActive
                        ? 'bg-white text-[#2f63ff]'
                        : isDone
                        ? 'bg-white text-[#111111]'
                        : 'bg-white border border-[#d9dbe0] text-[#5d6270]'
                    }`}
                  >
                    {isDone ? '✓' : st.num}
                  </span>
                  <span className="truncate">{st.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile Step Status Header */}
        <div className="sm:hidden px-3.5 py-1.5 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between text-[11px] text-[#2d313b] shrink-0">
          <span className="font-semibold text-[#111111]">
            Шаг {step} из 3: {
              step === 1 ? 'Склад и схема' :
              step === 2 ? 'Команда и правила' : 'Предпросмотр и правка'
            }
          </span>
          <span className="text-[11px] text-[#2f63ff] font-mono px-2 font-semibold tabular-nums">
            {Math.round((step / 3) * 100)}%
          </span>
        </div>

        {/* Modal Body */}
        <div className="p-3 sm:p-6 space-y-4 text-xs flex-1 overflow-y-auto bg-white">
          
          {/* STEP 1: Склад и схема сменности */}
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-[#111111] mb-1">
                  Шаг 1. Склад и схема графика
                </h3>
                <p className="text-[#5d6270] text-xs">
                  Выберите склад и базовый цикл сменности на {monthName}.
                </p>
              </div>

              <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-3">
                <label className="block text-[#111111] font-semibold text-xs">Склад:</label>
                <CustomSelect
                  value={location}
                  onChange={handleLocationChange}
                  menuHeaderTitle="Выберите склад"
                  options={activePvzs.map(p => ({
                    value: p.code,
                    label: p.name || p.code,
                    sublabel: `Адрес: ${p.address || '—'} · Прикреплено: ${getStaffForPvz(p.code).length} сотр.`,
                  }))}
                />

                {location && (
                  <div className="p-3 bg-white border border-[#d9dbe0] rounded-md flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <MapPin className="w-4 h-4 text-[#2f63ff] shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-[#111111] truncate">
                          {activePvzs.find(p => p.code === location)?.name || location}
                        </div>
                        <div className="text-[11px] text-[#5d6270] truncate">
                          {activePvzs.find(p => p.code === location)?.address || 'Адрес не указан'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span className="text-[#2f63ff] font-mono font-semibold tabular-nums">
                        {eligibleStaff.length}
                      </span>
                      <span className="text-[#5d6270] text-[11px] ml-1">сотр.</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {[
                  { id: '2/2', title: 'Схема 2 / 2', desc: 'Основная ротация 2 раб. через 2 вых.' },
                  { id: '3/3', title: 'Схема 3 / 3', desc: '3 дня раб. через 3 вых.' },
                  { id: '5/2', title: 'Схема 5 / 2', desc: 'Пятидневная неделя с выходными' },
                  { id: 'hybrid', title: 'Гибридный', desc: 'Разные сотрудники по своим графикам' },
                  { id: 'custom', title: 'Кастомный', desc: 'Своя длина рабочего/выходного цикла' },
                ].map(sc => {
                  const isSelected = scheduleType === sc.id;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setScheduleType(sc.id as ScheduleType)}
                      className={`p-3 rounded border text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#111111] border-[#111111] text-white font-semibold'
                          : 'bg-white border-[#d9dbe0] text-[#2d313b] hover:bg-[#f7f9ff] hover:border-[#2f63ff]'
                      }`}
                    >
                      <div className={`text-xs font-mono font-semibold mb-1 ${isSelected ? 'text-[#a9bcff]' : 'text-[#111111]'}`}>
                        {sc.title}
                      </div>
                      <div className={`text-[11px] leading-tight font-normal ${isSelected ? 'text-white/75' : 'text-[#5d6270]'}`}>
                        {sc.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Cycle Start Day & Custom Options */}
              <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[#111111] font-semibold mb-1.5">
                      Дата начала цикла в этом месяце:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max={daysList.length}
                        value={startCycleDay}
                        onChange={e => setStartCycleDay(Math.max(1, Math.min(daysList.length, parseInt(e.target.value) || 1)))}
                        className="w-24 px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono tabular-nums text-center focus:outline-none focus:border-[#2f63ff]"
                      />
                      <span className="text-xs text-[#2d313b]">
                        -е число месяца (влияет на чередование смен)
                      </span>
                    </div>
                  </div>

                  {scheduleType === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[#111111] font-semibold mb-1.5">Рабочих дней:</label>
                        <input
                          type="number"
                          min="1"
                          max="14"
                          value={customWorkDays}
                          onChange={e => setCustomWorkDays(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono tabular-nums text-center focus:outline-none focus:border-[#2f63ff]"
                        />
                      </div>
                      <div>
                        <label className="block text-[#111111] font-semibold mb-1.5">Выходных дней:</label>
                        <input
                          type="number"
                          min="1"
                          max="14"
                          value={customRestDays}
                          onChange={e => setCustomRestDays(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono tabular-nums text-center focus:outline-none focus:border-[#2f63ff]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 5/2 Weekend Strategy */}
                {scheduleType === '5/2' && (
                  <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                    <label className="block text-[#111111] font-semibold">Тип выходных для графика 5/2:</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'floating', title: 'Плавающие выходные', desc: 'Система сама балансирует дни, чтобы покрытие смен склада не страдало' },
                        { id: 'fixed', title: 'Фиксированные (Сб+Вс)', desc: 'Классические выходные в субботу и воскресенье' },
                        { id: 'manual', title: 'Ручной выбор', desc: 'Персональная настройка дней отдыха сотрудникам' },
                      ].map(opt => {
                        const isSelected = weekend52Mode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setWeekend52Mode(opt.id as Weekend52Mode)}
                            className={`p-2.5 rounded border text-left cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#111111] border-[#111111] text-white font-semibold'
                                : 'bg-white border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                            }`}
                          >
                            <div className={`text-xs mb-0.5 font-semibold ${isSelected ? 'text-[#a9bcff]' : 'text-[#111111]'}`}>
                              {opt.title}
                            </div>
                            <div className={`text-[10px] ${isSelected ? 'text-white/75' : 'text-[#5d6270]'}`}>
                              {opt.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Команда, покрытие и пожелания */}
          {step === 2 && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm sm:text-base font-semibold text-[#111111] mb-1">
                    Шаг 2. Команда и правила для {location}
                  </h3>
                  <p className="text-[#5d6270] text-xs">
                    Отметьте участников смены, задайте покрытие и учёт пожеланий.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStaffIds(eligibleStaff.map(s => s.id))}
                    className="px-2.5 py-1 text-[11px] bg-[#111111] hover:bg-[#2d313b] text-white font-medium rounded cursor-pointer transition-colors"
                  >
                    Выбрать всех
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStaffIds([])}
                    className="px-2.5 py-1 text-[11px] bg-white hover:bg-[#eef2ff] text-[#2d313b] border border-[#d9dbe0] font-medium rounded cursor-pointer transition-colors"
                  >
                    Снять выбор
                  </button>
                </div>
              </div>

              {/* Staff List */}
              {eligibleStaff.length === 0 ? (
                <div className="p-6 text-center text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                  К данному складу не прикреплено ни одного сотрудника в разделе «Сотрудники».
                </div>
              ) : (
                <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] overflow-hidden">
                  {eligibleStaff.map(s => {
                    const isSelected = selectedStaffIds.includes(s.id);
                    
                    // Only display wishes that the manager has APPROVED
                    const staffMonthWishes = availability.filter(
                      a => a.employeeId === s.id && a.date.startsWith(monthStr) && a.type !== 'preferred' && a.status === 'approved'
                    );
                    const staffPendingWishes = availability.filter(
                      a => a.employeeId === s.id && a.date.startsWith(monthStr) && a.type !== 'preferred' && (!a.status || a.status === 'pending')
                    );
                    const hasWishes = staffMonthWishes.length > 0;

                    // Shifts already scheduled for this employee at OTHER PVZs in this month
                    const staffOtherPvzShifts = (existingShifts || []).filter(
                      shift => shift.employeeId === s.id && shift.date.startsWith(monthStr) && shift.location !== location
                    );
                    const hasOtherPvzShifts = staffOtherPvzShifts.length > 0;

                    return (
                      <div
                        key={s.id}
                        className={`p-3 transition-colors ${
                          isSelected
                            ? 'bg-[#f7f9ff]/70'
                            : 'bg-white opacity-75'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <label className="flex items-center gap-3 cursor-pointer flex-1 select-none">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                if (isSelected) {
                                  setSelectedStaffIds(prev => prev.filter(id => id !== s.id));
                                } else {
                                  setSelectedStaffIds(prev => [...prev, s.id]);
                                }
                              }}
                              className="w-4 h-4 rounded-xs bg-white border-[#d9dbe0] text-[#2f63ff] accent-[#2f63ff] cursor-pointer"
                            />
                            <div>
                              <div className="font-semibold text-[#111111] flex items-center gap-1.5 flex-wrap">
                                <span>{s.name}</span>
                                {s.isSenior && (
                                  <span className="text-[11px] text-[#b45309] font-medium">
                                    · Старший
                                  </span>
                                )}
                                {s.isPartTime && (
                                  <span className="text-[11px] text-indigo-700 font-medium">
                                    · Подработка
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#5d6270] font-mono">
                                {s.login}
                              </div>
                            </div>
                          </label>

                          {/* Indicators: Other PVZs & Approved Wishes */}
                          <div className="flex items-center gap-2.5 flex-wrap self-start sm:self-auto">
                            {/* Other PVZ indicator */}
                            {hasOtherPvzShifts && (
                              <button
                                type="button"
                                onClick={() => setExpandedStaffOtherShifts(expandedStaffOtherShifts === s.id ? null : s.id)}
                                className="px-2.5 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-indigo-100 transition-colors"
                                title="Сотрудник уже задействован на других складах в этом месяце"
                              >
                                <MapPin className="w-3.5 h-3.5 text-indigo-700" />
                                <span>{staffOtherPvzShifts.length} смен на др. складах</span>
                              </button>
                            )}

                            {hasWishes ? (
                              <button
                                type="button"
                                onClick={() => setExpandedStaffWishes(expandedStaffWishes === s.id ? null : s.id)}
                                className="px-2.5 py-1 rounded bg-[#eef2ff] border border-[#a9bcff] text-[#2f63ff] text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-[#dbe4ff] transition-colors"
                                title="Посмотреть одобренные даты (только они исключаются из графика)"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#2f63ff]" />
                                <span>{staffMonthWishes.length} дн. одобрено</span>
                              </button>
                            ) : (
                              !hasOtherPvzShifts && (
                                <span className="text-[#5d6270] text-[11px]">
                                  Без ограничений
                                </span>
                              )
                            )}

                            {/* Pending wishes indicator */}
                            {staffPendingWishes.length > 0 && (
                              <span
                                className="inline-flex items-center gap-1.5 text-[#b45309] text-[11px] font-medium"
                                title="Есть нерассмотренные пожелания в шапке раздела «График» (не учитываются, пока не одобрены)"
                              >
                                <span className="w-1.5 h-1.5 rounded-xs bg-amber-500" />
                                <span>{staffPendingWishes.length} не одобр.</span>
                              </span>
                            )}

                            {/* Hybrid mode schedule selector */}
                            {scheduleType === 'hybrid' && isSelected && (
                              <select
                                value={hybridConfig[s.id]?.type || '2/2'}
                                onChange={e => {
                                  const val = e.target.value as any;
                                  setHybridConfig(prev => ({
                                    ...prev,
                                    [s.id]: { type: val },
                                  }));
                                }}
                                className="px-2.5 py-1 bg-white border border-[#d9dbe0] rounded text-[#111111] text-xs font-semibold cursor-pointer"
                              >
                                <option value="2/2" className="bg-white text-[#111111]">2 / 2</option>
                                <option value="3/3" className="bg-white text-[#111111]">3 / 3</option>
                                <option value="5/2" className="bg-white text-[#111111]">5 / 2</option>
                                <option value="custom" className="bg-white text-[#111111]">Кастом</option>
                              </select>
                            )}
                          </div>
                        </div>

                        {/* Expanded Other PVZ Shifts details */}
                        {expandedStaffOtherShifts === s.id && hasOtherPvzShifts && (
                          <div className="mt-2.5 p-2.5 bg-indigo-50 border border-indigo-200 rounded-md text-[11px] text-indigo-900 space-y-1.5 animate-fade-in">
                            <div className="font-semibold text-indigo-800 flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
                              <span>Сотрудник уже стоит в графике на другом складе и недоступен в эти даты:</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {staffOtherPvzShifts.map((sh, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded bg-white border border-indigo-200 text-indigo-800 flex items-center gap-1"
                                >
                                  <span className="font-mono font-semibold tabular-nums">{sh.date.slice(8)} {monthName.slice(0, 3)}</span>
                                  <span className="text-[#5d6270]">→</span>
                                  <span className="text-[#111111] font-semibold">{sh.location}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Expanded wish dates - Approved Only */}
                        {expandedStaffWishes === s.id && hasWishes && (
                          <div className="mt-2.5 p-2.5 bg-white border border-[#d9dbe0] rounded-md text-[11px] text-[#2d313b] space-y-1.5 animate-fade-in">
                            <div className="font-semibold text-[#2f63ff] flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#2f63ff]" />
                              <span>Одобренные руководителем пожелания (исключаются из графика):</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {staffMonthWishes.map((w, idx) => (
                                <span key={idx} className="px-2 py-0.5 rounded bg-[#f7f9ff] border border-[#d9dbe0] text-[#111111] font-mono tabular-nums text-[11px] flex items-center gap-1">
                                  <span>{w.date.slice(8)} {monthName.slice(0, 3)}</span>
                                  {w.comment && <span className="text-[#5d6270] font-sans">({w.comment})</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Manual 5/2 Weekends Picker */}
                        {scheduleType === '5/2' && weekend52Mode === 'manual' && isSelected && (
                          <div className="mt-2.5 pt-2.5 border-t border-[#e5e7eb] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span className="text-[#2d313b] font-medium">Выходные дни недели (5/2):</span>
                            <div className="flex flex-wrap items-center gap-1">
                              {[
                                { day: 1, label: 'Пн' },
                                { day: 2, label: 'Вт' },
                                { day: 3, label: 'Ср' },
                                { day: 4, label: 'Чт' },
                                { day: 5, label: 'Пт' },
                                { day: 6, label: 'Сб' },
                                { day: 0, label: 'Вс' },
                              ].map(d => {
                                const currentOff = manualWeekends52[s.id] || [0, 6];
                                const isOff = currentOff.includes(d.day);
                                return (
                                  <button
                                    key={d.day}
                                    type="button"
                                    onClick={() => {
                                      setManualWeekends52(prev => {
                                        const cur = prev[s.id] || [0, 6];
                                        const next = isOff
                                          ? cur.filter(x => x !== d.day)
                                          : cur.length >= 2
                                          ? [cur[1], d.day]
                                          : [...cur, d.day];
                                        return { ...prev, [s.id]: next };
                                      });
                                    }}
                                    className={`px-2 py-0.5 rounded border text-[10px] font-semibold cursor-pointer transition-colors ${
                                      isOff
                                        ? 'bg-[#111111] border-[#111111] text-white'
                                        : 'bg-[#f7f9ff] border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                                    }`}
                                  >
                                    {d.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Validation warnings */}
              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs space-y-1.5">
                {scheduleType === '2/2' && selectedStaffIds.length < 2 && (
                  <div className="text-[#b45309] font-medium flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Для графика 2/2 требуется минимум 2 человека (сейчас выбрано: {selectedStaffIds.length}).</span>
                  </div>
                )}
                {scheduleType === '3/3' && selectedStaffIds.length < 2 && (
                  <div className="text-[#b45309] font-medium flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Для графика 3/3 требуется минимум 2 человека (сейчас выбрано: {selectedStaffIds.length}).</span>
                  </div>
                )}
                {scheduleType === '5/2' && selectedStaffIds.length === 1 && (
                  <div className="text-[#b45309] font-medium flex items-center gap-1.5">
                    <Info className="w-4 h-4 shrink-0" />
                    <span>При 1 сотруднике он будет работать без выходных, либо потребуется сменщик.</span>
                  </div>
                )}
                {selectedStaffIds.length >= 3 && (
                  <div className="text-[#2f63ff] font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Выбрано {selectedStaffIds.length} сотрудников — ниже можно настроить усиление или сценарий ротации.</span>
                  </div>
                )}
                {/* Cross-PVZ notice */}
                {selectedStaffIds.some(id => (existingShifts || []).some(sh => sh.employeeId === id && sh.date.startsWith(monthStr) && sh.location !== location)) && (
                  <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-md text-indigo-800 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-[#111111]">Внимание: пересечение смен на других складах</div>
                      <div className="text-indigo-900 text-[11px] mt-0.5">
                        Один или несколько выбранных сотрудников уже имеют смены на других складах в этом месяце. Система автоматически учтёт их занятость и предупредит руководителя при попытке поставить смену в эти даты.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Coverage & Reinforcement */}
              <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-4">
                <div className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Покрытие и усиление смен
                </div>
                {/* 1. Base Coverage */}
                <div className="space-y-1.5">
                  <label className="block text-[#111111] font-semibold text-xs">
                    1. Сколько сотрудников нужно в обычный день:
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[1, 2, 3].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setBaseCoverage(cnt)}
                        className={`px-4 py-2 rounded border text-xs font-semibold cursor-pointer transition-colors ${
                          baseCoverage === cnt
                            ? 'bg-[#111111] border-[#111111] text-white font-semibold'
                            : 'bg-white border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                        }`}
                      >
                        {cnt} {cnt === 1 ? 'сотрудник' : 'сотрудника'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Reinforcement Mode */}
                <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                  <label className="block text-[#111111] font-semibold text-xs">
                    2. Нужно ли усиление в отдельные дни:
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'none', title: 'Без усиления', desc: 'Ровно 1 человек каждый день' },
                      { id: 'weekdays', title: 'По будням', desc: 'Усиление с Пн по Пт' },
                      { id: 'weekends', title: 'По выходным', desc: 'Усиление в Сб и Вс' },
                      { id: 'custom_days', title: 'По дням недели', desc: 'Выбор конкретных дней' },
                    ].map(mode => {
                      const isSelected = reinforcementMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setReinforcementMode(mode.id as ReinforcementMode)}
                          className={`p-2.5 rounded border text-left cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#111111] border-[#111111] text-white font-semibold'
                              : 'bg-white border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                          }`}
                        >
                          <div className={`text-xs font-semibold mb-0.5 ${isSelected ? 'text-[#a9bcff]' : 'text-[#111111]'}`}>
                            {mode.title}
                          </div>
                          <div className={`text-[10px] leading-tight ${isSelected ? 'text-white/75' : 'text-[#5d6270]'}`}>
                            {mode.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Coverage on Reinforcement Days */}
                {reinforcementMode !== 'none' && (
                  <div className="p-3 bg-white border border-[#d9dbe0] rounded-md space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <label className="text-[#111111] font-semibold text-xs">
                        3. Сколько человек в день усиления:
                      </label>
                      <div className="flex items-center gap-2">
                        {[2, 3, 4].map(cnt => (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() => setReinforcementCoverage(cnt)}
                            className={`px-3 py-1 rounded border text-xs cursor-pointer transition-colors ${
                              reinforcementCoverage === cnt
                                ? 'bg-[#2f63ff] text-white font-semibold border-[#2f63ff]'
                                : 'bg-[#f7f9ff] border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                            }`}
                          >
                            {cnt} сотр.
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Custom days of week */}
                    {reinforcementMode === 'custom_days' && (
                      <div className="space-y-1.5 pt-2 border-t border-[#e5e7eb]">
                        <label className="text-[#5d6270] text-[11px] font-medium">Дни недели для усиления:</label>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { day: 1, label: 'Пн' },
                            { day: 2, label: 'Вт' },
                            { day: 3, label: 'Ср' },
                            { day: 4, label: 'Чт' },
                            { day: 5, label: 'Пт' },
                            { day: 6, label: 'Сб' },
                            { day: 0, label: 'Вс' },
                          ].map(d => {
                            const active = reinforcementDaysOfWeek.includes(d.day);
                            return (
                              <button
                                key={d.day}
                                type="button"
                                onClick={() => {
                                  setReinforcementDaysOfWeek(prev =>
                                    active ? prev.filter(x => x !== d.day) : [...prev, d.day]
                                  );
                                }}
                                className={`px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer transition-colors ${
                                  active
                                    ? 'bg-[#111111] border-[#111111] text-white'
                                    : 'bg-[#f7f9ff] border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                                }`}
                              >
                                {d.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Special 3-staff scenarios */}
                {selectedStaffIds.length === 3 && (
                  <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                    <label className="block text-[#111111] font-semibold text-xs">
                      Сценарий для 3 сотрудников:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'queue', title: 'Очередь (2/2)', desc: 'Равномерная ротация всех троих' },
                        { id: 'weekdays', title: 'Усиление в будни', desc: 'Основная пара 2/2 + третий выходит на будни' },
                        { id: 'weekends', title: 'Усиление в сб/вс', desc: 'Основная пара 2/2 + третий усиливает выходные' },
                      ].map(sc => {
                        const isSelected = threeStaffMode === sc.id;
                        return (
                          <button
                            key={sc.id}
                            type="button"
                            onClick={() => setThreeStaffMode(sc.id as ThreeStaffScenario)}
                            className={`p-2.5 rounded border text-left cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#111111] border-[#111111] text-white font-semibold'
                                : 'bg-white border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                            }`}
                          >
                            <div className={`text-xs font-semibold ${isSelected ? 'text-[#a9bcff]' : 'text-[#111111]'}`}>
                              {sc.title}
                            </div>
                            <div className={`text-[10px] leading-tight ${isSelected ? 'text-white/75' : 'text-[#5d6270]'}`}>
                              {sc.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Wishes Toggle & Instant Check */}
              <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-3">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={respectWishes}
                    onChange={e => setRespectWishes(e.target.checked)}
                    className="w-5 h-5 mt-0.5 rounded-xs bg-white border-[#d9dbe0] text-[#2f63ff] accent-[#2f63ff] cursor-pointer"
                  />
                  <div>
                    <div className="font-semibold text-[#111111] text-sm">
                      Учитывать пожелания сотрудников («не могу выйти в этот день»)
                    </div>
                    <div className="text-xs text-[#2d313b] mt-0.5">
                      {respectWishes
                        ? 'Система будет распределять смены так, чтобы никто не ставился в свой отмеченный день. Приоритет: точная дата → диапазон → день недели.'
                        : 'Галочка снята: пожелания игнорируются, график строится строго по циклу и норме сменности.'}
                    </div>
                  </div>
                </label>

                {/* Analysis Preview */}
                {respectWishes && generatorResult && (
                  <div className="pt-3 border-t border-[#e5e7eb] space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#111111] font-semibold">Анализ пожеланий на {monthName}:</span>
                      <span className="text-[#2f63ff] font-mono font-semibold tabular-nums">
                        Учтено: {generatorResult.metrics.wishesRespected} из {generatorResult.metrics.totalWishesInMonth}
                      </span>
                    </div>

                    {generatorResult.metrics.criticalConflicts.length > 0 ? (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-md space-y-2">
                        <div className="flex items-center gap-2 text-rose-800 font-semibold text-xs">
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>
                            Внимание: обнаружены непокрытые дни из-за совпадения пожеланий и цикла ({generatorResult.metrics.criticalConflicts.length}):
                          </span>
                        </div>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                          {generatorResult.metrics.criticalConflicts.map((conf, idx) => (
                            <div
                              key={idx}
                              className="p-2 bg-white border border-rose-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]"
                            >
                              <div>
                                <span className="font-semibold text-[#111111] font-mono tabular-nums">{conf.dayNum} {monthName.slice(0, 3)} ({conf.dayName}): </span>
                                <span className="text-[#2d313b]">{conf.reason}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {conf.staffWithWishes.map(st => (
                                  <button
                                    key={st.id}
                                    type="button"
                                    onClick={() => toggleIgnoreWish(st.id, conf.dateStr)}
                                    className="px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-[#b45309] border border-amber-300 text-[10px] font-semibold cursor-pointer transition-colors"
                                    title="Временно снять пожелание сотрудника"
                                  >
                                    Снять пожелание {formatShortName(st.name)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-[#eef2ff] border border-[#a9bcff] rounded-md flex items-center gap-2 text-[#2f63ff] font-medium text-xs">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-[#2f63ff]" />
                        <span>Все дни месяца полностью закрыты, и пожелания сотрудников успешно соблюдены!</span>
                      </div>
                    )}

                    {/* Shift Exchange Summary in Month */}
                    {generatorResult.metrics.totalExchangeShiftsInMonth !== undefined && generatorResult.metrics.totalExchangeShiftsInMonth > 0 && (
                      <div className="p-3 bg-white border border-[#d9dbe0] rounded-md flex items-center justify-between text-xs text-[#111111]">
                        <div className="flex items-center gap-2">
                          <ArrowLeftRight className="w-4 h-4 text-[#2f63ff] shrink-0" />
                          <span>Смены из «Биржи смен» для этого склада:</span>
                        </div>
                        <span className="font-mono font-semibold text-[#2f63ff] tabular-nums">
                          Учтено {generatorResult.metrics.exchangeShiftsIncluded || 0} из {generatorResult.metrics.totalExchangeShiftsInMonth}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Предпросмотр и ручная правка графика */}
          {step === 3 && (
            <div className="space-y-4 animate-fade-in">
              {crossConflictAlert && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-md flex items-center justify-between text-xs text-rose-800 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span className="font-semibold">{crossConflictAlert}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCrossConflictAlert(null)}
                    className="p-1 hover:bg-rose-100 rounded text-rose-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              
              {/* Top Stats Bar */}
              {generatorResult && (
                <div className="bg-[#f7f9ff] border border-[#d9dbe0] rounded-md grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#e5e7eb]">
                  <div className="p-3">
                    <div className="text-[10px] uppercase font-medium text-[#5d6270] tracking-wider">Закрыто дней</div>
                    <div className="text-lg font-mono font-semibold text-[#111111] mt-0.5 tabular-nums">
                      <span className={generatorResult.metrics.coveredDays === generatorResult.metrics.totalDays ? 'text-[#2f63ff]' : 'text-[#b45309]'}>
                        {generatorResult.metrics.coveredDays}
                      </span>
                      <span className="text-[#5d6270] text-xs font-normal"> / {generatorResult.metrics.totalDays}</span>
                    </div>
                  </div>

                  <div className="p-3">
                    <div className="text-[10px] uppercase font-medium text-[#5d6270] tracking-wider">Пожеланий учтено</div>
                    <div className="text-lg font-mono font-semibold text-[#111111] mt-0.5 tabular-nums">
                      <span className="text-[#2f63ff]">{generatorResult.metrics.wishesRespected}</span>
                      <span className="text-[#5d6270] text-xs font-normal"> / {generatorResult.metrics.totalWishesInMonth}</span>
                    </div>
                  </div>

                  <div className="p-3">
                    <div className="text-[10px] uppercase font-medium text-[#5d6270] tracking-wider">Всего смен</div>
                    <div className="text-lg font-mono font-semibold text-[#111111] mt-0.5 tabular-nums">
                      {generatorResult.shifts.length}
                    </div>
                  </div>

                  <div className="p-3">
                    <div className="text-[10px] uppercase font-medium text-[#5d6270] tracking-wider">Статус графика</div>
                    <div className="text-xs font-semibold mt-1.5 flex items-center gap-1.5">
                      {generatorResult.metrics.uncoveredDays === 0 ? (
                        <span className="text-[#2f63ff] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Полностью готов
                        </span>
                      ) : (
                        <span className="text-rose-700 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Есть пропуски ({generatorResult.metrics.uncoveredDays})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Mode Tabs for Preview */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5">
                <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none w-full sm:w-auto">
                  {[
                    { id: 'calendar', label: 'Календарь (Сетка)', icon: CalendarIcon },
                    { id: 'matrix', label: 'Матрица смен', icon: Layers },
                    { id: 'balance', label: 'Баланс сотрудников', icon: Users },
                    ...(generatorResult && (generatorResult.metrics.criticalConflicts.length > 0 || allCrossPvzConflicts.length > 0)
                      ? [{
                          id: 'conflicts',
                          label: `Конфликты (${generatorResult.metrics.criticalConflicts.length + allCrossPvzConflicts.length})`,
                          icon: AlertTriangle,
                        }]
                      : []),
                  ].map(tab => {
                    const Icon = tab.icon;
                    const active = previewTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPreviewTab(tab.id as any)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors shrink-0 ${
                          active
                            ? tab.id === 'conflicts'
                              ? 'bg-rose-600 text-white font-semibold'
                              : 'bg-[#111111] text-white border border-[#111111] font-semibold'
                            : 'bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] border border-[#d9dbe0]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Custom Staff Filter Dropdown */}
                  <div className="relative">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setStaffDropdownOpen(prev => !prev)}
                        className={`h-8 px-2.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                          filterStaffId !== 'all'
                            ? 'bg-[#111111] text-white border-[#111111]'
                            : 'bg-white hover:bg-[#f7f9ff] text-[#2d313b] border-[#d9dbe0]'
                        }`}
                        title="Фильтрация смен по сотруднику"
                      >
                        <Users className={`w-3.5 h-3.5 shrink-0 ${filterStaffId !== 'all' ? 'text-[#a9bcff]' : 'text-[#2f63ff]'}`} />
                        <span className="truncate max-w-[140px] sm:max-w-[190px]">
                          {filterStaffId === 'all'
                            ? `Сотрудник: Все (${selectedStaffIds.length})`
                            : formatShortName(staffList.find(s => s.id === filterStaffId)?.name || 'Сотрудник')}
                        </span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${filterStaffId !== 'all' ? 'text-white/80' : 'text-[#5d6270]'} ${staffDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {filterStaffId !== 'all' && (
                        <button
                          type="button"
                          onClick={() => setFilterStaffId('all')}
                          className="h-8 px-2 text-[11px] text-[#2d313b] hover:text-rose-700 rounded bg-white hover:bg-rose-50 border border-[#d9dbe0] transition-colors cursor-pointer flex items-center gap-1"
                          title="Сбросить фильтр и показать всех"
                        >
                          <X className="w-3 h-3 text-rose-600" />
                          <span className="hidden sm:inline">Все</span>
                        </button>
                      )}
                    </div>

                    {/* Dropdown Menu */}
                    {staffDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setStaffDropdownOpen(false)}
                        />
                        <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-64 max-w-[calc(100vw-2.5rem)] bg-white border border-[#d9dbe0] rounded-md shadow-sm p-1.5 z-50 animate-fade-in text-xs space-y-1">
                          <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[#5d6270] flex items-center justify-between">
                            <span>Фильтр сотрудника</span>
                            <span className="text-[#111111] font-semibold font-mono tabular-nums">{selectedStaffIds.length} доступно</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setFilterStaffId('all');
                              setStaffDropdownOpen(false);
                            }}
                            className={`w-full px-2.5 py-1.5 rounded text-left flex items-center justify-between transition-colors cursor-pointer ${
                              filterStaffId === 'all'
                                ? 'bg-[#111111] text-white font-semibold'
                                : 'text-[#111111] hover:bg-[#f7f9ff]'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Users className={`w-3.5 h-3.5 shrink-0 ${filterStaffId === 'all' ? 'text-[#a9bcff]' : 'text-[#2f63ff]'}`} />
                              <span>Все сотрудники ({selectedStaffIds.length})</span>
                            </div>
                            {filterStaffId === 'all' && <Check className="w-3.5 h-3.5 text-[#a9bcff]" />}
                          </button>

                          <div className="max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
                            {selectedStaffIds.map(stId => {
                              const st = staffList.find(s => s.id === stId);
                              const isSelected = filterStaffId === stId;
                              const workload = generatorResult?.metrics.staffWorkload.find(w => w.employeeId === stId);

                              return (
                                <button
                                  key={stId}
                                  type="button"
                                  onClick={() => {
                                    setFilterStaffId(stId);
                                    setStaffDropdownOpen(false);
                                  }}
                                  className={`w-full px-2.5 py-1.5 rounded text-left flex items-center justify-between transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-[#eef2ff] text-[#111111] font-semibold'
                                      : 'text-[#2d313b] hover:bg-[#f7f9ff] hover:text-[#111111]'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-5 h-5 rounded-xs flex items-center justify-center text-xs font-medium shrink-0 ${
                                      isSelected ? 'bg-[#2f63ff] text-white font-semibold' : 'bg-[#f7f9ff] border border-[#d9dbe0] text-[#111111]'
                                    }`}>
                                      {st?.name ? st.name[0] : 'С'}
                                    </div>
                                    <div className="truncate">
                                      <span className="block truncate font-medium text-[#111111]">{st?.name || 'Сотрудник'}</span>
                                      <div className="flex items-center gap-1 text-[10px]">
                                        {st?.isSenior && <span className="text-[#b45309]">Старший</span>}
                                        {st?.isPartTime && <span className="text-indigo-700">Подработка</span>}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                    {workload && (
                                      <span className="text-[10px] font-mono text-[#2f63ff] font-medium tabular-nums">
                                        {workload.shiftsCount} см.
                                      </span>
                                    )}
                                    {isSelected && <Check className="w-3.5 h-3.5 text-[#2f63ff]" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="text-[11px] text-[#5d6270] hidden lg:flex items-center gap-1.5 ml-2">
                    <Info className="w-3.5 h-3.5 text-[#5d6270] shrink-0" />
                    <span>Кликните по сотруднику, чтобы снять или добавить смену</span>
                  </div>
                </div>
              </div>

              {/* Mobile Filter Notification Chip */}
              {filterStaffId !== 'all' && (
                <div className="sm:hidden p-2.5 bg-[#eef2ff] border border-[#a9bcff] rounded-md flex items-center justify-between text-xs text-[#111111] animate-fade-in">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-xs bg-[#111111] text-white flex items-center justify-center font-semibold text-xs">
                      {staffList.find(s => s.id === filterStaffId)?.name?.[0] || 'С'}
                    </div>
                    <div>
                      <span className="font-semibold text-[#111111]">
                        {formatShortName(staffList.find(s => s.id === filterStaffId)?.name || 'Сотрудник')}
                      </span>
                      <span className="text-[10px] text-[#2d313b] ml-1.5 font-mono tabular-nums">
                        {generatorResult?.metrics.staffWorkload.find(w => w.employeeId === filterStaffId)?.shiftsCount || 0} смен
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFilterStaffId('all')}
                    className="px-2.5 py-1 rounded bg-white hover:bg-[#f7f9ff] border border-[#d9dbe0] text-[#2d313b] text-[11px] cursor-pointer transition-colors"
                  >
                    ✕ Все
                  </button>
                </div>
              )}

              {/* TAB 1: CALENDAR VIEW */}
              {previewTab === 'calendar' && generatorResult && (
                <div className="p-2 sm:p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-2 animate-fade-in overflow-x-auto">
                  <div className="min-w-[460px] sm:min-w-0 space-y-2">
                    {/* Weekday Labels */}
                    <div className="grid grid-cols-7 gap-1 text-center font-semibold text-[11px] text-[#5d6270] py-1">
                      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d, i) => (
                        <div key={i} className={i >= 5 ? 'text-rose-700' : ''}>{d}</div>
                      ))}
                    </div>

                    {/* Month Grid */}
                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                      {/* Leading empty cells for alignment */}
                      {Array.from({ length: (daysList[0].dayOfWeek + 6) % 7 }).map((_, i) => (
                        <div key={`blank-${i}`} className="min-h-14 sm:min-h-18 rounded bg-white/60 border border-[#d9dbe0]/50" />
                      ))}

                    {/* Actual Days */}
                    {daysList.map(d => {
                      const analysis = generatorResult.dayAnalysis[d.dateStr];
                      const assignedIds = analysis?.assignedStaffIds || [];
                      const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
                      const isPartial = analysis?.coverageStatus === 'understaffed';
                      const isEmpty = analysis?.coverageStatus === 'empty';
                      const isFilterActive = filterStaffId !== 'all';
                      const isFilteredStaffWorking = isFilterActive && assignedIds.includes(filterStaffId);

                      return (
                        <div
                          key={d.dateStr}
                          className={`min-h-16 sm:min-h-20 p-1 sm:p-1.5 rounded border flex flex-col justify-between transition-colors ${
                            isFilterActive
                              ? isFilteredStaffWorking
                                ? 'bg-[#eef2ff] border-[#2f63ff]'
                                : 'bg-white/60 border-[#d9dbe0]/60 opacity-45'
                              : isEmpty
                              ? 'bg-rose-50 border-rose-200 text-rose-800'
                              : isPartial
                              ? 'bg-amber-50 border-amber-300 text-[#b45309]'
                              : 'bg-white border-[#d9dbe0] hover:border-[#a9bcff]'
                          }`}
                        >
                          {/* Day Header with indicator for working employee */}
                          <div className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1">
                              <span className={`font-mono font-semibold tabular-nums ${
                                isFilterActive && isFilteredStaffWorking
                                  ? 'text-[#2f63ff]'
                                  : isWeekend
                                  ? 'text-rose-700'
                                  : 'text-[#111111]'
                              }`}>
                                {d.dayNum}
                              </span>
                              {isFilterActive && isFilteredStaffWorking && (
                                <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff] inline-block shrink-0" title="Смена сотрудника" />
                              )}
                            </div>
                            {analysis?.isReinforcedDay ? (
                              <span className="text-[9px] text-[#b45309] font-semibold" title="День усиления">
                                Усил.
                              </span>
                            ) : null}
                          </div>

                          {/* Assigned Staff Badges */}
                          <div className="space-y-1 my-1">
                            {assignedIds.length === 0 ? (
                              <div className="text-[10px] text-rose-700 italic text-center py-1">
                                Нет смены
                              </div>
                            ) : (
                              assignedIds.map(stId => {
                                const staff = staffList.find(s => s.id === stId);
                                const hasWish = analysis?.wishesOnThisDay.some(w => w.employeeId === stId);
                                const crossPvz = analysis?.crossPvzConflicts?.find(c => c.employeeId === stId);
                                const exchangeItem = analysis?.exchangeShiftsOnThisDay?.find(e => e.employeeId === stId);
                                const isFocusedStaff = filterStaffId === 'all' || filterStaffId === stId;
                                const isExactFilterTarget = filterStaffId !== 'all' && filterStaffId === stId;

                                return (
                                  <button
                                    key={stId}
                                    type="button"
                                    onClick={() => toggleStaffOnDate(d.dateStr, stId)}
                                    className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-semibold truncate transition-colors cursor-pointer flex items-center justify-between ${
                                      !isFocusedStaff
                                        ? 'opacity-30 bg-[#f7f9ff] text-[#5d6270]'
                                        : isExactFilterTarget
                                        ? 'bg-[#2f63ff] text-white font-semibold'
                                        : crossPvz
                                        ? 'bg-indigo-100 text-indigo-800 hover:bg-rose-100 hover:text-rose-800'
                                        : exchangeItem
                                        ? 'bg-[#eef2ff] border border-[#a9bcff] text-[#2f63ff] hover:bg-rose-100 hover:text-rose-800'
                                        : hasWish
                                        ? 'bg-amber-100 text-[#b45309] hover:bg-rose-100 hover:text-rose-800'
                                        : 'bg-[#f7f9ff] border border-[#d9dbe0] text-[#111111] hover:bg-rose-100 hover:text-rose-800 hover:border-rose-200'
                                    }`}
                                    title={
                                      crossPvz
                                        ? `Внимание: ${staff?.name || 'Сотрудник'} уже стоит в ${crossPvz.location} в этот день. Кликните, чтобы снять.`
                                        : exchangeItem
                                        ? `Смена взята из «Биржи смен»${exchangeItem.requesterName ? ` (замена: ${exchangeItem.requesterName})` : ''}. Кликните, чтобы снять.`
                                        : `${staff?.name || 'Сотрудник'} (кликните, чтобы снять)`
                                    }
                                  >
                                    <span className="truncate flex items-center gap-1">
                                      {crossPvz && <AlertTriangle className="w-2.5 h-2.5 text-indigo-700 shrink-0" />}
                                      {exchangeItem && <ArrowLeftRight className="w-2.5 h-2.5 text-[#2f63ff] shrink-0" />}
                                      <span>{formatShortName(staff?.name || 'Сотрудник')}</span>
                                    </span>
                                    <span className="text-[8px] opacity-60">✕</span>
                                  </button>
                                );
                              })
                            )}
                          </div>

                          {/* Quick Add Available Staff */}
                          <div className="flex items-center justify-between pt-0.5">
                            <span className="text-[9px] text-[#5d6270] font-mono tabular-nums">
                              {assignedIds.length}/{analysis?.targetCount || 1}
                            </span>
                            {selectedStaffIds.length > assignedIds.length && (
                              <button
                                type="button"
                                onClick={() => {
                                  // Find next unassigned staff who is NOT busy at another PVZ on this date
                                  const unassigned = selectedStaffIds.find(id => {
                                    if (assignedIds.includes(id)) return false;
                                    const busyAtOther = existingShifts.some(
                                      s => s.employeeId === id &&
                                           s.date === d.dateStr &&
                                           s.location !== location &&
                                           s.location !== activePvzs.find(p => p.code === location)?.name
                                    );
                                    return !busyAtOther;
                                  });
                                  if (unassigned) {
                                    toggleStaffOnDate(d.dateStr, unassigned);
                                  } else {
                                    setCrossConflictAlert(`Все остальные сотрудники уже имеют смену на других складах на ${d.dayNum} ${monthName.slice(0, 3)}!`);
                                  }
                                }}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-[#f7f9ff] hover:bg-[#111111] hover:text-white border border-[#d9dbe0] text-[#111111] font-semibold cursor-pointer transition-colors"
                                title="Назначить следующего свободного сотрудника"
                              >
                                +
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mobile-friendly filtered staff shift list */}
                {filterStaffId !== 'all' && (
                  <div className="sm:hidden pt-2 space-y-2">
                    <div className="flex items-center justify-between text-xs text-[#111111] font-semibold px-1">
                      <span>Назначенные смены ({daysList.filter(d => (generatorResult.dayAnalysis[d.dateStr]?.assignedStaffIds || []).includes(filterStaffId)).length} дн.):</span>
                      <span className="text-[10px] text-[#2f63ff] font-mono tabular-nums">
                        {daysList.filter(d => (generatorResult.dayAnalysis[d.dateStr]?.assignedStaffIds || []).includes(filterStaffId)).length * 12} ч
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {daysList.map(d => {
                        const assignedIds = generatorResult.dayAnalysis[d.dateStr]?.assignedStaffIds || [];
                        const isWorking = assignedIds.includes(filterStaffId);
                        if (!isWorking) return null;
                        const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;

                        return (
                          <div
                            key={`mob-shift-${d.dateStr}`}
                            className="p-2 rounded-md bg-white border border-[#d9dbe0] flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`font-mono font-semibold tabular-nums ${isWeekend ? 'text-rose-700' : 'text-[#111111]'}`}>
                                {d.dayNum} {monthName.slice(0, 3)}
                              </span>
                              <span className="text-[10px] text-[#5d6270]">({d.dayName})</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleStaffOnDate(d.dateStr, filterStaffId)}
                              className="text-[10px] text-rose-700 hover:bg-rose-100 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 cursor-pointer transition-colors"
                              title="Снять смену"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            )}

              {/* TAB 2: MATRIX TABLE VIEW */}
              {previewTab === 'matrix' && generatorResult && (
                <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[#f7f9ff] sticky top-0 text-[10px] uppercase font-medium text-[#5d6270] border-b border-[#d9dbe0]">
                      <tr>
                        <th className="p-2.5">Дата</th>
                        <th className="p-2.5">День</th>
                        <th className="p-2.5">План / Факт</th>
                        <th className="p-2.5">Назначенные сотрудники</th>
                        <th className="p-2.5">Статус</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e5e7eb]">
                      {daysList.map(d => {
                        const analysis = generatorResult.dayAnalysis[d.dateStr];
                        const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
                        const isFilterActive = filterStaffId !== 'all';
                        const isFilteredStaffWorking = isFilterActive && (analysis?.assignedStaffIds || []).includes(filterStaffId);

                        return (
                          <tr
                            key={d.dateStr}
                            className={`transition-colors ${
                              isFilterActive
                                ? isFilteredStaffWorking
                                  ? 'bg-[#eef2ff]'
                                  : 'opacity-40'
                                : 'hover:bg-[#f7f9ff]'
                            }`}
                          >
                            <td className="p-2.5 font-mono tabular-nums text-[#111111] font-semibold">{d.dayNum} {monthName.slice(0, 3)}</td>
                            <td className={`p-2.5 font-semibold ${isWeekend ? 'text-rose-700' : 'text-[#5d6270]'}`}>{d.dayName}</td>
                            <td className="p-2.5 font-mono tabular-nums">
                              <span className={analysis?.coverageStatus === 'ok' ? 'text-[#2f63ff] font-semibold' : 'text-rose-700 font-semibold'}>
                                {analysis?.assignedStaffIds.length || 0}
                              </span>
                              <span className="text-[#5d6270]"> / {analysis?.targetCount || 1}</span>
                            </td>
                            <td className="p-2.5">
                              <div className="flex flex-wrap gap-1">
                                {(analysis?.assignedStaffIds || []).map(stId => {
                                  const staff = staffList.find(s => s.id === stId);
                                  const isFocusedStaff = filterStaffId === 'all' || filterStaffId === stId;
                                  const isExactFilterTarget = filterStaffId !== 'all' && filterStaffId === stId;

                                  return (
                                    <button
                                      key={stId}
                                      type="button"
                                      onClick={() => toggleStaffOnDate(d.dateStr, stId)}
                                      className={`px-2 py-0.5 rounded font-semibold cursor-pointer text-[11px] transition-colors ${
                                        !isFocusedStaff
                                          ? 'opacity-30 bg-[#f7f9ff] text-[#5d6270]'
                                          : isExactFilterTarget
                                          ? 'bg-[#2f63ff] border border-[#2f63ff] text-white font-semibold'
                                          : 'bg-[#f7f9ff] border border-[#d9dbe0] text-[#111111] hover:bg-rose-100 hover:text-rose-800 hover:border-rose-200'
                                      }`}
                                      title="Нажмите, чтобы снять"
                                    >
                                      {formatShortName(staff?.name || 'Сотрудник')} ✕
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="p-2.5">
                              {analysis?.coverageStatus === 'ok' ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#2f63ff]">
                                  <span className="w-1.5 h-1.5 rounded-xs bg-[#2f63ff]" />
                                  <span>Закрыт</span>
                                </span>
                              ) : analysis?.coverageStatus === 'understaffed' ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#b45309]">
                                  <span className="w-1.5 h-1.5 rounded-xs bg-amber-500" />
                                  <span>Частично</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-700">
                                  <span className="w-1.5 h-1.5 rounded-xs bg-rose-600" />
                                  <span>Пропуск</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 3: WORKLOAD BALANCE */}
              {previewTab === 'balance' && generatorResult && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
                  {generatorResult.metrics.staffWorkload.map(st => {
                    const isFilterTarget = filterStaffId !== 'all' && filterStaffId === st.employeeId;
                    const isOtherStaff = filterStaffId !== 'all' && filterStaffId !== st.employeeId;

                    return (
                      <div
                        key={st.employeeId}
                        className={`p-4 rounded-md border space-y-3 transition-colors ${
                          isFilterTarget
                            ? 'bg-[#eef2ff] border-[#2f63ff]'
                            : isOtherStaff
                            ? 'bg-white border-[#d9dbe0] opacity-45'
                            : 'bg-white border-[#d9dbe0]'
                        }`}
                      >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-[#111111] text-sm flex items-center gap-1.5 flex-wrap">
                            <span>{st.employeeName}</span>
                            {st.isSenior && <span className="text-[11px] text-[#b45309] font-medium">· Старший</span>}
                          </div>
                          <div className="text-xs text-[#5d6270] font-mono tabular-nums">{st.hours} рабочих часов в месяце</div>
                        </div>
                        <div className="text-right">
                          <span className="text-xl font-mono font-semibold text-[#2f63ff] tabular-nums">{st.shiftsCount}</span>
                          <span className="text-xs text-[#5d6270] ml-1">смен</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] text-[#5d6270]">
                          <span>Доля месяца:</span>
                          <span className="font-mono font-semibold text-[#111111] tabular-nums">{st.percentOfMonth}%</span>
                        </div>
                        <div className="w-full h-2 bg-[#f7f9ff] border border-[#d9dbe0] rounded-xs overflow-hidden">
                          <div
                            className="h-full bg-[#2f63ff] rounded-xs"
                            style={{ width: `${Math.min(100, st.percentOfMonth)}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#e5e7eb]">
                        <span className="text-[#5d6270]">Пожелания:</span>
                        <span className="text-[#111111] font-semibold font-mono tabular-nums">Соблюдено: {st.wishesMet}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}

              {/* TAB 4: CONFLICTS VIEW */}
              {previewTab === 'conflicts' && generatorResult && (
                <div className="space-y-2 animate-fade-in max-h-72 overflow-y-auto">
                  {/* Cross-PVZ Conflict Banners */}
                  {allCrossPvzConflicts.map((conf, idx) => (
                    <div
                      key={`cross-${idx}`}
                      className="p-3 bg-indigo-50 border border-indigo-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-[#111111] flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
                          <span className="text-indigo-800">Пересечение с другим складом</span>
                          <span className="font-mono text-indigo-700 ml-1 tabular-nums">
                            {conf.dayNum} {monthName.slice(0, 3)} ({conf.dayName})
                          </span>
                        </div>
                        <div className="text-indigo-900 text-[11px] mt-0.5">
                          Сотрудник <strong className="text-[#111111]">{conf.employeeName}</strong> уже стоит в графике на складе{' '}
                          <strong className="text-indigo-800">{conf.otherLocation}</strong> в эту дату и не может выйти сюда.
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleStaffOnDate(conf.dateStr, conf.employeeId)}
                          className="px-2.5 py-1 rounded bg-white text-indigo-800 border border-indigo-300 font-semibold cursor-pointer text-[11px] hover:bg-rose-50 hover:text-rose-800 hover:border-rose-300 transition-colors"
                          title="Снять сотрудника с этой даты на данном складе"
                        >
                          Снять с этой даты
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Standard Critical Wishes Conflicts */}
                  {generatorResult.metrics.criticalConflicts.length === 0 && allCrossPvzConflicts.length === 0 ? (
                    <div className="p-6 text-center text-[#2f63ff] font-medium bg-[#eef2ff] border border-[#a9bcff] rounded-md">
                      Критических конфликтов нет! Все смены распределены успешно.
                    </div>
                  ) : (
                    generatorResult.metrics.criticalConflicts.map((conf, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-rose-50 border border-rose-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-[#111111] flex items-center gap-2">
                            <span className="font-mono tabular-nums">{conf.dayNum} {monthName.slice(0, 3)} ({conf.dayName})</span>
                            <span className="text-[11px] text-rose-700 font-semibold">
                              · Не закрыт
                            </span>
                          </div>
                          <div className="text-rose-900 text-[11px] mt-0.5">{conf.reason}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {conf.staffWithWishes.map(st => (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => toggleIgnoreWish(st.id, conf.dateStr)}
                              className="px-2.5 py-1 rounded bg-amber-50 text-[#b45309] border border-amber-300 font-semibold cursor-pointer text-[11px] hover:bg-amber-100 transition-colors"
                            >
                              Снять пожелание {formatShortName(st.name)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Bottom Options: Save as Template */}
              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-[#111111] font-medium text-xs select-none">
                  <input
                    type="checkbox"
                    checked={saveTemplate}
                    onChange={e => setSaveTemplate(e.target.checked)}
                    className="w-4 h-4 rounded-xs bg-white border-[#d9dbe0] text-[#2f63ff] accent-[#2f63ff] cursor-pointer"
                  />
                  <span>Сохранить эту схему как шаблон для будущих месяцев</span>
                </label>
                {saveTemplate && (
                  <input
                    type="text"
                    placeholder="Название шаблона (напр., 2/2 Основной)"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    className="w-full sm:max-w-md px-3 py-1.5 bg-white border border-[#d9dbe0] focus:border-[#2f63ff] focus:outline-none rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs"
                  />
                )}
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer with Stepper Controls */}
        <div className="p-2.5 sm:p-4 border-t border-[#d9dbe0] shrink-0 bg-[#f7f9ff] flex items-center justify-between gap-2">
          {step === 3 ? (
            /* Step 3: All 4 buttons in ONE single compact line on mobile */
            <div className="flex items-center justify-between gap-1.5 sm:gap-2 w-full">
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Назад */}
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="h-8 sm:h-9 px-2 sm:px-3.5 bg-white hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] font-semibold rounded transition-colors cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs shrink-0"
                  title="Назад к шагу 2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Назад</span>
                </button>

                {/* В PDF */}
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={isExportingPdf || !generatorResult || generatorResult.shifts.length === 0}
                  className="h-8 sm:h-9 px-2 sm:px-3.5 bg-[#111111] hover:bg-[#2d313b] text-white font-semibold rounded transition-colors cursor-pointer disabled:opacity-50 text-[11px] sm:text-xs flex items-center justify-center gap-1 sm:gap-1.5 shrink-0"
                  title="Скачать PDF с графиком смен"
                >
                  {isExportingPdf ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>PDF...</span>
                    </>
                  ) : (
                    <>
                      <FileDown className="w-3.5 h-3.5 text-white shrink-0" />
                      <span className="hidden sm:inline">В </span>
                      <span>PDF</span>
                    </>
                  )}
                </button>

                {/* Отмена */}
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 sm:h-9 px-2 sm:px-3 text-[#2d313b] hover:text-[#111111] bg-white sm:bg-transparent hover:bg-[#eef2ff] border border-[#d9dbe0] sm:border-transparent rounded transition-colors cursor-pointer text-[11px] sm:text-xs flex items-center justify-center gap-1 shrink-0"
                  title="Закрыть мастер верстки"
                >
                  <X className="w-3.5 h-3.5 sm:hidden text-[#2d313b]" />
                  <span className="hidden sm:inline">Отмена</span>
                </button>
              </div>

              {/* Применить */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  disabled={isApplying || loading || !generatorResult || generatorResult.shifts.length === 0}
                  onClick={handleApply}
                  className="h-8 sm:h-9 px-3 sm:px-5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded transition-colors cursor-pointer disabled:opacity-50 text-[11px] sm:text-xs flex items-center justify-center gap-1.5 flex-1 sm:flex-initial"
                  title="Применить сформированный график"
                >
                  {isApplying || loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Сохранение...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                      <span>Применить</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Steps 1 - 2 */
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-2">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep(s => s - 1)}
                    className="h-8 sm:h-9 px-3 sm:px-3.5 bg-white hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] font-semibold rounded transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Назад</span>
                  </button>
                ) : <div />}

                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 sm:h-9 px-3 text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff] rounded transition-colors cursor-pointer text-xs"
                >
                  Отмена
                </button>
              </div>

              <button
                type="button"
                disabled={(step === 1 && !location) || (step === 2 && selectedStaffIds.length === 0)}
                onClick={() => setStep(s => s + 1)}
                className="h-8 sm:h-9 px-4 sm:px-5 bg-[#2f63ff] hover:bg-[#1f4fe0] disabled:bg-[#eef2ff] disabled:text-[#5d6270] disabled:border disabled:border-[#d9dbe0] disabled:cursor-not-allowed text-white font-semibold rounded transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-xs"
              >
                <span>{step === 2 ? 'Предпросмотр графика' : 'Далее'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
