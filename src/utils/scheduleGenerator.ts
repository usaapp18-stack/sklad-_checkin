import { PlannedShift, ShiftType, StaffMember, AvailabilityRequest, ShiftSwapRequest } from '../types';

export type ScheduleType = '2/2' | '3/3' | '5/2' | 'hybrid' | 'custom';
export type Weekend52Mode = 'fixed' | 'floating' | 'manual';
export type ReinforcementMode = 'none' | 'weekdays' | 'weekends' | 'custom_days';
export type ThreeStaffScenario = 'queue' | 'weekdays' | 'weekends' | 'custom_days' | 'manual';

export interface DayInfo {
  dateStr: string;
  dayNum: number;
  dayOfWeek: number; // 0=Вс, 1=Пн, ... 6=Сб
  dayName: string;
}

export interface GeneratorConfig {
  location: string;
  monthStr: string;
  daysList: DayInfo[];
  scheduleType: ScheduleType;
  startCycleDay: number; // 1 to 31
  customWorkDays: number; // e.g. 4
  customRestDays: number; // e.g. 2
  weekend52Mode: Weekend52Mode;
  manualWeekends52: Record<string, number[]>; // employeeId -> [dayOfWeek, dayOfWeek]

  selectedStaffIds: string[];
  staffList: StaffMember[];
  hybridStaffConfig: Record<string, { type: '2/2' | '3/3' | '5/2' | 'custom'; workDays?: number; restDays?: number }>;

  baseCoverage: number;
  reinforcementMode: ReinforcementMode;
  reinforcementCoverage: number;
  reinforcementDaysOfWeek: number[]; // 1..5 for Mon..Fri, 0,6 for Sat,Sun
  threeStaffMode: ThreeStaffScenario;

  respectWishes: boolean;
  availabilityList: AvailabilityRequest[];
  ignoredWishKeys: string[]; // Set of `${employeeId}_${dateStr}` manually overridden by manager
  swapRequests?: ShiftSwapRequest[]; // Approved / claimed shifts from Shift Exchange (Биржа смен)

  shiftType: ShiftType;
  manualOverrides?: Record<string, string[]>; // dateStr -> employeeId[]
  otherExistingShifts?: PlannedShift[]; // Shifts already scheduled at other PVZs in this month
}

export interface DayAnalysis {
  dateStr: string;
  dayNum: number;
  dayOfWeek: number;
  dayName: string;
  targetCount: number;
  assignedStaffIds: string[];
  isReinforcedDay: boolean;
  coverageStatus: 'ok' | 'empty' | 'understaffed';
  wishesOnThisDay: {
    employeeId: string;
    employeeName: string;
    type: string;
    comment?: string;
    isMet: boolean;
    isIgnored: boolean;
  }[];
  exchangeShiftsOnThisDay?: {
    employeeId: string;
    employeeName: string;
    shiftType: string;
    location: string;
    requesterName?: string;
    status: string;
  }[];
  conflictReason?: string;
  crossPvzConflicts?: {
    employeeId: string;
    employeeName: string;
    location: string;
  }[];
}

export interface GeneratorResult {
  shifts: PlannedShift[];
  dayAnalysis: Record<string, DayAnalysis>;
  metrics: {
    totalDays: number;
    coveredDays: number;
    uncoveredDays: number;
    reinforcedDaysTarget: number;
    reinforcedDaysFulfilled: number;
    totalWishesInMonth: number;
    wishesRespected: number;
    wishesViolated: number;
    totalExchangeShiftsInMonth?: number;
    exchangeShiftsIncluded?: number;
    staffWorkload: {
      employeeId: string;
      employeeName: string;
      isSenior?: boolean;
      isPartTime?: boolean;
      shiftsCount: number;
      hours: number;
      percentOfMonth: number;
      dates: number[];
      wishesMet: number;
      wishesViolated: number;
    }[];
    criticalConflicts: {
      dateStr: string;
      dayNum: number;
      dayName: string;
      reason: string;
      staffWithWishes: { id: string; name: string }[];
    }[];
  };
}

