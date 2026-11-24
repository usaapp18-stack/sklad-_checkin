import { CheckInRecord, DailySales, ShiftType, SHIFT_LABELS } from '../types';

export interface CalculatedDailySummary {
  photoCash: number;
  photoCard: number;
  photoTotal: number;
  printCash: number;
  printCard: number;
  printTotal: number;
  laminationCash: number;
  laminationCard: number;
  laminationTotal: number;
  totalCash: number;
  totalCard: number;
  totalSales: number;
  bonus: number; // 5%
}

export function calculateDailySales(sales: DailySales | null | undefined): CalculatedDailySummary {
  if (!sales) {
    return {
      photoCash: 0,
      photoCard: 0,
      photoTotal: 0,
      printCash: 0,
      printCard: 0,
      printTotal: 0,
      laminationCash: 0,
      laminationCard: 0,
      laminationTotal: 0,
      totalCash: 0,
      totalCard: 0,
      totalSales: 0,
      bonus: 0,
    };
  }

  const photoCash = Number(sales.photo?.cash) || 0;
  const photoCard = Number(sales.photo?.card) || 0;
  const photoTotal = photoCash + photoCard;

  const printCash = Number(sales.print?.cash) || 0;
  const printCard = Number(sales.print?.card) || 0;
  const printTotal = printCash + printCard;

  const laminationCash = Number(sales.lamination?.cash) || 0;
  const laminationCard = Number(sales.lamination?.card) || 0;
  const laminationTotal = laminationCash + laminationCard;

  // Support direct cash & card (or calculate from legacy breakdown)
  const totalCash = sales.cash !== undefined
    ? Number(sales.cash) || 0
    : (photoCash + printCash + laminationCash);

  const totalCard = sales.card !== undefined
    ? Number(sales.card) || 0
    : (photoCard + printCard + laminationCard);

  const totalSales = sales.total !== undefined && sales.total > 0 && sales.cash === undefined && sales.card === undefined
    ? Number(sales.total)
    : (totalCash + totalCard);

  // Bonus formula: 5% of total sales revenue
  const bonus = Math.round(totalSales * 0.05);

  return {
    photoCash,
    photoCard,
    photoTotal,
    printCash,
    printCard,
    printTotal,
    laminationCash,
    laminationCard,
    laminationTotal,
    totalCash,
    totalCard,
    totalSales,
    bonus,
  };
}

export interface EmployeeMonthlyStats {
  employeeId: string;
  employeeName: string;
  month: string; // YYYY-MM
  shiftsCount: {
    day12?: number;
    night12?: number;
    standard8?: number;
    part4?: number;
    part6?: number;
    daily24?: number;
    standard?: number;
    '400+'?: number;
    '500+'?: number;
    '8h'?: number;
    '4h'?: number;
    '500+_helper'?: number;
    '6h'?: number;
    total: number;
    [key: string]: number | undefined;
  };
  totalWorkedHours: number;
  dayShiftsCount: number;
  nightShiftsCount: number;
  qrVerifiedCount: number;
  geoVerifiedCount: number;
  sales: {
    photo: { cash: number; card: number; total: number };
    print: { cash: number; card: number; total: number };
    lamination: { cash: number; card: number; total: number };
    totalCash: number;
    totalCard: number;
    totalRevenue: number;
    totalBonus: number;
  };
  records: CheckInRecord[];
}

export function normalizeShiftType(type: string | null | undefined): ShiftType {
  if (!type) return 'standard';
  if (type === 'rate400') return '400+';
  if (type === 'rate500') return '500+';
  if (type === 'shift8h') return '8h';
  if (type === 'shift4h') return '4h';
  return type as ShiftType;
}

export function getShiftLabel(shiftType: string | null | undefined, rates?: any): string {
  if (!shiftType) return 'Без смены';

  const checkInRates = (r: any): string | null => {
    if (!r) return null;
    if (Array.isArray(r.shiftTypes)) {
      const found = r.shiftTypes.find((t: any) => t.code === shiftType);
      if (found && found.name) return found.name;
    }
    if (Array.isArray(r.partTimeShiftTypes)) {
      const found = r.partTimeShiftTypes.find((t: any) => t.code === shiftType);
      if (found && found.name) return found.name;
    }
    return null;
  };

  const fromPassed = checkInRates(rates);
  if (fromPassed) return fromPassed;

  if (SHIFT_LABELS[shiftType]) return SHIFT_LABELS[shiftType];
  const norm = normalizeShiftType(shiftType);
  if (SHIFT_LABELS[norm]) return SHIFT_LABELS[norm];

  // Prevent displaying raw technical IDs like shift_1791354388961 to users
  if (typeof shiftType === 'string') {
    if (shiftType.startsWith('pt_shift_') || shiftType.startsWith('pt_')) {
      return 'Смена подработчика';
    }
    if (shiftType.startsWith('shift_')) {
      return 'Дополнительная смена';
    }
  }

  return shiftType;
}

