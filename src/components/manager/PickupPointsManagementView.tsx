import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { PickupPoint } from '../../types';
import { calculateDailySales, formatCurrency, calculateShiftTotalSalary } from '../../utils/calculations';
import { getCurrentAndPreviousMonth, formatMonthName, getAllAvailableMonths, formatDateRuDMY } from '../../utils/time';
import { CustomPeriodSelect } from '../common/CustomPeriodSelect';
import {
  Building2,
  Plus,
  Search,
  Users,
  MapPin,
  Phone,
  FileText,
  Edit2,
  Trash2,
  XCircle,
  TrendingUp,
  DollarSign,
  X,
  Shield,
  AlertTriangle,
  UserCheck,
  ChevronRight,
  Archive,
  RotateCcw,
  CheckCircle2,
  Inbox,
  AlertCircle,
  QrCode,
  Navigation,
  Compass,
  Loader2,
} from 'lucide-react';
import { WarehouseQRModal } from './WarehouseQRModal';
import { getCurrentBrowserPosition } from '../../utils/geo';

export function formatPhoneNumber(val: string): string {
  const digits = val.replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';

  let res = digits[0];
  if (digits.length > 1) {
    res += ` (${digits.slice(1, Math.min(4, digits.length))}`;
  }
  if (digits.length >= 4) {
    res += ')';
  }
  if (digits.length > 4) {
    res += ` ${digits.slice(4, Math.min(7, digits.length))}`;
  }
  if (digits.length > 7) {
    res += `-${digits.slice(7, Math.min(9, digits.length))}`;
  }
  if (digits.length > 9) {
    res += `-${digits.slice(9, 11)}`;
  }
  return res;
}