/**
 * Calculates shift duration in hours based on ShiftType
 */
export function getShiftHours(shiftType: ShiftType): number {
  if (shiftType === 'standard8' || shiftType === 'shift8h' || shiftType === '8h') return 8;
  if (shiftType === 'part4' || shiftType === 'shift4h' || shiftType === '4h') return 4;
  if (shiftType === 'part6' || shiftType === '6h') return 6;
  if (shiftType === 'daily24') return 24;
  return 12; // Standard 2/2, 3/3, day12, night12, etc. are 12 hours
}

/**
 * Checks whether an employee has an active wish ("не могу выйти") on a given date
 */
export function hasEmployeeUnavailability(
  availabilityList: AvailabilityRequest[],
  employeeId: string,
  dateStr: string,
  ignoredWishKeys: string[] = []
): { hasWish: boolean; wish?: AvailabilityRequest; isIgnored: boolean } {
  const wish = availabilityList.find(
    a => a.employeeId === employeeId && a.date === dateStr && a.type !== 'preferred'
  );
  if (!wish) return { hasWish: false, isIgnored: false };

  const isIgnored = ignoredWishKeys.includes(`${employeeId}_${dateStr}`);
  return { hasWish: !isIgnored, wish, isIgnored };
}

/**
 * Builds and evaluates shifts for a PVZ according to the strict priority rules:
 * Coverage (min 1/day) > Reinforcement > Employee Wishes > Cycle fairness
 */
