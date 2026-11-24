import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getCurrentAndPreviousMonth, formatMonthName, formatDisplayDate, getAllAvailableMonths } from '../../utils/time';
import {
  aggregateMonthlyStats,
  formatCurrency,
  calculateShiftBreakdown,
  getRecordWorkedHours,
  getShiftLabel
} from '../../utils/calculations';
import {
  QrCode,
  MapPin,
  Sun,
  Moon,
} from 'lucide-react';
import { CustomPeriodSelect } from '../common/CustomPeriodSelect';
import { AccessibleModal } from '../common/AccessibleModal';

interface ShiftStatsViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShiftStatsView: React.FC<ShiftStatsViewProps> = ({ isOpen, onClose }) => {
  const { currentStaffId, currentStaff, records, rates } = useApp();
  const { current } = getCurrentAndPreviousMonth();
  const allAvailableMonths = getAllAvailableMonths(records, 12);
  const [selectedMonth, setSelectedMonth] = useState<string>(current);

  if (!isOpen) return null;

  const statsMap = aggregateMonthlyStats(records, selectedMonth, currentStaffId);
  const myStat = statsMap.get(currentStaffId);

  const monthRecords = (myStat?.records || [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));

  let totalNightBonus = 0;
  let totalEarnings = 0;
  let totalWorkedHours = 0;

  monthRecords.forEach(rec => {
    if (rec.shiftType) {
      const breakdown = calculateShiftBreakdown(rec, currentStaff, rates);
      totalNightBonus += breakdown.nightBonus;
      totalEarnings += breakdown.total;
      totalWorkedHours += breakdown.workedHours;
    }
  });

  const pos = currentStaff?.position || (currentStaff?.isSenior ? 'Старший смены' : (currentStaff?.isPartTime ? 'Подработчик' : 'Работник склада'));
  const isHourly = currentStaff?.payType === 'hourly';
  const rateText = isHourly
    ? `${currentStaff?.hourlyRate || 350} ₽ / час`
    : `${currentStaff?.shiftRate || 3500} ₽ / смена`;

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Личные показатели и табель"
      subtitle={`${currentStaff?.name || 'Сотрудник'} · ${pos}`}
      maxWidthClass="max-w-2xl"
    >
      {/* Unified Month Selector */}
      <div className="p-3 sm:px-4 border border-[#d9dbe0] bg-white rounded-md flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <CustomPeriodSelect
          value={selectedMonth}
          onChange={setSelectedMonth}
          options={allAvailableMonths}
          labelPrefix="Период:"
          align="left"
          showQuickNav
          className="w-full sm:w-auto"
        />
        <div className="text-xs text-[#5d6270] font-mono tabular-nums">
          Смен за месяц: <strong className="text-[#111111]">{monthRecords.length}</strong>
        </div>
      </div>