export const PickupPointsManagementView: React.FC = () => {
  const {
    pickupPoints,
    staffList,
    records,
    rates,
    addPickupPoint,
    updatePickupPoint,
    archivePickupPoint,
    restorePickupPoint,
    deletePickupPoint,
    assignStaffToPickupPoint,
    paybackRecords,
  } = useApp();

  const { current } = getCurrentAndPreviousMonth();
  const allAvailableMonths = getAllAvailableMonths();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'archived'>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(current);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<PickupPoint | null>(null);

  // Assignment Modal
  const [assigningPoint, setAssigningPoint] = useState<PickupPoint | null>(null);
  const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([]);
  const [staffSearchQuery, setStaffSearchQuery] = useState('');

  // Form State for Add / Edit
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formStaffIds, setFormStaffIds] = useState<string[]>([]);
  const [formLatitude, setFormLatitude] = useState<string>('');
  const [formLongitude, setFormLongitude] = useState<string>('');
  const [formRadiusMeters, setFormRadiusMeters] = useState<number>(300);
  const [formZones, setFormZones] = useState<string>('Приёмка, Сборка, Упаковка, Отгрузка, Зона хранения');
  const [isDetectingGps, setIsDetectingGps] = useState<boolean>(false);

  // Warehouse QR Modal state
  const [selectedWarehouseForQR, setSelectedWarehouseForQR] = useState<PickupPoint | null>(null);

  // Detailed Slide-Over Drawer for specific location
  const [analyticsPoint, setAnalyticsPoint] = useState<PickupPoint | null>(null);
  const [drawerTab, setDrawerTab] = useState<'overview' | 'manage'>('overview');

  // Action Confirmation Modals State
  const [deactivatingPoint, setDeactivatingPoint] = useState<PickupPoint | null>(null);
  const [archivingPoint, setArchivingPoint] = useState<PickupPoint | null>(null);
  const [restoringPoint, setRestoringPoint] = useState<PickupPoint | null>(null);
  const [deletingPoint, setDeletingPoint] = useState<PickupPoint | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Status & Error handling
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Safari focus trap for accessibility
  React.useEffect(() => {
    if (!isAddModalOpen && !assigningPoint && !analyticsPoint && !deactivatingPoint && !archivingPoint && !restoringPoint && !deletingPoint) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const modal = document.querySelector('.fixed.inset-0.z-\\[60\\]') || document.querySelector('.fixed.inset-0.z-50') || document.querySelector('.fixed.inset-0');
        if (!modal) return;
        
        const focusableElements = modal.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]'
        );
        
        if (focusableElements.length === 0) return;
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement as HTMLElement;
        
        if (e.shiftKey) {
          if (activeElement === firstElement || !Array.from(focusableElements).includes(activeElement)) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (activeElement === lastElement || !Array.from(focusableElements).includes(activeElement)) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen, assigningPoint, analyticsPoint, deactivatingPoint, archivingPoint, restoringPoint, deletingPoint]);

  // Active employees
  const activeStaff = staffList.filter(s => s.status === 'active');

  // Reliable bidirectional assigned staff finder
  const getAssignedStaffIdsForPoint = (point: PickupPoint): string[] => {
    const ids = new Set<string>(point.assignedStaffIds || []);
    staffList.forEach(s => {
      const locs = s.locations && s.locations.length > 0 ? s.locations : (s.location ? [s.location] : []);
      if (locs.some(l => l === point.code || l === point.name || l === point.id)) {
        ids.add(s.id);
      }
    });
    return Array.from(ids);
  };

  const openAddModal = () => {
    setEditingPoint(null);
    setFormName('');
    setFormCode('');
    setFormAddress('');
    setFormPhone('');
    setFormNotes('');
    setFormActive(true);
    setFormStaffIds([]);
    setFormLatitude('');
    setFormLongitude('');
    setFormRadiusMeters(300);
    setFormZones('Приёмка, Сборка, Упаковка, Отгрузка, Зона хранения');
    setErrorMsg('');
    setIsAddModalOpen(true);
  };

  const openEditModal = (point: PickupPoint) => {
    setEditingPoint(point);
    setFormName(point.name.slice(0, 30));
    setFormCode(point.code);
    setFormAddress(point.address || '');
    setFormPhone(formatPhoneNumber(point.contactPhone || ''));
    setFormNotes(point.notes || '');
    setFormActive(point.active !== false);
    setFormStaffIds(getAssignedStaffIdsForPoint(point));
    setFormLatitude(point.latitude != null ? String(point.latitude) : '');
    setFormLongitude(point.longitude != null ? String(point.longitude) : '');
    setFormRadiusMeters(point.radiusMeters || 300);
    setFormZones(Array.isArray(point.zones) && point.zones.length > 0 ? point.zones.join(', ') : 'Приёмка, Сборка, Упаковка, Отгрузка, Зона хранения');
    setErrorMsg('');
    setIsAddModalOpen(true);
  };

  const handleDetectCurrentGps = async () => {
    setIsDetectingGps(true);
    setErrorMsg('');
    try {
      const pos = await getCurrentBrowserPosition();
      setFormLatitude(pos.latitude.toFixed(6));
      setFormLongitude(pos.longitude.toFixed(6));
    } catch (err: any) {
      setErrorMsg(err.message || 'Не удалось определить текущие координаты GPS');
    } finally {
      setIsDetectingGps(false);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (formPhone.length > raw.length && (formPhone.endsWith('-') || formPhone.endsWith(') ') || formPhone.endsWith(')'))) {
      const stripped = raw.replace(/\D*$/, '');
      setFormPhone(formatPhoneNumber(stripped.slice(0, -1)));
      return;
    }
    setFormPhone(formatPhoneNumber(raw));
  };

  const openAssignModal = (point: PickupPoint) => {
    setAssigningPoint(point);
    setAssignedStaffIds(getAssignedStaffIdsForPoint(point));
    setStaffSearchQuery('');
  };

  const togglePointActive = async (point: PickupPoint) => {
    const nextActive = point.active === false ? true : false;
    await updatePickupPoint(point.id, { active: nextActive });
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formName.trim().slice(0, 30);
    if (!cleanName) {
      setErrorMsg('Укажите название склада (до 30 знаков)');
      return;
    }

    // Check unique name constraint (case-insensitive)
    const duplicate = pickupPoints.find(
      p => p.name.trim().toLowerCase() === cleanName.toLowerCase() && (!editingPoint || p.id !== editingPoint.id)
    );
    if (duplicate) {
      setErrorMsg(`Склад с названием «${cleanName}» уже существует. Названия складов должны быть уникальными.`);
      return;
    }

    const cleanCode = formCode.trim().slice(0, 18).toUpperCase();
    const isEditing = Boolean(editingPoint);
    const targetPoint = editingPoint;
    const staffIdsToSave = formStaffIds;
    const addressToSave = formAddress.trim();
    const phoneToSave = formPhone.trim();
    const notesToSave = formNotes.trim();
    const activeToSave = formActive;
    const parsedLat = formLatitude.trim() ? parseFloat(formLatitude.trim()) : undefined;
    const parsedLng = formLongitude.trim() ? parseFloat(formLongitude.trim()) : undefined;
    const parsedRadius = formRadiusMeters ? Number(formRadiusMeters) : 300;
    const parsedZones = formZones.split(',').map(z => z.trim()).filter(Boolean);

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      if (isEditing && targetPoint) {
        const res = await updatePickupPoint(targetPoint.id, {
          name: cleanName,
          code: cleanCode || targetPoint.code,
          address: addressToSave,
          contactPhone: phoneToSave,
          notes: notesToSave,
          active: activeToSave,
          assignedStaffIds: staffIdsToSave,
          latitude: parsedLat,
          longitude: parsedLng,
          radiusMeters: parsedRadius,
          zones: parsedZones,
        });
        if (!res.success) {
          setErrorMsg(res.error || 'Ошибка обновления склада');
          setIsSubmitting(false);
          return;
        }
      } else {
        const res = await addPickupPoint({
          name: cleanName,
          code: cleanCode,
          address: addressToSave,
          contactPhone: phoneToSave,
          notes: notesToSave,
          assignedStaffIds: staffIdsToSave,
          latitude: parsedLat,
          longitude: parsedLng,
          radiusMeters: parsedRadius,
          zones: parsedZones,
        });
        if (!res.success) {
          setErrorMsg(res.error || 'Ошибка создания склада');
          setIsSubmitting(false);
          return;
        }
      }

      setIsAddModalOpen(false);
      setActionSuccessMsg(isEditing ? `Изменения склада «${cleanName}» сохранены` : `Склад «${cleanName}» успешно создан`);
      setTimeout(() => setActionSuccessMsg(null), 3500);
      setEditingPoint(null);
      setFormName('');
      setFormCode('');
      setFormAddress('');
      setFormPhone('');
      setFormNotes('');
      setFormActive(true);
      setFormStaffIds([]);
      setFormLatitude('');
      setFormLongitude('');
      setFormRadiusMeters(300);
      setFormZones('Приёмка, Сборка, Упаковка, Отгрузка, Зона хранения');
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка сохранения склада');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveStaffAssignment = async () => {
    if (!assigningPoint) return;
    setIsSubmitting(true);
    await assignStaffToPickupPoint(assigningPoint.id, assignedStaffIds);
    setIsSubmitting(false);
    setAssigningPoint(null);
  };

  // Archive Flow
  const handleRequestArchive = (point: PickupPoint) => {
    setArchivingPoint(point);
  };

  const handleConfirmArchive = async () => {
    if (!archivingPoint) return;
    setIsSubmitting(true);
    try {
      const res = await archivePickupPoint(archivingPoint.id);
      if (res.success) {
        setArchivingPoint(null);
        setActionSuccessMsg(`Склад «${archivingPoint.name}» успешно перемещен в Архив.`);
        setTimeout(() => setActionSuccessMsg(null), 4000);
      } else {
        setDeleteError(res.error || 'Ошибка архивации склада');
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Ошибка архивации склада');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Restore Flow
  const handleConfirmRestore = async () => {
    if (!restoringPoint) return;
    setIsSubmitting(true);
    try {
      const res = await restorePickupPoint(restoringPoint.id);
      if (res.success) {
        setRestoringPoint(null);
        setActionSuccessMsg(`Склад «${restoringPoint.name}» успешно восстановлен из архива и активирован.`);
        setTimeout(() => setActionSuccessMsg(null), 4000);
      } else {
        setDeleteError(res.error || 'Ошибка восстановления склада');
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Ошибка восстановления склада');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Permanent Delete Flow
  const handleRequestPermanentDelete = (point: PickupPoint) => {
    setDeleteError(null);
    setDeletingPoint(point);
  };

  const handleConfirmPermanentDelete = async () => {
    if (!deletingPoint) return;
    setIsSubmitting(true);
    setDeleteError(null);
    try {
      const targetId = deletingPoint.id || deletingPoint.code;
      const res = await deletePickupPoint(targetId);
      if (res.success) {
        if (analyticsPoint?.id === deletingPoint.id) {
          setAnalyticsPoint(null);
        }
        setDeletingPoint(null);
        setDeleteError(null);
        setActionSuccessMsg(`Склад «${deletingPoint.name}» окончательно удален из базы данных.`);
        setTimeout(() => setActionSuccessMsg(null), 4000);
      } else {
        setDeleteError(res.error || 'Ошибка при удалении склада');
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Ошибка удаления склада');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Memoized Location Stats calculation (Выручка, Смены, ЗП/ФОТ)
  interface LocationStatsResult {
    shiftCount: number;
    totalRevenue: number;
    cashRevenue: number;
    cardRevenue: number;
    avgRevenuePerShift: number;
    totalShiftSalary: number;
    totalBonus: number;
    totalSalary: number;
    records: typeof records;
  }

  const defaultStats: LocationStatsResult = {
    shiftCount: 0,
    totalRevenue: 0,
    cashRevenue: 0,
    cardRevenue: 0,
    avgRevenuePerShift: 0,
    totalShiftSalary: 0,
    totalBonus: 0,
    totalSalary: 0,
    records: [],
  };

  const locationStatsMap = useMemo(() => {
    const map = new Map<string, LocationStatsResult>();
    const monthRecs = records.filter(r => r.date?.startsWith(selectedMonth));

    // Helper to resolve canonical code for any location name/id/code
    const getCanonicalLocCode = (locStr?: string): string => {
      if (!locStr) return (pickupPoints[0]?.code || '').toUpperCase();
      const clean = locStr.trim();
      const matched = pickupPoints.find(
        p =>
          p.code.toUpperCase() === clean.toUpperCase() ||
          p.name.toUpperCase() === clean.toUpperCase() ||
          p.id.toUpperCase() === clean.toUpperCase()
      );
      return matched ? matched.code.toUpperCase() : clean.toUpperCase();
    };

    // Group records by canonical location code uppercase
    const byLoc = new Map<string, typeof records>();
    for (const r of monthRecs) {
      const codeKey = getCanonicalLocCode(r.location);
      let arr = byLoc.get(codeKey);
      if (!arr) {
        arr = [];
        byLoc.set(codeKey, arr);
      }
      arr.push(r);
    }

    const staffMap = new Map(staffList.map(s => [s.id, s]));

    for (const [codeKey, locRecords] of byLoc.entries()) {
      let totalRevenue = 0;
      let cashRevenue = 0;
      let cardRevenue = 0;
      let totalShiftSalary = 0;
      let totalBonus = 0;

      for (const r of locRecords) {
        const sales = calculateDailySales(r.sales);
        totalRevenue += sales.totalSales;
        cashRevenue += sales.totalCash;
        cardRevenue += sales.totalCard;
        totalBonus += sales.bonus;

        const staff = staffMap.get(r.employeeId);
        let pay = calculateShiftTotalSalary(r, staff, rates);

        totalShiftSalary += pay;
      }

      const shiftCount = locRecords.length;
      const avgRevenuePerShift = shiftCount > 0 ? Math.round(totalRevenue / shiftCount) : 0;
      const totalSalary = totalShiftSalary + totalBonus;

      map.set(codeKey, {
        shiftCount,
        totalRevenue,
        cashRevenue,
        cardRevenue,
        avgRevenuePerShift,
        totalShiftSalary,
        totalBonus,
        totalSalary,
        records: locRecords,
      });
    }

    return map;
  }, [records, selectedMonth, staffList, rates, pickupPoints]);

  const getLocationStats = (locCode: string): LocationStatsResult => {
    return locationStatsMap.get((locCode || '').toUpperCase()) || defaultStats;
  };

  // Non-archived and archived counts
  const nonArchivedPoints = pickupPoints.filter(p => !p.isArchived);
  const archivedPoints = pickupPoints.filter(p => p.isArchived);
  const activePointsCount = nonArchivedPoints.filter(p => p.active !== false).length;
  const inactivePointsCount = nonArchivedPoints.filter(p => p.active === false).length;

  // Network total revenue & salary for selected month (active network)
  const totalNetworkRevenue = useMemo(() => {
    return records
      .filter(r => r.date?.startsWith(selectedMonth))
      .reduce((sum, r) => sum + calculateDailySales(r.sales).totalSales, 0);
  }, [records, selectedMonth]);

  const totalNetworkSalary = useMemo(() => {
    return nonArchivedPoints.reduce((sum, point) => {
      return sum + getLocationStats(point.code).totalSalary;
    }, 0);
  }, [nonArchivedPoints, locationStatsMap]);

  // Net profit (Чистая прибыль / мес) per Warehouse from Payback section (Окупаемость склада)
  const getPvzNetProfit = (pointCode: string): number => {
    const rec = paybackRecords.find(
      r => (r.pvzCode || '').toUpperCase() === (pointCode || '').toUpperCase() && r.month === selectedMonth
    );
    if (!rec) return 0;
    const totalInc = (rec.incomes || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const totalExp = (rec.expenses || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    return totalInc - totalExp;
  };

  // Total positive net profit across the network for share calculation, or total net profit
  const totalNetworkNetProfit = useMemo(() => {
    return nonArchivedPoints.reduce((sum, point) => {
      const net = getPvzNetProfit(point.code);
      return sum + (net > 0 ? net : 0);
    }, 0);
  }, [nonArchivedPoints, paybackRecords, selectedMonth]);

  // Overall net profit (sum of all PVZ net profits including negatives)
  const networkOverallNetProfit = useMemo(() => {
    return nonArchivedPoints.reduce((sum, point) => sum + getPvzNetProfit(point.code), 0);
  }, [nonArchivedPoints, paybackRecords, selectedMonth]);

  // Filtered pickup points list for cards and matrix
  const filteredPoints = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = pickupPoints.filter(point => {
      const matchesSearch =
        !term ||
        point.name.toLowerCase().includes(term) ||
        point.code.toLowerCase().includes(term) ||
        (point.address && point.address.toLowerCase().includes(term));

      if (filterStatus === 'archived') {
        return matchesSearch && point.isArchived === true;
      }

      // For all, active, inactive tabs: hide archived points
      if (point.isArchived) return false;

      if (filterStatus === 'active') return matchesSearch && point.active !== false;
      if (filterStatus === 'inactive') return matchesSearch && point.active === false;
      return matchesSearch;
    });

    // Sort alphabetically by name
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [pickupPoints, searchTerm, filterStatus]);

  // Automatic sorting for Comparative Matrix by "ДОЛЯ В СЕТИ" (рассчитанной от Чистой прибыли) descending
  const sortedMatrixPoints = useMemo(() => {
    return [...filteredPoints].sort((a, b) => {
      const netA = getPvzNetProfit(a.code);
      const netB = getPvzNetProfit(b.code);
      if (netB !== netA) {
        return netB - netA; // Чем выше чистая прибыль, тем выше в списке
      }
      const statsA = getLocationStats(a.code);
      const statsB = getLocationStats(b.code);
      return statsB.totalRevenue - statsA.totalRevenue;
    });
  }, [filteredPoints, paybackRecords, selectedMonth, locationStatsMap]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {actionSuccessMsg && (
        <div className="toast-banner fixed top-5 right-5 z-50 p-3.5 bg-[#111111] text-white border border-[#2d313b] rounded-md text-xs font-semibold shadow-sm flex items-center gap-2.5 animate-in slide-in-from-top duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#a9bcff] shrink-0" />
          <span className="text-white font-medium">{actionSuccessMsg}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
        <div className="p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 w-full xl:w-auto">
            <Building2 className="w-5 h-5 text-[#2f63ff] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base sm:text-lg font-semibold text-[#111111] tracking-tight">
                  Управление складами
                </h2>

                <span className="text-[#5d6270] font-mono text-xs font-medium whitespace-nowrap tabular-nums">
                  {nonArchivedPoints.length} / 30
                </span>
                {archivedPoints.length > 0 && (
                  <span className="text-[#5d6270] font-mono text-xs font-normal whitespace-nowrap tabular-nums">
                    ({archivedPoints.length} в архиве)
                  </span>
                )}
              </div>
              <p className="text-xs text-[#5d6270] mt-0.5">
                Гео-координаты проходной, зоны склада и закреплённый персонал
              </p>
            </div>
          </div>

          {/* Action Bar: Period and +Добавить Склад */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap self-start xl:self-center">
            <CustomPeriodSelect
              value={selectedMonth}
              onChange={setSelectedMonth}
              options={allAvailableMonths}
              labelPrefix="Период:"
              align="right"
            />

            <button
              onClick={openAddModal}
              disabled={pickupPoints.length >= 30}
              className="py-1.5 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 shrink-0 stroke-[2.5]" />
              <span>Добавить склад</span>
            </button>
          </div>
        </div>

        {/* Capacity Indicator Strip */}
        <div className="border-t border-[#e5e7eb] bg-[#f7f9ff]/60 grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#e5e7eb] text-xs">
          <div className="p-3.5 sm:px-5">
            <span className="text-[#5d6270] block text-xs">Активных складов</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold text-[#111111] font-mono tabular-nums">{nonArchivedPoints.length}</span>
              <span className="text-[#5d6270] text-xs">/ 30 макс</span>
            </div>
          </div>

          <div className="p-3.5 sm:px-5">
            <span className="text-[#5d6270] block text-xs">Работают сейчас</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold text-[#2f63ff] font-mono tabular-nums">{activePointsCount}</span>
              <span className="text-[#5d6270] text-xs">в строю</span>
            </div>
          </div>

          <div className="p-3.5 sm:px-5">
            <span className="text-[#5d6270] block text-xs">Рабочих на складах</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold text-[#111111] font-mono tabular-nums">{activeStaff.length}</span>
              <span className="text-[#5d6270] text-xs">активных</span>
            </div>
          </div>

          <div className="p-3.5 sm:px-5">
            <span className="text-[#5d6270] block text-xs">Выручка сети ({formatMonthName(selectedMonth)})</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold text-[#2f63ff] font-mono tabular-nums">{formatCurrency(totalNetworkRevenue)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Network Multi-Location Comparison Table Matrix */}
      <div className="bg-white border border-[#d9dbe0] rounded-md p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#2f63ff]" />
            <h3 className="text-sm font-semibold text-[#111111]">
              Сравнительная матрица всех складов ({formatMonthName(selectedMonth)})
            </h3>
          </div>
          <span className="text-xs text-[#5d6270] font-mono tabular-nums">
            Оборот сети: <span className="font-semibold text-[#2f63ff]">{formatCurrency(totalNetworkRevenue)}</span> · ФОТ: <span className="font-semibold text-[#111111]">{formatCurrency(totalNetworkSalary)}</span> · Прибыль: <span className={`font-semibold ${networkOverallNetProfit < 0 ? 'text-rose-700' : 'text-[#111111]'}`}>{formatCurrency(networkOverallNetProfit)}</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#2d313b] border-collapse">
            <thead>
              <tr className="bg-[#f7f9ff] text-[#5d6270] text-xs font-semibold border-b border-[#e5e7eb]">
                <th className="py-2.5 px-3 font-semibold">Код / Название склада</th>
                <th className="py-2.5 px-3 font-semibold">Статус</th>
                <th className="py-2.5 px-3 font-semibold text-center">Персонал</th>
                <th className="py-2.5 px-3 font-semibold text-center">Смен</th>
                <th className="py-2.5 px-3 font-semibold text-right">Выручка</th>
                <th className="py-2.5 px-3 font-semibold text-right">ЗП за тек. месяц</th>
                <th className="py-2.5 px-3 font-semibold text-right" title="Доля в сети рассчитывается от значения чистой прибыли склада">
                  Доля в сети
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e7eb] font-mono tabular-nums">
              {sortedMatrixPoints.map(point => {
                const stats = getLocationStats(point.code);
                const assignedCount = activeStaff.filter(
                  s => point.assignedStaffIds?.includes(s.id) || s.locations?.includes(point.code)
                ).length;

                const netProfit = getPvzNetProfit(point.code);
                const shareNum =
                  totalNetworkNetProfit > 0 && netProfit > 0
                    ? (netProfit / totalNetworkNetProfit) * 100
                    : 0;
                const share = shareNum.toFixed(1);

                return (
                  <tr key={point.id} className="hover:bg-[#f7f9ff] transition-colors">
                    <td className="py-2.5 px-3 font-medium text-[#111111] font-sans">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#2f63ff] shrink-0">
                          {point.code}
                        </span>
                        <span className="text-[#d9dbe0]" aria-hidden="true">·</span>
                        <span className="truncate max-w-[200px] font-semibold">{point.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-sans">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${
                          point.isArchived
                            ? 'text-[#b45309]'
                            : point.active !== false
                            ? 'text-[#2f63ff]'
                            : 'text-[#5d6270]'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-xs shrink-0 ${
                            point.isArchived
                              ? 'bg-[#b45309]'
                              : point.active !== false
                              ? 'bg-[#2f63ff]'
                              : 'bg-[#5d6270]'
                          }`}
                        />
                        {point.isArchived ? 'В архиве' : point.active !== false ? 'Активен' : 'Отключен'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center font-semibold text-[#111111]">{assignedCount} чел.</td>
                    <td className="py-2.5 px-3 text-center font-semibold text-[#111111]">{stats.shiftCount}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-[#2f63ff]">
                      {formatCurrency(stats.totalRevenue)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-[#111111]">
                      {formatCurrency(stats.totalSalary)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-medium text-[#111111] font-sans">
                      <div className="flex items-center justify-end gap-1.5" title={`Чистая прибыль склада: ${formatCurrency(netProfit)}`}>
                        <div className="w-12 bg-[#f7f9ff] h-2 rounded-xs overflow-hidden border border-[#d9dbe0] hidden sm:block">
                          <div
                            className={`h-full rounded-xs ${netProfit < 0 ? 'bg-rose-500' : 'bg-[#2f63ff]'}`}
                            style={{ width: `${Math.min(Math.max(shareNum, 0), 100)}%` }}
                          />
                        </div>
                        <span className={`font-mono font-semibold tabular-nums ${netProfit < 0 ? 'text-rose-700' : 'text-[#111111]'}`}>
                          {netProfit < 0 ? '0.0%' : `${share}%`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Controls: Search & Status Filters including Archive */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-md border border-[#d9dbe0]">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-[#5d6270] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск склада по названию, коду, адресу..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-[#f7f9ff] border border-[#d9dbe0] pl-8 pr-3 py-1.5 rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff]"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 bg-[#f7f9ff] p-1 rounded-md border border-[#d9dbe0] flex-wrap">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-[#111111] text-white'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
            }`}
          >
            Все ({nonArchivedPoints.length})
          </button>
          <button
            onClick={() => setFilterStatus('active')}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
              filterStatus === 'active'
                ? 'bg-[#111111] text-white'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
            }`}
          >
            Активные ({activePointsCount})
          </button>
          <button
            onClick={() => setFilterStatus('inactive')}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
              filterStatus === 'inactive'
                ? 'bg-[#111111] text-white'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
            }`}
          >
            Отключенные ({inactivePointsCount})
          </button>
          <button
            onClick={() => setFilterStatus('archived')}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              filterStatus === 'archived'
                ? 'bg-[#111111] text-white'
                : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
            }`}
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Архив ({archivedPoints.length})</span>
          </button>
        </div>
      </div>

      {/* Archive Context Banner (shown when viewing Archive tab) */}
      {filterStatus === 'archived' && (
        <div className="p-3.5 bg-white border border-[#d9dbe0] rounded-md flex items-start gap-2.5">
          <Archive className="w-4 h-4 text-[#b45309] shrink-0 mt-0.5" />
          <div className="text-xs text-[#2d313b]">
            <h4 className="font-semibold text-[#111111] text-xs sm:text-sm">Архив складов</h4>
            <p className="mt-0.5 text-[#5d6270] text-xs leading-relaxed">
              В архиве хранятся выведенные из эксплуатации склады. Вся история смен, табелей и аналитика по ним сохраняются в полном объеме. Вы можете в любой момент восстановить склад в активный список или удалить его окончательно.
            </p>
          </div>
        </div>
      )}

      {/* 2. Light Scannable Warehouses List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5d6270]">
            {filterStatus === 'archived' ? 'Архивированные склады' : 'Склады'} ({filteredPoints.length})
          </h3>
          <span className="text-[11px] text-[#5d6270]">
            Нажмите на склад, чтобы открыть карточку и управление
          </span>
        </div>

        {filteredPoints.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-md border border-[#d9dbe0] text-[#5d6270] text-xs">
            {filterStatus === 'archived' ? (
              <>
                <Inbox className="w-8 h-8 text-[#5d6270] mx-auto mb-2" />
                <p className="text-xs font-semibold text-[#111111]">В архиве пока нет складов</p>
                <p className="text-[11px] text-[#5d6270] mt-1">При отправке склада в архив он появится здесь с возможностью восстановления</p>
              </>
            ) : (
              <>
                <Building2 className="w-8 h-8 text-[#5d6270] mx-auto mb-2" />
                <p className="text-xs font-semibold text-[#111111]">Склады не найдены</p>
                <p className="text-[11px] text-[#5d6270] mt-1">Попробуйте изменить поисковый запрос или фильтр</p>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] overflow-hidden">
            {filteredPoints.map(point => {
              const stats = getLocationStats(point.code);
              const assignedStaffMembers = activeStaff.filter(
                s => point.assignedStaffIds?.includes(s.id) || s.locations?.includes(point.code)
              );

              const openPointDrawer = (tab: 'overview' | 'manage' = 'overview') => {
                setAnalyticsPoint(point);
                setDrawerTab(tab);
              };

              return (
                <div
                  key={point.id}
                  onClick={() => openPointDrawer('overview')}
                  className={`p-3 sm:px-4 sm:py-3.5 transition-colors flex items-center justify-between gap-3 flex-wrap md:flex-nowrap cursor-pointer ${
                    point.isArchived ? 'bg-[#f7f9ff]/60 hover:bg-[#eef2ff]/60' : 'hover:bg-[#f7f9ff]'
                  }`}
                >
                  {/* Left: Icon, Name, Code, Status, Address */}
                  <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
                    {point.isArchived ? (
                      <Archive className="w-4 h-4 text-[#b45309] shrink-0" />
                    ) : (
                      <Building2 className="w-4 h-4 text-[#2f63ff] shrink-0" />
                    )}

                    <div className="min-w-0">
                      <div className="font-semibold text-[#111111] text-sm flex items-center gap-1.5 flex-wrap">
                        <span className="truncate">{point.name}</span>
                        <span className="font-mono text-xs font-semibold text-[#2f63ff]">
                          · {point.code}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            point.isArchived
                              ? 'text-[#b45309]'
                              : point.active !== false
                              ? 'text-[#2f63ff]'
                              : 'text-[#5d6270]'
                          }`}
                        >
                          · {point.isArchived ? 'В архиве' : point.active !== false ? 'Активен' : 'Отключен'}
                        </span>
                        {point.isArchived && point.archivedAt && (
                          <span className="text-[11px] text-[#5d6270] font-normal">
                            (с {formatDateRuDMY(point.archivedAt.split('T')[0])})
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-[#5d6270] flex items-center gap-1.5 mt-0.5 truncate">
                        <MapPin className="w-3 h-3 text-[#5d6270] shrink-0" />
                        <span className="truncate">{point.address || 'Адрес не указан'}</span>
                        {point.contactPhone && (
                          <span className="text-[#5d6270] hidden sm:inline">· {point.contactPhone}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Inline Tabular Metrics */}
                  <div className="flex items-center gap-4 sm:gap-6 shrink-0 text-right">
                    <div>
                      <div className="text-[11px] text-[#5d6270]">Персонал</div>
                      <div className="text-xs font-semibold font-mono text-[#111111] tabular-nums">{assignedStaffMembers.length} чел.</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5d6270]">Смен</div>
                      <div className="text-xs font-semibold font-mono text-[#111111] tabular-nums">{stats.shiftCount}</div>
                    </div>
                    <div className="hidden sm:block">
                      <div className="text-[11px] text-[#5d6270]">Выручка</div>
                      <div className="text-xs font-semibold font-mono text-[#2f63ff] tabular-nums">{formatCurrency(stats.totalRevenue)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5d6270]">ФОТ (ЗП)</div>
                      <div className="text-xs font-semibold font-mono text-[#111111] tabular-nums">{formatCurrency(stats.totalSalary)}</div>
                    </div>
                  </div>

                  {/* Right: Quick QR & Drawer Button */}
                  <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setSelectedWarehouseForQR(point)}
                      className="py-1.5 px-2.5 bg-[#eef2ff] hover:bg-[#dbe4ff] text-[#2f63ff] rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-[#a9bcff]"
                      title="Распечатать или показать QR-код для проходной"
                    >
                      <QrCode className="w-3.5 h-3.5 text-[#2f63ff]" />
                      <span className="hidden sm:inline">QR проходной</span>
                    </button>

                    {point.isArchived ? (
                      <button
                        type="button"
                        onClick={() => setRestoringPoint(point)}
                        className="py-1.5 px-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Восстановить склад"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Восстановить</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openPointDrawer('overview')}
                        className="py-1.5 px-3 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span>Карточка</span>
                        <ChevronRight className="w-3.5 h-3.5 text-[#5d6270]" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Add or Edit PVZ */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-3 sm:p-4 z-[60] overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto text-[#111111]">
            <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#2f63ff]" />
                <h3 className="text-sm font-semibold text-[#111111]">
                  {editingPoint ? 'Редактировать склад' : 'Добавить новый склад'}
                </h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-4 space-y-3.5 flex-1 overflow-y-auto">
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-md text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-[#2d313b]">
                    Название склада <span className="text-rose-600">*</span>
                  </label>
                  <span className={`text-[10px] ${formName.length >= 30 ? 'text-[#b45309] font-semibold' : 'text-[#5d6270]'}`}>
                    {formName.length} / 30
                  </span>
                </div>
                <input
                  type="text"
                  required
                  maxLength={30}
                  placeholder="Например: Склад Северный (Терминал А)"
                  value={formName}
                  onChange={e => setFormName(e.target.value.slice(0, 30))}
                  className="w-full bg-white border border-[#d9dbe0] rounded px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#2d313b] mb-1">
                    Код / Аббревиатура
                  </label>
                  <input
                    type="text"
                    placeholder="Например: СК-1, СК-СЕВЕР"
                    maxLength={18}
                    value={formCode}
                    onChange={e => setFormCode(e.target.value.slice(0, 18))}
                    className="w-full bg-white border border-[#d9dbe0] rounded px-3 py-1.5 text-xs text-[#111111] uppercase placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] font-mono"
                  />
                  <div className="flex items-center justify-between mt-0.5 text-[10px] text-[#5d6270]">
                    <span>Короткий код склада для отчетов</span>
                    <span className={formCode.length >= 18 ? 'text-[#b45309] font-semibold' : 'text-[#5d6270]'}>
                      {formCode.length} / 18
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#2d313b] mb-1">Телефон склада / охраны</label>
                  <input
                    type="tel"
                    placeholder="1 (234) 567-89-10"
                    value={formPhone}
                    onChange={handlePhoneChange}
                    className="w-full bg-white border border-[#d9dbe0] rounded px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] font-mono"
                  />
                  <span className="text-[10px] text-[#5d6270] mt-0.5 block">Формат: 1 (234) 567-89-10</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#2d313b] mb-1">Фактический адрес склада</label>
                <input
                  type="text"
                  placeholder="г. Москва, Октябрьский проспект, д. 42"
                  value={formAddress}
                  onChange={e => setFormAddress(e.target.value)}
                  className="w-full bg-white border border-[#d9dbe0] rounded px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff]"
                />
              </div>

              {/* Anti-Fraud GPS Coordinates & Warehouse Zones */}
              <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                    <Navigation className="w-3.5 h-3.5 text-[#2f63ff]" />
                    <span>Геолокация склада и зоны (Anti-Fraud)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDetectCurrentGps}
                    disabled={isDetectingGps}
                    className="text-[11px] py-1 px-2.5 rounded bg-[#eef2ff] hover:bg-[#dbe4ff] text-[#2f63ff] font-semibold border border-[#a9bcff] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Compass className="w-3 h-3 text-[#2f63ff]" />
                    <span>{isDetectingGps ? 'Определяем GPS...' : 'Определить мой GPS'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-[#5d6270] leading-normal">
                  Сотрудник сможет отметиться только находясь в пределах допустимого радиуса склада при сканировании QR-кода на проходной.
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#2d313b] font-medium mb-0.5">Широта (Lat)</label>
                    <input
                      type="text"
                      placeholder="55.751244"
                      value={formLatitude}
                      onChange={e => setFormLatitude(e.target.value)}
                      className="w-full bg-white border border-[#d9dbe0] rounded px-2.5 py-1 text-xs text-[#111111] placeholder:text-[#5d6270]/60 font-mono focus:outline-none focus:border-[#2f63ff]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#2d313b] font-medium mb-0.5">Долгота (Lng)</label>
                    <input
                      type="text"
                      placeholder="37.618423"
                      value={formLongitude}
                      onChange={e => setFormLongitude(e.target.value)}
                      className="w-full bg-white border border-[#d9dbe0] rounded px-2.5 py-1 text-xs text-[#111111] placeholder:text-[#5d6270]/60 font-mono focus:outline-none focus:border-[#2f63ff]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#2d313b] font-medium mb-0.5">Радиус (метры)</label>
                    <input
                      type="number"
                      min={50}
                      max={5000}
                      step={50}
                      value={formRadiusMeters}
                      onChange={e => setFormRadiusMeters(Number(e.target.value))}
                      className="w-full bg-white border border-[#d9dbe0] rounded px-2.5 py-1 text-xs text-[#111111] placeholder:text-[#5d6270]/60 font-mono focus:outline-none focus:border-[#2f63ff]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-[#2d313b] font-medium mb-0.5">Зоны склада (через запятую)</label>
                  <input
                    type="text"
                    placeholder="Приёмка, Сборка, Упаковка, Отгрузка, Зона хранения"
                    value={formZones}
                    onChange={e => setFormZones(e.target.value)}
                    className="w-full bg-white border border-[#d9dbe0] rounded px-2.5 py-1 text-xs text-[#111111] placeholder:text-[#5d6270]/60 focus:outline-none focus:border-[#2f63ff]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#2d313b] mb-1">Заметки / Режим работы</label>
                <textarea
                  rows={2}
                  placeholder="Время работы, особенности выдачи или контакта с курьерами..."
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  className="w-full bg-white border border-[#d9dbe0] rounded px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff]"
                />
              </div>

              {/* Active Toggle */}
              <label className="flex items-center justify-between p-2.5 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] hover:border-[#2f63ff] cursor-pointer transition-colors">
                <div>
                  <span className="text-xs font-semibold text-[#111111] block">Статус работы склада</span>
                  <span className="text-[11px] text-[#5d6270]">
                    {formActive ? 'Склад активен и доступен для выбора сотрудниками' : 'Склад временно отключен'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={e => setFormActive(e.target.checked)}
                  className="w-4 h-4 accent-[#2f63ff] cursor-pointer rounded focus:outline-none focus:ring-1 focus:ring-[#2f63ff]"
                />
              </label>

              {/* Staff Multi-Select */}
              <div>
                <label className="block text-xs font-medium text-[#2d313b] mb-1">
                  Закрепленные сотрудники ({formStaffIds.length})
                </label>
                <div className="max-h-36 overflow-y-auto bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb]">
                  {activeStaff.map(staff => {
                    const isChecked = formStaffIds.includes(staff.id);
                    return (
                      <label
                        key={staff.id}
                        className="flex items-center justify-between px-3 py-2 hover:bg-[#f7f9ff] cursor-pointer text-xs transition-colors"
                      >
                        <span className="text-[#111111] font-medium">{staff.name}</span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setFormStaffIds(prev => [...prev, staff.id]);
                            } else {
                              setFormStaffIds(prev => prev.filter(id => id !== staff.id));
                            }
                          }}
                          className="w-3.5 h-3.5 accent-[#2f63ff] cursor-pointer rounded focus:outline-none"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors cursor-pointer border border-[#d9dbe0]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Сохранение...' : editingPoint ? 'Сохранить изменения' : 'Создать склад'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Staff Assignment for Location */}
      {assigningPoint && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-3 sm:p-4 z-[60] overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto text-[#111111]">
            <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">Распределение персонала</h3>
                <p className="text-xs text-[#2f63ff] font-mono font-medium mt-0.5">
                  Склад: {assigningPoint.name} ({assigningPoint.code})
                </p>
              </div>
              <button
                onClick={() => setAssigningPoint(null)}
                className="p-1 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#5d6270] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Поиск сотрудника..."
                  value={staffSearchQuery}
                  onChange={e => setStaffSearchQuery(e.target.value)}
                  className="w-full bg-white border border-[#d9dbe0] pl-8 pr-3 py-1.5 rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff]"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-[#5d6270] px-1">
                <span>Выбрано: <strong className="text-[#111111] font-mono tabular-nums">{assignedStaffIds.length} чел.</strong></span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAssignedStaffIds(activeStaff.map(s => s.id))}
                    className="text-[#2f63ff] hover:underline cursor-pointer font-semibold"
                  >
                    Выбрать всех
                  </button>
                  <span>·</span>
                  <button onClick={() => setAssignedStaffIds([])} className="text-[#5d6270] hover:text-[#111111] hover:underline cursor-pointer">
                    Сбросить
                  </button>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb]">
                {activeStaff
                  .filter(s => s.name.toLowerCase().includes(staffSearchQuery.toLowerCase()))
                  .map(staff => {
                    const isAssigned = assignedStaffIds.includes(staff.id);
                    return (
                      <div
                        key={staff.id}
                        onClick={() => {
                          if (isAssigned) {
                            setAssignedStaffIds(prev => prev.filter(id => id !== staff.id));
                          } else {
                            setAssignedStaffIds(prev => [...prev, staff.id]);
                          }
                        }}
                        className={`flex items-center justify-between px-3 py-2 cursor-pointer text-xs transition-colors ${
                          isAssigned
                            ? 'bg-[#eef2ff] text-[#111111] font-semibold'
                            : 'bg-white text-[#2d313b] hover:bg-[#f7f9ff]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <UserCheck className={`w-3.5 h-3.5 ${isAssigned ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                          <span>{staff.name}</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 accent-[#2f63ff] cursor-pointer rounded"
                        />
                      </div>
                    );
                  })}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
                <button
                  onClick={() => setAssigningPoint(null)}
                  className="px-3.5 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors cursor-pointer border border-[#d9dbe0]"
                >
                  Отмена
                </button>
                <button
                  onClick={handleSaveStaffAssignment}
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Сохранение...' : 'Применить доступ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-Over Drawer: Warehouse Overview & Management */}
      {analyticsPoint && (() => {
        const activePoint = pickupPoints.find(p => p.id === analyticsPoint.id) || analyticsPoint;
        const stats = getLocationStats(activePoint.code);
        const assignedStaffMembers = activeStaff.filter(
          s => activePoint.assignedStaffIds?.includes(s.id) || s.locations?.includes(activePoint.code)
        );
        const revenueShare =
          totalNetworkRevenue > 0
            ? Math.round((stats.totalRevenue / totalNetworkRevenue) * 100)
            : 0;

        return (
          <div
            onClick={e => {
              if (e.target === e.currentTarget) setAnalyticsPoint(null);
            }}
            className="fixed inset-0 bg-[#111111]/55 flex justify-end z-50 animate-fade-in"
          >
            <div className="bg-white border-l border-[#d9dbe0] w-full max-w-2xl h-full flex flex-col overflow-hidden text-[#111111]">
              <div className="p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {activePoint.isArchived ? (
                      <Archive className="w-5 h-5 text-[#b45309] shrink-0" />
                    ) : (
                      <Building2 className="w-5 h-5 text-[#2f63ff] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-[#111111] truncate">{activePoint.name}</h3>
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                            activePoint.isArchived
                              ? 'text-[#b45309]'
                              : activePoint.active !== false
                              ? 'text-emerald-700'
                              : 'text-[#5d6270]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-xs ${
                              activePoint.isArchived
                                ? 'bg-[#b45309]'
                                : activePoint.active !== false
                                ? 'bg-emerald-600'
                                : 'bg-[#5d6270]'
                            }`}
                          />
                          {activePoint.isArchived ? 'В архиве' : activePoint.active !== false ? 'Активен' : 'Отключен'}
                        </span>
                      </div>
                      <span className="text-xs text-[#5d6270] font-mono block mt-0.5 truncate">
                        Код: {activePoint.code} · {formatMonthName(selectedMonth)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setAnalyticsPoint(null)}
                    className="p-1.5 text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] rounded transition-colors cursor-pointer shrink-0"
                    title="Закрыть карточку"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Drawer Tab Switcher */}
                <div className="inline-flex bg-white p-1 rounded-md border border-[#d9dbe0]">
                  <button
                    type="button"
                    onClick={() => setDrawerTab('overview')}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                      drawerTab === 'overview'
                        ? 'bg-[#111111] text-white'
                        : 'text-[#2d313b] hover:bg-[#eef2ff] hover:text-[#111111]'
                    }`}
                  >
                    Обзор и смены
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('manage')}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                      drawerTab === 'manage'
                        ? 'bg-[#111111] text-white'
                        : 'text-[#2d313b] hover:bg-[#eef2ff] hover:text-[#111111]'
                    }`}
                  >
                    Персонал и управление
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto bg-white">
                {drawerTab === 'overview' ? (
                  <>
                    {/* Top Stats Strip */}
                    <div className="bg-[#f7f9ff] border border-[#d9dbe0] rounded-md grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#e5e7eb] overflow-hidden text-xs">
                      <div className="p-3">
                        <span className="text-[#5d6270] block text-[11px]">Совокупная выручка</span>
                        <span className="text-sm font-bold text-[#2f63ff] font-mono mt-0.5 block tabular-nums">
                          {formatCurrency(stats.totalRevenue)}
                        </span>
                        <span className="text-[10px] text-[#5d6270]">{revenueShare}% от сети</span>
                      </div>

                      <div className="p-3">
                        <span className="text-[#5d6270] block text-[11px]">Всего смен</span>
                        <span className="text-sm font-bold text-[#111111] font-mono mt-0.5 block tabular-nums">
                          {stats.shiftCount} смен
                        </span>
                        <span className="text-[10px] text-[#5d6270]">~{stats.avgRevenuePerShift} ₽/см</span>
                      </div>

                      <div className="p-3">
                        <span className="text-[#2d313b] font-medium block text-[11px]">ФОТ за месяц</span>
                        <span className="text-sm font-bold text-[#111111] font-mono mt-0.5 block tabular-nums">
                          {formatCurrency(stats.totalSalary)}
                        </span>
                      </div>

                      <div className="p-3">
                        <span className="text-[#5d6270] block text-[11px]">Доля в выручке</span>
                        <span className="text-sm font-bold text-[#2f63ff] font-mono mt-0.5 block tabular-nums">
                          {totalNetworkRevenue > 0
                            ? ((stats.totalRevenue / totalNetworkRevenue) * 100).toFixed(1)
                            : 0}
                          %
                        </span>
                      </div>
                    </div>

                    {/* Revenue & Salary Breakdown */}
                    <div className="border border-[#d9dbe0] rounded-md overflow-hidden">
                      <div className="px-3 py-2 bg-[#f7f9ff] border-b border-[#e5e7eb]">
                        <h4 className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
                          <DollarSign className="w-3.5 h-3.5 text-[#2f63ff]" />
                          ФОТ и выручка на складе
                        </h4>
                      </div>
                      <div className="bg-white grid grid-cols-2 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#e5e7eb] text-xs">
                        <div className="p-2.5 text-center">
                          <span className="text-[11px] text-[#5d6270] block">Наличные</span>
                          <span className="font-bold text-[#111111] font-mono mt-0.5 block tabular-nums">
                            {formatCurrency(stats.cashRevenue)}
                          </span>
                        </div>
                        <div className="p-2.5 text-center">
                          <span className="text-[11px] text-[#5d6270] block">Безналичные / Карта</span>
                          <span className="font-bold text-[#111111] font-mono mt-0.5 block tabular-nums">
                            {formatCurrency(stats.cardRevenue)}
                          </span>
                        </div>
                        <div className="p-2.5 text-center col-span-2 sm:col-span-1">
                          <span className="text-[11px] text-[#5d6270] block">Оклады / Премии</span>
                          <span className="font-bold text-[#111111] font-mono mt-0.5 block tabular-nums">
                            {formatCurrency(stats.totalShiftSalary)} + {formatCurrency(stats.totalBonus)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Recent Shifts Log for this location */}
                    <div>
                      <h4 className="text-xs font-semibold text-[#111111] mb-2 flex items-center justify-between">
                        <span>Журнал смен за {formatMonthName(selectedMonth)}</span>
                        <span className="text-[#5d6270] font-normal font-mono tabular-nums">{stats.records.length} записей</span>
                      </h4>

                      {stats.records.length > 0 ? (
                        <div className="max-h-80 overflow-y-auto bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb]">
                          {stats.records.map(r => {
                            const sales = calculateDailySales(r.sales);
                            return (
                              <div key={r.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-[#f7f9ff] transition-colors">
                                <div>
                                  <span className="font-semibold text-[#111111] block">{r.employeeName}</span>
                                  <span className="text-[10px] text-[#5d6270] font-mono">{r.date} · {r.shiftType || 'standard'}</span>
                                </div>
                                <div className="text-right font-mono tabular-nums">
                                  <span className="font-semibold text-[#2f63ff] block">
                                    {formatCurrency(sales.totalSales)}
                                  </span>
                                  <span className="text-[10px] text-[#5d6270]">
                                    Надбавка: {formatCurrency(sales.bonus)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-center text-xs text-[#5d6270]">
                          Смен за выбранный месяц на этом складе пока не зафиксировано
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4 text-xs">
                    {/* Location Parameters & QR */}
                    <div className="border border-[#d9dbe0] rounded-md overflow-hidden">
                      <div className="px-3.5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270]">
                          Параметры склада и геолокации
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedWarehouseForQR(activePoint)}
                            className="py-1 px-2.5 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <QrCode className="w-3.5 h-3.5 text-[#2f63ff]" />
                            <span>QR проходной</span>
                          </button>
                          {!activePoint.isArchived && (
                            <button
                              type="button"
                              onClick={() => openEditModal(activePoint)}
                              className="py-1 px-2.5 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5 text-[#2f63ff]" />
                              <span>Изменить</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="bg-white p-3.5 divide-y divide-[#e5e7eb] text-[#2d313b]">
                        <div className="flex items-start gap-2 pb-2">
                          <MapPin className="w-3.5 h-3.5 text-[#5d6270] shrink-0 mt-0.5" />
                          <span>{activePoint.address || 'Адрес не указан'}</span>
                        </div>
                        {activePoint.contactPhone && (
                          <div className="flex items-center gap-2 py-2">
                            <Phone className="w-3.5 h-3.5 text-[#5d6270] shrink-0" />
                            <span className="font-mono">{activePoint.contactPhone}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between py-2 text-[11px]">
                          <span className="text-[#5d6270]">Гео-радиус отметки:</span>
                          <span className="font-mono font-semibold text-[#111111]">
                            {activePoint.latitude && activePoint.longitude
                              ? `${activePoint.radiusMeters || 300} м (${activePoint.latitude}, ${activePoint.longitude})`
                              : 'Не заданы координаты'}
                          </span>
                        </div>
                        {Array.isArray(activePoint.zones) && activePoint.zones.length > 0 && (
                          <div className="py-2 text-[11px] text-[#5d6270]">
                            Зоны: <span className="text-[#111111] font-medium">{activePoint.zones.join(', ')}</span>
                          </div>
                        )}
                        {activePoint.notes && (
                          <div className="flex items-start gap-2 text-[#5d6270] text-[11px] pt-2">
                            <FileText className="w-3.5 h-3.5 text-[#5d6270] shrink-0 mt-0.5" />
                            <span>{activePoint.notes}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Assigned Staff Section */}
                    <div className="border border-[#d9dbe0] rounded-md overflow-hidden">
                      <div className="px-3.5 py-2.5 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270] flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-[#2f63ff]" />
                          Персонал склада ({assignedStaffMembers.length})
                        </span>
                        {!activePoint.isArchived && (
                          <button
                            type="button"
                            onClick={() => openAssignModal(activePoint)}
                            className="py-1 px-2.5 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2f63ff] rounded text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Распределить персонал
                          </button>
                        )}
                      </div>

                      {assignedStaffMembers.length > 0 ? (
                        <div className="bg-white divide-y divide-[#e5e7eb] max-h-48 overflow-y-auto">
                          {assignedStaffMembers.map(staff => (
                            <div key={staff.id} className="px-3.5 py-2 flex items-center justify-between">
                              <span className="font-medium text-[#111111]">{staff.name}</span>
                              <span className="text-[11px] text-[#5d6270]">{staff.position || 'Работник склада'}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-3.5 bg-white text-[11px] text-[#5d6270]">
                          {activePoint.isArchived
                            ? 'Локация в архиве (сотрудники отключены)'
                            : 'Сотрудники не закреплены (склад доступен всем)'}
                        </div>
                      )}
                    </div>

                    {/* Lifecycle & Status Actions */}
                    <div className="p-3.5 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-2.5">
                      <span className="text-[11px] uppercase font-semibold tracking-wider text-[#5d6270] block">
                        Статус и жизненный цикл
                      </span>

                      <div className="flex items-center gap-2 flex-wrap">
                        {activePoint.isArchived ? (
                          <button
                            type="button"
                            onClick={() => setRestoringPoint(activePoint)}
                            className="flex-1 py-2 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Восстановить из архива</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                if (activePoint.active !== false) {
                                  setDeactivatingPoint(activePoint);
                                } else {
                                  togglePointActive(activePoint);
                                }
                              }}
                              className={`flex-1 py-2 px-3 rounded text-xs font-semibold transition-colors cursor-pointer border ${
                                activePoint.active !== false
                                  ? 'bg-white text-[#b45309] border-amber-300 hover:bg-amber-50'
                                  : 'bg-[#2f63ff] text-white border-[#2f63ff] hover:bg-[#1f4fe0]'
                              }`}
                            >
                              {activePoint.active !== false ? 'Отключить склад' : 'Включить склад'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRequestArchive(activePoint)}
                              className="py-2 px-3 bg-amber-50 hover:bg-amber-100 text-[#b45309] border border-amber-300 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              <span>В архив</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleRequestPermanentDelete(activePoint)}
                          className="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Удалить</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between shrink-0">
                <span className="text-[11px] text-[#5d6270] font-mono">{activePoint.code}</span>
                <button
                  onClick={() => setAnalyticsPoint(null)}
                  className="px-4 py-1.5 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-semibold transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Confirm Deactivate PVZ */}
      {deactivatingPoint && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md overflow-hidden text-[#111111]">
            <div className="p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#b45309] shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111111]">Отключение склада</h3>
                  <p className="text-xs text-[#5d6270]">Подтверждение действия</p>
                </div>
              </div>
              <button
                onClick={() => setDeactivatingPoint(null)}
                className="text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] p-1 rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <p className="text-xs text-[#2d313b] leading-relaxed">
                Вы уверены, что хотите отключить склад{' '}
                <span className="font-semibold text-[#111111]">«{deactivatingPoint.name}»</span>{' '}
                <span className="font-mono font-semibold text-[#2f63ff]">
                  ({deactivatingPoint.code})
                </span>
                ?
              </p>

              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs text-[#2d313b] space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[#b45309] font-semibold">•</span>
                  <span>Склад перейдет в статус <strong>«Отключен»</strong> и не будет доступен сотрудникам для открытия новых смен.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#2f63ff] font-semibold">•</span>
                  <span>Все финансовые показатели, история смен и аналитика сохраняются в полном объеме.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#2f63ff] font-semibold">•</span>
                  <span>Вы сможете включить его обратно в любой момент одним нажатием кнопки <strong>«Включить»</strong>.</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => setDeactivatingPoint(null)}
                  className="px-3.5 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors cursor-pointer border border-[#d9dbe0]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = deactivatingPoint;
                    setDeactivatingPoint(null);
                    const res = await updatePickupPoint(target.id, { active: false });
                    if (res.success) {
                      setActionSuccessMsg(`Склад «${target.name}» успешно отключен`);
                      setTimeout(() => setActionSuccessMsg(null), 3000);
                    }
                  }}
                  className="px-4 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors cursor-pointer"
                >
                  Отключить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Archive PVZ */}
      {archivingPoint && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md overflow-hidden text-[#111111]">
            <div className="p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Archive className="w-4 h-4 text-[#b45309] shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111111]">Перемещение в архив</h3>
                  <p className="text-xs text-[#5d6270]">Архивация склада</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isSubmitting) setArchivingPoint(null);
                }}
                disabled={isSubmitting}
                className="text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] p-1 rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <p className="text-xs text-[#2d313b] leading-relaxed">
                Вы уверены, что хотите отправить в архив склад{' '}
                <span className="font-semibold text-[#111111]">«{archivingPoint.name}»</span>{' '}
                <span className="font-mono font-semibold text-[#2f63ff]">
                  ({archivingPoint.code})
                </span>
                ?
              </p>

              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs text-[#2d313b] space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[#2f63ff] font-semibold">•</span>
                  <span>Склад будет перемещен во вкладку <strong>«Архив»</strong> и отключен для новых смен сотрудников.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#2f63ff] font-semibold">•</span>
                  <span>Все ранее сохраненные отчеты, смены и расчеты сохраняются.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#2f63ff] font-semibold">•</span>
                  <span>Вы сможете <strong>восстановить</strong> этот склад в любой момент одним нажатием.</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => setArchivingPoint(null)}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer border border-[#d9dbe0]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleConfirmArchive}
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Архивация...</span>
                    </>
                  ) : (
                    <>
                      <Archive className="w-3.5 h-3.5" />
                      <span>В архив</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Restore Warehouse from Archive */}
      {restoringPoint && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md overflow-hidden text-[#111111]">
            <div className="p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <RotateCcw className="w-4 h-4 text-[#2f63ff] shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111111]">Восстановление из архива</h3>
                  <p className="text-xs text-[#5d6270]">Возврат склада в рабочий список</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isSubmitting) setRestoringPoint(null);
                }}
                disabled={isSubmitting}
                className="text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] p-1 rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <p className="text-xs text-[#2d313b] leading-relaxed">
                Восстановить склад{' '}
                <span className="font-semibold text-[#111111]">«{restoringPoint.name}»</span>{' '}
                <span className="font-mono font-semibold text-[#2f63ff]">
                  ({restoringPoint.code})
                </span>{' '}
                из архива и вернуть его в активный список?
              </p>

              <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs text-[#2d313b] space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[#2f63ff] font-semibold">•</span>
                  <span>Склад снова появится в основном списке активных складов и станет доступен для работы.</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => setRestoringPoint(null)}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer border border-[#d9dbe0]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Восстановление...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Восстановить склад</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Permanent Delete Warehouse */}
      {deletingPoint && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md overflow-hidden text-[#111111]">
            <div className="p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111111]">Окончательное удаление</h3>
                  <p className="text-xs text-[#5d6270]">Полное удаление из базы данных</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isSubmitting) {
                    setDeletingPoint(null);
                    setDeleteError(null);
                  }
                }}
                disabled={isSubmitting}
                className="text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] p-1 rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              {deleteError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{deleteError}</span>
                </div>
              )}

              <p className="text-xs text-[#2d313b] leading-relaxed">
                Вы уверены, что хотите окончательно удалить склад{' '}
                <span className="font-semibold text-[#111111]">«{deletingPoint.name}»</span>{' '}
                <span className="font-mono font-semibold text-[#2f63ff]">
                  ({deletingPoint.code})
                </span>
                ?
              </p>

              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 space-y-1.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>Склад будет полностью удален из базы данных. Если вы хотите временно скрыть склад — используйте кнопку <strong>«В архив»</strong>.</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => {
                    setDeletingPoint(null);
                    setDeleteError(null);
                  }}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer border border-[#d9dbe0]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPermanentDelete}
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Удаление...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Удалить навсегда</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Warning for Single Remaining PVZ */}
      {deleteWarning && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md overflow-hidden text-[#111111]">
            <div className="p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-[#b45309] shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-[#111111]">Невозможно выполнить действие</h3>
                  <p className="text-xs text-[#5d6270]">Ограничение структуры сети</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteWarning(null)}
                className="text-[#5d6270] hover:text-[#111111] hover:bg-[#eef2ff] p-1 rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <p className="text-xs text-[#2d313b] leading-relaxed">
                {deleteWarning}
              </p>
              <div className="flex justify-end pt-2 border-t border-[#e5e7eb]">
                <button
                  type="button"
                  onClick={() => setDeleteWarning(null)}
                  className="px-4 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-bold transition-colors cursor-pointer"
                >
                  Понятно
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Warehouse QR Code Printable Pass Modal */}
      {selectedWarehouseForQR && (
        <WarehouseQRModal
          isOpen={!!selectedWarehouseForQR}
          onClose={() => setSelectedWarehouseForQR(null)}
          warehouse={selectedWarehouseForQR}
        />
      )}
    </div>
  );
};

