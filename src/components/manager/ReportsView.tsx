import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { getCurrentAndPreviousMonth, formatMonthName, getAllAvailableMonths } from '../../utils/time';
import { CustomPeriodSelect } from '../common/CustomPeriodSelect';
import { CustomSelect } from '../common/CustomSelect';
import { aggregateMonthlyStats, formatCurrency, calculateShiftBreakdown } from '../../utils/calculations';
import { Calendar, DollarSign, BarChart2, Wallet, Sliders, Settings, Lock, Unlock, Edit3, Save, X, Plus, Trash2, AlertTriangle, Clock, QrCode, MapPin, Moon, Sun } from 'lucide-react';

export const ReportsView: React.FC = () => {
  const { records, staffList, rates, saveRates, pickupPoints } = useApp();
  const { current } = getCurrentAndPreviousMonth();
  const allAvailableMonths = getAllAvailableMonths(records, 12);
  const [selectedMonth, setSelectedMonth] = useState<string>(current);
  const [showRatesConfig, setShowRatesConfig] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formRates, setFormRates] = useState(rates);
  const [localShiftTypes, setLocalShiftTypes] = useState<any[]>([]);
  const [localPartTimeShiftTypes, setLocalPartTimeShiftTypes] = useState<any[]>([]);
  const [localBonuses, setLocalBonuses] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const getDefaultShiftTypes = () => [
    { code: 'day12', name: 'Дневная смена (12ч)', baseRate: rates.day12 || 3500, isArchived: false },
    { code: 'night12', name: 'Ночная смена (12ч)', baseRate: rates.night12 || 4000, isArchived: false },
    { code: 'standard8', name: 'Стандартная (8ч)', baseRate: rates.standard8 || 2800, isArchived: false },
    { code: 'part6', name: 'Подработка (6ч)', baseRate: rates.part6 || 2100, isArchived: false },
    { code: 'part4', name: 'Подработка (4ч)', baseRate: rates.part4 || 1400, isArchived: false },
    { code: 'daily24', name: 'Суточная (24ч)', baseRate: rates.daily24 || 7000, isArchived: false },
  ];

  const getDefaultPartTimeShiftTypes = () => [
    { code: 'part4', name: 'Подработка (4ч)', baseRate: rates.part4 || 1400, isArchived: false },
    { code: 'part6', name: 'Подработка (6ч)', baseRate: rates.part6 || 2100, isArchived: false },
    { code: 'standard8', name: 'Стандартная (8ч)', baseRate: rates.standard8 || 2800, isArchived: false },
  ];

  const getDefaultBonuses = () => [
    { code: 'nightBonus', name: 'Доплата за ночную смену', value: rates.nightBonus || 500, isArchived: false, target: 'always' },
    { code: 'seniorBonus', name: 'Доплата Бригадиру / Старшему смены', value: rates.seniorBonus || 500, isArchived: false, target: 'senior' },
    { code: 'partTimeBonus', name: 'Доплата Подработчику', value: rates.partTimeBonus || 0, isArchived: false, target: 'part_time' },
  ];

  useEffect(() => {
    setFormRates(rates);
    const initialTypes = rates.shiftTypes && rates.shiftTypes.length > 0
      ? rates.shiftTypes
      : getDefaultShiftTypes();
    setLocalShiftTypes(initialTypes);

    const initialPartTimeTypes = rates.partTimeShiftTypes && rates.partTimeShiftTypes.length > 0
      ? rates.partTimeShiftTypes
      : getDefaultPartTimeShiftTypes();
    setLocalPartTimeShiftTypes(initialPartTimeTypes);

    const initialBonuses = rates.bonuses && rates.bonuses.length > 0
      ? rates.bonuses
      : getDefaultBonuses();
    setLocalBonuses(initialBonuses);
  }, [rates]);

  const handleEditToggle = () => {
    setFormRates(rates);
    const initialTypes = rates.shiftTypes && rates.shiftTypes.length > 0
      ? rates.shiftTypes
      : getDefaultShiftTypes();
    setLocalShiftTypes(initialTypes);

    const initialPartTimeTypes = rates.partTimeShiftTypes && rates.partTimeShiftTypes.length > 0
      ? rates.partTimeShiftTypes
      : getDefaultPartTimeShiftTypes();
    setLocalPartTimeShiftTypes(initialPartTimeTypes);

    const initialBonuses = rates.bonuses && rates.bonuses.length > 0
      ? rates.bonuses
      : getDefaultBonuses();
    setLocalBonuses(initialBonuses);
    setIsEditing(true);
    setSaveError('');
  };

  const handleCancel = () => {
    setFormRates(rates);
    const initialTypes = rates.shiftTypes && rates.shiftTypes.length > 0
      ? rates.shiftTypes
      : getDefaultShiftTypes();
    setLocalShiftTypes(initialTypes);

    const initialPartTimeTypes = rates.partTimeShiftTypes && rates.partTimeShiftTypes.length > 0
      ? rates.partTimeShiftTypes
      : getDefaultPartTimeShiftTypes();
    setLocalPartTimeShiftTypes(initialPartTimeTypes);

    const initialBonuses = rates.bonuses && rates.bonuses.length > 0
      ? rates.bonuses
      : getDefaultBonuses();
    setLocalBonuses(initialBonuses);
    setIsEditing(false);
    setSaveError('');
  };

  const handleApply = async () => {
    setIsSaving(true);
    setSaveError('');

    const emptyName = localShiftTypes.some(t => !t.isArchived && !t.name.trim());
    if (emptyName) {
      setSaveError('Название смены не может быть пустым');
      setIsSaving(false);
      return;
    }

    const emptyPtName = localPartTimeShiftTypes.some(t => !t.isArchived && !t.name.trim());
    if (emptyPtName) {
      setSaveError('Название смены подработчика не может быть пустым');
      setIsSaving(false);
      return;
    }

    const emptyBonusName = localBonuses.some(b => !b.isArchived && !b.name.trim());
    if (emptyBonusName) {
      setSaveError('Название корректировки не может быть пустым');
      setIsSaving(false);
      return;
    }

    const cleanedRates: any = {};
    Object.entries(formRates).forEach(([k, v]) => {
      if (k !== 'shiftTypes' && k !== 'partTimeShiftTypes' && k !== 'bonuses') {
        cleanedRates[k] = Number(v) || 0;
      }
    });

    localShiftTypes.forEach(t => {
      cleanedRates[t.code] = Number(t.baseRate) || 0;
    });

    localPartTimeShiftTypes.forEach(t => {
      cleanedRates[t.code] = Number(t.baseRate) || 0;
    });
    const ptStd = localPartTimeShiftTypes.find(t => !t.isArchived && (t.code === 'pt_standard' || t.name.toLowerCase().includes('полн')));
    if (ptStd) cleanedRates.partTimeShiftRate = Number(ptStd.baseRate) || 0;
    const pt4h = localPartTimeShiftTypes.find(t => !t.isArchived && t.code === '4h');
    if (pt4h) cleanedRates['4h'] = Number(pt4h.baseRate) || 0;

    localBonuses.forEach(b => {
      if (['seniorBonus', 'partTimeBonus'].includes(b.code)) {
        cleanedRates[b.code] = Number(b.value) || 0;
      }
    });

    cleanedRates.shiftTypes = localShiftTypes;
    cleanedRates.partTimeShiftTypes = localPartTimeShiftTypes;
    cleanedRates.bonuses = localBonuses;

    const res = await saveRates(cleanedRates);
    setIsSaving(false);
    if (res.success) {
      setIsEditing(false);
    } else {
      setSaveError(res.error || 'Ошибка при сохранении ставок');
    }
  };

  const resetRates = async () => {
    const DEFAULT_RATES = {
      day12: 3500,
      night12: 4000,
      standard8: 2800,
      part6: 2100,
      part4: 1400,
      daily24: 7000,
      standard: 3500,
      '8h': 2800,
      '4h': 1400,
      nightBonus: 500,
      seniorBonus: 500,
      partTimeBonus: 0,
      shiftTypes: [
        { code: 'day12', name: 'Дневная смена (12ч)', baseRate: 3500, isArchived: false },
        { code: 'night12', name: 'Ночная смена (12ч)', baseRate: 4000, isArchived: false },
        { code: 'standard8', name: 'Стандартная (8ч)', baseRate: 2800, isArchived: false },
        { code: 'part6', name: 'Подработка (6ч)', baseRate: 2100, isArchived: false },
        { code: 'part4', name: 'Подработка (4ч)', baseRate: 1400, isArchived: false },
        { code: 'daily24', name: 'Суточная (24ч)', baseRate: 7000, isArchived: false },
      ],
      partTimeShiftTypes: [
        { code: 'part4', name: 'Подработка (4ч)', baseRate: 1400, isArchived: false },
        { code: 'part6', name: 'Подработка (6ч)', baseRate: 2100, isArchived: false },
        { code: 'standard8', name: 'Стандартная (8ч)', baseRate: 2800, isArchived: false },
      ],
      bonuses: [
        { code: 'nightBonus', name: 'Доплата за ночную смену', value: 500, isArchived: false, target: 'always' },
        { code: 'seniorBonus', name: 'Доплата Бригадиру / Старшему смены', value: 500, isArchived: false, target: 'senior' },
        { code: 'partTimeBonus', name: 'Доплата Подработчику', value: 0, isArchived: false, target: 'part_time' },
      ]
    };
    setIsSaving(true);
    setSaveError('');
    const res = await saveRates(DEFAULT_RATES);
    setIsSaving(false);
    if (res.success) {
      setIsEditing(false);
    } else {
      setSaveError(res.error || 'Ошибка при сбросе ставок');
    }
  };

  const handleUpdateShiftType = (index: number, field: string, val: any) => {
    setLocalShiftTypes(prev => prev.map((t, idx) => idx === index ? { ...t, [field]: val } : t));
  };

  const handleArchiveShiftType = (index: number) => {
    setLocalShiftTypes(prev => prev.map((t, idx) => idx === index ? { ...t, isArchived: true } : t));
  };

  const handleRestoreShiftType = (index: number) => {
    setLocalShiftTypes(prev => prev.map((t, idx) => idx === index ? { ...t, isArchived: false } : t));
  };

  const handleAddShiftType = () => {
    const code = `shift_${Date.now()}`;
    setLocalShiftTypes(prev => [
      ...prev,
      { code, name: 'Смена...', baseRate: 1500, isArchived: false }
    ]);
  };

  const handleUpdatePartTimeShiftType = (index: number, field: string, val: any) => {
    setLocalPartTimeShiftTypes(prev => prev.map((t, idx) => idx === index ? { ...t, [field]: val } : t));
  };

  const handleArchivePartTimeShiftType = (index: number) => {
    setLocalPartTimeShiftTypes(prev => prev.map((t, idx) => idx === index ? { ...t, isArchived: true } : t));
  };

  const handleRestorePartTimeShiftType = (index: number) => {
    setLocalPartTimeShiftTypes(prev => prev.map((t, idx) => idx === index ? { ...t, isArchived: false } : t));
  };

  const handleAddPartTimeShiftType = () => {
    const code = `pt_shift_${Date.now()}`;
    setLocalPartTimeShiftTypes(prev => [
      ...prev,
      { code, name: 'Смена подработчика...', baseRate: 1000, isArchived: false }
    ]);
  };

  const handleUpdateBonus = (index: number, field: string, val: any) => {
    setLocalBonuses(prev => prev.map((b, idx) => idx === index ? { ...b, [field]: val } : b));
  };

  const handleArchiveBonus = (index: number) => {
    setLocalBonuses(prev => prev.map((b, idx) => idx === index ? { ...b, isArchived: true } : b));
  };

  const handleRestoreBonus = (index: number) => {
    setLocalBonuses(prev => prev.map((b, idx) => idx === index ? { ...b, isArchived: false } : b));
  };

  const handleAddBonus = () => {
    const code = `bonus_${Date.now()}`;
    setLocalBonuses(prev => [
      ...prev,
      { code, name: 'Новая доплата', value: 100, isArchived: false, target: 'always' }
    ]);
  };

  const statsMap = aggregateMonthlyStats(records, selectedMonth, undefined);

  const enrichedStats = Array.from(statsMap.values()).map(stat => {
    const staff = staffList.find(s => s.id === stat.employeeId);

    let totalBaseSalary = 0;
    let totalNightBonus = 0;
    let totalEarnings = 0;

    stat.records.forEach(rec => {
      if (rec.shiftType) {
        const breakdown = calculateShiftBreakdown(rec, staff, rates);
        totalBaseSalary += breakdown.basePay;
        totalNightBonus += breakdown.nightBonus;
        totalEarnings += breakdown.total;
      }
    });

    return {
      ...stat,
      totalBaseSalary,
      totalNightBonus,
      totalEarnings,
    };
  });

  let grandTotalShifts = 0;
  let grandDayShifts = 0;
  let grandNightShifts = 0;
  let grandTotalHours = 0;
  let grandBaseSalary = 0;
  let grandNightBonus = 0;
  let grandTotalEarnings = 0;
  let grandQrVerified = 0;
  let grandGeoVerified = 0;

  for (const stat of enrichedStats) {
    grandTotalShifts += stat.shiftsCount.total;
    grandDayShifts += stat.dayShiftsCount;
    grandNightShifts += stat.nightShiftsCount;
    grandTotalHours += stat.totalWorkedHours;
    grandBaseSalary += stat.totalBaseSalary;
    grandNightBonus += stat.totalNightBonus;
    grandTotalEarnings += stat.totalEarnings;
    grandQrVerified += stat.qrVerifiedCount;
    grandGeoVerified += stat.geoVerifiedCount;
  }

  return (
    <div className="space-y-6">
      {/* Month Switcher Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <CustomPeriodSelect
            value={selectedMonth}
            onChange={setSelectedMonth}
            options={allAvailableMonths}
            labelPrefix="Период:"
            align="left"
            showQuickNav
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRatesConfig(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer rounded text-xs font-semibold border transition-colors bg-white hover:bg-[#f7f9ff] text-[#111111] border-[#d9dbe0]"
          >
            <Sliders className="w-3.5 h-3.5 text-[#2f63ff]" />
            <span>Настройка смен и тарифных ставок</span>
          </button>
        </div>
      </div>

      {/* Tariff Configuration Modal */}
      {showRatesConfig && (
        <div
          onClick={e => {
            if (e.target === e.currentTarget && !isSaving) {
              if (isEditing) handleCancel();
              setShowRatesConfig(false);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto"
        >
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-5xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto">
            <div className="p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between flex-wrap gap-3 shrink-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <Settings className="w-4 h-4 text-[#2f63ff] shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-[#111111]">Настройка смен и тарифных ставок</h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    {isEditing ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#b45309] font-semibold">
                        <Unlock className="w-3 h-3" />
                        Редактирование активно
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#5d6270] font-medium">
                        <Lock className="w-3 h-3 text-[#2f63ff]" />
                        Защищено от случайных правок
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
              {isEditing ? (
                <>
                  <button
                    onClick={handleApply}
                    disabled={isSaving}
                    className="flex items-center gap-1 px-3 py-1.5 cursor-pointer bg-[#2f63ff] hover:bg-[#1f4fe0] text-white text-xs font-bold rounded transition-colors disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Применить</span>
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="flex items-center gap-1 px-3 py-1.5 cursor-pointer bg-white hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] text-xs font-medium rounded transition-colors disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Отмена</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleEditToggle}
                    className="flex items-center gap-1 px-3 py-1.5 cursor-pointer bg-[#111111] hover:bg-[#2d313b] text-white text-xs font-semibold rounded transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-[#a9bcff]" />
                    <span>Редактировать</span>
                  </button>
                  <button
                    onClick={resetRates}
                    disabled={isSaving}
                    className="px-2.5 py-1.5 text-xs text-[#5d6270] hover:text-[#111111] transition-colors cursor-pointer font-medium"
                  >
                    Сбросить к заводским
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  if (isEditing) handleCancel();
                  setShowRatesConfig(false);
                }}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded transition-colors cursor-pointer"
                title="Закрыть окно"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            </div>

            <div className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto bg-white">
              {saveError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span className="font-medium">{saveError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Block 1: Base shift rates */}
            <div className="bg-white border border-[#d9dbe0] rounded-md flex flex-col justify-between overflow-hidden">
              <div className="flex flex-col flex-1">
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb]">
                  <div>
                    <h5 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">Базовые оклады (₽)</h5>
                    <div className="text-[11px] text-[#5d6270]">Для штатных сотрудников</div>
                  </div>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={handleAddShiftType}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[#111111] bg-white border border-[#d9dbe0] rounded hover:bg-[#eef2ff] cursor-pointer transition-colors"
                    >
                      <Plus className="w-3 h-3 text-[#2f63ff]" />
                      <span>Смена</span>
                    </button>
                  )}
                </div>

                <div className="divide-y divide-[#e5e7eb] max-h-[300px] overflow-y-auto">
                  {localShiftTypes.filter(t => !t.isArchived).map((t) => {
                    const actualIndex = localShiftTypes.findIndex(x => x.code === t.code);
                    return (
                      <div key={t.code} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#f7f9ff]/60 transition-colors">
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <input
                              type="text"
                              required
                              placeholder="Название смены..."
                              value={t.name}
                              onChange={e => handleUpdateShiftType(actualIndex, 'name', e.target.value)}
                              className="w-full px-2 py-0.5 text-xs bg-white border border-[#d9dbe0] focus:border-[#2f63ff] rounded text-[#111111] font-medium outline-none"
                            />
                          ) : (
                            <span className="text-xs font-medium text-[#111111] truncate block">{t.name}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="flex items-center bg-[#f7f9ff] border border-[#d9dbe0] rounded overflow-hidden focus-within:border-[#2f63ff]">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="0"
                              value={t.baseRate ?? ''}
                              disabled={!isEditing}
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateShiftType(actualIndex, 'baseRate', e.target.value === '' ? '' : Number(e.target.value.replace(/\D/g, '')))}
                              className="w-14 px-1.5 py-0.5 text-xs text-right bg-transparent text-[#2f63ff] font-mono outline-none disabled:opacity-80 font-semibold tabular-nums"
                            />
                            <span className="text-[11px] text-[#5d6270] pr-1.5 font-medium">₽</span>
                          </div>

                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => handleArchiveShiftType(actualIndex)}
                              className="p-1 text-[#5d6270] hover:text-rose-600 rounded transition-colors cursor-pointer"
                              title="Архивировать смену"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {localShiftTypes.some(t => t.isArchived) && (
                <div className="px-3.5 py-2.5 bg-[#f7f9ff] border-t border-[#e5e7eb] space-y-1.5">
                  <div className="text-[11px] text-[#5d6270] uppercase tracking-wider font-medium">Архивные типы смен</div>
                  <div className="divide-y divide-[#e5e7eb] max-h-20 overflow-y-auto">
                    {localShiftTypes.filter(t => t.isArchived).map((t) => {
                      const actualIndex = localShiftTypes.findIndex(x => x.code === t.code);
                      return (
                        <div key={t.code} className="py-1 flex items-center justify-between text-xs text-[#5d6270]">
                          <span className="line-through truncate mr-1">{t.name} ({t.baseRate} ₽)</span>
                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => handleRestoreShiftType(actualIndex)}
                              className="text-xs text-[#2f63ff] hover:underline font-medium cursor-pointer shrink-0"
                            >
                              Восстановить
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Block 2: Part-timer shift rates */}
            <div className="bg-white border border-[#d9dbe0] rounded-md flex flex-col justify-between overflow-hidden">
              <div className="flex flex-col flex-1">
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb]">
                  <div>
                    <h5 className="text-xs font-semibold text-[#b45309] uppercase tracking-wider">Смены Подработчика (₽)</h5>
                    <div className="text-[11px] text-[#5d6270]">Доступны только подработчикам</div>
                  </div>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={handleAddPartTimeShiftType}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[#111111] bg-white border border-[#d9dbe0] rounded hover:bg-[#eef2ff] cursor-pointer transition-colors"
                    >
                      <Plus className="w-3 h-3 text-[#b45309]" />
                      <span>Смена</span>
                    </button>
                  )}
                </div>

                <div className="divide-y divide-[#e5e7eb] max-h-[300px] overflow-y-auto">
                  {localPartTimeShiftTypes.filter(t => !t.isArchived).map((t) => {
                    const actualIndex = localPartTimeShiftTypes.findIndex(x => x.code === t.code);
                    return (
                      <div key={t.code} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#f7f9ff]/60 transition-colors">
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <input
                              type="text"
                              required
                              placeholder="Смена подработчика..."
                              value={t.name}
                              onChange={e => handleUpdatePartTimeShiftType(actualIndex, 'name', e.target.value)}
                              className="w-full px-2 py-0.5 text-xs bg-white border border-[#d9dbe0] focus:border-[#2f63ff] rounded text-[#111111] font-medium outline-none"
                            />
                          ) : (
                            <span className="text-xs font-medium text-[#111111] truncate block">{t.name}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="flex items-center bg-[#f7f9ff] border border-[#d9dbe0] rounded overflow-hidden focus-within:border-[#2f63ff]">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="0"
                              value={t.baseRate ?? ''}
                              disabled={!isEditing}
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdatePartTimeShiftType(actualIndex, 'baseRate', e.target.value === '' ? '' : Number(e.target.value.replace(/\D/g, '')))}
                              className="w-14 px-1.5 py-0.5 text-xs text-right bg-transparent text-[#b45309] font-mono outline-none disabled:opacity-80 font-semibold tabular-nums"
                            />
                            <span className="text-[11px] text-[#5d6270] pr-1.5 font-medium">₽</span>
                          </div>

                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => handleArchivePartTimeShiftType(actualIndex)}
                              className="p-1 text-[#5d6270] hover:text-rose-600 rounded transition-colors cursor-pointer"
                              title="Архивировать смену"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-3.5 py-2.5 bg-[#f7f9ff] border-t border-[#e5e7eb] space-y-1.5">
                <div className="text-[11px] text-[#5d6270] leading-tight">
                  Подработчики могут отмечать чекин только для этих типов смен (либо взятых с биржи).
                </div>

                {localPartTimeShiftTypes.some(t => t.isArchived) && (
                  <div className="space-y-1 pt-1 border-t border-[#e5e7eb]">
                    <div className="text-[11px] text-[#5d6270] uppercase tracking-wider font-medium">Архивные смены подработчика</div>
                    <div className="divide-y divide-[#e5e7eb] max-h-20 overflow-y-auto">
                      {localPartTimeShiftTypes.filter(t => t.isArchived).map((t) => {
                        const actualIndex = localPartTimeShiftTypes.findIndex(x => x.code === t.code);
                        return (
                          <div key={t.code} className="py-1 flex items-center justify-between text-xs text-[#5d6270]">
                            <span className="line-through truncate mr-1">{t.name} ({t.baseRate} ₽)</span>
                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => handleRestorePartTimeShiftType(actualIndex)}
                                className="text-xs text-[#b45309] hover:underline font-medium cursor-pointer shrink-0"
                              >
                                Восстановить
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Block 3: Status & Location Modifiers */}
            <div className="bg-white border border-[#d9dbe0] rounded-md flex flex-col justify-between overflow-hidden">
              <div className="flex flex-col flex-1">
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb]">
                  <div>
                    <h5 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">Корректировки и бонусы (₽)</h5>
                    <div className="text-[11px] text-[#5d6270]">Доплаты за статус, склад и смены</div>
                  </div>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={handleAddBonus}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[#111111] bg-white border border-[#d9dbe0] rounded hover:bg-[#eef2ff] cursor-pointer transition-colors"
                    >
                      <Plus className="w-3 h-3 text-[#2f63ff]" />
                      <span>Бонус</span>
                    </button>
                  )}
                </div>

                <div className={`divide-y divide-[#e5e7eb] ${isEditing ? 'overflow-visible' : 'max-h-[300px] overflow-y-auto'}`}>
                  {localBonuses.filter(b => !b.isArchived).map((b) => {
                    const actualIndex = localBonuses.findIndex(x => x.code === b.code);
                    return (
                      <div key={b.code} className="px-3 py-2.5 space-y-2 relative hover:bg-[#f7f9ff]/60 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            {isEditing ? (
                              <input
                                type="text"
                                required
                                placeholder="Название доплаты..."
                                value={b.name}
                                onChange={e => handleUpdateBonus(actualIndex, 'name', e.target.value)}
                                className="w-full px-2 py-0.5 text-xs bg-white border border-[#d9dbe0] focus:border-[#2f63ff] rounded text-[#111111] font-medium outline-none"
                              />
                            ) : (
                              <span className="text-xs font-medium text-[#111111] truncate block">{b.name}</span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="flex items-center bg-[#f7f9ff] border border-[#d9dbe0] rounded overflow-hidden focus-within:border-[#2f63ff]">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="0"
                                value={b.value ?? ''}
                                disabled={!isEditing}
                                onFocus={e => e.target.select()}
                                onClick={e => (e.target as HTMLInputElement).select()}
                                onChange={e => handleUpdateBonus(actualIndex, 'value', e.target.value === '' ? '' : Number(e.target.value.replace(/\D/g, '')))}
                                className="w-14 px-1.5 py-0.5 text-xs text-right bg-transparent text-[#2f63ff] font-mono outline-none disabled:opacity-80 font-semibold tabular-nums"
                              />
                              <span className="text-[11px] text-[#5d6270] pr-1.5 font-medium">₽</span>
                            </div>

                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => handleArchiveBonus(actualIndex)}
                                className="p-1 text-[#5d6270] hover:text-rose-600 rounded transition-colors cursor-pointer"
                                title="Архивировать доплату"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className={isEditing ? 'space-y-1' : 'flex items-center gap-1.5 text-xs'}>
                          <label className="text-[#5d6270] font-medium text-[11px] uppercase tracking-wider shrink-0">Кому:</label>
                          {isEditing ? (
                            <CustomSelect
                              size="sm"
                              value={b.target || 'always'}
                              onChange={val => handleUpdateBonus(actualIndex, 'target', val)}
                              menuHeaderTitle="Кому начисляется доплата"
                              options={[
                                { value: 'senior', label: 'Старшему (Ст.С.)' },
                                { value: 'part_time', label: 'Подработчику' },
                                ...(pickupPoints || []).map(p => ({
                                  value: `location_${p.code.toLowerCase()}`,
                                  label: `Склад ${p.code}`
                                })),
                                { value: 'always', label: 'Всем всегда' },
                                { value: 'weekend', label: 'Только в выходные' },
                              ]}
                            />
                          ) : (
                            <span className="text-xs font-semibold">
                              {b.target === 'senior' && (
                                <span className="text-[#2f63ff]">Старшему (Ст.С.)</span>
                              )}
                              {b.target === 'part_time' && (
                                <span className="text-[#b45309]">Подработчику</span>
                              )}
                              {b.target && (b.target.startsWith('location_') || b.target.startsWith('loc_')) && (
                                <span className="text-[#2f63ff] font-mono">
                                  Склад {b.target.replace(/^(location_|loc_)/, '').toUpperCase()}
                                </span>
                              )}
                              {(!b.target || b.target === 'always') && (
                                <span className="text-[#2d313b] font-medium">Всем всегда</span>
                              )}
                              {b.target === 'weekend' && (
                                <span className="text-[#b45309]">Только в выходные (Сб/Вс)</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {localBonuses.some(b => b.isArchived) && (
                <div className="px-3.5 py-2.5 bg-[#f7f9ff] border-t border-[#e5e7eb] space-y-1.5">
                  <div className="text-[11px] text-[#5d6270] uppercase tracking-wider font-medium">Архивные доплаты</div>
                  <div className="divide-y divide-[#e5e7eb] max-h-20 overflow-y-auto">
                    {localBonuses.filter(b => b.isArchived).map((b) => {
                      const actualIndex = localBonuses.findIndex(x => x.code === b.code);
                      return (
                        <div key={b.code} className="py-1 flex items-center justify-between text-xs text-[#5d6270]">
                          <span className="line-through truncate mr-1">{b.name} ({b.value} ₽)</span>
                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => handleRestoreBonus(actualIndex)}
                              className="text-xs text-[#2f63ff] hover:underline font-medium cursor-pointer shrink-0"
                            >
                              Восстановить
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between gap-3 flex-wrap shrink-0">
              <div className="text-[11px] text-[#5d6270] leading-relaxed">
                <strong className="text-[#111111]">Защита от правок активна по умолчанию.</strong> Нажмите «Редактировать», внесите изменения и сохраните кнопкой «Применить».
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  if (isEditing) handleCancel();
                  setShowRatesConfig(false);
                }}
                className="px-4 py-1.5 text-xs font-semibold bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded transition-colors cursor-pointer shrink-0"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aggregate KPI Summary Strip */}
      <div className="bg-white border border-[#d9dbe0] rounded-md grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#e5e7eb] overflow-hidden">
        <div className="p-4 sm:p-4.5 flex flex-col justify-between">
          <div className="text-[11px] font-medium text-[#5d6270] mb-1 flex items-center justify-between">
            <span>Всего отработано смен</span>
            <Calendar className="w-3.5 h-3.5 text-[#5d6270]" />
          </div>
          <div className="text-xl font-bold text-[#111111] font-mono tabular-nums">
            {grandTotalShifts}
          </div>
          <div className="text-xs text-[#2d313b] mt-1 flex items-center gap-1.5 font-mono tabular-nums">
            <span className="flex items-center gap-0.5 text-[#b45309] font-medium">
              <Sun className="w-3 h-3" /> {grandDayShifts} дн.
            </span>
            <span>·</span>
            <span className="flex items-center gap-0.5 text-[#2f63ff] font-medium">
              <Moon className="w-3 h-3" /> {grandNightShifts} ночн.
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-4.5 flex flex-col justify-between">
          <div className="text-[11px] font-medium text-[#5d6270] mb-1 flex items-center justify-between">
            <span>Отработано часов (Табель)</span>
            <Clock className="w-3.5 h-3.5 text-[#2f63ff]" />
          </div>
          <div className="text-xl font-bold text-[#111111] font-mono tabular-nums">
            {grandTotalHours} ч
          </div>
          <div className="text-xs text-[#2d313b] mt-1 flex items-center gap-2 font-mono tabular-nums">
            <span className="flex items-center gap-1 text-[#111111]" title="Подтверждено по QR-коду">
              <QrCode className="w-3 h-3 text-[#2f63ff]" /> {grandQrVerified}
            </span>
            <span>·</span>
            <span className="flex items-center gap-1 text-[#111111]" title="Подтверждено по GPS координатам">
              <MapPin className="w-3 h-3 text-[#2f63ff]" /> {grandGeoVerified}
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-4.5 flex flex-col justify-between">
          <div className="text-[11px] font-medium text-[#5d6270] mb-1 flex items-center justify-between">
            <span>Базовый ФОТ склада</span>
            <Wallet className="w-3.5 h-3.5 text-[#5d6270]" />
          </div>
          <div className="text-xl font-bold text-[#111111] font-mono tabular-nums">
            {formatCurrency(grandBaseSalary)}
          </div>
          <div className="text-xs text-[#5d6270] mt-1 font-mono tabular-nums">
            Ночные доплаты: +{formatCurrency(grandNightBonus)}
          </div>
        </div>

        <div className="p-4 sm:p-4.5 flex flex-col justify-between bg-[#eef2ff]/60">
          <div className="text-[11px] font-semibold text-[#2f63ff] mb-1 flex items-center justify-between">
            <span>Итого начислено (ФОТ)</span>
            <DollarSign className="w-3.5 h-3.5 text-[#2f63ff]" />
          </div>
          <div className="text-xl font-bold text-[#2f63ff] font-mono tabular-nums">
            {formatCurrency(grandTotalEarnings)}
          </div>
          <div className="text-xs text-[#5d6270] mt-1">
            К выплате за {formatMonthName(selectedMonth)}
          </div>
        </div>
      </div>

      {/* Detailed Monthly Report Table */}
      <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
        <div className="p-3.5 sm:p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[#2f63ff]" />
            <h3 className="text-sm font-semibold text-[#111111]">
              Табель смен и начисления рабочих за {formatMonthName(selectedMonth)}
            </h3>
          </div>
          <span className="text-xs text-[#5d6270]">
            Сотрудников в табеле: <strong className="text-[#111111] font-mono tabular-nums">{enrichedStats.length}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          {enrichedStats.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#5d6270]">
              Нет зафиксированных смен за {formatMonthName(selectedMonth)}.
            </div>
          ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#e5e7eb] text-xs font-semibold uppercase tracking-wider text-[#5d6270] bg-[#f7f9ff]">
                <th className="py-2.5 px-3 font-semibold">Сотрудник и роль</th>
                <th className="py-2.5 px-3 font-semibold">Форма оплаты</th>
                <th className="py-2.5 px-2 font-semibold text-center bg-[#eef2ff] text-[#2f63ff]">Смен</th>
                <th className="py-2.5 px-2 font-semibold text-center">День / Ночь</th>
                <th className="py-2.5 px-2.5 font-semibold text-center">Отработано часов</th>
                <th className="py-2.5 px-2.5 font-semibold text-center">Аудит явки</th>
                <th className="py-2.5 px-3 font-semibold text-right">Базовая оплата</th>
                <th className="py-2.5 px-3 font-semibold text-right">Ночные доплаты</th>
                <th className="py-2.5 px-3 font-semibold text-right">Итого к выплате</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e7eb] text-xs">
              {enrichedStats.map(stat => {
                const staff = staffList.find(s => s.id === stat.employeeId);
                const pos = staff?.position || (staff?.isSenior ? 'Старший смены' : (staff?.isPartTime ? 'Подработчик' : 'Работник склада'));
                const isHourly = staff?.payType === 'hourly';
                const rateText = isHourly
                  ? `${staff?.hourlyRate || 350} ₽/ч`
                  : `${staff?.shiftRate || 3500} ₽/см`;

                return (
                  <tr key={stat.employeeId} className="hover:bg-[#f7f9ff] transition-colors">
                    <td className="py-2.5 px-3 font-medium text-[#111111]">
                      <div className="font-semibold text-[#111111]">{stat.employeeName}</div>
                      <div className="text-[11px] text-[#5d6270] flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className="text-[#2d313b]">{pos}</span>
                        {staff?.isSenior && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-[#2f63ff]">Старший</span>
                          </>
                        )}
                        {staff?.isPartTime && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-[#b45309]">Подработчик</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[#2d313b]">
                      <div className="flex flex-col">
                        <span className="font-medium text-[#111111]">
                          {isHourly ? 'Почасовая' : 'За смену'}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-[#2f63ff]">
                          {rateText}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono tabular-nums font-semibold text-[#111111] bg-[#f7f9ff]/80">
                      {stat.shiftsCount.total}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono tabular-nums text-xs font-medium">
                      <span className="text-[#b45309]" title="Дневных смен">{stat.dayShiftsCount}д</span>
                      <span className="text-[#5d6270] mx-1">/</span>
                      <span className="text-[#2f63ff]" title="Ночных смен">{stat.nightShiftsCount}н</span>
                    </td>
                    <td className="py-2.5 px-2.5 text-center font-mono tabular-nums font-semibold text-[#111111]">
                      {stat.totalWorkedHours} ч
                    </td>
                    <td className="py-2.5 px-2.5 text-center font-mono tabular-nums text-[11px]">
                      <div className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center gap-0.5 text-[#111111]" title="Явок с QR-кодом">
                          <QrCode className="w-3 h-3 text-[#2f63ff]" />
                          <span>{stat.qrVerifiedCount}</span>
                        </span>
                        <span className="text-[#d9dbe0]">·</span>
                        <span className="inline-flex items-center gap-0.5 text-[#111111]" title="Явок с подтверждением GPS">
                          <MapPin className="w-3 h-3 text-[#2f63ff]" />
                          <span>{stat.geoVerifiedCount}</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#111111] font-medium">
                      {formatCurrency(stat.totalBaseSalary)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-[#2d313b]">
                      {stat.totalNightBonus > 0 ? `+${formatCurrency(stat.totalNightBonus)}` : '0 ₽'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#2f63ff] text-sm">
                      {formatCurrency(stat.totalEarnings)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#d9dbe0] bg-[#f7f9ff] text-xs font-semibold">
                <td className="py-3 px-3 text-[#111111] uppercase tracking-wider font-semibold" colSpan={2}>Итого по складу:</td>
                <td className="py-3 px-2 text-center font-mono tabular-nums text-[#2f63ff] font-bold bg-[#eef2ff]">{grandTotalShifts}</td>
                <td className="py-3 px-2 text-center font-mono tabular-nums text-[#111111] font-medium">
                  <span className="text-[#b45309]">{grandDayShifts}д</span> / <span className="text-[#2f63ff]">{grandNightShifts}н</span>
                </td>
                <td className="py-3 px-2.5 text-center font-mono tabular-nums text-[#111111] font-bold">
                  {grandTotalHours} ч
                </td>
                <td className="py-3 px-2.5 text-center font-mono tabular-nums text-[#5d6270] text-[11px]">
                  QR: {grandQrVerified} · GPS: {grandGeoVerified}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-[#111111] font-semibold">{formatCurrency(grandBaseSalary)}</td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-[#2d313b] font-semibold">+{formatCurrency(grandNightBonus)}</td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-[#2f63ff] text-sm font-bold">{formatCurrency(grandTotalEarnings)}</td>
              </tr>
            </tfoot>
          </table>
          )}
        </div>
      </div>
    </div>
  );
};
