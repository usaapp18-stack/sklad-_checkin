import * as XLSX from 'xlsx';
import { CheckInRecord, StaffMember, SHIFT_LABELS } from '../types';
import { aggregateMonthlyStats, calculateShiftBreakdown, getRecordWorkedHours } from './calculations';
import { formatMonthName } from './time';

export function exportMonthlyReportToExcel(
  records: CheckInRecord[],
  staffList: StaffMember[],
  months: string[], // e.g. ['2026-09', '2026-08', '2026-07']
  rates: any
) {
  const wb = XLSX.utils.book_new();

  // 1. Summary Sheet: Timesheet & Payroll Calculation
  const summaryRows: any[] = [];
  summaryRows.push([
    'Сотрудник',
    'Должность',
    'Тип оплаты',
    'Ставка (₽)',
    'Период',
    'Смен всего',
    'Дневных смен',
    'Ночных смен',
    'Отработано часов',
    'Явок с QR-кодом',
    'Явок с GPS',
    'Базовая оплата (₽)',
    'Ночные надбавки (₽)',
    'Итого начислено (₽)'
  ]);

  for (const m of months) {
    const statsMap = aggregateMonthlyStats(records, m);
    for (const staff of staffList) {
      const stat = statsMap.get(staff.id);
      
      const positionLabel = staff.position || (staff.isSenior ? 'Старший смены' : (staff.isPartTime ? 'Подработчик' : 'Работник склада'));
      const payTypeLabel = staff.payType === 'shift' ? 'За смену' : 'Почасовая';
      const rateLabel = staff.payType === 'shift'
        ? `${staff.shiftRate || 3500} ₽/см`
        : `${staff.hourlyRate || 350} ₽/ч`;

      if (stat) {
        let totalBasePay = 0;
        let totalNightBonus = 0;
        let totalEarnings = 0;

        stat.records.forEach(rec => {
          if (rec.shiftType) {
            const breakdown = calculateShiftBreakdown(rec, staff, rates);
            totalBasePay += breakdown.basePay;
            totalNightBonus += breakdown.nightBonus;
            totalEarnings += breakdown.total;
          }
        });

        summaryRows.push([
          staff.name,
          positionLabel,
          payTypeLabel,
          rateLabel,
          formatMonthName(m),
          stat.shiftsCount.total,
          stat.dayShiftsCount,
          stat.nightShiftsCount,
          stat.totalWorkedHours,
          stat.qrVerifiedCount,
          stat.geoVerifiedCount,
          totalBasePay,
          totalNightBonus,
          totalEarnings
        ]);
      } else if (staff.status === 'active') {
        summaryRows.push([
          staff.name,
          positionLabel,
          payTypeLabel,
          rateLabel,
          formatMonthName(m),
          0, 0, 0, 0, 0, 0,
          0, 0, 0
        ]);
      }
    }
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Табель и расчет ФОТ');

  // 2. Detailed Shifts & Check-ins Log
  const dailyRows: any[] = [];
  dailyRows.push([
    'Дата смены',
    'Сотрудник',
    'Должность',
    'Склад / Терминал',
    'Зона склада',
    'Тип смены',
    'Время Check-in',
    'Время Check-out',
    'Перерыв (мин)',
    'Отработано часов',
    'QR-код верификация',
    'GPS геопозиция',
    'Базовая ставка (₽)',
    'Ночная доплата (₽)',
    'Итого за смену (₽)'
  ]);

  const filteredRecords = records
    .filter(r => months.some(m => r.date.startsWith(m)))
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const r of filteredRecords) {
    const staff = staffList.find(s => s.id === r.employeeId);
    const positionLabel = staff?.position || (staff?.isSenior ? 'Старший смены' : (staff?.isPartTime ? 'Подработчик' : 'Работник склада'));

    const breakdown = calculateShiftBreakdown(r, staff, rates);
    const workedHours = getRecordWorkedHours(r);

    const checkInTime = r.checkedInAt || r.timestamp;
    const checkOutTime = r.checkOutAt;

    dailyRows.push([
      r.date,
      r.employeeName,
      positionLabel,
      r.location || '—',
      r.zone || 'Основная',
      r.shiftType ? (SHIFT_LABELS[r.shiftType] || r.shiftType) : '—',
      checkInTime ? new Date(checkInTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—',
      checkOutTime ? new Date(checkOutTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'В процессе',
      r.breakMinutes !== undefined ? r.breakMinutes : 60,
      workedHours,
      r.qrVerified ? 'Да' : 'Нет',
      r.geoVerified ? 'Да' : 'Нет',
      breakdown.basePay,
      breakdown.nightBonus,
      breakdown.total
    ]);
  }

  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Журнал смен и явок');

  // Generate file and trigger download
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `SKLADIN_Vedomost_${dateStr}.xlsx`);
}