export function generateSchedulePlan(config: GeneratorConfig): GeneratorResult {
  const {
    location,
    daysList,
    scheduleType,
    startCycleDay,
    customWorkDays,
    customRestDays,
    weekend52Mode,
    manualWeekends52,
    selectedStaffIds,
    staffList,
    hybridStaffConfig,
    baseCoverage,
    reinforcementMode,
    reinforcementCoverage,
    reinforcementDaysOfWeek,
    threeStaffMode,
    respectWishes,
    availabilityList,
    ignoredWishKeys,
    swapRequests = [],
    shiftType,
    manualOverrides,
    otherExistingShifts = [],
  } = config;

  // Build a lookup map of staff shifts scheduled at OTHER PVZs: dateStr -> { [employeeId]: locationName }
  const otherShiftsMap: Record<string, Record<string, string>> = {};
  otherExistingShifts.forEach(shift => {
    // Only care if it's not the current PVZ location
    if (shift.location !== location) {
      if (!otherShiftsMap[shift.date]) {
        otherShiftsMap[shift.date] = {};
      }
      otherShiftsMap[shift.date][shift.employeeId] = shift.location;
    }
  });

  // Build Shift Exchange (Биржа смен) lookup maps:
  // 1. Shifts taken by employees at OTHER locations (marks employee busy at other PVZ)
  // 2. Shifts claimed/approved by selected employees at THIS location (gives priority to work here)
  const currentLocNormalized = location.trim().toUpperCase();
  const exchangeOtherPvzMap: Record<string, Record<string, string>> = {};
  const exchangeThisPvzCandidates: Record<string, { candidateId: string; shift: ShiftSwapRequest }[]> = {};

  swapRequests.forEach(sw => {
    if (!sw.candidateId || (sw.status !== 'approved' && sw.status !== 'claimed')) return;
    const swLocNormalized = (sw.location || '').trim().toUpperCase();
    const isThisPvz = swLocNormalized === currentLocNormalized;

    if (!isThisPvz) {
      if (!exchangeOtherPvzMap[sw.date]) {
        exchangeOtherPvzMap[sw.date] = {};
      }
      exchangeOtherPvzMap[sw.date][sw.candidateId] = sw.location || 'Биржа смен';
      // Also register into otherShiftsMap to guarantee they cannot be double-booked
      if (!otherShiftsMap[sw.date]) {
        otherShiftsMap[sw.date] = {};
      }
      otherShiftsMap[sw.date][sw.candidateId] = sw.location || 'Биржа смен';
    } else {
      if (!exchangeThisPvzCandidates[sw.date]) {
        exchangeThisPvzCandidates[sw.date] = [];
      }
      exchangeThisPvzCandidates[sw.date].push({ candidateId: sw.candidateId, shift: sw });
    }
  });

  const selectedStaff = selectedStaffIds
    .map(id => staffList.find(s => s.id === id))
    .filter(Boolean) as StaffMember[];

  const totalDays = daysList.length;

  // 1. Determine daily target count (Coverage & Reinforcement)
  const dailyTargets: Record<string, { target: number; isReinforced: boolean }> = {};
  daysList.forEach(d => {
    let isReinforced = false;
    let target = Math.max(1, baseCoverage);

    if (reinforcementMode === 'weekdays' && d.dayOfWeek >= 1 && d.dayOfWeek <= 5) {
      isReinforced = true;
      target = Math.max(target, reinforcementCoverage);
    } else if (reinforcementMode === 'weekends' && (d.dayOfWeek === 0 || d.dayOfWeek === 6)) {
      isReinforced = true;
      target = Math.max(target, reinforcementCoverage);
    } else if (reinforcementMode === 'custom_days' && reinforcementDaysOfWeek.includes(d.dayOfWeek)) {
      isReinforced = true;
      target = Math.max(target, reinforcementCoverage);
    }

    dailyTargets[d.dateStr] = { target, isReinforced };
  });

  // 2. Base cycle assignment per employee (before availability checks)
  // employeeId -> set of dateStr where cycle indicates work
  const baseCycleWorkingDates: Record<string, Set<string>> = {};
  selectedStaff.forEach(s => {
    baseCycleWorkingDates[s.id] = new Set<string>();
  });

  if (selectedStaff.length > 0) {
    if (scheduleType === '2/2') {
      if (selectedStaff.length === 2) {
        // Standard 2-person counterphase: A works 0,1; B works 2,3
        daysList.forEach(d => {
          const dayIdx = (d.dayNum - startCycleDay + 400) % 4;
          if (dayIdx < 2) {
            baseCycleWorkingDates[selectedStaff[0].id].add(d.dateStr);
          } else {
            baseCycleWorkingDates[selectedStaff[1].id].add(d.dateStr);
          }
        });
      } else if (selectedStaff.length === 3) {
        if (threeStaffMode === 'queue') {
          // Variant A: Queue of 3 (each works 2, rests 4). Cycle length 6.
          daysList.forEach(d => {
            const dayIdx = (d.dayNum - startCycleDay + 600) % 6;
            if (dayIdx < 2) {
              baseCycleWorkingDates[selectedStaff[0].id].add(d.dateStr);
            } else if (dayIdx < 4) {
              baseCycleWorkingDates[selectedStaff[1].id].add(d.dateStr);
            } else {
              baseCycleWorkingDates[selectedStaff[2].id].add(d.dateStr);
            }
          });
        } else {
          // Variants B, C, D: Staff 0 & 1 work 2/2 counterphase.
          // Staff 2 reinforces on designated reinforced days!
          daysList.forEach(d => {
            const dayIdx = (d.dayNum - startCycleDay + 400) % 4;
            if (dayIdx < 2) {
              baseCycleWorkingDates[selectedStaff[0].id].add(d.dateStr);
            } else {
              baseCycleWorkingDates[selectedStaff[1].id].add(d.dateStr);
            }

            if (dailyTargets[d.dateStr].isReinforced) {
              baseCycleWorkingDates[selectedStaff[2].id].add(d.dateStr);
            }
          });
        }
      } else if (selectedStaff.length === 4) {
        // 2 pairs: Pair A (0, 1), Pair B (2, 3)
        daysList.forEach(d => {
          const dayIdx = (d.dayNum - startCycleDay + 400) % 4;
          if (dayIdx < 2) {
            baseCycleWorkingDates[selectedStaff[0].id].add(d.dateStr);
            baseCycleWorkingDates[selectedStaff[1].id].add(d.dateStr);
          } else {
            baseCycleWorkingDates[selectedStaff[2].id].add(d.dateStr);
            baseCycleWorkingDates[selectedStaff[3].id].add(d.dateStr);
          }
        });
      } else {
        // N employees: evenly distributed across 4-day cycle phases
        daysList.forEach(d => {
          const dayIdx = (d.dayNum - startCycleDay + 400) % 4;
          selectedStaff.forEach((s, idx) => {
            const phase = idx % 2 === 0 ? 0 : 2;
            if ((dayIdx < 2 && phase === 0) || (dayIdx >= 2 && phase === 2)) {
              baseCycleWorkingDates[s.id].add(d.dateStr);
            }
          });
        });
      }
    } else if (scheduleType === '3/3') {
      if (selectedStaff.length === 2) {
        // 2-person counterphase 3/3: A works 0,1,2; B works 3,4,5
        daysList.forEach(d => {
          const dayIdx = (d.dayNum - startCycleDay + 600) % 6;
          if (dayIdx < 3) {
            baseCycleWorkingDates[selectedStaff[0].id].add(d.dateStr);
          } else {
            baseCycleWorkingDates[selectedStaff[1].id].add(d.dateStr);
          }
        });
      } else {
        // Queue blocks of 3 days
        const cycleLen = selectedStaff.length * 3;
        daysList.forEach(d => {
          const dayIdx = (d.dayNum - startCycleDay + cycleLen * 100) % cycleLen;
          const staffIdx = Math.floor(dayIdx / 3);
          if (selectedStaff[staffIdx]) {
            baseCycleWorkingDates[selectedStaff[staffIdx].id].add(d.dateStr);
          }
        });
      }
    } else if (scheduleType === '5/2') {
      if (weekend52Mode === 'fixed') {
        // Standard Sat & Sun off.
        // If 2+ employees: second employee takes Mon & Tue off so Sat & Sun are covered!
        daysList.forEach(d => {
          const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
          selectedStaff.forEach((s, sIdx) => {
            if (sIdx === 0) {
              if (!isWeekend) baseCycleWorkingDates[s.id].add(d.dateStr);
            } else if (sIdx === 1) {
              // Off on Mon (1) & Tue (2), works Wed..Sun
              if (d.dayOfWeek !== 1 && d.dayOfWeek !== 2) {
                baseCycleWorkingDates[s.id].add(d.dateStr);
              }
            } else {
              // Additional staff offsets
              const offDay1 = (sIdx * 2) % 7;
              const offDay2 = (sIdx * 2 + 1) % 7;
              if (d.dayOfWeek !== offDay1 && d.dayOfWeek !== offDay2) {
                baseCycleWorkingDates[s.id].add(d.dateStr);
              }
            }
          });
        });
      } else if (weekend52Mode === 'floating') {
        // Floating days off distributed across week to guarantee every day has someone
        daysList.forEach(d => {
          selectedStaff.forEach((s, sIdx) => {
            const off1 = (sIdx * 2 + 5) % 7;
            const off2 = (sIdx * 2 + 6) % 7;
            if (d.dayOfWeek !== off1 && d.dayOfWeek !== off2) {
              baseCycleWorkingDates[s.id].add(d.dateStr);
            }
          });
        });
      } else {
        // Manual weekends from manualWeekends52
        daysList.forEach(d => {
          selectedStaff.forEach(s => {
            const daysOff = manualWeekends52[s.id] || [0, 6];
            if (!daysOff.includes(d.dayOfWeek)) {
              baseCycleWorkingDates[s.id].add(d.dateStr);
            }
          });
        });
      }
    } else if (scheduleType === 'custom') {
      const workD = Math.max(1, customWorkDays || 4);
      const restD = Math.max(1, customRestDays || 2);
      const cycleLen = workD + restD;

      daysList.forEach(d => {
        selectedStaff.forEach((s, sIdx) => {
          const phaseOffset = Math.floor((sIdx * cycleLen) / selectedStaff.length);
          const dayIdx = (d.dayNum - startCycleDay + phaseOffset + cycleLen * 100) % cycleLen;
          if (dayIdx < workD) {
            baseCycleWorkingDates[s.id].add(d.dateStr);
          }
        });
      });
    } else if (scheduleType === 'hybrid') {
      daysList.forEach(d => {
        selectedStaff.forEach((s, sIdx) => {
          const conf = hybridStaffConfig[s.id] || { type: '2/2' };
          if (conf.type === '2/2') {
            const phase = sIdx % 2 === 0 ? 0 : 2;
            const dayIdx = (d.dayNum - startCycleDay + phase + 400) % 4;
            if (dayIdx < 2) baseCycleWorkingDates[s.id].add(d.dateStr);
          } else if (conf.type === '3/3') {
            const phase = sIdx % 2 === 0 ? 0 : 3;
            const dayIdx = (d.dayNum - startCycleDay + phase + 600) % 6;
            if (dayIdx < 3) baseCycleWorkingDates[s.id].add(d.dateStr);
          } else if (conf.type === '5/2') {
            const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
            if (sIdx % 2 === 0) {
              if (!isWeekend) baseCycleWorkingDates[s.id].add(d.dateStr);
            } else {
              if (d.dayOfWeek !== 1 && d.dayOfWeek !== 2) baseCycleWorkingDates[s.id].add(d.dateStr);
            }
          } else {
            const w = conf.workDays || 4;
            const r = conf.restDays || 2;
            const cLen = w + r;
            const dayIdx = (d.dayNum - startCycleDay + cLen * 100) % cLen;
            if (dayIdx < w) baseCycleWorkingDates[s.id].add(d.dateStr);
          }
        });
      });
    }
  }

  // 3. Construct Day-by-Day Assignments with Priority Resolution:
  // Coverage (min 1) > Reinforcement > Wishes > Cycle fairness
  const dayAssignedStaff: Record<string, string[]> = {};
  daysList.forEach(d => {
    dayAssignedStaff[d.dateStr] = [];
  });

  // Track how many shifts each staff has received
  const staffShiftCounts: Record<string, number> = {};
  selectedStaff.forEach(s => {
    staffShiftCounts[s.id] = 0;
  });

  // Check manual overrides if manager already tweaked cells
  if (manualOverrides && Object.keys(manualOverrides).length > 0) {
    daysList.forEach(d => {
      if (manualOverrides[d.dateStr] !== undefined) {
        // Enforce rule: never allow staff already scheduled at another PVZ today
        const filteredOverrides = manualOverrides[d.dateStr].filter(id => !otherShiftsMap[d.dateStr]?.[id]);
        dayAssignedStaff[d.dateStr] = [...filteredOverrides];
        filteredOverrides.forEach(id => {
          if (staffShiftCounts[id] !== undefined) staffShiftCounts[id]++;
        });
      }
    });
  }

  // For days not manually overridden, run the intelligent resolution engine
  daysList.forEach(d => {
    if (manualOverrides && manualOverrides[d.dateStr] !== undefined) return;

    const target = dailyTargets[d.dateStr].target;

    // Enforce Rule: If an employee already has a shift at another PVZ on this date,
    // they CANNOT be added to this PVZ today!
    const isBusyAtOtherPvz = (staffId: string) => Boolean(otherShiftsMap[d.dateStr]?.[staffId]);
    const availableStaffToday = selectedStaff.filter(s => !isBusyAtOtherPvz(s.id));

    // A. Check which staff want to work by their cycle among available staff
    const cycleCandidates = availableStaffToday.filter(s => baseCycleWorkingDates[s.id]?.has(d.dateStr));
    const restingCandidates = availableStaffToday.filter(s => !baseCycleWorkingDates[s.id]?.has(d.dateStr));

    const finalAssigned: string[] = [];

    // Prioritize employees who claimed/have approved shifts from Shift Exchange (Биржа смен) for this PVZ on this date!
    const exchangeForToday = exchangeThisPvzCandidates[d.dateStr] || [];
    exchangeForToday.forEach(item => {
      // Check if employee is in selected staff or available staff for this location
      if (
        availableStaffToday.some(s => s.id === item.candidateId) &&
        !finalAssigned.includes(item.candidateId) &&
        finalAssigned.length < target
      ) {
        finalAssigned.push(item.candidateId);
      }
    });

    // Filter by wishes if respectWishes is active
    if (!respectWishes) {
      // Just take cycle candidates up to target
      cycleCandidates.forEach(s => {
        if (!finalAssigned.includes(s.id) && finalAssigned.length < target) finalAssigned.push(s.id);
      });
      // If cycle gave fewer than target, add resting staff with lowest workload
      if (finalAssigned.length < target) {
        const sortedResting = [...restingCandidates].sort(
          (a, b) => (staffShiftCounts[a.id] || 0) - (staffShiftCounts[b.id] || 0)
        );
        for (const s of sortedResting) {
          if (finalAssigned.length >= target) break;
          if (!finalAssigned.includes(s.id)) finalAssigned.push(s.id);
        }
      }
    } else {
      // 1) From cycleCandidates, partition into available vs unavailable (wished not to work)
      const cycleAvailable: StaffMember[] = [];
      const cycleWishedOff: StaffMember[] = [];

      cycleCandidates.forEach(s => {
        const { hasWish } = hasEmployeeUnavailability(availabilityList, s.id, d.dateStr, ignoredWishKeys);
        if (hasWish) {
          cycleWishedOff.push(s);
        } else {
          cycleAvailable.push(s);
        }
      });

      // 2) Assign available cycle staff first (if not already assigned from exchange)
      cycleAvailable.forEach(s => {
        if (!finalAssigned.includes(s.id) && finalAssigned.length < target) finalAssigned.push(s.id);
      });

      // 3) If we still need staff to reach target, look for resting staff WITHOUT wishes!
      if (finalAssigned.length < target) {
        const restingAvailable = restingCandidates
          .filter(s => !finalAssigned.includes(s.id) && !hasEmployeeUnavailability(availabilityList, s.id, d.dateStr, ignoredWishKeys).hasWish)
          .sort((a, b) => (staffShiftCounts[a.id] || 0) - (staffShiftCounts[b.id] || 0));

        for (const s of restingAvailable) {
          if (finalAssigned.length >= target) break;
          if (!finalAssigned.includes(s.id)) finalAssigned.push(s.id);
        }
      }

      // 4) If we STILL have 0 people on this day (Breaks Rule 1: PVZ must never be closed!),
      // we assign at least 1 person from available staff even if they had a wish, prioritizing:
      // a) Staff whose wish has lower conflict (latest created or simple personal matter)
      // Note: ONLY from availableStaffToday who do NOT already have a shift at another PVZ!
      if (finalAssigned.length === 0 && availableStaffToday.length > 0) {
        // Pick cycle candidate who wished off, or anyone available who is NOT busy at another PVZ
        const fallbackCandidates = cycleWishedOff.length > 0 ? cycleWishedOff : availableStaffToday;
        const fallback = fallbackCandidates.sort(
          (a, b) => (staffShiftCounts[a.id] || 0) - (staffShiftCounts[b.id] || 0)
        )[0];
        if (fallback) {
          finalAssigned.push(fallback.id);
        }
      }
    }

    dayAssignedStaff[d.dateStr] = finalAssigned;
    finalAssigned.forEach(id => {
      if (staffShiftCounts[id] !== undefined) staffShiftCounts[id]++;
    });
  });

  // 4. Build comprehensive Day Analysis, Wishes Stats and Metrics
  const dayAnalysis: Record<string, DayAnalysis> = {};
  const criticalConflicts: GeneratorResult['metrics']['criticalConflicts'] = [];

  let coveredDays = 0;
  let uncoveredDays = 0;
  let reinforcedDaysTarget = 0;
  let reinforcedDaysFulfilled = 0;
  let totalWishesInMonth = 0;
  let wishesRespected = 0;
  let wishesViolated = 0;

  daysList.forEach(d => {
    const targetObj = dailyTargets[d.dateStr] || { target: 1, isReinforced: false };
    const assigned = dayAssignedStaff[d.dateStr] || [];

    if (assigned.length > 0) coveredDays++;
    else uncoveredDays++;

    if (targetObj.isReinforced) {
      reinforcedDaysTarget++;
      if (assigned.length >= targetObj.target) reinforcedDaysFulfilled++;
    }

    let coverageStatus: 'ok' | 'empty' | 'understaffed' = 'ok';
    if (assigned.length === 0) coverageStatus = 'empty';
    else if (assigned.length < targetObj.target) coverageStatus = 'understaffed';

    // Wishes on this day for selected staff
    const wishesOnThisDay: DayAnalysis['wishesOnThisDay'] = [];
    selectedStaff.forEach(s => {
      const wishItem = availabilityList.find(
        a => a.employeeId === s.id && a.date === d.dateStr && a.type !== 'preferred'
      );
      if (wishItem) {
        totalWishesInMonth++;
        const isWorking = assigned.includes(s.id);
        const isIgnored = ignoredWishKeys.includes(`${s.id}_${d.dateStr}`);
        const isMet = !isWorking; // Met if the employee is NOT working

        if (isMet) wishesRespected++;
        else wishesViolated++;

        wishesOnThisDay.push({
          employeeId: s.id,
          employeeName: s.name,
          type: wishItem.type,
          comment: wishItem.comment,
          isMet,
          isIgnored,
        });
      }
    });

    // Exchange shifts on this day for current PVZ
    const exchangeShiftsOnThisDay: DayAnalysis['exchangeShiftsOnThisDay'] = [];
    const exList = exchangeThisPvzCandidates[d.dateStr] || [];
    exList.forEach(item => {
      const staff = staffList.find(s => s.id === item.candidateId);
      exchangeShiftsOnThisDay.push({
        employeeId: item.candidateId,
        employeeName: staff?.name || item.shift.candidateName || 'Сотрудник',
        shiftType: item.shift.shiftType,
        location: item.shift.location,
        requesterName: item.shift.requesterName,
        status: item.shift.status,
      });
    });

    // Cross-PVZ conflicts: check if any assigned employee is ALREADY scheduled on another PVZ today
    const crossPvzConflicts: DayAnalysis['crossPvzConflicts'] = [];
    assigned.forEach(stId => {
      const otherLoc = otherShiftsMap[d.dateStr]?.[stId];
      if (otherLoc) {
        const staff = staffList.find(s => s.id === stId);
        crossPvzConflicts.push({
          employeeId: stId,
          employeeName: staff?.name || 'Сотрудник',
          location: otherLoc,
        });
      }
    });

    let conflictReason: string | undefined = undefined;
    if (coverageStatus === 'empty') {
      const busyAtOther = selectedStaff.filter(s => Boolean(otherShiftsMap[d.dateStr]?.[s.id]));
      if (busyAtOther.length > 0 && selectedStaff.every(s => Boolean(otherShiftsMap[d.dateStr]?.[s.id]))) {
        const busyDetails = busyAtOther.map(s => `${s.name} (уже в ${otherShiftsMap[d.dateStr][s.id]})`).join(', ');
        conflictReason = `Все сотрудники уже заняты на других складах: ${busyDetails}`;
      } else {
        const reasons = wishesOnThisDay.map(w => `${w.employeeName} — пожелание (${w.type})`).join(', ');
        conflictReason = reasons ? `Все сотрудники недоступны: ${reasons}` : 'Не назначен ни один сотрудник';
      }
      criticalConflicts.push({
        dateStr: d.dateStr,
        dayNum: d.dayNum,
        dayName: d.dayName,
        reason: conflictReason,
        staffWithWishes: wishesOnThisDay.map(w => ({ id: w.employeeId, name: w.employeeName })),
      });
    } else if (coverageStatus === 'understaffed') {
      conflictReason = `План усиления: ${targetObj.target} чел., фактически: ${assigned.length} чел.`;
    } else if (crossPvzConflicts.length > 0) {
      const names = crossPvzConflicts.map(c => `${c.employeeName} (уже стоит в ${c.location})`).join(', ');
      conflictReason = `Конфликт складов: ${names}`;
    }

    dayAnalysis[d.dateStr] = {
      dateStr: d.dateStr,
      dayNum: d.dayNum,
      dayOfWeek: d.dayOfWeek,
      dayName: d.dayName,
      targetCount: targetObj.target,
      assignedStaffIds: assigned,
      isReinforcedDay: targetObj.isReinforced,
      coverageStatus,
      wishesOnThisDay,
      exchangeShiftsOnThisDay,
      conflictReason,
      crossPvzConflicts,
    };
  });

  // 5. Final PlannedShift[] batch
  const shifts: PlannedShift[] = [];
  daysList.forEach(d => {
    const assigned = dayAssignedStaff[d.dateStr] || [];
    assigned.forEach((staffId, sIdx) => {
      const staff = staffList.find(s => s.id === staffId);
      // Absolute guarantee: never generate a shift if employee already has one today at another PVZ
      if (staff && !otherShiftsMap[d.dateStr]?.[staff.id]) {
        shifts.push({
          id: `gen-${d.dateStr}-${location}-${staff.id}-${sIdx}`,
          date: d.dateStr,
          location,
          employeeId: staff.id,
          employeeName: staff.name,
          shiftType,
          note: `Сверстано (${scheduleType})`,
          createdAt: new Date().toISOString(),
        });
      }
    });
  });

  // 6. Workload stats per staff member
  const shiftHours = getShiftHours(shiftType);
  const staffWorkload = selectedStaff.map(s => {
    const dates: number[] = [];
    daysList.forEach(d => {
      if (dayAssignedStaff[d.dateStr]?.includes(s.id)) {
        dates.push(d.dayNum);
      }
    });

    const staffWishes = availabilityList.filter(
      a => a.employeeId === s.id && a.date.startsWith(config.monthStr) && a.type !== 'preferred'
    );
    const metCount = staffWishes.filter(w => !dates.includes(parseInt(w.date.split('-')[2], 10))).length;
    const violatedCount = staffWishes.length - metCount;

    return {
      employeeId: s.id,
      employeeName: s.name,
      isSenior: s.isSenior,
      isPartTime: s.isPartTime,
      shiftsCount: dates.length,
      hours: dates.length * shiftHours,
      percentOfMonth: Math.round((dates.length / totalDays) * 100),
      dates,
      wishesMet: metCount,
      wishesViolated: violatedCount,
    };
  }).sort((a, b) => b.shiftsCount - a.shiftsCount);

  return {
    shifts,
    dayAnalysis,
    metrics: {
      totalDays,
      coveredDays,
      uncoveredDays,
      reinforcedDaysTarget,
      reinforcedDaysFulfilled,
      totalWishesInMonth,
      wishesRespected,
      wishesViolated,
      totalExchangeShiftsInMonth: Object.values(exchangeThisPvzCandidates).reduce((sum, arr) => sum + arr.length, 0),
      exchangeShiftsIncluded: Object.entries(exchangeThisPvzCandidates).reduce((sum, [dStr, arr]) => {
        const assigned = dayAssignedStaff[dStr] || [];
        return sum + arr.filter(item => assigned.includes(item.candidateId)).length;
      }, 0),
      staffWorkload,
      criticalConflicts,
    },
  };
}