      {/* Top Warehouse KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="p-2.5 sm:p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-center">
          <div className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270] mb-0.5">Всего смен</div>
          <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-[#111111]">
            {myStat?.shiftsCount.total || 0}
          </div>
          <div className="text-[11px] text-[#5d6270] font-mono tabular-nums mt-0.5">
            {myStat?.dayShiftsCount || 0}д / {myStat?.nightShiftsCount || 0}н
          </div>
        </div>

        <div className="p-2.5 sm:p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-center">
          <div className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270] mb-0.5">Часов по табелю</div>
          <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-[#2f63ff]">
            {totalWorkedHours} ч
          </div>
          <div className="text-[11px] text-[#5d6270] font-mono mt-0.5">
            чистые часы
          </div>
        </div>

        <div className="p-2.5 sm:p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-center">
          <div className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270] mb-0.5">Аудит явки</div>
          <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-[#2f63ff] flex items-center justify-center gap-1.5 mt-0.5">
            <span className="flex items-center gap-0.5" title="Явок с QR-кодом"><QrCode className="w-3 h-3" />{myStat?.qrVerifiedCount || 0}</span>
            <span className="text-[#d9dbe0]">|</span>
            <span className="flex items-center gap-0.5" title="Явок с GPS"><MapPin className="w-3 h-3" />{myStat?.geoVerifiedCount || 0}</span>
          </div>
          <div className="text-[11px] text-[#5d6270] font-mono mt-0.5">
            QR и GPS
          </div>
        </div>

        <div className="p-2.5 sm:p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-center">
          <div className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270] mb-0.5">Ночные доплаты</div>
          <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-[#2f63ff]">
            +{formatCurrency(totalNightBonus)}
          </div>
          <div className="text-[11px] text-[#5d6270] font-mono mt-0.5">
            за ночные часы
          </div>
        </div>

        <div className="p-2.5 sm:p-3 bg-[#eef2ff] border border-[#a9bcff] rounded-md text-center col-span-2 sm:col-span-1">
          <div className="text-[11px] uppercase font-semibold tracking-wider text-[#2f63ff] mb-0.5">К начислению</div>
          <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-[#111111]">
            {formatCurrency(totalEarnings)}
          </div>
          <div className="text-[11px] text-[#2f63ff] font-mono mt-0.5">
            {isHourly ? 'по часам' : 'за смены'}
          </div>
        </div>
      </div>

      {/* Warehouse Worker Rates & Terms */}
      <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] text-xs overflow-hidden">
        <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
          <span>Должность и форма оплаты:</span>
          <span className="font-semibold text-[#111111]">
            {pos} · {isHourly ? 'Почасовая ставка' : 'Фиксированная за смену'}
          </span>
        </div>
        <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
          <span>Базовая ставка:</span>
          <span className="font-mono tabular-nums font-bold text-[#111111]">{rateText}</span>
        </div>
        {currentStaff?.nightRate ? (
          <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
            <span>Ночная надбавка:</span>
            <span className="font-mono tabular-nums font-bold text-[#2f63ff]">+{currentStaff.nightRate} ₽ / смену</span>
          </div>
        ) : null}
      </div>

      {/* Breakdown by Shift Types */}
      {(() => {
        const shiftTypeCountsMap = new Map<string, number>();
        (myStat?.records || []).forEach(rec => {
          if (rec.shiftType) {
            shiftTypeCountsMap.set(rec.shiftType, (shiftTypeCountsMap.get(rec.shiftType) || 0) + 1);
          }
        });
        const workedShiftEntries = Array.from(shiftTypeCountsMap.entries());

        return (
          <div className="border border-[#d9dbe0] rounded-md bg-white overflow-hidden">
            <div className="px-3.5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb] text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
              Отработанные смены по категориям
            </div>
            {workedShiftEntries.length > 0 ? (
              <div className="divide-y divide-[#e5e7eb]">
                {workedShiftEntries.map(([code, count]) => (
                  <div key={code} className="px-3.5 py-2 flex items-center justify-between text-xs">
                    <span className="text-[#2d313b] font-medium truncate" title={getShiftLabel(code, rates)}>
                      {getShiftLabel(code, rates)}
                    </span>
                    <span className="font-bold font-mono tabular-nums text-[#2f63ff]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[#5d6270] italic py-3 text-center">
                Нет отмеченных смен за выбранный период
              </div>
            )}
          </div>
        );
      })()}

      {/* Daily Shift Log */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
          Журнал смен за {formatMonthName(selectedMonth)}
        </div>
        {monthRecords.length === 0 ? (
          <div className="p-4 rounded-md bg-[#f7f9ff] border border-[#d9dbe0] text-center text-xs text-[#5d6270]">
            Нет записей за выбранный месяц
          </div>
        ) : (
          <div className="rounded-md bg-white border border-[#d9dbe0] divide-y divide-[#e5e7eb] overflow-hidden">
            {monthRecords.map(rec => {
              const breakdown = calculateShiftBreakdown(rec, currentStaff, rates);
              const hours = getRecordWorkedHours(rec);
              const isNight = rec.shiftType === 'night12' || rec.isNightShift;

              return (
                <div
                  key={rec.id}
                  className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-[#f7f9ff] transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold text-[#111111] flex items-center gap-2 flex-wrap">
                      <span>{formatDisplayDate(rec.date)}</span>
                      <span className="text-[#d9dbe0]">·</span>
                      {isNight ? (
                        <span className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold">
                          <Moon className="w-3.5 h-3.5" /> Ночная
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-[#b45309] font-semibold">
                          <Sun className="w-3.5 h-3.5" /> Дневная
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#2d313b] flex items-center gap-1.5 flex-wrap">
                      <span>{rec.shiftType ? getShiftLabel(rec.shiftType, rates) : 'Без смены'}</span>
                      {rec.location && (
                        <>
                          <span className="text-[#d9dbe0]">·</span>
                          <span className="font-mono font-semibold text-[#2f63ff]">
                            {rec.location}
                          </span>
                        </>
                      )}
                      <span className="text-[#d9dbe0]">·</span>
                      <span className="text-[#111111] font-mono tabular-nums font-semibold">{hours} ч</span>
                      <span className="text-[#d9dbe0]">·</span>
                      <span className="text-xs text-[#5d6270] font-mono">
                        {rec.qrVerified ? 'QR: Да' : 'QR: Нет'} / {rec.geoVerified ? 'GPS: Да' : 'GPS: Нет'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="font-bold text-[#111111]">
                      {formatCurrency(breakdown.total)}
                    </div>
                    <div className="text-[11px] text-[#5d6270] leading-normal">
                      {isHourly ? `${hours}ч × ${currentStaff?.hourlyRate || 350}₽` : 'ставка за смену'}
                      {breakdown.nightBonus > 0 && ` +${formatCurrency(breakdown.nightBonus)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AccessibleModal>
  );
};
