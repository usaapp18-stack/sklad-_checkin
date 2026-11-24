import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { StaffMember, LocationType, ShiftType } from '../../types';
import { aggregateMonthlyStats, formatCurrency, calculateDailySales, normalizeShiftType, calculateShiftTotalSalary, getShiftLabel } from '../../utils/calculations';
import { getCurrentAndPreviousMonth, formatMonthName, formatDateRuDMY, getAllAvailableMonths } from '../../utils/time';
import { copyToClipboard } from '../../utils/clipboard';
import { CustomPeriodSelect } from '../common/CustomPeriodSelect';
import { CustomSelect } from '../common/CustomSelect';
import { CustomDatePicker } from '../common/CustomDatePicker';
import {
  User,
  UserCheck,
  UserX,
  Archive,
  RotateCcw,
  Search,
  AlertCircle,
  Eye,
  EyeOff,
  X,
  UserPlus,
  Copy,
  Check,
  Edit2,
  Trash2,
  Plus,
  Clock,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  Banknote,
  CreditCard,
  Shield,
  Briefcase
} from 'lucide-react';

export const StaffManagementView: React.FC = () => {
  const {
    staffList,
    records,
    rates,
    deactivateStaff,
    restoreStaff,
    archiveStaff,
    deleteStaffPermanently,
    createEmployeeAccount,
    updateEmployeeCredentials,
    managerAddOrUpdateShift,
    managerDeleteShift,
    submitSales,
    pickupPoints = [],
    warehousePositions = [],
    addWarehousePosition,
  } = useApp();

  const calculateFOT = (staff: StaffMember, stat: any) => {
    if (!stat || !stat.records) return 0;
    let totalShiftSalary = 0;
    stat.records.forEach((rec: any) => {
      if (rec.shiftType) {
        totalShiftSalary += calculateShiftTotalSalary(rec, staff, rates);
      }
    });
    return totalShiftSalary;
  };

  const calculateShiftSinglePay = (staff: StaffMember, rec: any) => {
    if (!rec || !rec.shiftType) return 0;
    return calculateShiftTotalSalary(rec, staff, rates);
  };

  const allAvailableMonths = getAllAvailableMonths(records, 12);
  const { current } = getCurrentAndPreviousMonth();
  const currentMonthStats = aggregateMonthlyStats(records, current);

  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Slide-Over Drawer state
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [drawerTab, setDrawerTab] = useState<'stats' | 'access'>('stats');
  const [selectedStaffMonth, setSelectedStaffMonth] = useState<string>(current);
  const [shiftToDelete, setShiftToDelete] = useState<any | null>(null);

  // Staff action confirmation state (block, archive, restore, delete) without native browser confirm()
  const [staffActionConfirm, setStaffActionConfirm] = useState<{
    type: 'block' | 'archive' | 'restore' | 'delete';
    staff: StaffMember;
  } | null>(null);
  const [staffActionProcessing, setStaffActionProcessing] = useState(false);
  const [staffActionError, setStaffActionError] = useState<string | null>(null);

  const handleExecuteStaffAction = async () => {
    if (!staffActionConfirm) return;
    const { type, staff } = staffActionConfirm;
    setStaffActionProcessing(true);
    setStaffActionError(null);

    const actionText = 
      type === 'block' ? `Доступ сотрудника «${staff.name}» отключен` :
      type === 'archive' ? `Сотрудник «${staff.name}» перенесен в архив` :
      type === 'restore' ? `Сотрудник «${staff.name}» восстановлен` :
      `Сотрудник «${staff.name}» удален`;

    try {
      let res: { success: boolean; error?: string } = { success: false };
      if (type === 'block') {
        res = await deactivateStaff(staff.id);
      } else if (type === 'archive') {
        res = await archiveStaff(staff.id);
      } else if (type === 'restore') {
        res = await restoreStaff(staff.id);
      } else if (type === 'delete') {
        res = await deleteStaffPermanently(staff.id);
        if (res.success && selectedStaff?.id === staff.id) {
          setSelectedStaff(null);
        }
      }

      if (res.success) {
        setStaffActionConfirm(null);
        setActionToastMsg(actionText);
        setTimeout(() => setActionToastMsg(null), 3500);
      } else {
        setStaffActionError(res.error || 'Ошибка при выполнении операции');
        setActionErrorMsg(res.error || 'Ошибка при выполнении операции');
        setTimeout(() => setActionErrorMsg(null), 5000);
      }
    } catch (err: any) {
      setStaffActionError(err.message || 'Ошибка сети');
      setActionErrorMsg(err.message || 'Ошибка сети');
      setTimeout(() => setActionErrorMsg(null), 5000);
    } finally {
      setStaffActionProcessing(false);
    }
  };

  // Add shift state in manager indicators modal
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [newShiftDate, setNewShiftDate] = useState(new Date().toISOString().slice(0, 10));
  const [newShiftType, setNewShiftType] = useState<ShiftType>('day12');
  const [newShiftLocation, setNewShiftLocation] = useState<LocationType>(pickupPoints[0]?.code || '');
  const [shiftActionLoading, setShiftActionLoading] = useState(false);
  const [shiftActionMsg, setShiftActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit individual shift inline state
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editingShiftType, setEditingShiftType] = useState<ShiftType>('day12');
  const [editingShiftLocation, setEditingShiftLocation] = useState<LocationType>(pickupPoints[0]?.code || '');

  // Edit individual sales inline state (Наличные и Безналичные)
  const [editingCashSales, setEditingCashSales] = useState<string>('0');
  const [editingCardSales, setEditingCardSales] = useState<string>('0');

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editCredStaff, setEditCredStaff] = useState<StaffMember | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Create form state
  const [newName, setNewName] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newLocations, setNewLocations] = useState<LocationType[]>([]);
  const [newTelegram, setNewTelegram] = useState('');
  const [newPosition, setNewPosition] = useState('Работник склада');
  const [newCustomPosition, setNewCustomPosition] = useState('');
  const [isNewCustomPosOpen, setIsNewCustomPosOpen] = useState(false);
  const [newPayType, setNewPayType] = useState<'hourly' | 'shift'>('hourly');
  const [newHourlyRate, setNewHourlyRate] = useState<number>(350);
  const [newShiftRate, setNewShiftRate] = useState<number>(3500);
  const [newNightRate, setNewNightRate] = useState<number>(0);
  const [newIsPartTime, setNewIsPartTime] = useState(false);
  const [newIsSenior, setNewIsSenior] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit creds state
  const [editName, setEditName] = useState('');
  const [editLogin, setEditLogin] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editLocations, setEditLocations] = useState<LocationType[]>([]);
  const [editPosition, setEditPosition] = useState('Работник склада');
  const [editCustomPosition, setEditCustomPosition] = useState('');
  const [isEditCustomPosOpen, setIsEditCustomPosOpen] = useState(false);
  const [editPayType, setEditPayType] = useState<'hourly' | 'shift'>('hourly');
  const [editHourlyRate, setEditHourlyRate] = useState<number>(350);
  const [editShiftRate, setEditShiftRate] = useState<number>(3500);
  const [editNightRate, setEditNightRate] = useState<number>(0);
  const [editIsPartTime, setEditIsPartTime] = useState(false);
  const [editIsSenior, setEditIsSenior] = useState(false);
  const [editTelegram, setEditTelegram] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Instant notification toasts
  const [actionToastMsg, setActionToastMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  // Safari focus trap for accessibility
  React.useEffect(() => {
    if (!isCreateOpen && !editCredStaff && !selectedStaff && !staffActionConfirm) return;

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
  }, [isCreateOpen, editCredStaff, selectedStaff, staffActionConfirm]);

  const filteredStaff = staffList.filter(s => {
    const sLogin = s.login || '';
    const sName = s.name || '';
    const sTg = s.telegramUsername || '';
    const term = searchTerm.toLowerCase();

    const matchesSearch =
      sName.toLowerCase().includes(term) ||
      sLogin.toLowerCase().includes(term) ||
      sTg.toLowerCase().includes(term);
    if (!matchesSearch) return false;

    if (activeTab === 'active') {
      return s.status === 'active';
    } else {
      return s.status !== 'active';
    }
  });

  const copyCredentials = async (staff: StaffMember) => {
    const locs = staff.locations && staff.locations.length > 0 ? staff.locations.join(', ') : (staff.location || 'Не указан');
    const passwordText = staff.password || 'Не задан';
    const text = `Логин: ${staff.login || ''}\nПароль: ${passwordText}\nМесто работы: ${locs}`;
    await copyToClipboard(text);
    setCopiedId(staff.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleLocationSelection = (loc: LocationType, list: LocationType[], setList: (l: LocationType[]) => void) => {
    if (list.includes(loc)) {
      setList(list.filter(item => item !== loc));
    } else {
      setList([...list, loc]);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const nameToSave = newName.trim();
    const loginToSave = newLogin.trim().toLowerCase();
    const passToSave = newPassword.trim();
    const locsToSave = newLocations;
    const tgToSave = newTelegram.trim();
    const partTimeToSave = newIsPartTime;
    const seniorToSave = newIsSenior;

    if (staffList.length >= 150) {
      setCreateError('Достигнут лимит: максимально допустимо 150 сотрудников.');
      return;
    }

    if (!nameToSave) {
      setCreateError('Укажите ФИО сотрудника');
      return;
    }
    if (!loginToSave || !passToSave) {
      setCreateError('Логин и пароль обязательны для заполнения');
      return;
    }
    if (locsToSave.length === 0) {
      setCreateError('Необходимо выбрать хотя бы одно место работы');
      return;
    }

    const duplicate = staffList.find(s => (s.login || '').toLowerCase() === loginToSave);
    if (duplicate) {
      setCreateError('Сотрудник с таким логином уже зарегистрирован');
      return;
    }

    const finalNewPosition = isNewCustomPosOpen && newCustomPosition.trim() ? newCustomPosition.trim() : newPosition;
    if (isNewCustomPosOpen && newCustomPosition.trim()) {
      addWarehousePosition(newCustomPosition.trim()).catch(() => {});
    }

    // Fast saving: immediately close modal and reset form
    setIsCreateOpen(false);
    setNewName('');
    setNewLogin('');
    setNewPassword('');
    setNewTelegram('');
    setNewLocations([]);
    setNewPosition('Работник склада');
    setNewCustomPosition('');
    setIsNewCustomPosOpen(false);
    setNewPayType('hourly');
    setNewHourlyRate(350);
    setNewShiftRate(3500);
    setNewNightRate(0);
    setNewIsPartTime(false);
    setNewIsSenior(false);

    setActionToastMsg(`Сотрудник «${nameToSave}» успешно добавлен`);
    setTimeout(() => setActionToastMsg(null), 3500);

    const result = await createEmployeeAccount(
      nameToSave,
      loginToSave,
      passToSave,
      locsToSave,
      tgToSave,
      partTimeToSave,
      seniorToSave,
      {
        position: finalNewPosition,
        payType: newPayType,
        hourlyRate: Number(newHourlyRate) || 350,
        shiftRate: Number(newShiftRate) || 3500,
        nightRate: Number(newNightRate) || 0,
      }
    );
    if (!result.success) {
      setActionToastMsg(null);
      setActionErrorMsg(result.error || 'Ошибка создания учетной записи');
      setTimeout(() => setActionErrorMsg(null), 5000);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCredStaff) return;
    setEditError(null);

    const targetStaff = editCredStaff;
    const nameToSave = editName.trim();
    const loginToSave = editLogin.trim().toLowerCase();
    const passToSave = editPassword.trim();
    const locsToSave = editLocations;
    const tgToSave = editTelegram.trim();
    const partTimeToSave = editIsPartTime;
    const seniorToSave = editIsSenior;
    const finalEditPosition = isEditCustomPosOpen && editCustomPosition.trim() ? editCustomPosition.trim() : editPosition;
    if (isEditCustomPosOpen && editCustomPosition.trim()) {
      addWarehousePosition(editCustomPosition.trim()).catch(() => {});
    }

    if (!nameToSave) {
      setEditError('Имя обязательно для заполнения');
      return;
    }
    if (!loginToSave) {
      setEditError('Логин обязателен для заполнения');
      return;
    }
    if (locsToSave.length === 0) {
      setEditError('Необходимо выбрать хотя бы одно место работы');
      return;
    }

    const conflict = staffList.find(s => s.id !== targetStaff.id && (s.login || '').toLowerCase() === loginToSave);
    if (conflict) {
      setEditError('Такой логин уже занят другим сотрудником');
      return;
    }

    // Fast saving: immediately close modal and sync selectedStaff
    setEditCredStaff(null);
    setSelectedStaff(prev => (prev && prev.id === targetStaff.id ? {
      ...prev,
      name: nameToSave,
      login: loginToSave,
      password: passToSave || prev.password,
      locations: locsToSave,
      telegramUsername: tgToSave,
      isPartTime: partTimeToSave,
      isSenior: seniorToSave,
      position: finalEditPosition,
      payType: editPayType,
      hourlyRate: Number(editHourlyRate) || 350,
      shiftRate: Number(editShiftRate) || 3500,
      nightRate: Number(editNightRate) || 0,
    } : prev));

    setActionToastMsg(`Данные сотрудника «${nameToSave}» успешно сохранены`);
    setTimeout(() => setActionToastMsg(null), 3500);

    const result = await updateEmployeeCredentials(
      targetStaff.id,
      loginToSave,
      passToSave || undefined,
      locsToSave,
      partTimeToSave,
      seniorToSave,
      nameToSave,
      tgToSave,
      {
        position: finalEditPosition,
        payType: editPayType,
        hourlyRate: Number(editHourlyRate) || 350,
        shiftRate: Number(editShiftRate) || 3500,
        nightRate: Number(editNightRate) || 0,
      }
    );
    if (!result.success) {
      setActionToastMsg(null);
      setActionErrorMsg(result.error || 'Ошибка обновления данных сотрудника');
      setTimeout(() => setActionErrorMsg(null), 5000);
    }
  };

  const openEditModal = (staff: StaffMember) => {
    setEditCredStaff(staff);
    setEditName(staff.name || '');
    setEditLogin(staff.login || '');
    setEditPassword('');
    setEditTelegram(staff.telegramUsername || '');
    setEditLocations(staff.locations && staff.locations.length > 0 ? staff.locations : (staff.location ? [staff.location] : []));
    setEditPosition(staff.position || 'Работник склада');
    setEditCustomPosition('');
    setIsEditCustomPosOpen(false);
    setEditPayType(staff.payType || 'hourly');
    setEditHourlyRate(staff.hourlyRate != null ? staff.hourlyRate : 350);
    setEditShiftRate(staff.shiftRate != null ? staff.shiftRate : 3500);
    setEditNightRate(staff.nightRate != null ? staff.nightRate : 0);
    setEditIsPartTime(!!staff.isPartTime);
    setEditIsSenior(!!staff.isSenior);
    setEditError(null);
  };

  const handleSaveNewShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff) return;
    setShiftActionLoading(true);
    setShiftActionMsg(null);

    const res = await managerAddOrUpdateShift(selectedStaff.id, newShiftDate, newShiftType, newShiftLocation);
    setShiftActionLoading(false);
    if (res.success) {
      if (newShiftDate.length >= 7) {
        setSelectedStaffMonth(newShiftDate.slice(0, 7));
      }
      setShiftActionMsg({ type: 'success', text: `Смена на ${formatDateRuDMY(newShiftDate)} успешно сохранена!` });
      setIsAddShiftOpen(false);
      setTimeout(() => setShiftActionMsg(null), 3000);
    } else {
      setShiftActionMsg({ type: 'error', text: res.error || 'Ошибка сохранения смены' });
    }
  };

  const handleSaveEditedShift = async (rec: any) => {
    if (!selectedStaff) return;
    setShiftActionLoading(true);
    setShiftActionMsg(null);

    // 1. Update shift details
    const res = await managerAddOrUpdateShift(selectedStaff.id, rec.date, editingShiftType, editingShiftLocation);
    
    if (res.success) {
      // 2. Update sales details only for non-part-time staff when sales are present or entered
      if (!selectedStaff.isPartTime) {
        const cashVal = Math.max(0, parseInt(editingCashSales, 10) || 0);
        const cardVal = Math.max(0, parseInt(editingCardSales, 10) || 0);
        const totalEntered = cashVal + cardVal;
        const hadSales = rec.sales && (rec.sales.total > 0 || rec.sales.photo || rec.sales.print || rec.sales.cash || rec.sales.card);

        if (totalEntered > 0 || hadSales) {
          const parsedSales = {
            cash: cashVal,
            card: cardVal,
            total: totalEntered,
          };

          const salesRes = await submitSales(selectedStaff.id, parsedSales, rec.date);
          if (!salesRes.success) {
            setShiftActionLoading(false);
            setShiftActionMsg({
              type: 'error',
              text: `Смена сохранена, но возникла ошибка при обновлении выручки: ${salesRes.error}`,
            });
            return;
          }
        }
      }

      setShiftActionLoading(false);
      setEditingRecordId(null);
      setShiftActionMsg({ type: 'success', text: `Смена на ${formatDateRuDMY(rec.date)} успешно обновлена!` });
      setTimeout(() => setShiftActionMsg(null), 3000);
    } else {
      setShiftActionLoading(false);
      setShiftActionMsg({ type: 'error', text: res.error || 'Ошибка изменения смены' });
    }
  };

  const handleConfirmDeleteShift = async () => {
    if (!shiftToDelete || !selectedStaff) return;
    setShiftActionLoading(true);
    setShiftActionMsg(null);
    const recDate = shiftToDelete.date;
    const res = await managerDeleteShift(shiftToDelete.id);
    setShiftActionLoading(false);
    setShiftToDelete(null);
    if (editingRecordId === shiftToDelete.id) {
      setEditingRecordId(null);
    }
    if (res.success) {
      setShiftActionMsg({ type: 'success', text: `Смена за ${formatDateRuDMY(recDate)} успешно удалена!` });
      setTimeout(() => setShiftActionMsg(null), 3000);
    } else {
      setShiftActionMsg({ type: 'error', text: res.error || 'Ошибка удаления смены' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {actionToastMsg && (
        <div className="toast-banner fixed top-5 right-5 z-50 p-3.5 bg-[#111111] text-white border border-[#2d313b] rounded-md text-xs font-semibold shadow-sm flex items-center gap-2.5 animate-in slide-in-from-top duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#a9bcff] shrink-0" />
          <span className="text-white">{actionToastMsg}</span>
        </div>
      )}
      {actionErrorMsg && (
        <div className="toast-banner fixed top-5 right-5 z-50 p-3.5 bg-rose-700 text-white border border-rose-500 rounded-md text-xs font-semibold shadow-sm flex items-center gap-2.5 animate-in slide-in-from-top duration-200">
          <AlertCircle className="w-4 h-4 text-rose-200 shrink-0" />
          <span className="text-white">{actionErrorMsg}</span>
        </div>
      )}

      {/* Top Header & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-base font-semibold text-[#111111] tracking-wide uppercase flex items-center gap-2">
              <span>Сотрудники</span>
              <span className="text-[#5d6270] font-mono text-sm font-normal tracking-normal normal-case ml-1 tabular-nums">
                {staffList.filter(s => s.status === 'active').length}
              </span>
            </h2>
            <span className="text-xs font-normal text-[#5d6270] whitespace-nowrap">
              Всего: {staffList.length} / 150
            </span>
          </div>
          <p className="text-xs text-[#2d313b] mt-0.5">
            Управление персоналом ({staffList.filter(s => s.status === 'active').length} активных из {staffList.length}), выдача доступов и детальные показатели
          </p>
        </div>

        {/* Tab switcher: Active vs Archived */}
        <div className="flex items-center gap-2">
          <div className="flex bg-[#f7f9ff] p-0.5 rounded-md border border-[#d9dbe0]">
            <button
              onClick={() => setActiveTab('active')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'active'
                  ? 'bg-[#111111] text-white font-semibold'
                  : 'text-[#2d313b] hover:bg-[#eef2ff] hover:text-[#111111]'
              }`}
            >
              <UserCheck className={`w-3.5 h-3.5 ${activeTab === 'active' ? 'text-[#a9bcff]' : 'text-[#5d6270]'}`} />
              <span>Активные ({staffList.filter(s => s.status === 'active').length})</span>
            </button>

            <button
              onClick={() => setActiveTab('archived')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'archived'
                  ? 'bg-[#111111] text-white font-semibold'
                  : 'text-[#2d313b] hover:bg-[#eef2ff] hover:text-[#111111]'
              }`}
            >
              <Archive className={`w-3.5 h-3.5 ${activeTab === 'archived' ? 'text-[#a9bcff]' : 'text-[#5d6270]'}`} />
              <span>Архив ({staffList.filter(s => s.status !== 'active').length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search & Create Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-[#5d6270] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск по имени, логину, telegram..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] transition-colors"
            />
          </div>
        </div>

        <button
          onClick={() => {
            if (staffList.length >= 150) return;
            setNewName('');
            setNewLogin(`emp_${Math.floor(100 + Math.random() * 900)}`);
            setNewPassword(`pass${Math.floor(100 + Math.random() * 900)}`);
            setNewLocations([]);
            setCreateError(null);
            setIsCreateOpen(true);
          }}
          disabled={staffList.length >= 150}
          title={staffList.length >= 150 ? 'Достигнут лимит: 150 сотрудников' : 'Создать доступ'}
          className="flex items-center justify-center gap-1.5 py-1.5 px-3.5 bg-[#2f63ff] hover:bg-[#1f4fe0] disabled:bg-[#eef2ff] disabled:text-[#5d6270] disabled:border disabled:border-[#d9dbe0] disabled:cursor-not-allowed text-white rounded text-xs font-bold whitespace-nowrap transition-colors cursor-pointer"
        >
          <UserPlus className="w-4 h-4 stroke-[2.5]" />
          <span>Создать доступ</span>
        </button>
      </div>

      {/* Staff Light Scannable List */}
      <div>
        {filteredStaff.length === 0 ? (
          <div className="py-12 text-center text-[#5d6270] text-xs bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
            Работники не найдены
          </div>
        ) : (
          <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] overflow-hidden">
            {filteredStaff.map(staff => {
              const stat = currentMonthStats.get(staff.id);
              const staffLocations = staff.locations && staff.locations.length > 0 ? staff.locations : [];
              const fot = calculateFOT(staff, stat);
              const bonus = stat?.sales.totalBonus || 0;

              const openStaffDrawer = (initialTab: 'stats' | 'access' = 'stats') => {
                setSelectedStaff(staff);
                setDrawerTab(initialTab);
                setSelectedStaffMonth(current);
                setIsAddShiftOpen(false);
                setEditingRecordId(null);
                setShiftActionMsg(null);
              };

              return (
                <div
                  key={staff.id}
                  onClick={() => openStaffDrawer('stats')}
                  className="p-3 sm:px-4 sm:py-3 hover:bg-[#f7f9ff] transition-colors flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap cursor-pointer"
                >
                  {/* Left: Avatar & Clean Metadata */}
                  <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                    <div className={`w-9 h-9 rounded flex items-center justify-center shrink-0 font-mono font-semibold text-xs ${
                      staff.status === 'active'
                        ? 'bg-[#f7f9ff] text-[#111111] border border-[#d9dbe0]'
                        : 'bg-[#eef2ff]/60 text-[#5d6270] border border-[#d9dbe0]'
                    }`}>
                      {staff.name
                        ? staff.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
                        : '??'}
                    </div>

                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#111111] flex items-center gap-1.5 flex-wrap">
                        <span className="truncate">{staff.name}</span>
                        <span className="text-xs font-medium text-[#2d313b]">
                          · {staff.position || 'Работник склада'}
                        </span>
                        {staff.isSenior && (
                          <span className="text-[#2f63ff] font-semibold text-xs">· Бригадир</span>
                        )}
                        <span className="text-[#5d6270] font-normal text-xs">
                          · {staff.isPartTime ? 'Подработка' : 'Штат'}
                        </span>
                        {staff.status !== 'active' && (
                          <span className={`text-[11px] font-semibold ${
                            staff.status === 'archived' ? 'text-[#b45309]' : 'text-rose-700'
                          }`}>
                            · {staff.status === 'archived' ? 'В архиве' : 'Заблокирован'}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-[#5d6270] flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="font-mono text-[#2f63ff] font-semibold tabular-nums">
                          {staff.payType === 'shift' ? `${staff.shiftRate || 3500} ₽/см` : `${staff.hourlyRate || 350} ₽/ч`}
                        </span>
                        {staff.nightRate ? (
                          <span className="text-[#b45309] font-medium text-[11px] tabular-nums">· ночные +{staff.nightRate} ₽</span>
                        ) : null}
                        <span className="font-mono text-[#5d6270]">· {staff.login}</span>
                        {staffLocations.length > 0 && (
                          <span className="text-[#2d313b]">· {staffLocations.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Compact Current Month Indicators */}
                  <div className="flex items-center gap-4 sm:gap-6 shrink-0 text-right">
                    <div>
                      <div className="text-[11px] text-[#5d6270] font-normal">Смен</div>
                      <div className="text-xs font-semibold font-mono text-[#111111] tabular-nums">{stat?.shiftsCount.total || 0}</div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[#5d6270] font-normal">ФОТ (ЗП)</div>
                      <div className="text-xs font-semibold font-mono text-[#2f63ff] tabular-nums">{formatCurrency(fot)}</div>
                    </div>

                    {bonus > 0 && (
                      <div className="hidden sm:block">
                        <div className="text-[11px] text-[#5d6270] font-normal">Премия</div>
                        <div className="text-xs font-semibold font-mono text-[#b45309] tabular-nums">+{formatCurrency(bonus)}</div>
                      </div>
                    )}
                  </div>

                  {/* Right: Drawer Trigger */}
                  <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openStaffDrawer('stats')}
                      className="py-1.5 px-3 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>Карточка</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#5d6270]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Staff Slide-Over Drawer (Shifts & Payroll + Access & Settings) */}
      {selectedStaff && (() => {
        const activeStaff = staffList.find(s => s.id === selectedStaff.id) || selectedStaff;
        const activeStaffLocations = activeStaff.locations && activeStaff.locations.length > 0 ? activeStaff.locations : [];
        const isCopied = copiedId === activeStaff.id;

        return (
          <div
            onClick={e => {
              if (e.target === e.currentTarget) setSelectedStaff(null);
            }}
            className="fixed inset-0 z-50 flex justify-end bg-[#111111]/55 animate-fade-in"
          >
            <div className="bg-white border-l border-[#d9dbe0] w-full max-w-2xl h-full flex flex-col overflow-hidden">
              
              {/* Drawer Header */}
              <div className="p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] space-y-3 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {activeStaff.status === 'active' ? (
                      <User className="w-5 h-5 text-[#2f63ff] shrink-0 mt-0.5" />
                    ) : (
                      <UserX className="w-5 h-5 text-[#b45309] shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-[#111111] flex items-center gap-2.5 flex-wrap">
                        <span className="truncate">{activeStaff.name}</span>
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            activeStaff.status === 'active'
                              ? 'text-[#2f63ff]'
                              : activeStaff.status === 'archived'
                              ? 'text-[#b45309]'
                              : 'text-rose-700'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-xs ${
                              activeStaff.status === 'active'
                                ? 'bg-[#2f63ff]'
                                : activeStaff.status === 'archived'
                                ? 'bg-[#b45309]'
                                : 'bg-rose-600'
                            }`}
                          />
                          {activeStaff.status === 'active'
                            ? 'Активен'
                            : activeStaff.status === 'archived'
                            ? 'В архиве'
                            : 'Заблокирован'}
                        </span>
                      </h3>
                      <p className="text-xs text-[#2d313b] mt-0.5 truncate">
                        {activeStaff.position || 'Работник склада'}
                        {activeStaff.isSenior ? ' · Бригадир' : ''}
                        {' · '}
                        {activeStaff.isPartTime ? 'Подработка' : 'Штат'}
                        {activeStaffLocations.length > 0 ? ` · ${activeStaffLocations.join(', ')}` : ''}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedStaff(null)}
                    className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer shrink-0"
                    title="Закрыть карточку"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Drawer Tab Switcher */}
                <div className="inline-flex bg-white p-1 rounded-md border border-[#d9dbe0]">
                  <button
                    type="button"
                    onClick={() => setDrawerTab('stats')}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                      drawerTab === 'stats'
                        ? 'bg-[#111111] text-white'
                        : 'text-[#2d313b] hover:bg-[#eef2ff] hover:text-[#111111]'
                    }`}
                  >
                    Смены и начисления
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('access')}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                      drawerTab === 'access'
                        ? 'bg-[#111111] text-white'
                        : 'text-[#2d313b] hover:bg-[#eef2ff] hover:text-[#111111]'
                    }`}
                  >
                    Доступ и профиль
                  </button>
                </div>
              </div>

            <div className="p-4 sm:p-5 space-y-5 flex-1 overflow-y-auto bg-white">
              {drawerTab === 'stats' ? (
                <>
              
              {/* Feedback Alert Message */}
              {shiftActionMsg && (
                <div
                  className={`p-3 rounded-md border text-xs flex items-center gap-2 animate-fade-in ${
                    shiftActionMsg.type === 'success'
                      ? 'bg-[#eef2ff] border-[#a9bcff] text-[#111111]'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {shiftActionMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 text-[#2f63ff]" /> : <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />}
                  <span className="font-medium">{shiftActionMsg.text}</span>
                </div>
              )}

              {/* Month Comparative Overview Cards & Navigation Tabs */}
              {(() => {
                const displayMonths = [...allAvailableMonths.slice(0, 3)];
                if (!displayMonths.some(m => m.key === selectedStaffMonth)) {
                  const currentM = allAvailableMonths.find(m => m.key === selectedStaffMonth) || {
                    key: selectedStaffMonth,
                    label: formatMonthName(selectedStaffMonth),
                    isCurrent: false,
                  };
                  displayMonths.push(currentM);
                }

                return (
                  <div className="space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
                        <span>Статистика по месяцам</span>
                      </div>
                      <CustomPeriodSelect
                        value={selectedStaffMonth}
                        onChange={val => {
                          setSelectedStaffMonth(val);
                          setIsAddShiftOpen(false);
                          setEditingRecordId(null);
                        }}
                        options={allAvailableMonths}
                        labelPrefix="Период:"
                        align="right"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {displayMonths.map(m => {
                        const mStats = aggregateMonthlyStats(records, m.key, selectedStaff.id);
                        const mStat = mStats.get(selectedStaff.id);
                        const mFot = calculateFOT(selectedStaff, mStat);
                        const mBonus = mStat?.sales.totalBonus || 0;
                        const mTotal = mFot + mBonus;
                        const isSelected = selectedStaffMonth === m.key;

                        return (
                          <button
                            key={m.key}
                            onClick={() => {
                              setSelectedStaffMonth(m.key);
                              setIsAddShiftOpen(false);
                              setEditingRecordId(null);
                            }}
                            className={`p-3 rounded-md text-left transition-colors relative overflow-hidden border cursor-pointer ${
                              isSelected
                                ? 'bg-[#111111] border-[#111111] text-white'
                                : 'bg-[#f7f9ff] border-[#d9dbe0] hover:bg-[#eef2ff]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-[#111111]'}`}>
                                {m.label}
                              </span>
                              {m.isCurrent && (
                                <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                                  isSelected ? 'text-[#a9bcff]' : 'text-[#2f63ff]'
                                }`}>
                                  Текущий
                                </span>
                              )}
                            </div>

                            <div className="flex items-baseline justify-between mt-2 font-mono tabular-nums">
                              <div>
                                <div className={`text-[10px] font-sans ${isSelected ? 'text-[#a9bcff]' : 'text-[#5d6270]'}`}>Смен</div>
                                <div className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-[#111111]'}`}>{mStat?.shiftsCount.total || 0}</div>
                              </div>
                              <div className="text-right">
                                <div className={`text-[10px] font-sans ${isSelected ? 'text-[#a9bcff]' : 'text-[#5d6270]'}`}>Начислено</div>
                                <div className={`text-sm font-semibold ${isSelected ? 'text-[#a9bcff]' : 'text-[#2f63ff]'}`}>{formatCurrency(mTotal)}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Active Selected Month Detailed KPIs */}
              {(() => {
                const activeMonthStats = aggregateMonthlyStats(records, selectedStaffMonth, selectedStaff.id);
                const stat = activeMonthStats.get(selectedStaff.id);
                const fot = calculateFOT(selectedStaff, stat);
                const bonus = stat?.sales.totalBonus || 0;
                const totalEarned = fot + bonus;

                // Unique shifts worked in this month
                const monthShifts = (stat?.records || []).slice().sort((a, b) => b.date.localeCompare(a.date));

                return (
                  <div className="space-y-4 pt-3 border-t border-[#e5e7eb]">
                    
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-xs font-medium text-[#5d6270] uppercase tracking-wider flex items-center gap-1.5">
                        <span>Детализация за:</span>
                        <span className="text-[#111111] font-semibold">{formatMonthName(selectedStaffMonth)}</span>
                      </div>

                      <div className="text-xs font-mono font-semibold text-[#2f63ff] tabular-nums">
                        Итого доход: {formatCurrency(totalEarned)}
                      </div>
                    </div>

                    {/* 4 Metrics Grid */}
                    <div className="bg-[#f7f9ff] border border-[#d9dbe0] rounded-md grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#e5e7eb] overflow-hidden">
                      <div className="p-3 text-center">
                        <div className="text-[11px] text-[#5d6270] font-medium">Отработано смен</div>
                        <div className="text-base font-semibold font-mono text-[#111111] mt-0.5 tabular-nums">
                          {stat?.shiftsCount?.total || 0}
                        </div>
                      </div>

                      <div className="p-3 text-center">
                        <div className="text-[11px] text-[#5d6270] font-medium">Выручка (доп. услуги)</div>
                        <div className="text-base font-semibold font-mono text-[#111111] mt-0.5 truncate tabular-nums">
                          {formatCurrency(stat?.sales?.totalRevenue || 0)}
                        </div>
                      </div>

                      <div className="p-3 text-center">
                        <div className="text-[11px] text-[#5d6270] font-medium">ФОТ (Оклады)</div>
                        <div className="text-base font-semibold font-mono text-[#2f63ff] mt-0.5 truncate tabular-nums">
                          {formatCurrency(fot)}
                        </div>
                      </div>

                      <div className="p-3 text-center">
                        <div className="text-[11px] text-[#5d6270] font-medium">Премия 5%</div>
                        <div className="text-base font-semibold font-mono text-[#b45309] mt-0.5 truncate tabular-nums">
                          +{formatCurrency(bonus)}
                        </div>
                      </div>
                    </div>

                    {/* Shift Categories & Sales breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(() => {
                        const staffShiftCountsMap = new Map<string, number>();
                        stat?.records?.forEach((rec: any) => {
                          if (rec.shiftType) {
                            staffShiftCountsMap.set(rec.shiftType, (staffShiftCountsMap.get(rec.shiftType) || 0) + 1);
                          }
                        });
                        const staffWorkedShifts = Array.from(staffShiftCountsMap.entries());

                        return (
                          <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs space-y-2">
                            <div className="text-[#5d6270] font-semibold">Смены по типам:</div>
                            {staffWorkedShifts.length > 0 ? (
                              <div className="grid grid-cols-2 gap-2 text-[#2d313b] font-mono tabular-nums">
                                {staffWorkedShifts.map(([code, count]) => (
                                  <div key={code} className="truncate" title={getShiftLabel(code, rates)}>
                                    <span className="text-[#5d6270]">{getShiftLabel(code, rates)}:</span>{' '}
                                    <span className="font-semibold text-[#111111]">{count}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[#5d6270] italic py-1">Нет отмеченных смен</div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md text-xs space-y-1.5 font-mono tabular-nums">
                        <div className="text-[#5d6270] font-semibold font-sans">Выручка по оплате:</div>
                        <div className="flex justify-between text-[#2d313b]">
                          <span>Наличные:</span>
                          <span className="font-semibold text-[#111111]">{formatCurrency(stat?.sales?.totalCash || 0)}</span>
                        </div>
                        <div className="flex justify-between text-[#2d313b]">
                          <span>Безналичные:</span>
                          <span className="font-semibold text-[#111111]">{formatCurrency(stat?.sales?.totalCard || 0)}</span>
                        </div>
                        <div className="flex justify-between text-[#2f63ff] pt-1 border-t border-[#e5e7eb] font-semibold">
                          <span>Общая выручка:</span>
                          <span>{formatCurrency(stat?.sales?.totalRevenue || 0)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Manual Shift Management Section (Add / Edit / Cancel shifts) */}
                    <div className="pt-3 border-t border-[#e5e7eb] space-y-3">
                      
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <h4 className="text-xs font-semibold text-[#111111] uppercase tracking-wider flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-[#2f63ff]" />
                            <span>Журнал и управление сменами ({monthShifts.length})</span>
                          </h4>
                          <p className="text-[11px] text-[#5d6270]">
                            Вы можете вручную добавить пропущенную смену, изменить категорию или отменить смену
                          </p>
                        </div>

                        <button
                          onClick={() => {
                            setIsAddShiftOpen(!isAddShiftOpen);
                            setNewShiftDate(`${selectedStaffMonth}-01`);
                          }}
                          className="py-1.5 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold rounded text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isAddShiftOpen ? 'Скрыть форму' : 'Добавить смену'}</span>
                        </button>
                      </div>

                      {/* Add Shift Inline Form */}
                      {isAddShiftOpen && (
                        <form
                          onSubmit={handleSaveNewShift}
                          className="p-4 bg-[#f7f9ff] border border-[#a9bcff] rounded-md space-y-3.5 animate-fade-in"
                        >
                          <div className="text-xs font-semibold text-[#111111] flex items-center gap-2">
                            <CalendarPlus className="w-4 h-4 text-[#2f63ff]" />
                            <span>Добавление / Назначение смены сотруднику</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            {/* Control 1: Дата смены */}
                            <div>
                              <label className="block text-[11px] font-medium text-[#2d313b] mb-1.5">
                                Дата смены <span className="text-[#2f63ff]">*</span>
                              </label>
                              <CustomDatePicker
                                value={newShiftDate}
                                onChange={v => setNewShiftDate(v)}
                              />
                            </div>

                            {/* Control 2: Категория смены */}
                            <div>
                              <label className="block text-[11px] font-medium text-[#2d313b] mb-1.5">
                                Категория смены <span className="text-[#2f63ff]">*</span>
                              </label>
                              <CustomSelect<ShiftType>
                                value={newShiftType}
                                onChange={v => setNewShiftType(v)}
                                menuHeaderTitle="Категория смены"
                                options={(rates?.shiftTypes || []).filter((t: any) => !t.isArchived).length > 0
                                  ? (rates.shiftTypes || []).filter((t: any) => !t.isArchived).map((t: any) => ({
                                      value: t.code as ShiftType,
                                      label: t.name,
                                    }))
                                  : [
                                      { value: 'day12', label: 'Дневная смена (12ч)' },
                                      { value: 'night12', label: 'Ночная смена (12ч)' },
                                      { value: 'standard8', label: 'Стандартная (8ч)' },
                                      { value: 'part6', label: 'Подработка (6ч)' },
                                      { value: 'part4', label: 'Подработка (4ч)' },
                                      { value: 'daily24', label: 'Суточная (24ч)' },
                                    ]}
                              />
                            </div>

                            {/* Control 3: Пункт (Локация) */}
                            <div>
                              <label className="block text-[11px] font-medium text-[#2d313b] mb-1.5">
                                Склад <span className="text-[#2f63ff]">*</span>
                              </label>
                              <CustomSelect<LocationType>
                                value={newShiftLocation}
                                onChange={v => setNewShiftLocation(v)}
                                align="right"
                                menuHeaderTitle="Выберите склад"
                                options={(pickupPoints || []).map(pt => ({
                                  value: pt.code as LocationType,
                                  label: pt.code,
                                  sublabel: pt.name && pt.name !== pt.code ? pt.name : undefined,
                                  badge: (pt as any).isArchived ? 'Архив' : undefined,
                                  badgeColor: (pt as any).isArchived ? ('amber' as const) : undefined,
                                }))}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e7eb]">
                            <button
                              type="button"
                              onClick={() => setIsAddShiftOpen(false)}
                              className="px-3.5 py-1.5 text-xs text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer font-medium"
                            >
                              Отмена
                            </button>
                            <button
                              type="submit"
                              disabled={shiftActionLoading}
                              className="px-4 py-1.5 text-xs font-bold text-white bg-[#2f63ff] hover:bg-[#1f4fe0] rounded transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {shiftActionLoading ? 'Сохранение...' : 'Сохранить смену'}
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Shifts Table / Cards */}
                      {monthShifts.length === 0 ? (
                        <div className="p-6 text-center text-xs text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                          В {formatMonthName(selectedStaffMonth)} смен пока нет. Вы можете нажать «+ Добавить смену», чтобы внести смену вручную.
                        </div>
                      ) : (
                        <div className="bg-white border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] overflow-hidden">
                          {monthShifts.map(rec => {
                            const shiftSalary = calculateShiftSinglePay(selectedStaff, rec);
                            const dailyCalc = calculateDailySales(rec.sales);
                            const isEditing = editingRecordId === rec.id;

                            return (
                              <div
                                key={rec.id}
                                className="p-3 hover:bg-[#f7f9ff] transition-colors text-xs space-y-2.5"
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  {/* Left info */}
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-semibold text-[#111111] font-mono">{formatDateRuDMY(rec.date)}</span>
                                      
                                       {isEditing ? (
                                        <div className="flex items-center gap-2">
                                          <CustomSelect<ShiftType>
                                            value={editingShiftType}
                                            onChange={v => setEditingShiftType(v)}
                                            className="w-40"
                                            triggerClassName="!h-8 !min-h-[32px] !py-1 !px-2.5"
                                            options={(rates?.shiftTypes || []).filter((t: any) => !t.isArchived).length > 0
                                              ? (rates.shiftTypes || []).filter((t: any) => !t.isArchived).map((t: any) => ({
                                                  value: t.code as ShiftType,
                                                  label: t.name,
                                                }))
                                              : [
                                                  { value: 'day12', label: 'Дневная (12ч)' },
                                                  { value: 'night12', label: 'Ночная (12ч)' },
                                                  { value: 'standard8', label: '8 часов' },
                                                  { value: 'part6', label: 'Подработка 6ч' },
                                                  { value: 'part4', label: 'Подработка 4ч' },
                                                  { value: 'daily24', label: 'Сутки (24ч)' },
                                                ]}
                                          />
                                          <CustomSelect<LocationType>
                                            value={editingShiftLocation}
                                            onChange={v => setEditingShiftLocation(v)}
                                            className="w-28"
                                            triggerClassName="!h-8 !min-h-[32px] !py-1 !px-2.5"
                                            options={(pickupPoints || []).map(pt => ({
                                              value: pt.code as LocationType,
                                              label: pt.code,
                                            }))}
                                          />
                                        </div>
                                      ) : (
                                        <>
                                          <span className="text-[#111111] font-medium">
                                            {getShiftLabel(rec.shiftType, rates)}
                                          </span>
                                          <span className="text-[#5d6270]">·</span>
                                          <span className="font-mono text-[#2f63ff] font-semibold">
                                            {rec.location || '—'}
                                          </span>
                                        </>
                                      )}

                                      <span className="text-[#5d6270] text-[11px] font-mono tabular-nums">
                                        {rec.checkedInAt ? `· ${rec.checkedInAt.slice(11, 16)}` : rec.timestamp ? `· ${rec.timestamp.slice(11, 16)}` : ''}
                                      </span>
                                    </div>

                                    <div className="text-[11px] text-[#2d313b] flex items-center gap-3 font-mono tabular-nums flex-wrap">
                                      <span>Оклад: <strong className="text-[#2f63ff] font-semibold">{formatCurrency(shiftSalary)}</strong></span>
                                      {dailyCalc.totalSales > 0 ? (
                                        <>
                                          <span>Выручка: {formatCurrency(dailyCalc.totalSales)} (Премия: <strong className="text-emerald-700 font-semibold">+{formatCurrency(dailyCalc.bonus)}</strong>)</span>
                                          <span>Итого за смену: <strong className="text-[#111111] font-semibold">{formatCurrency(shiftSalary + dailyCalc.bonus)}</strong></span>
                                        </>
                                      ) : (
                                        <span>Итого за смену: <strong className="text-[#111111] font-semibold">{formatCurrency(shiftSalary)}</strong></span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right actions */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {isEditing ? (
                                      <>
                                        <button
                                          onClick={() => handleSaveEditedShift(rec)}
                                          disabled={shiftActionLoading}
                                          className="py-1 px-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold rounded text-xs transition-colors cursor-pointer"
                                        >
                                          Сохранить
                                        </button>
                                        <button
                                          onClick={() => setEditingRecordId(null)}
                                          className="py-1 px-2 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2d313b] rounded text-xs font-medium cursor-pointer"
                                        >
                                          Отмена
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setShiftToDelete(rec)}
                                          className="py-1 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                          title="Удалить смену"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                          <span>Удалить</span>
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => {
                                            setEditingRecordId(rec.id);
                                            setEditingShiftType(normalizeShiftType(rec.shiftType));
                                            setEditingShiftLocation(rec.location || (pickupPoints[0]?.code || ''));
                                            const sCalc = calculateDailySales(rec.sales);
                                            setEditingCashSales(rec.sales?.cash !== undefined ? String(rec.sales.cash) : (sCalc.totalCash > 0 ? String(sCalc.totalCash) : ''));
                                            setEditingCardSales(rec.sales?.card !== undefined ? String(rec.sales.card) : (sCalc.totalCard > 0 ? String(sCalc.totalCard) : ''));
                                          }}
                                          className="p-1.5 text-[#2d313b] hover:text-[#2f63ff] hover:bg-[#eef2ff] rounded transition-colors cursor-pointer"
                                          title="Изменить смену"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => setShiftToDelete(rec)}
                                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                          title="Отменить смену"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {isEditing && !selectedStaff.isPartTime && (
                                  <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-2.5 animate-fade-in">
                                    <div className="text-[10px] font-semibold text-[#5d6270] uppercase tracking-wider pb-1 flex items-center justify-between">
                                      <span>Выручка за смену (продажи):</span>
                                      <span className="text-[#2f63ff] font-mono font-semibold tabular-nums">
                                        Итого: {formatCurrency((Math.max(0, parseInt(editingCashSales, 10) || 0)) + (Math.max(0, parseInt(editingCardSales, 10) || 0)))}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2.5">
                                      <div>
                                        <label className="flex items-center gap-1 text-[10px] text-[#2d313b] mb-1 font-medium">
                                          <Banknote className="w-3 h-3 text-[#2f63ff]" />
                                          <span>Наличные (₽)</span>
                                        </label>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          pattern="[0-9]*"
                                          placeholder="0"
                                          value={editingCashSales}
                                          onFocus={e => e.target.select()}
                                          onClick={e => (e.target as HTMLInputElement).select()}
                                          onChange={e => setEditingCashSales(e.target.value.replace(/\D/g, ''))}
                                          className="w-full px-2.5 py-1.5 bg-white rounded font-mono text-[#111111] text-xs focus:outline-none focus:border-[#2f63ff] border border-[#d9dbe0]"
                                        />
                                      </div>
                                      <div>
                                        <label className="flex items-center gap-1 text-[10px] text-[#2d313b] mb-1 font-medium">
                                          <CreditCard className="w-3 h-3 text-[#2f63ff]" />
                                          <span>Безналичные / Карта (₽)</span>
                                        </label>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          pattern="[0-9]*"
                                          placeholder="0"
                                          value={editingCardSales}
                                          onFocus={e => e.target.select()}
                                          onClick={e => (e.target as HTMLInputElement).select()}
                                          onChange={e => setEditingCardSales(e.target.value.replace(/\D/g, ''))}
                                          className="w-full px-2.5 py-1.5 bg-white rounded font-mono text-[#111111] text-xs focus:outline-none focus:border-[#2f63ff] border border-[#d9dbe0]"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                    </div>

                  </div>
                );
              })()}
                </>
              ) : (
                <div className="space-y-4">
                  {/* Profile & Rates Summary */}
                  <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden text-xs">
                    <div className="px-4 py-3 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 font-semibold text-[#111111]">
                        <Briefcase className="w-4 h-4 text-[#2f63ff]" />
                        <span>Профиль и ставка оплаты</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditModal(activeStaff)}
                        className="py-1.5 px-3 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2f63ff] rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Изменить профиль и ставки</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
                      <div>
                        <span className="text-[#5d6270] block text-[11px]">Должность</span>
                        <span className="font-semibold text-[#111111]">{activeStaff.position || 'Работник склада'}</span>
                      </div>
                      <div>
                        <span className="text-[#5d6270] block text-[11px]">Тип занятости</span>
                        <span className="font-semibold text-[#111111]">
                          {activeStaff.isPartTime ? 'Подработка' : 'Основной штат'}
                          {activeStaff.isSenior ? ' · Старший смены' : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#5d6270] block text-[11px]">Базовая ставка</span>
                        <span className="font-semibold font-mono text-[#2f63ff] tabular-nums">
                          {activeStaff.payType === 'shift'
                            ? `${activeStaff.shiftRate || 3500} ₽ / смена`
                            : `${activeStaff.hourlyRate || 350} ₽ / час`}
                          {activeStaff.nightRate ? ` (+${activeStaff.nightRate} ₽ ночные)` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#5d6270] block text-[11px]">Telegram</span>
                        <span className="font-mono text-[#111111]">
                          {activeStaff.telegramUsername || 'Не указан'}
                        </span>
                      </div>
                    </div>

                    <div className="px-4 py-3 border-t border-[#e5e7eb] flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[#5d6270]">Назначенные склады:</span>
                      <span className="font-semibold text-[#111111]">
                        {activeStaffLocations.length > 0 ? activeStaffLocations.join(', ') : 'Не назначены'}
                      </span>
                    </div>
                  </div>

                  {/* Credentials Card */}
                  <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden text-xs">
                    <div className="px-4 py-3 bg-[#f7f9ff] border-b border-[#e5e7eb] font-semibold text-[#111111]">
                      Учётные данные для входа
                    </div>
                    <div className="divide-y divide-[#e5e7eb] font-mono">
                      <div className="px-4 py-2.5 flex items-center justify-between">
                        <span className="text-[#5d6270] font-sans">Логин:</span>
                        <span className="font-semibold text-[#111111] tabular-nums">{activeStaff.login}</span>
                      </div>
                      <div className="px-4 py-2.5 flex items-center justify-between">
                        <span className="text-[#5d6270] font-sans">Пароль:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[#111111] tabular-nums">
                            {visiblePasswords.has(activeStaff.id) ? (activeStaff.password || 'Не задан') : '••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility(activeStaff.id)}
                            className="p-1 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
                            title={visiblePasswords.has(activeStaff.id) ? 'Скрыть пароль' : 'Показать пароль'}
                          >
                            {visiblePasswords.has(activeStaff.id) ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-[#f7f9ff] border-t border-[#e5e7eb]">
                      <button
                        type="button"
                        onClick={() => copyCredentials(activeStaff)}
                        className="w-full py-2 px-3 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2f63ff] rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700 font-semibold">Логин, пароль и локация скопированы</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-[#5d6270]" />
                            <span>Скопировать логин, пароль и локацию</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Account Lifecycle Controls */}
                  <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden text-xs">
                    <div className="px-4 py-3 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center gap-2 font-semibold text-[#111111]">
                      <Shield className="w-4 h-4 text-[#2f63ff]" />
                      <span>Управление статусом и доступом</span>
                    </div>
                    <div className="p-4 flex items-center gap-2 flex-wrap">
                      {activeStaff.status === 'active' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setStaffActionConfirm({ type: 'block', staff: activeStaff })}
                            className="flex-1 py-2 px-3 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>Заблокировать</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setStaffActionConfirm({ type: 'archive', staff: activeStaff })}
                            className="flex-1 py-2 px-3 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-[#b45309] rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Archive className="w-3.5 h-3.5" />
                            <span>Переместить в архив</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setStaffActionConfirm({ type: 'restore', staff: activeStaff })}
                            className="flex-1 py-2 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Восстановить доступ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setStaffActionConfirm({ type: 'delete', staff: activeStaff })}
                            className="py-2 px-3 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Удалить</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between gap-2 shrink-0">
              <span className="text-[11px] text-[#5d6270] font-mono">Логин: {activeStaff.login}</span>
              <button
                onClick={() => setSelectedStaff(null)}
                className="px-4 py-2 text-xs font-semibold bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded transition-colors cursor-pointer"
              >
                Закрыть
              </button>
            </div>

          </div>
        </div>
        );
      })()}

      {/* Staff Action Confirmation Modal (Block, Archive, Restore, Delete) */}
      {staffActionConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#111111]/55 animate-fade-in">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              {staffActionConfirm.type === 'block' && <UserX className="w-5 h-5 text-[#b45309] shrink-0 mt-0.5" />}
              {staffActionConfirm.type === 'archive' && <Archive className="w-5 h-5 text-[#2f63ff] shrink-0 mt-0.5" />}
              {staffActionConfirm.type === 'restore' && <RotateCcw className="w-5 h-5 text-[#2f63ff] shrink-0 mt-0.5" />}
              {staffActionConfirm.type === 'delete' && <Trash2 className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}
              <div>
                <h4 className="text-sm font-semibold text-[#111111]">
                  {staffActionConfirm.type === 'block' && 'Заблокировать доступ'}
                  {staffActionConfirm.type === 'archive' && 'Переместить в архив'}
                  {staffActionConfirm.type === 'restore' && 'Восстановить доступ'}
                  {staffActionConfirm.type === 'delete' && 'Удалить сотрудника навсегда'}
                </h4>
                <p className="text-xs text-[#5d6270] font-normal">
                  {staffActionConfirm.type === 'delete'
                    ? 'Действие нельзя отменить'
                    : 'Подтвердите действие'}
                </p>
              </div>
            </div>

            {staffActionError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-md text-rose-800 flex items-center gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{staffActionError}</span>
              </div>
            )}

            <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs text-[#2d313b] leading-relaxed">
              {staffActionConfirm.type === 'block' && (
                <>
                  Вы действительно хотите заблокировать доступ в систему для сотрудника{' '}
                  <strong className="text-[#111111]">{staffActionConfirm.staff.name}</strong>? Он не сможет входить в систему и отмечать смены.
                </>
              )}
              {staffActionConfirm.type === 'archive' && (
                <>
                  Переместить сотрудника <strong className="text-[#111111]">{staffActionConfirm.staff.name}</strong> в архив?
                  Сотрудник будет скрыт из списков активного персонала, но все его смены и история выплат сохранятся.
                </>
              )}
              {staffActionConfirm.type === 'restore' && (
                <>
                  Восстановить доступ для сотрудника <strong className="text-[#111111]">{staffActionConfirm.staff.name}</strong>?
                  Аккаунт снова станет активным.
                </>
              )}
              {staffActionConfirm.type === 'delete' && (
                <>
                  Внимание! Вы собираетесь навсегда удалить сотрудника <strong className="text-[#111111]">{staffActionConfirm.staff.name}</strong> и все связанные данные.
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setStaffActionConfirm(null);
                  setStaffActionError(null);
                }}
                disabled={staffActionProcessing}
                className="px-4 py-2 text-xs font-medium text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleExecuteStaffAction}
                disabled={staffActionProcessing}
                className={`px-4 py-2 text-xs font-semibold rounded transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer ${
                  staffActionConfirm.type === 'block'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : staffActionConfirm.type === 'archive'
                    ? 'bg-[#111111] hover:bg-[#2d313b] text-white'
                    : staffActionConfirm.type === 'restore'
                    ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white'
                    : 'bg-rose-600 hover:bg-rose-700 text-white'
                }`}
              >
                {staffActionProcessing ? (
                  <span>Выполнение...</span>
                ) : (
                  <span>
                    {staffActionConfirm.type === 'block' && 'Заблокировать'}
                    {staffActionConfirm.type === 'archive' && 'В архив'}
                    {staffActionConfirm.type === 'restore' && 'Восстановить'}
                    {staffActionConfirm.type === 'delete' && 'Да, удалить'}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Shift Confirmation Modal */}
      {shiftToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#111111]/55 animate-fade-in">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-[#111111]">Подтверждение удаления</h4>
                <p className="text-xs text-[#5d6270]">Действие нельзя отменить</p>
              </div>
            </div>
            <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs text-[#2d313b] leading-relaxed">
              Вы точно хотите удалить смену сотрудника <strong className="text-[#111111]">{selectedStaff?.name}</strong> за дату{' '}
              <strong className="text-[#2f63ff] font-mono tabular-nums">{formatDateRuDMY(shiftToDelete.date)}</strong>?
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShiftToDelete(null)}
                className="px-4 py-2 text-xs font-medium text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteShift}
                disabled={shiftActionLoading}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{shiftActionLoading ? 'Удаление...' : 'Да, точно удалить'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Account Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto">
            <div className="flex items-center justify-between p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <div className="flex items-center gap-2 text-[#111111] font-semibold">
                <UserPlus className="w-5 h-5 text-[#2f63ff]" />
                <span>Создание доступа сотруднику</span>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="p-1 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-4 space-y-3.5 text-xs flex-1 overflow-y-auto bg-white">
              {createError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-md text-rose-800 flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{createError}</span>
                </div>
              )}

              <div>
                <label className="block text-[#2d313b] font-medium mb-1">ФИО сотрудника *</label>
                <input
                  type="text"
                  required
                  placeholder="Иванов Иван Иванович"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] placeholder:text-[#5d6270]/70 font-medium focus:outline-none focus:border-[#2f63ff] transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Логин *</label>
                  <input
                    type="text"
                    required
                    value={newLogin}
                    onChange={e => setNewLogin(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono focus:outline-none focus:border-[#2f63ff] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[#2d313b] font-medium mb-1">Пароль *</label>
                  <input
                    type="text"
                    required
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono focus:outline-none focus:border-[#2f63ff] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Telegram (юзернейм, опционально)</label>
                <input
                  type="text"
                  placeholder="@username"
                  value={newTelegram}
                  onChange={e => setNewTelegram(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] transition-colors"
                />
              </div>

              {/* Warehouse Position & Custom Position */}
              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Должность на складе *</label>
                <select
                  value={isNewCustomPosOpen ? '__custom__' : newPosition}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setIsNewCustomPosOpen(true);
                    } else {
                      setIsNewCustomPosOpen(false);
                      setNewPosition(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] focus:outline-none focus:border-[#2f63ff] cursor-pointer"
                >
                  {warehousePositions.map(pos => (
                    <option key={pos} value={pos} className="bg-white text-[#111111]">
                      {pos}
                    </option>
                  ))}
                  <option value="__custom__" className="bg-white text-[#2f63ff] font-semibold">
                    + Создать новую должность...
                  </option>
                </select>

                {isNewCustomPosOpen && (
                  <div className="mt-2">
                    <input
                      type="text"
                      required
                      placeholder="Введите название новой должности"
                      value={newCustomPosition}
                      onChange={e => setNewCustomPosition(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-[#2f63ff] rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs focus:outline-none"
                      autoFocus
                    />
                    <p className="text-[10px] text-[#5d6270] mt-1">Новая должность сохранится в системе и станет доступна для всех сотрудников.</p>
                  </div>
                )}
              </div>

              {/* Wage Type & Rates */}
              <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[#111111] font-semibold">Формат и ставка оплаты:</span>
                  <div className="inline-flex rounded-md bg-white p-0.5 border border-[#d9dbe0]">
                    <button
                      type="button"
                      onClick={() => setNewPayType('hourly')}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        newPayType === 'hourly'
                          ? 'bg-[#111111] text-white font-semibold'
                          : 'text-[#2d313b] hover:bg-[#eef2ff]'
                      }`}
                    >
                      Почасовая
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewPayType('shift')}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        newPayType === 'shift'
                          ? 'bg-[#111111] text-white font-semibold'
                          : 'text-[#2d313b] hover:bg-[#eef2ff]'
                      }`}
                    >
                      За смену
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#5d6270] mb-0.5">
                      {newPayType === 'hourly' ? 'Ставка (₽ / час)' : 'Ставка (₽ / смена)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={newPayType === 'hourly' ? newHourlyRate : newShiftRate}
                      onChange={e => {
                        const val = Number(e.target.value);
                        if (newPayType === 'hourly') setNewHourlyRate(val);
                        else setNewShiftRate(val);
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono tabular-nums text-xs focus:outline-none focus:border-[#2f63ff]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#5d6270] mb-0.5">
                      Ночная надбавка (₽)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      placeholder="0"
                      value={newNightRate}
                      onChange={e => setNewNightRate(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono tabular-nums text-xs focus:outline-none focus:border-[#2f63ff]"
                    />
                  </div>
                </div>
              </div>

              {/* Workplace Locations Multi-select */}
              <div>
                <label className="block text-[#2d313b] font-medium mb-1.5">Назначенные склады работы:</label>
                <div className="p-2.5 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md overflow-y-auto max-h-40">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {pickupPoints.map(pt => {
                      const code = pt.code;
                      const isSelected = newLocations.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => toggleLocationSelection(code, newLocations, setNewLocations)}
                          className={`py-1.5 px-2.5 rounded border transition-colors flex items-center justify-between text-xs box-border focus:outline-none cursor-pointer ${
                            isSelected
                              ? 'bg-[#111111] border-[#111111] text-white font-semibold'
                              : 'bg-white border-[#d9dbe0] text-[#2d313b] hover:border-[#2f63ff] hover:text-[#111111]'
                          }`}
                        >
                          <span className="truncate">{pt.code}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#a9bcff] shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Status Toggles: Senior & Part-time */}
              <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newIsSenior}
                    onChange={e => setNewIsSenior(e.target.checked)}
                    className="rounded-xs border-[#d9dbe0] text-[#2f63ff] w-4 h-4 bg-white accent-[#2f63ff] cursor-pointer"
                  />
                  <span className="text-[#111111] font-medium">Старший смены (доплата за смену)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newIsPartTime}
                    onChange={e => setNewIsPartTime(e.target.checked)}
                    className="rounded-xs border-[#d9dbe0] text-[#2f63ff] w-4 h-4 bg-white accent-[#2f63ff] cursor-pointer"
                  />
                  <span className="text-[#111111] font-medium">Подработчик (сменный график)</span>
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded cursor-pointer font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded transition-colors cursor-pointer"
                >
                  Создать доступ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Credentials Modal */}
      {editCredStaff && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden my-auto">
            <div className="flex items-center justify-between p-4 bg-[#f7f9ff] border-b border-[#e5e7eb] shrink-0">
              <div className="flex items-center gap-2 text-[#111111] font-semibold">
                <Edit2 className="w-4 h-4 text-[#2f63ff]" />
                <span>Редактирование данных: {editCredStaff.name}</span>
              </div>
              <button
                onClick={() => setEditCredStaff(null)}
                className="p-1 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-4 space-y-3.5 text-xs flex-1 overflow-y-auto bg-white">
              {editError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-md text-rose-800 flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{editError}</span>
                </div>
              )}

              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Имя сотрудника *</label>
                <input
                  type="text"
                  required
                  placeholder="Иван Иванов"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] placeholder:text-[#5d6270]/70 font-medium focus:outline-none focus:border-[#2f63ff] transition-colors"
                />
              </div>

              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Логин *</label>
                <input
                  type="text"
                  required
                  value={editLogin}
                  onChange={e => setEditLogin(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono focus:outline-none focus:border-[#2f63ff] transition-colors"
                />
              </div>

              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Новый пароль (оставьте пустым, если не меняется)</label>
                <input
                  type="text"
                  placeholder="Оставить без изменений"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] placeholder:text-[#5d6270]/70 font-mono focus:outline-none focus:border-[#2f63ff] transition-colors"
                />
              </div>

              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Telegram (юзернейм, опционально)</label>
                <input
                  type="text"
                  placeholder="@username"
                  value={editTelegram}
                  onChange={e => setEditTelegram(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] placeholder:text-[#5d6270]/70 font-mono focus:outline-none focus:border-[#2f63ff] transition-colors"
                />
              </div>

              {/* Warehouse Position & Custom Position */}
              <div>
                <label className="block text-[#2d313b] font-medium mb-1">Должность на складе *</label>
                <select
                  value={isEditCustomPosOpen ? '__custom__' : editPosition}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setIsEditCustomPosOpen(true);
                    } else {
                      setIsEditCustomPosOpen(false);
                      setEditPosition(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] focus:outline-none focus:border-[#2f63ff] cursor-pointer"
                >
                  {warehousePositions.map(pos => (
                    <option key={pos} value={pos} className="bg-white text-[#111111]">
                      {pos}
                    </option>
                  ))}
                  <option value="__custom__" className="bg-white text-[#2f63ff] font-semibold">
                    + Создать новую должность...
                  </option>
                </select>

                {isEditCustomPosOpen && (
                  <div className="mt-2">
                    <input
                      type="text"
                      required
                      placeholder="Введите название новой должности"
                      value={editCustomPosition}
                      onChange={e => setEditCustomPosition(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-[#2f63ff] rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs focus:outline-none"
                      autoFocus
                    />
                    <p className="text-[10px] text-[#5d6270] mt-1">Новая должность сохранится в системе и станет доступна для всех сотрудников.</p>
                  </div>
                )}
              </div>

              {/* Wage Type & Rates */}
              <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[#111111] font-semibold">Формат и ставка оплаты:</span>
                  <div className="inline-flex rounded-md bg-white p-0.5 border border-[#d9dbe0]">
                    <button
                      type="button"
                      onClick={() => setEditPayType('hourly')}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        editPayType === 'hourly'
                          ? 'bg-[#111111] text-white font-semibold'
                          : 'text-[#2d313b] hover:bg-[#eef2ff]'
                      }`}
                    >
                      Почасовая
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditPayType('shift')}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        editPayType === 'shift'
                          ? 'bg-[#111111] text-white font-semibold'
                          : 'text-[#2d313b] hover:bg-[#eef2ff]'
                      }`}
                    >
                      За смену
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#5d6270] mb-0.5">
                      {editPayType === 'hourly' ? 'Ставка (₽ / час)' : 'Ставка (₽ / смена)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={editPayType === 'hourly' ? editHourlyRate : editShiftRate}
                      onChange={e => {
                        const val = Number(e.target.value);
                        if (editPayType === 'hourly') setEditHourlyRate(val);
                        else setEditShiftRate(val);
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono tabular-nums text-xs focus:outline-none focus:border-[#2f63ff]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#5d6270] mb-0.5">
                      Ночная надбавка (₽)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      placeholder="0"
                      value={editNightRate}
                      onChange={e => setEditNightRate(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono tabular-nums text-xs focus:outline-none focus:border-[#2f63ff]"
                    />
                  </div>
                </div>
              </div>

              {/* Workplaces Multi-select */}
              <div>
                <label className="block text-[#2d313b] font-medium mb-1.5">Назначенные склады работы:</label>
                <div className="p-2.5 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md overflow-y-auto max-h-40">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {pickupPoints.map(pt => {
                      const code = pt.code;
                      const isSelected = editLocations.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => toggleLocationSelection(code, editLocations, setEditLocations)}
                          className={`py-1.5 px-2.5 rounded border transition-colors flex items-center justify-between text-xs box-border focus:outline-none cursor-pointer ${
                            isSelected
                              ? 'bg-[#111111] border-[#111111] text-white font-semibold'
                              : 'bg-white border-[#d9dbe0] text-[#2d313b] hover:border-[#2f63ff] hover:text-[#111111]'
                          }`}
                        >
                          <span className="truncate">{pt.code}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#a9bcff] shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Status Toggles: Senior & Part-time */}
              <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editIsSenior}
                    onChange={e => setEditIsSenior(e.target.checked)}
                    className="rounded-xs border-[#d9dbe0] text-[#2f63ff] w-4 h-4 bg-white accent-[#2f63ff] cursor-pointer"
                  />
                  <span className="text-[#111111] font-medium">Старший смены (доплата за смену)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editIsPartTime}
                    onChange={e => setEditIsPartTime(e.target.checked)}
                    className="rounded-xs border-[#d9dbe0] text-[#2f63ff] w-4 h-4 bg-white accent-[#2f63ff] cursor-pointer"
                  />
                  <span className="text-[#111111] font-medium">Подработчик (сменный график)</span>
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditCredStaff(null)}
                  className="px-4 py-2 text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded cursor-pointer font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded transition-colors cursor-pointer"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