export function getDayOfWeekFromDate(dateStr?: string | null): number {
  if (!dateStr) return -1;
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  }
  const t = new Date(dateStr);
  return isNaN(t.getTime()) ? -1 : t.getDay();
}

export function getBaseShiftPay(rates: any, rawShiftType: string | null | undefined, isPartTime?: boolean, baseRate?: number): number {
  if (!rawShiftType) return 0;
  const norm = normalizeShiftType(rawShiftType);
  const ptFlag = Boolean(isPartTime && isPartTime !== ('0' as any) && isPartTime !== (0 as any));

  // If rates are loaded and provided, calculate strictly according to rates configuration
  if (rates) {
    // 1. Part-time employees
    if (ptFlag) {
      // Check partTimeShiftTypes configuration first
      if (Array.isArray(rates.partTimeShiftTypes)) {
        const foundPt = rates.partTimeShiftTypes.find((t: any) => 
          !t.isArchived && (
            t.code === rawShiftType || 
            t.code === norm ||
            ((norm === 'standard' || rawShiftType === 'standard' || rawShiftType === 'pt_standard') && (t.code === 'pt_standard' || t.code === 'standard'))
          )
        );
        if (foundPt) {
          return Number(foundPt.baseRate) || 0;
        }
      }

      // Check part-time standard shift rate
      if (norm === 'standard' || rawShiftType === 'standard' || rawShiftType === 'pt_standard') {
        if (rates.partTimeShiftRate !== undefined && rates.partTimeShiftRate !== null) {
          return Number(rates.partTimeShiftRate) || 0;
        }
      }

      // If part-timer worked a non-standard shift (e.g. 400+, 500+, 8h from shift exchange)
      if (Array.isArray(rates.shiftTypes)) {
        const found = rates.shiftTypes.find((t: any) => !t.isArchived && (t.code === rawShiftType || t.code === norm));
        if (found) {
          return Number(found.baseRate) || 0;
        }
      }

      if (rates[norm] !== undefined) return Number(rates[norm]) || 0;
      if (rates[rawShiftType] !== undefined) return Number(rates[rawShiftType]) || 0;
      if (rates.partTimeShiftRate !== undefined) return Number(rates.partTimeShiftRate) || 0;
    } else {
      // 2. Regular staff members
      if (Array.isArray(rates.shiftTypes)) {
        const found = rates.shiftTypes.find((t: any) => 
          !t.isArchived && (
            t.code === rawShiftType || 
            t.code === norm ||
            (rawShiftType === 'pt_standard' && t.code === 'standard')
          )
        );
        if (found) {
          return Number(found.baseRate) || 0;
        }
      }

      if (rawShiftType === 'pt_standard') {
        if (rates.standard !== undefined) return Number(rates.standard) || 2000;
      }

      if (rates[norm] !== undefined) return Number(rates[norm]) || 0;
      if (rates[rawShiftType] !== undefined) return Number(rates[rawShiftType]) || 0;
    }
  }

  // 3. Fallback to frozen baseRate if rates was not provided
  if (baseRate !== undefined && baseRate !== null) {
    return Number(baseRate) || 0;
  }

  // 4. Default warehouse rates fallback
  if (ptFlag) {
    if (norm === 'day12' || norm === 'standard' || rawShiftType === 'pt_standard') return 2100;
    if (norm === 'part4' || norm === '4h') return 1400;
    if (norm === 'part6') return 2100;
  }
  if (norm === 'day12' || norm === 'standard') return 3500;
  if (norm === 'night12') return 4000;
  if (norm === 'standard8' || norm === '8h') return 2800;
  if (norm === 'part6') return 2100;
  if (norm === 'part4' || norm === '4h') return 1400;
  if (norm === 'daily24') return 7000;
  if (norm === '400+') return 3800;
  if (norm === '500+') return 4200;

  return 0;
}

export function getRecordWorkedHours(rec: any): number {
  if (!rec) return 0;
  if (typeof rec.workedHours === 'number' && !isNaN(rec.workedHours) && rec.workedHours > 0) {
    return rec.workedHours;
  }
  const type = rec.shiftType;
  if (type === 'standard8' || type === '8h' || type === 'shift8h') return 8;
  if (type === 'part4' || type === '4h' || type === 'shift4h') return 4;
  if (type === 'part6') return 6;
  if (type === 'daily24') return 22; // 24h minus break allowance
  if (type === 'day12' || type === 'night12' || type === 'standard' || type === '400+' || type === '500+') return 11;
  return 11;
}

export function calculateShiftBreakdown(rec: any, staff: any, rates: any): {
  basePay: number;
  nightBonus: number;
  total: number;
  workedHours: number;
  isNight: boolean;
} {
  if (!rec || !rec.shiftType) {
    return { basePay: 0, nightBonus: 0, total: 0, workedHours: 0, isNight: false };
  }

  const workedHours = getRecordWorkedHours(rec);
  const isNight = Boolean(rec.shiftType === 'night12' || rec.isNightShift);

  // 1. Hourly pay type
  if (staff?.payType === 'hourly' && staff.hourlyRate) {
    const basePay = Math.round(workedHours * Number(staff.hourlyRate));
    const nightBonus = isNight ? Number(staff.nightRate || 0) : 0;
    return {
      basePay,
      nightBonus,
      total: basePay + nightBonus,
      workedHours,
      isNight,
    };
  }

  // 2. Fixed shift pay type
  if (staff?.payType === 'shift' && staff.shiftRate) {
    const basePay = Number(staff.shiftRate);
    const nightBonus = isNight ? Number(staff.nightRate || 0) : 0;
    return {
      basePay,
      nightBonus,
      total: basePay + nightBonus,
      workedHours,
      isNight,
    };
  }

  // 3. Fallback to standard rates table
  const isPartTime = Boolean(staff?.isPartTime && staff.isPartTime !== '0' && staff.isPartTime !== 0);
  const basePay = getBaseShiftPay(rates, rec.shiftType, isPartTime, rec.baseRate);
  const nightBonus = isNight ? Number(rates?.nightBonus || 500) : 0;
  const dynamicBonuses = calculateShiftBonuses(rec, staff, rates);

  return {
    basePay,
    nightBonus: nightBonus + dynamicBonuses,
    total: basePay + nightBonus + dynamicBonuses,
    workedHours,
    isNight,
  };
}

export function calculateShiftTotalSalary(rec: any, staff: any, rates: any): number {
  return calculateShiftBreakdown(rec, staff, rates).total;
}

export function calculateShiftBonuses(rec: any, staff: any, rates: any): number {
  if (!rates) return 0;
  
  const defaultBonuses = [
    { code: 'seniorBonus', name: 'Доплата Старшему (Ст.С.)', value: rates.seniorBonus || 200, isArchived: false, target: 'senior' },
    { code: 'partTimeBonus', name: 'Доплата Подработчику', value: rates.partTimeBonus || 0, isArchived: false, target: 'part_time' },
  ];
  
  const bonuses = Array.isArray(rates.bonuses) && rates.bonuses.length > 0 ? rates.bonuses : defaultBonuses;
  let totalBonus = 0;

  const isSenior = Boolean(staff?.isSenior && staff.isSenior !== '0' && staff.isSenior !== 0);
  const isPartTime = Boolean(staff?.isPartTime && staff.isPartTime !== '0' && staff.isPartTime !== 0);
  const recLoc = String(rec?.location || '').trim().toUpperCase();
  const dayOfWeek = getDayOfWeekFromDate(rec?.date);
  
  bonuses.forEach((b: any) => {
    if (b.isArchived) return;
    const value = Number(b.value) || 0;
    if (value === 0) return;
    
    if (b.target === 'senior' && isSenior) {
      totalBonus += value;
    } else if (b.target === 'part_time' && isPartTime) {
      totalBonus += value;
    } else if (b.target === 'always') {
      totalBonus += value;
    } else if (b.target === 'weekend' && (dayOfWeek === 0 || dayOfWeek === 6)) {
      totalBonus += value;
    } else if (b.target && (b.target.startsWith('location_') || b.target.startsWith('loc_'))) {
      const targetLoc = b.target.replace(/^(location_|loc_)/, '').toUpperCase();
      if (recLoc === targetLoc || (targetLoc === 'BD' && recLoc === 'БД') || (targetLoc === 'SD' && recLoc === 'СД')) {
        totalBonus += value;
      }
    } else if (b.target && recLoc === String(b.target).toUpperCase()) {
      totalBonus += value;
    }
  });
  
  return totalBonus;
}

export function aggregateMonthlyStats(
  records: CheckInRecord[],
  month: string, // YYYY-MM
  filterEmployeeId?: string
): Map<string, EmployeeMonthlyStats> {
  const map = new Map<string, EmployeeMonthlyStats>();

  const filtered = records.filter(r => {
    if (!r.date.startsWith(month)) return false;
    if (filterEmployeeId && r.employeeId !== filterEmployeeId) return false;
    return true;
  });

  // Strict deduplication: ensure only the LATEST shift variant per (employeeId, date) is counted
  const latestByEmployeeAndDate = new Map<string, CheckInRecord>();
  const toMs = (val?: string) => {
    if (!val) return 0;
    const iso = val.includes(' ') && !val.includes('T') ? val.replace(' ', 'T') : val;
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  };

  for (const rec of filtered) {
    const key = `${rec.employeeId}_${rec.date}`;
    const existing = latestByEmployeeAndDate.get(key);
    if (!existing) {
      latestByEmployeeAndDate.set(key, rec);
    } else {
      const tRec = toMs(rec.checkedInAt || rec.timestamp || `${rec.date}T00:00:00`);
      const tExist = toMs(existing.checkedInAt || existing.timestamp || `${existing.date}T00:00:00`);
      if (tRec >= tExist) {
        const merged = !rec.sales && existing.sales ? { ...rec, sales: existing.sales } : rec;
        latestByEmployeeAndDate.set(key, merged);
      } else if (!existing.sales && rec.sales) {
        latestByEmployeeAndDate.set(key, { ...existing, sales: rec.sales });
      }
    }
  }

  const deduplicated = Array.from(latestByEmployeeAndDate.values());

  for (const rec of deduplicated) {
    let stat = map.get(rec.employeeId);
    if (!stat) {
      stat = {
        employeeId: rec.employeeId,
        employeeName: rec.employeeName,
        month,
        shiftsCount: {
          total: 0,
        },
        totalWorkedHours: 0,
        dayShiftsCount: 0,
        nightShiftsCount: 0,
        qrVerifiedCount: 0,
        geoVerifiedCount: 0,
        sales: {
          photo: { cash: 0, card: 0, total: 0 },
          print: { cash: 0, card: 0, total: 0 },
          lamination: { cash: 0, card: 0, total: 0 },
          totalCash: 0,
          totalCard: 0,
          totalRevenue: 0,
          totalBonus: 0,
        },
        records: [],
      };
      map.set(rec.employeeId, stat);
    }

    stat.records.push(rec);

    // Calculate hours worked for this shift
    const hours = getRecordWorkedHours(rec);
    stat.totalWorkedHours += hours;

    // Check-in verification counts
    if (rec.qrVerified) stat.qrVerifiedCount += 1;
    if (rec.geoVerified) stat.geoVerifiedCount += 1;

    // Shift classification (Day vs Night)
    const isNight = rec.shiftType === 'night12' || rec.isNightShift;
    if (isNight) {
      stat.nightShiftsCount += 1;
    } else {
      stat.dayShiftsCount += 1;
    }

    if (rec.shiftType) {
      const normType = normalizeShiftType(rec.shiftType);
      stat.shiftsCount[normType] = (stat.shiftsCount[normType] || 0) + 1;
      if (normType !== rec.shiftType) {
        stat.shiftsCount[rec.shiftType] = (stat.shiftsCount[rec.shiftType] || 0) + 1;
      }
      stat.shiftsCount.total += 1;
    }

    if (rec.sales) {
      const summary = calculateDailySales(rec.sales);
      stat.sales.photo.cash += summary.photoCash;
      stat.sales.photo.card += summary.photoCard;
      stat.sales.photo.total += summary.photoTotal;

      stat.sales.print.cash += summary.printCash;
      stat.sales.print.card += summary.printCard;
      stat.sales.print.total += summary.printTotal;

      stat.sales.lamination.cash += summary.laminationCash;
      stat.sales.lamination.card += summary.laminationCard;
      stat.sales.lamination.total += summary.laminationTotal;

      stat.sales.totalCash += summary.totalCash;
      stat.sales.totalCard += summary.totalCard;
      stat.sales.totalRevenue += summary.totalSales;
      stat.sales.totalBonus += summary.bonus;
    }
  }

  return map;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'decimal',
    maximumFractionDigits: 0,
  }).format(amount) + '\u00A0₽';
}

export function formatDateDDMMYYYY(dateStr?: string | null): string {
  if (!dateStr) return '';
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return dateStr;
}
