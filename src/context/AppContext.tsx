import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  AuthSession,
  StaffMember,
  CheckInRecord,
  ApplicationRequest,
  ManagerMessage,
  StaffNotification,
  BotRestartLog,
  ShiftType,
  LocationType,
  DailySales,
  ShiftSwapRequest,
  PlannedShift,
  ScheduleTemplate,
  AvailabilityRequest,
  PickupPoint,
  IncomeGoal,
  PaybackPvzRecord,
  PaybackArticleTemplates,
  TelegramSettings,
  OrganizationInfo,
  SubscriptionInfo,
  DEFAULT_WAREHOUSE_POSITIONS,
} from '../types';
import {
  formatMoscowDate,
  formatMoscowTime,
} from '../utils/time';

interface LoginResult {
  success: boolean;
  error?: string;
}

export type AuthStatus = 'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

async function safeJson(res: Response): Promise<{ ok: boolean; data: any }> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const data = await res.json();
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: { success: false, error: { message: 'Ошибка парсинга ответа' } } };
    }
  }
  const text = await res.text();
  let userFriendlyMsg = text;
  if (!text || text.includes('<html') || text.includes('<head>') || res.status === 403 || res.status === 401) {
    if (res.status === 403) {
      userFriendlyMsg = 'Доступ запрещен (403 Forbidden). Проверьте права руководителя.';
    } else if (res.status === 401) {
      userFriendlyMsg = 'Требуется авторизация в системе.';
    } else if (res.status === 404) {
      userFriendlyMsg = 'Запрашиваемый ресурс не найден (404).';
    } else {
      userFriendlyMsg = `Ошибка сервера (HTTP ${res.status})`;
    }
  }
  return { ok: res.ok, data: { success: res.ok, error: { message: userFriendlyMsg } } };
}

export interface AppContextType {
  // Auth & SaaS state
  authStatus: AuthStatus;
  authSession: AuthSession | null;
  organization: OrganizationInfo | null;
  subscription: SubscriptionInfo | null;
  isReadOnlyWorkspace: boolean;
  billingModalOpen: boolean;
  setBillingModalOpen: (open: boolean) => void;
  currentRole: 'employee' | 'manager';
  currentStaffId: string;
  currentStaff: StaffMember | undefined;
  staffList: StaffMember[];
  records: CheckInRecord[];
  cancelledDates: string[];
  applications: ApplicationRequest[];
  messages: ManagerMessage[];
  notifications: StaffNotification[];
  restartLogs: BotRestartLog[];
  swaps: ShiftSwapRequest[];
  schedules: PlannedShift[];
  scheduleTemplates: ScheduleTemplate[];
  availability: AvailabilityRequest[];
  incomeGoals: IncomeGoal[];
  paybackRecords: PaybackPvzRecord[];
  paybackTemplates: PaybackArticleTemplates;
  pickupPoints: PickupPoint[];
  openingAlerts: any;
  isBotRestarting: boolean;
  mskTime: string;
  todayDate: string;
  csrfToken: string;

  // Auth & SaaS Organization Actions
  login: (loginInput: string, passwordInput: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  registerManager: (payload: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    acceptPrivacy: boolean;
    acceptTerms: boolean;
  }) => Promise<LoginResult>;
  createOrganization: (payload: {
    name: string;
    inn?: string;
    timezone?: string;
    selectedPlan?: string;
    selectedPeriod?: number;
  }) => Promise<LoginResult>;
  updateOrganization: (payload: {
    name?: string;
    inn?: string;
    timezone?: string;
  }) => Promise<LoginResult>;
  refreshOrganization: () => Promise<void>;
  refreshData: () => Promise<void>;

  // Staff Management
  warehousePositions: string[];
  fetchWarehousePositions: () => Promise<string[]>;
  addWarehousePosition: (name: string) => Promise<{ success: boolean; error?: string; positions?: string[] }>;
  createEmployeeAccount: (
    name: string,
    loginVal: string,
    passwordVal: string,
    locations: LocationType[],
    telegramUsername?: string,
    isPartTime?: boolean,
    isSenior?: boolean,
    warehouseDetails?: {
      position?: string;
      payType?: 'hourly' | 'shift';
      hourlyRate?: number;
      shiftRate?: number;
      nightRate?: number;
    }
  ) => Promise<{ success: boolean; error?: string; staff?: StaffMember }>;
  updateEmployeeCredentials: (
    staffId: string,
    newLogin: string,
    newPassword?: string,
    newLocations?: LocationType[],
    isPartTime?: boolean,
    isSenior?: boolean,
    newName?: string,
    telegramUsername?: string,
    warehouseDetails?: {
      position?: string;
      payType?: 'hourly' | 'shift';
      hourlyRate?: number;
      shiftRate?: number;
      nightRate?: number;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  toggleEmployeeAccess: (staffId: string, hasAccess: boolean) => Promise<{ success: boolean; error?: string }>;

  // Work Actions
  switchStaff: (staffId: string) => void;
  performCheckIn: (
    employeeId: string,
    shiftType: ShiftType,
    location?: LocationType,
    customDate?: string,
    initialCash?: number,
    cashNotes?: string,
    options?: {
      qrVerified?: boolean;
      geoVerified?: boolean;
      zone?: string;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  performCheckOut: (
    employeeId?: string,
    checkinId?: string,
    data?: {
      checkOutAt?: string;
      breakMinutes?: number;
      workedHours?: number;
      notes?: string;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  cancelCheckIn: (employeeId: string) => Promise<{ success: boolean; error?: string }>;
  submitSales: (
    employeeId: string,
    sales: DailySales,
    customDate?: string,
    finalCash?: number,
    collectedCash?: number,
    initialCash?: number,
    cashNotes?: string
  ) => Promise<{ success: boolean; error?: string }>;
  sendMessageToManager: (employeeId: string, message: string) => Promise<boolean>;
  replyToMessage: (messageId: string, replyText: string) => Promise<{ success: boolean; error?: string }>;
  submitRegistration: (name: string, telegramUsername?: string) => Promise<{ success: boolean; error?: string; id?: string }>;
  handleApplication: (
    appId: string,
    action: 'accept' | 'reject',
    note?: string,
    generatedLogin?: string,
    generatedPassword?: string,
    assignedLocations?: LocationType[]
  ) => Promise<{ success: boolean; error?: string }>;
  deactivateStaff: (staffId: string) => Promise<{ success: boolean; error?: string }>;
  restoreStaff: (staffId: string) => Promise<{ success: boolean; error?: string }>;
  archiveStaff: (staffId: string) => Promise<{ success: boolean; error?: string }>;
  deleteStaffPermanently: (staffId: string, confirmation?: string) => Promise<{ success: boolean; error?: string }>;
  sendThankYou: (location: string) => Promise<void>;
  restartBot: () => Promise<void>;
  markMessageRead: (msgId: string) => Promise<void>;
  markNotificationRead: (notifId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  markAllMessagesRead: () => Promise<void>;
  dismissNotification: (notifId: string) => Promise<void>;
  resetLocalUIState: () => void;
  resetToDefaults: () => void;
  sendReportToTelegram: () => Promise<{ success: boolean; error?: string }>;
  rates: any;
  saveRates: (newRates: any) => Promise<{ success: boolean; error?: string }>;
  managerAddOrUpdateShift: (
    employeeId: string,
    date: string,
    shiftType: ShiftType,
    location: LocationType
  ) => Promise<{ success: boolean; error?: string }>;
  managerDeleteShift: (recordId: string) => Promise<{ success: boolean; error?: string }>;

  // Shift Swaps (Биржа смен)
  createSwapRequest: (
    date: string,
    shiftType: ShiftType,
    location: LocationType,
    reason?: string
  ) => Promise<{ success: boolean; error?: string }>;
  claimSwapRequest: (swapId: string) => Promise<{ success: boolean; error?: string }>;
  approveSwapRequest: (swapId: string) => Promise<{ success: boolean; error?: string }>;
  rejectSwapRequest: (swapId: string) => Promise<{ success: boolean; error?: string }>;
  cancelSwapRequest: (swapId: string) => Promise<{ success: boolean; error?: string }>;
  updateSwapRequest: (
    swapId: string,
    updates: Partial<ShiftSwapRequest>
  ) => Promise<{ success: boolean; error?: string }>;

  savePlannedShift: (
    date: string,
    location: LocationType,
    employeeId: string,
    employeeName: string,
    shiftType: ShiftType,
    note?: string
  ) => Promise<{ success: boolean; error?: string }>;
  saveSlotShifts: (
    date: string,
    location: string,
    shifts: Array<{ employeeId: string; employeeName: string; shiftType: ShiftType; note?: string }>
  ) => Promise<{ success: boolean; error?: string }>;
  deletePlannedShift: (scheduleId: string) => Promise<{ success: boolean; error?: string }>;
  clearMonthSchedules: (month: string, location?: string) => Promise<{ success: boolean; error?: string }>;
  saveScheduleBatch: (
    batch: PlannedShift[],
    replaceOptions?: { replaceMonth?: string; replaceLocation?: string }
  ) => Promise<{ success: boolean; error?: string }>;
  publishSchedule: (
    month: string,
    location?: string,
    count?: number
  ) => Promise<{ success: boolean; error?: string; publishedAt?: string }>;
  saveScheduleTemplate: (
    template: Partial<ScheduleTemplate>
  ) => Promise<{ success: boolean; error?: string; template?: ScheduleTemplate }>;
  deleteScheduleTemplate: (templateId: string) => Promise<{ success: boolean; error?: string }>;

  // Availability / Time Off (Пожелания по графику)
  setAvailability: (
    date: string,
    type: 'unavailable' | 'vacation' | 'study' | 'sick' | 'preferred' | 'clear',
    comment?: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteAvailability: (availId: string) => Promise<{ success: boolean; error?: string }>;
  updateAvailabilityStatus: (availId: string, status: 'approved' | 'rejected' | 'pending') => Promise<{ success: boolean; error?: string }>;

  // Financial Goals (Цель и прогноз заработка)
  saveIncomeGoal: (
    employeeId: string,
    month: string,
    targetAmount: number
  ) => Promise<{ success: boolean; error?: string }>;

  // Payback / Окупаемость склада
  savePaybackRecord: (record: PaybackPvzRecord) => Promise<{ success: boolean; error?: string }>;
  savePaybackArticle: (
    type: 'income' | 'expense',
    action: 'add' | 'edit' | 'delete',
    name: string,
    oldName?: string
  ) => Promise<{ success: boolean; error?: string }>;
  deletePaybackRecord: (pvzCode: string, month: string) => Promise<{ success: boolean; error?: string }>;

  // Alerts
  checkOpeningAlerts: () => Promise<{ success: boolean; missing?: string[]; sdChecked?: boolean; bdChecked?: boolean }>;

  // Location / Склад Management (Up to 30)
  addPickupPoint: (data: {
    name: string;
    code?: string;
    address?: string;
    assignedStaffIds?: string[];
    contactPhone?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    qrSecret?: string;
    zones?: string[];
  }) => Promise<{ success: boolean; error?: string }>;
  updatePickupPoint: (id: string, data: Partial<PickupPoint>) => Promise<{ success: boolean; error?: string }>;
  archivePickupPoint: (id: string) => Promise<{ success: boolean; error?: string }>;
  restorePickupPoint: (id: string) => Promise<{ success: boolean; error?: string }>;
  deletePickupPoint: (id: string) => Promise<{ success: boolean; error?: string }>;
  assignStaffToPickupPoint: (pointId: string, staffIds: string[]) => Promise<{ success: boolean; error?: string }>;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;

  // Telegram Integration
  telegramSettings: TelegramSettings | null;
  fetchTelegramSettings: () => Promise<TelegramSettings | null>;
  saveTelegramSettings: (botToken: string, managerChatId: string) => Promise<{ success: boolean; error?: string; botUsername?: string }>;
  testTelegramConnection: () => Promise<{ success: boolean; error?: string }>;
  disconnectTelegram: () => Promise<{ success: boolean; error?: string }>;
}

export const AppContext = createContext<AppContextType | null>(null);

function parseTimeSafe(dateStr?: string): number {
  if (!dateStr) return 0;
  const iso = dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

function deduplicateRecords(recs: CheckInRecord[]): CheckInRecord[] {
  const map = new Map<string, CheckInRecord>();
  for (const r of recs) {
    const key = `${r.employeeId}_${r.date}`;
    const exist = map.get(key);
    if (!exist) {
      map.set(key, r);
    } else {
      const tR = parseTimeSafe(r.checkedInAt || r.timestamp || `${r.date}T00:00:00`);
      const tE = parseTimeSafe(exist.checkedInAt || exist.timestamp || `${exist.date}T00:00:00`);
      if (tR >= tE) {
        if (!r.sales && exist.sales) r.sales = exist.sales;
        map.set(key, r);
      } else if (!exist.sales && r.sales) {
        exist.sales = r.sales;
      }
    }
  }
  return Array.from(map.values());
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() => {
    if (typeof window !== 'undefined') {
      const hasToken = !!localStorage.getItem('pvz_session_token') || !!getCookie('pvz_session');
      return hasToken ? 'LOADING' : 'UNAUTHENTICATED';
    }
    return 'UNAUTHENTICATED';
  });
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [sessionToken, setSessionToken] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pvz_session_token') || '';
    }
    return '';
  });
  const [csrfToken, setCsrfToken] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pvz_csrf') || '';
    }
    return '';
  });

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [records, setRecords] = useState<CheckInRecord[]>([]);
  const [cancelledDates, setCancelledDates] = useState<string[]>([]);
  const [applications, setApplications] = useState<ApplicationRequest[]>([]);
  const [messages, setMessages] = useState<ManagerMessage[]>([]);
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [restartLogs, setRestartLogs] = useState<BotRestartLog[]>([]);
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([]);
  const [schedules, setSchedules] = useState<PlannedShift[]>([]);
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [availability, setAvailabilityState] = useState<AvailabilityRequest[]>([]);
  const [incomeGoals, setIncomeGoals] = useState<IncomeGoal[]>([]);
  const [paybackRecords, setPaybackRecords] = useState<PaybackPvzRecord[]>([]);
  const [paybackTemplates, setPaybackTemplates] = useState<PaybackArticleTemplates>({
    customIncomeArticles: [],
    customExpenseArticles: [],
  });
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [warehousePositions, setWarehousePositions] = useState<string[]>([...DEFAULT_WAREHOUSE_POSITIONS]);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings | null>(null);
  const [openingAlerts, setOpeningAlerts] = useState<any>(null);
  const [rates, setRates] = useState<any>(() => {
    return {
      day12: 3500,
      night12: 4000,
      standard8: 2800,
      part6: 2100,
      part4: 1400,
      daily24: 7000,
      standard: 3500,
      '400+': 3800,
      '500+': 4200,
      '8h': 2800,
      '4h': 1400,
      partTimeShiftRate: 2100,
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
        { code: 'pt_standard', name: 'Смена подработчика (полная)', baseRate: 2800, isArchived: false },
      ],
      bonuses: [
        { code: 'seniorBonus', name: 'Доплата Старшему (Ст.С.)', value: 500, isArchived: false, target: 'senior' },
        { code: 'partTimeBonus', name: 'Доплата Подработчику', value: 0, isArchived: false, target: 'part_time' },
      ],
    };
  });

  const [billingModalOpen, setBillingModalOpen] = useState(false);
  const [isBotRestarting, setIsBotRestarting] = useState(false);
  const [mskTime, setMskTime] = useState(formatMoscowTime());
  const [todayDate, setTodayDate] = useState(formatMoscowDate());

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => {
      setMskTime(formatMoscowTime());
      setTodayDate(formatMoscowDate());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Helper for all state-changing and data fetch requests with CSRF + Credentials + Bearer Auth
  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(options.headers || {});

      if (!headers.has('Content-Type') && options.method && !['GET', 'HEAD'].includes(options.method)) {
        headers.set('Content-Type', 'application/json');
      }

      const activeToken = sessionToken || (typeof window !== 'undefined' ? localStorage.getItem('pvz_session_token') : null);
      if (activeToken) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }

      const tokenToUse =
        csrfToken ||
        (typeof window !== 'undefined' ? localStorage.getItem('pvz_csrf') : null) ||
        getCookie('pvz_csrf');

      if (tokenToUse && options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method)) {
        headers.set('x-csrf-token', tokenToUse);
      }

      // Safeguard against network hanging forever (15 seconds timeout)
      let signal = options.signal;
      let timer: any = null;
      if (!signal && typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        signal = controller.signal;
        timer = setTimeout(() => {
          try {
            controller.abort();
          } catch {}
        }, 15000);
      }

      try {
        const res = await fetch(url, {
          ...options,
          headers,
          credentials: 'include',
          signal,
        });
        return res;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    [sessionToken, csrfToken]
  );

  // Load collection data from API in parallel using Promise.allSettled (super fast, non-blocking)
  const refreshData = useCallback(async (overrideOrgId?: string | null) => {
    const activeOrgId = overrideOrgId !== undefined ? overrideOrgId : authSession?.organizationId;
    if (!activeOrgId) {
      return;
    }
    try {
      const [
        staffRes,
        checkinRes,
        msgRes,
        notifRes,
        botRes,
        ratesRes,
        appRes,
        swapsRes,
        schedRes,
        tplRes,
        availRes,
        goalsRes,
        pbRes,
        locsRes,
        tgRes,
      ] = await Promise.allSettled([
        apiFetch('/api/v1/staff'),
        apiFetch('/api/v1/checkins'),
        apiFetch('/api/v1/messages'),
        apiFetch('/api/v1/notifications'),
        apiFetch('/api/v1/bot/logs'),
        apiFetch('/api/v1/rates'),
        apiFetch('/api/v1/applications'),
        apiFetch('/api/v1/swaps'),
        apiFetch('/api/v1/schedules'),
        apiFetch('/api/v1/schedules/templates'),
        apiFetch('/api/v1/availability'),
        apiFetch('/api/v1/income-goals'),
        apiFetch('/api/v1/payback'),
        apiFetch('/api/v1/locations'),
        apiFetch('/api/v1/telegram/settings'),
      ]);

      // 1. Staff
      if (staffRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(staffRes.value);
        if (ok && data?.success && Array.isArray(data.staff)) setStaffList(data.staff);
      }

      // 2. Records / Checkins
      if (checkinRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(checkinRes.value);
        if (ok && data?.success && Array.isArray(data.records)) setRecords(deduplicateRecords(data.records));
        if (ok && data?.success && Array.isArray(data.cancelledDates)) setCancelledDates(data.cancelledDates);
      }

      // 3. Messages
      if (msgRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(msgRes.value);
        if (ok && data?.success && Array.isArray(data.messages)) setMessages(data.messages);
      }

      // 4. Notifications
      if (notifRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(notifRes.value);
        if (ok && data?.success && Array.isArray(data.notifications)) setNotifications(data.notifications);
      }

      // 5. Bot Logs
      if (botRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(botRes.value);
        if (ok && data?.success && Array.isArray(data.logs)) setRestartLogs(data.logs);
      }

      // 5.5. Rates Settings
      if (ratesRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(ratesRes.value);
        if (ok && data?.success && data.rates) setRates(data.rates);
      }

      // 6. Applications (if manager)
      if (appRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(appRes.value);
        if (ok && data?.success && Array.isArray(data.applications)) setApplications(data.applications);
      }

      // 7. Swaps
      if (swapsRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(swapsRes.value);
        if (ok && data?.success && Array.isArray(data.swaps)) setSwaps(data.swaps);
      }

      // 8. Schedules
      if (schedRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(schedRes.value);
        if (ok && data?.success && Array.isArray(data.schedules)) setSchedules(data.schedules);
      }

      // 8b. Schedule Templates
      if (tplRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(tplRes.value);
        if (ok && data?.success && Array.isArray(data.templates)) setScheduleTemplates(data.templates);
      }

      // 9. Availability
      if (availRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(availRes.value);
        if (ok && data?.success && Array.isArray(data.availability)) setAvailabilityState(data.availability);
      }

      // 9b. Income Goals
      if (goalsRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(goalsRes.value);
        if (ok && data?.success && Array.isArray(data.goals)) setIncomeGoals(data.goals);
      }

      // 9c. Payback / Окупаемость склада
      if (pbRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(pbRes.value);
        if (ok && data?.success) {
          if (Array.isArray(data.records)) setPaybackRecords(data.records);
          if (data.templates) setPaybackTemplates(data.templates);
        }
      }

      // 10. Pickup Points / Locations
      if (locsRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(locsRes.value);
        if (ok && data?.success && Array.isArray(data.locations)) setPickupPoints(data.locations);
      }

      // 11. Telegram Settings
      if (tgRes.status === 'fulfilled') {
        const { ok, data } = await safeJson(tgRes.value);
        if (ok && data?.success && data.settings) {
          setTelegramSettings(data.settings);
        }
      }
    } catch (err) {
      console.error('[AppContext] Failed to refresh data from server:', err);
    }
  }, [apiFetch, authSession?.organizationId]);

  // Initial session verification (runs once on mount, timeout protection ensures it never hangs)
  useEffect(() => {
    let isCancelled = false;

    async function initAuth() {
      // 1. Check if we even have a stored token or cookie to check
      const hasStoredToken = typeof window !== 'undefined' && (
        !!localStorage.getItem('pvz_session_token') ||
        !!getCookie('pvz_session')
      );

      // If no token exists at all, skip loading spinner immediately
      if (!hasStoredToken) {
        if (!isCancelled) {
          setAuthSession(null);
          setAuthStatus('UNAUTHENTICATED');
        }
        return;
      }

      setAuthStatus('LOADING');

      // Hard network abort controller: aborts fetch after 1500ms
      const abortController = new AbortController();
      const abortTimer = setTimeout(() => {
        abortController.abort();
      }, 1500);

      try {
        const activeToken = typeof window !== 'undefined' ? localStorage.getItem('pvz_session_token') : null;
        const headers: Record<string, string> = {};
        if (activeToken) {
          headers['Authorization'] = `Bearer ${activeToken}`;
        }

        const res = await fetch('/api/v1/auth/me', {
          headers,
          credentials: 'include',
          signal: abortController.signal,
        });
        clearTimeout(abortTimer);

        if (isCancelled) return;

        const { ok, data } = await safeJson(res);
        if (ok && data.success && data.user) {
          const orgId = data.user.organization_id || null;
          setAuthSession({
            role: data.user.role,
            staffId: data.user.id,
            name: data.user.name,
            login: data.user.login,
            email: data.user.email,
            phone: data.user.phone,
            organizationId: orgId,
            orgRole: data.user.org_role || null,
            organization: data.user.organization || null,
            subscription: data.user.subscription || null,
            locations: data.user.locations,
            position: data.user.position,
            payType: data.user.pay_type,
            hourlyRate: data.user.hourly_rate,
            shiftRate: data.user.shift_rate,
            nightRate: data.user.night_rate,
            isPartTime: data.user.is_part_time,
            isSenior: data.user.is_senior,
            telegramUsername: data.user.telegram_username,
          });
          if (data.csrfToken) {
            setCsrfToken(data.csrfToken);
            localStorage.setItem('pvz_csrf', data.csrfToken);
          }
          setAuthStatus('AUTHENTICATED');
          // Load data in background only once organization exists
          if (orgId) {
            refreshData(orgId).catch(e => console.warn('Background refresh error:', e));
          }
          return;
        } else {
          // If session expired or invalid, clear stored tokens
          if (typeof window !== 'undefined') {
            localStorage.removeItem('pvz_session_token');
            localStorage.removeItem('pvz_csrf');
          }
          setSessionToken('');
          setCsrfToken('');
        }
      } catch (err) {
        clearTimeout(abortTimer);
        console.warn('[AppContext] Initial session verification failed:', err);
      }

      if (!isCancelled) {
        setAuthSession(null);
        setAuthStatus('UNAUTHENTICATED');
      }
    }

    initAuth();

    return () => {
      isCancelled = true;
    };
  }, []); // Run once on mount!

  const currentRole: 'employee' | 'manager' = authSession?.role || 'employee';
  const currentStaffId: string = authSession?.staffId || '';
  const staffMemberFromList = staffList.find(s => s.id === currentStaffId);
  const currentStaff: StaffMember | undefined = staffMemberFromList || (authSession && authSession.staffId ? {
    id: authSession.staffId,
    name: authSession.name,
    login: authSession.login,
    role: 'employee',
    status: 'active',
    hasAccess: true,
    locations: authSession.locations || [],
    position: authSession.position,
    payType: authSession.payType,
    hourlyRate: authSession.hourlyRate,
    shiftRate: authSession.shiftRate,
    nightRate: authSession.nightRate,
    isPartTime: authSession.isPartTime || false,
    isSenior: authSession.isSenior || false,
    telegramUsername: authSession.telegramUsername,
    registeredAt: new Date().toISOString(),
  } : undefined);

  // Authentication: Server-Side Login
  const login = async (loginInput: string, passwordInput: string): Promise<LoginResult> => {
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          login: loginInput.trim(),
          password: passwordInput.trim(),
        }),
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return {
          success: false,
          error: data.error?.message || 'Неверный логин или пароль',
        };
      }

      const user = data.user;
      if (!user) {
        return {
          success: false,
          error: 'Ошибка авторизации: сервер не прислал данные пользователя',
        };
      }

      const orgId = user.organization_id || null;
      const session: AuthSession = {
        role: user.role,
        staffId: user.id,
        name: user.name,
        login: user.login,
        email: user.email,
        phone: user.phone,
        organizationId: orgId,
        orgRole: user.org_role || null,
        organization: user.organization || null,
        subscription: user.subscription || null,
        locations: user.locations,
        position: user.position,
        payType: user.pay_type,
        hourlyRate: user.hourly_rate,
        shiftRate: user.shift_rate,
        nightRate: user.night_rate,
        isPartTime: user.is_part_time,
        isSenior: user.is_senior,
        telegramUsername: user.telegram_username,
      };

      if (data.token) {
        setSessionToken(data.token);
        localStorage.setItem('pvz_session_token', data.token);
      }
      if (data.csrfToken) {
        setCsrfToken(data.csrfToken);
        localStorage.setItem('pvz_csrf', data.csrfToken);
      }

      setAuthSession(session);
      setAuthStatus('AUTHENTICATED');

      // Refresh data immediately with the new token if organization exists
      if (orgId) {
        try {
          const authHeader: Record<string, string> = data.token ? { Authorization: `Bearer ${data.token}` } : {};
          const [staffRes, checkinRes, msgRes, notifRes, botRes, locsRes, ratesRes] = await Promise.all([
            fetch('/api/v1/staff', { headers: authHeader, credentials: 'include' }),
            fetch('/api/v1/checkins', { headers: authHeader, credentials: 'include' }),
            fetch('/api/v1/messages', { headers: authHeader, credentials: 'include' }),
            fetch('/api/v1/notifications', { headers: authHeader, credentials: 'include' }),
            fetch('/api/v1/bot/logs', { headers: authHeader, credentials: 'include' }),
            fetch('/api/v1/locations', { headers: authHeader, credentials: 'include' }),
            fetch('/api/v1/rates', { headers: authHeader, credentials: 'include' }),
          ]);

          const [staffData, checkinData, msgData, notifData, botData, locsData, ratesData] = await Promise.all([
            safeJson(staffRes),
            safeJson(checkinRes),
            safeJson(msgRes),
            safeJson(notifRes),
            safeJson(botRes),
            safeJson(locsRes),
            safeJson(ratesRes),
          ]);

          if (staffData.ok && staffData.data.success && Array.isArray(staffData.data.staff)) {
            setStaffList(staffData.data.staff);
          }
          if (checkinData.ok && checkinData.data.success && Array.isArray(checkinData.data.records)) {
            setRecords(deduplicateRecords(checkinData.data.records));
          }
          if (checkinData.ok && checkinData.data.success && Array.isArray(checkinData.data.cancelledDates)) {
            setCancelledDates(checkinData.data.cancelledDates);
          }
          if (msgData.ok && msgData.data.success && Array.isArray(msgData.data.messages)) {
            setMessages(msgData.data.messages);
          }
          if (notifData.ok && notifData.data.success && Array.isArray(notifData.data.notifications)) {
            setNotifications(notifData.data.notifications);
          }
          if (botData.ok && botData.data.success && Array.isArray(botData.data.logs)) {
            setRestartLogs(botData.data.logs);
          }
          if (locsData.ok && locsData.data.success && Array.isArray(locsData.data.locations)) {
            setPickupPoints(locsData.data.locations);
          }
          if (ratesData.ok && ratesData.data.success && ratesData.data.rates) {
            setRates(ratesData.data.rates);
          }

          if (user.role === 'manager') {
            const appRes = await fetch('/api/v1/applications', { headers: authHeader, credentials: 'include' });
            const appData = await safeJson(appRes);
            if (appData.ok && appData.data.success && Array.isArray(appData.data.applications)) {
              setApplications(appData.data.applications);
            }
          }
        } catch (refreshErr) {
          console.warn('[AppContext] Post-login background refresh warning:', refreshErr);
        }
      }

      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Ошибка соединения с сервером',
      };
    }
  };

  const refreshOrganization = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/organization');
      const { ok, data } = await safeJson(res);
      if (ok && data?.success) {
        setAuthSession(prev =>
          prev
            ? {
                ...prev,
                organizationId: data.organization?.id || prev.organizationId || null,
                organization: data.organization || null,
                subscription: data.subscription || null,
              }
            : prev
        );
      }
    } catch (err) {
      console.warn('[AppContext] refreshOrganization error:', err);
    }
  }, [apiFetch]);

  const registerManager = async (payload: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    acceptPrivacy: boolean;
    acceptTerms: boolean;
  }): Promise<LoginResult> => {
    try {
      const res = await fetch('/api/v1/auth/register-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data?.success || !data.user) {
        return {
          success: false,
          error: data?.error?.message || 'Ошибка регистрации руководителя',
        };
      }

      const user = data.user;
      if (data.token) {
        setSessionToken(data.token);
        localStorage.setItem('pvz_session_token', data.token);
      }
      if (data.csrfToken) {
        setCsrfToken(data.csrfToken);
        localStorage.setItem('pvz_csrf', data.csrfToken);
      }

      setAuthSession({
        role: user.role,
        staffId: user.id,
        name: user.name,
        login: user.login,
        email: user.email,
        phone: user.phone,
        organizationId: user.organization_id || null,
        orgRole: user.org_role || null,
        organization: user.organization || null,
        subscription: user.subscription || null,
        locations: user.locations || [],
        position: user.position,
        payType: user.pay_type,
        hourlyRate: user.hourly_rate,
        shiftRate: user.shift_rate,
        nightRate: user.night_rate,
        isPartTime: user.is_part_time,
        isSenior: user.is_senior,
      });
      setAuthStatus('AUTHENTICATED');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Ошибка сети при регистрации' };
    }
  };

  const createOrganization = async (payload: {
    name: string;
    inn?: string;
    timezone?: string;
    selectedPlan?: string;
    selectedPeriod?: number;
  }): Promise<LoginResult> => {
    try {
      const res = await apiFetch('/api/v1/organization', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data?.success || !data.organization) {
        return {
          success: false,
          error: data?.error?.message || 'Не удалось создать организацию',
        };
      }

      const newOrgId = data.organization.id;
      setAuthSession(prev =>
        prev
          ? {
              ...prev,
              organizationId: newOrgId,
              orgRole: 'owner',
              organization: data.organization,
              subscription: data.subscription || null,
            }
          : prev
      );

      await refreshData(newOrgId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Ошибка сети при создании организации' };
    }
  };

  const updateOrganization = async (payload: {
    name?: string;
    inn?: string;
    timezone?: string;
  }): Promise<LoginResult> => {
    try {
      const res = await apiFetch('/api/v1/organization', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data?.success || !data.organization) {
        return {
          success: false,
          error: data?.error?.message || 'Ошибка обновления организации',
        };
      }
      setAuthSession(prev => (prev ? { ...prev, organization: data.organization } : prev));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Ошибка сети' };
    }
  };

  const logout = async () => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout network error:', err);
    }
    localStorage.removeItem('pvz_session_token');
    localStorage.removeItem('pvz_csrf');
    setSessionToken('');
    setCsrfToken('');
    setAuthSession(null);
    setAuthStatus('UNAUTHENTICATED');
    setBillingModalOpen(false);
    setStaffList([]);
    setRecords([]);
    setCancelledDates([]);
    setApplications([]);
    setMessages([]);
    setNotifications([]);
    setPickupPoints([]);
    setSchedules([]);
    setScheduleTemplates([]);
    setSwaps([]);
    setAvailabilityState([]);
    setIncomeGoals([]);
    setPaybackRecords([]);
    setTelegramSettings(null);
  };

  // Warehouse positions management
  const fetchWarehousePositions = useCallback(async (): Promise<string[]> => {
    try {
      const res = await apiFetch('/api/v1/staff/positions');
      const { ok, data } = await safeJson(res);
      if (ok && data?.success && Array.isArray(data.positions)) {
        setWarehousePositions(data.positions);
        return data.positions;
      }
    } catch (e) {
      console.warn('[AppContext] Failed to load warehouse positions:', e);
    }
    return DEFAULT_WAREHOUSE_POSITIONS as unknown as string[];
  }, [apiFetch]);

  const addWarehousePosition = async (name: string): Promise<{ success: boolean; error?: string; positions?: string[] }> => {
    const cleanName = name.trim();
    if (!cleanName) return { success: false, error: 'Укажите название должности' };
    setWarehousePositions(prev => prev.includes(cleanName) ? prev : [...prev, cleanName]);
    try {
      const res = await apiFetch('/api/v1/staff/positions', {
        method: 'POST',
        body: JSON.stringify({ name: cleanName }),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data?.success && Array.isArray(data.positions)) {
        setWarehousePositions(data.positions);
        return { success: true, positions: data.positions };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сохранения должности' };
    }
  };

  // Manager: Create employee account (Optimistic & fast saving)
  const createEmployeeAccount = async (
    name: string,
    loginVal: string,
    passwordVal: string,
    locations: LocationType[] = [],
    telegramUsername?: string,
    isPartTime: boolean = false,
    isSenior: boolean = false,
    warehouseDetails?: {
      position?: string;
      payType?: 'hourly' | 'shift';
      hourlyRate?: number;
      shiftRate?: number;
      nightRate?: number;
    }
  ): Promise<{ success: boolean; error?: string; staff?: StaffMember }> => {
    const trimmedLogin = loginVal.trim().toLowerCase();
    const trimmedPass = passwordVal.trim();

    const maxStaffLimit = authSession?.subscription?.maxStaff ?? 150;
    const activeStaffCount = staffList.filter(s => s.status !== 'archived').length;
    if (activeStaffCount >= maxStaffLimit) {
      return {
        success: false,
        error: `Достигнут лимит вашего тарифа (${maxStaffLimit} сотрудников). Перейдите на более высокий тариф в разделе «Тариф и оплата».`,
      };
    }

    if (!trimmedLogin || !trimmedPass) {
      return { success: false, error: 'Логин и пароль обязательны для заполнения' };
    }

    if (locations.length === 0) {
      return { success: false, error: 'Необходимо выбрать хотя бы одно место работы' };
    }

    const tempId = `emp-${Date.now().toString(36)}`;
    const newStaffMember: StaffMember = {
      id: tempId,
      name: name.trim(),
      login: trimmedLogin,
      password: trimmedPass,
      role: 'employee',
      status: 'active',
      registeredAt: new Date().toISOString(),
      location: locations[0] || (pickupPoints[0]?.code || ''),
      locations,
      isPartTime,
      isSenior,
      hasAccess: true,
      telegramUsername: telegramUsername?.trim() || undefined,
      position: warehouseDetails?.position || 'Работник склада',
      payType: warehouseDetails?.payType || 'hourly',
      hourlyRate: warehouseDetails?.hourlyRate != null ? warehouseDetails.hourlyRate : 350,
      shiftRate: warehouseDetails?.shiftRate != null ? warehouseDetails.shiftRate : 3500,
      nightRate: warehouseDetails?.nightRate != null ? warehouseDetails.nightRate : 0,
    };

    // Optimistic addition so UI updates instantly
    setStaffList(prev => [...prev, newStaffMember]);

    try {
      const res = await apiFetch('/api/v1/staff', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          login: trimmedLogin,
          password: trimmedPass,
          locations,
          telegramUsername: telegramUsername?.trim() || undefined,
          isPartTime,
          isSenior,
          position: warehouseDetails?.position || 'Работник склада',
          payType: warehouseDetails?.payType || 'hourly',
          hourlyRate: warehouseDetails?.hourlyRate != null ? warehouseDetails.hourlyRate : 350,
          shiftRate: warehouseDetails?.shiftRate != null ? warehouseDetails.shiftRate : 3500,
          nightRate: warehouseDetails?.nightRate != null ? warehouseDetails.nightRate : 0,
        }),
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        // Rollback optimistic add
        setStaffList(prev => prev.filter(s => s.id !== tempId));
        return { success: false, error: data.error?.message || 'Ошибка создания учетной записи' };
      }

      if (data.staff) {
        setStaffList(prev => prev.map(s => (s.id === tempId ? { ...newStaffMember, ...data.staff } : s)));
      }

      // Background sync without blocking the caller
      refreshData().catch(e => console.warn('[AppContext] Background refreshData error:', e));
      return { success: true, staff: data.staff || newStaffMember };
    } catch (err: any) {
      setStaffList(prev => prev.filter(s => s.id !== tempId));
      return { success: false, error: err.message || 'Ошибка сети при создании сотрудника' };
    }
  };

  const updateEmployeeCredentials = async (
    staffId: string,
    newLogin: string,
    newPassword?: string,
    newLocations?: LocationType[],
    isPartTime?: boolean,
    isSenior?: boolean,
    newName?: string,
    telegramUsername?: string,
    warehouseDetails?: {
      position?: string;
      payType?: 'hourly' | 'shift';
      hourlyRate?: number;
      shiftRate?: number;
      nightRate?: number;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    const trimmedLogin = newLogin.trim().toLowerCase();
    const trimmedPass = newPassword ? newPassword.trim() : undefined;
    const trimmedName = newName ? newName.trim() : undefined;
    const trimmedTg = telegramUsername !== undefined ? telegramUsername.trim() : undefined;

    if (!trimmedLogin) {
      return { success: false, error: 'Логин обязателен' };
    }

    const prevStaffList = [...staffList];

    // Optimistic update so UI reflects changes with 0ms delay
    setStaffList(prev =>
      prev.map(s => {
        if (s.id === staffId) {
          return {
            ...s,
            name: trimmedName || s.name,
            login: trimmedLogin,
            password: trimmedPass || s.password,
            locations: newLocations && newLocations.length > 0 ? newLocations : s.locations,
            location: newLocations && newLocations.length > 0 ? newLocations[0] : s.location,
            isPartTime: isPartTime !== undefined ? isPartTime : s.isPartTime,
            isSenior: isSenior !== undefined ? isSenior : s.isSenior,
            telegramUsername: trimmedTg !== undefined ? trimmedTg : s.telegramUsername,
            position: warehouseDetails?.position !== undefined ? warehouseDetails.position : s.position,
            payType: warehouseDetails?.payType !== undefined ? warehouseDetails.payType : s.payType,
            hourlyRate: warehouseDetails?.hourlyRate !== undefined ? warehouseDetails.hourlyRate : s.hourlyRate,
            shiftRate: warehouseDetails?.shiftRate !== undefined ? warehouseDetails.shiftRate : s.shiftRate,
            nightRate: warehouseDetails?.nightRate !== undefined ? warehouseDetails.nightRate : s.nightRate,
          };
        }
        return s;
      })
    );

    // Also optimistically keep pickupPoints assignedStaffIds bidirectionally in sync
    if (newLocations && Array.isArray(newLocations)) {
      setPickupPoints(prevPoints =>
        prevPoints.map(point => {
          const belongs = newLocations.some(
            l => l === point.code || l === point.name || l === point.id
          );
          const currentIds = point.assignedStaffIds || [];
          if (belongs && !currentIds.includes(staffId)) {
            return { ...point, assignedStaffIds: [...currentIds, staffId] };
          } else if (!belongs && currentIds.includes(staffId)) {
            return { ...point, assignedStaffIds: currentIds.filter(id => id !== staffId) };
          }
          return point;
        })
      );
    }

    try {
      const res = await apiFetch(`/api/v1/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName || undefined,
          login: trimmedLogin,
          password: trimmedPass || undefined,
          locations: newLocations,
          isPartTime,
          isSenior,
          telegramUsername: trimmedTg !== undefined ? trimmedTg : undefined,
          position: warehouseDetails?.position,
          payType: warehouseDetails?.payType,
          hourlyRate: warehouseDetails?.hourlyRate,
          shiftRate: warehouseDetails?.shiftRate,
          nightRate: warehouseDetails?.nightRate,
        }),
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        // Rollback
        setStaffList(prevStaffList);
        return { success: false, error: data.error?.message || 'Ошибка обновления данных сотрудника' };
      }

      // Background sync without blocking
      refreshData().catch(e => console.warn('[AppContext] Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      setStaffList(prevStaffList);
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const toggleEmployeeAccess = async (staffId: string, hasAccess: boolean): Promise<{ success: boolean; error?: string }> => {
    const newStatus = hasAccess ? 'active' : 'deactivated';
    const prevStaffList = [...staffList];

    // Optimistic update
    setStaffList(prev => prev.map(s => (s.id === staffId ? { ...s, status: newStatus, hasAccess } : s)));

    try {
      const res = await apiFetch(`/api/v1/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        setStaffList(prevStaffList);
        return { success: false, error: data.error?.message || 'Ошибка изменения статуса сотрудника' };
      }
      refreshData().catch(e => console.warn('[AppContext] Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      setStaffList(prevStaffList);
      console.error('Error toggling employee access:', err);
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const switchStaff = (_staffId: string) => {};

  // Perform Check-In
  const performCheckIn = async (
    employeeId: string,
    shiftType: ShiftType,
    chosenLocation?: LocationType,
    customDate?: string,
    initialCash?: number,
    cashNotes?: string,
    options?: {
      qrVerified?: boolean;
      geoVerified?: boolean;
      zone?: string;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    const staff = staffList.find(s => s.id === employeeId);
    const loc = chosenLocation || (staff?.locations && staff.locations[0]) || staff?.location || (pickupPoints[0]?.code || '');

    try {
      const res = await apiFetch('/api/v1/checkins', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          shiftType,
          location: loc,
          date: customDate,
          initialCash,
          cashNotes,
          qrVerified: options?.qrVerified,
          geoVerified: options?.geoVerified,
          zone: options?.zone,
        }),
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка выполнения Check-in' };
      }

      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети при выполнении Check-in' };
    }
  };

  // Perform Check-Out (Complete shift)
  const performCheckOut = async (
    employeeId?: string,
    checkinId?: string,
    checkoutData?: {
      checkOutAt?: string;
      breakMinutes?: number;
      workedHours?: number;
      notes?: string;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/checkins/checkout', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          checkinId,
          ...checkoutData,
        }),
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка завершения смены' };
      }

      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети при завершении смены' };
    }
  };

  const cancelCheckIn = async (employeeId: string): Promise<{ success: boolean; error?: string }> => {
    const today = formatMoscowDate();
    const existing = records.find(r => r.employeeId === employeeId && r.date === today);

    if (!existing) {
      return { success: false, error: 'Запись смены на сегодня не найдена' };
    }

    try {
      const res = await apiFetch(`/api/v1/checkins/${existing.id}`, { method: 'DELETE' });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка отмены Check-in' };
      }

      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const managerAddOrUpdateShift = async (
    employeeId: string,
    date: string,
    shiftType: ShiftType,
    location: LocationType
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/checkins', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          date,
          shiftType,
          location,
        }),
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка сохранения смены' };
      }

      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const managerDeleteShift = async (recordId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/checkins/${recordId}`, {
        method: 'DELETE',
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка отмены смены' };
      }

      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  // Submit Sales
  const submitSales = async (
    employeeId: string,
    sales: DailySales,
    customDate?: string,
    finalCash?: number,
    collectedCash?: number,
    initialCash?: number,
    cashNotes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/sales', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          sales,
          date: customDate,
          finalCash,
          collectedCash,
          initialCash,
          cashNotes,
        }),
      });

      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return {
          success: false,
          error: data.error?.message || 'Ошибка при сохранении выручки (проверьте наличие Check-in)',
        };
      }

      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  // Shift Swaps (Биржа смен)
  const createSwapRequest = async (
    date: string,
    shiftType: ShiftType,
    location: LocationType,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/swaps', {
        method: 'POST',
        body: JSON.stringify({
          date,
          shiftType,
          location,
          reason,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка создания заявки' };
      }
      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const claimSwapRequest = async (swapId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Optimistic update for instantaneous feedback
      setSwaps(prev =>
        prev.map(s =>
          s.id === swapId
            ? {
                ...s,
                status: 'claimed',
                candidateId: currentStaffId,
                candidateName: currentStaff?.name || authSession?.name || 'Сотрудник',
              }
            : s
        )
      );

      const res = await apiFetch('/api/v1/swaps', {
        method: 'POST',
        body: JSON.stringify({
          action: 'claim',
          swapId,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        await refreshData();
        return { success: false, error: data.error || data.error?.message || 'Ошибка отклика на смену' };
      }
      if (Array.isArray(data.swaps)) {
        setSwaps(data.swaps);
      } else {
        await refreshData();
      }
      return { success: true };
    } catch (err: any) {
      await refreshData();
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const approveSwapRequest = async (swapId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Optimistic update
      setSwaps(prev =>
        prev.map(s =>
          s.id === swapId
            ? { ...s, status: 'approved', resolvedAt: new Date().toISOString() }
            : s
        )
      );

      const res = await apiFetch(`/api/v1/swaps/${swapId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        await refreshData();
        return { success: false, error: data.error?.message || 'Ошибка подтверждения подмены' };
      }
      if (Array.isArray(data.swaps)) {
        setSwaps(data.swaps);
      } else {
        await refreshData();
      }
      return { success: true };
    } catch (err: any) {
      await refreshData();
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const rejectSwapRequest = async (swapId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Optimistic update
      setSwaps(prev =>
        prev.map(s =>
          s.id === swapId
            ? { ...s, status: 'open', candidateId: undefined, candidateName: undefined }
            : s
        )
      );

      const res = await apiFetch(`/api/v1/swaps/${swapId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject' }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        await refreshData();
        return { success: false, error: data.error?.message || 'Ошибка отклонения заявки' };
      }
      if (Array.isArray(data.swaps)) {
        setSwaps(data.swaps);
      } else {
        await refreshData();
      }
      return { success: true };
    } catch (err: any) {
      await refreshData();
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const cancelSwapRequest = async (swapId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setSwaps(prev => prev.filter(s => s.id !== swapId));

      const res = await apiFetch(`/api/v1/swaps/${swapId}`, {
        method: 'DELETE',
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        await refreshData();
        return { success: false, error: data.error?.message || 'Ошибка отмены заявки' };
      }
      if (Array.isArray(data.swaps)) {
        setSwaps(data.swaps);
      } else {
        await refreshData();
      }
      return { success: true };
    } catch (err: any) {
      await refreshData();
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const updateSwapRequest = async (
    swapId: string,
    updates: Partial<ShiftSwapRequest>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/swaps/${swapId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка редактирования заявки' };
      }
      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  // Schedule Planner
  const savePlannedShift = async (
    date: string,
    location: LocationType,
    employeeId: string,
    employeeName: string,
    shiftType: ShiftType,
    note?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/schedules', {
        method: 'POST',
        body: JSON.stringify({
          date,
          location,
          employeeId,
          employeeName,
          shiftType,
          note,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка планирования смены' };
      }
      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const saveSlotShifts = async (
    date: string,
    location: string,
    shifts: Array<{ employeeId: string; employeeName: string; shiftType: ShiftType; note?: string }>
  ): Promise<{ success: boolean; error?: string }> => {
    const prevSchedules = [...schedules];
    const newShifts: PlannedShift[] = shifts.map(sh => ({
      id: `sch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      date,
      location,
      employeeId: sh.employeeId,
      employeeName: sh.employeeName || 'Сотрудник',
      shiftType: sh.shiftType || 'standard',
      note: sh.note ? String(sh.note).trim() : '',
      createdAt: new Date().toISOString(),
    }));

    // Optimistically update local state immediately - zero delay
    setSchedules(prev => {
      const filtered = prev.filter(s => !(s.date === date && (s.location === location || s.location.toLowerCase() === location.toLowerCase())));
      return [...filtered, ...newShifts];
    });

    try {
      const res = await apiFetch('/api/v1/schedules/slot', {
        method: 'POST',
        body: JSON.stringify({
          date,
          location,
          shifts: newShifts,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        setSchedules(prevSchedules);
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка сохранения смен';
        return { success: false, error: errorMsg };
      }
      if (Array.isArray(data.schedules)) {
        setSchedules(data.schedules);
      }
      refreshData().catch(e => console.warn('Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      setSchedules(prevSchedules);
      return { success: false, error: err.message || 'Ошибка сети при сохранении смен' };
    }
  };

  const deletePlannedShift = async (scheduleId: string): Promise<{ success: boolean; error?: string }> => {
    // Optimistic delete so UI updates instantly
    setSchedules(prev => prev.filter(s => s.id !== scheduleId));
    try {
      const res = await apiFetch(`/api/v1/schedules/${scheduleId}`, {
        method: 'DELETE',
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        refreshData().catch(() => {});
        return { success: false, error: data.error?.message || 'Ошибка удаления плановой смены' };
      }
      refreshData().catch(e => console.warn('Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      refreshData().catch(() => {});
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const clearMonthSchedules = async (
    month: string,
    location?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const prevSchedules = [...schedules];
    // Optimistic instant clearance with 0ms delay - eliminates freezing!
    setSchedules(prev =>
      prev.filter(s => {
        const matchMonth = s.date.startsWith(month);
        const matchLoc = location ? (s.location === location || s.location.toLowerCase() === location.toLowerCase()) : true;
        return !(matchMonth && matchLoc);
      })
    );

    try {
      const res = await apiFetch('/api/v1/schedules', {
        method: 'POST',
        body: JSON.stringify({
          batch: [],
          replaceMonth: month,
          replaceLocation: location,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        setSchedules(prevSchedules);
        return { success: false, error: data?.error?.message || 'Ошибка очистки расписания' };
      }
      refreshData().catch(e => console.warn('Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      setSchedules(prevSchedules);
      return { success: false, error: err.message || 'Ошибка сети при очистке месяца' };
    }
  };

  const saveScheduleBatch = async (
    batch: PlannedShift[],
    replaceOptions?: { replaceMonth?: string; replaceLocation?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/schedules', {
        method: 'POST',
        body: JSON.stringify({
          batch,
          replaceMonth: replaceOptions?.replaceMonth,
          replaceLocation: replaceOptions?.replaceLocation,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка сохранения расписания';
        return { success: false, error: errorMsg };
      }
      // Immediately apply returned schedules so UI is instant
      if (Array.isArray(data.schedules)) {
        setSchedules(data.schedules);
      }
      // Run background refresh non-blocking
      refreshData().catch(e => console.warn('Background refresh error:', e));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const publishSchedule = async (
    month: string,
    location?: string,
    count?: number
  ): Promise<{ success: boolean; error?: string; publishedAt?: string }> => {
    try {
      const res = await apiFetch('/api/v1/schedules/publish', {
        method: 'POST',
        body: JSON.stringify({ month, location, count }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка публикации графика';
        return { success: false, error: errorMsg };
      }
      refreshData().catch(e => console.warn('Background refresh error:', e));
      return { success: true, publishedAt: data.publishedAt };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const saveScheduleTemplate = async (
    template: Partial<ScheduleTemplate>
  ): Promise<{ success: boolean; error?: string; template?: ScheduleTemplate }> => {
    try {
      const res = await apiFetch('/api/v1/schedules/templates', {
        method: 'POST',
        body: JSON.stringify(template),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка сохранения шаблона';
        return { success: false, error: errorMsg };
      }
      if (data.template) {
        setScheduleTemplates(prev => {
          const exists = prev.some(t => t.id === data.template.id);
          if (exists) return prev.map(t => t.id === data.template.id ? data.template : t);
          return [...prev, data.template];
        });
      }
      refreshData().catch(e => console.warn('Background refresh error:', e));
      return { success: true, template: data.template };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const deleteScheduleTemplate = async (templateId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/schedules/templates/${templateId}`, {
        method: 'DELETE',
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка удаления шаблона';
        return { success: false, error: errorMsg };
      }
      setScheduleTemplates(prev => prev.filter(t => t.id !== templateId));
      refreshData().catch(e => console.warn('Background refresh error:', e));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  // Availability / Time Off
  const setAvailability = async (
    date: string,
    type: 'unavailable' | 'vacation' | 'study' | 'sick' | 'preferred' | 'clear',
    comment?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/availability', {
        method: 'POST',
        body: JSON.stringify({
          date,
          type,
          comment,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка сохранения пожелания';
        return { success: false, error: errorMsg };
      }
      refreshData().catch(e => console.warn('Background refresh error:', e));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const deleteAvailability = async (availId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/availability/${availId}`, {
        method: 'DELETE',
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка удаления';
        return { success: false, error: errorMsg };
      }
      setAvailabilityState(prev => prev.filter(a => a.id !== availId));
      refreshData().catch(e => console.warn('Background refresh error:', e));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const updateAvailabilityStatus = async (
    availId: string,
    status: 'approved' | 'rejected' | 'pending'
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/availability/${availId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка обновления статуса';
        return { success: false, error: errorMsg };
      }
      setAvailabilityState(prev => prev.map(a => a.id === availId ? { ...a, status } : a));
      refreshData().catch(e => console.warn('Background refresh error:', e));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  // Financial Goals (Цель и прогноз заработка)
  const saveIncomeGoal = async (
    employeeId: string,
    month: string,
    targetAmount: number
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/income-goals', {
        method: 'POST',
        body: JSON.stringify({ employeeId, month, targetAmount }),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        if (Array.isArray(data.goals)) {
          setIncomeGoals(data.goals);
        } else if (data.goal) {
          setIncomeGoals(prev => [
            ...prev.filter(g => !(g.employeeId === employeeId && g.month === month)),
            data.goal
          ]);
        }
        return { success: true };
      }
      const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка сохранения цели';
      return { success: false, error: errorMsg };
    } catch (err: any) {
      return { success: false, error: err.message || 'Сетевая ошибка' };
    }
  };

  // Payback / Окупаемость склада
  const savePaybackRecord = async (
    record: PaybackPvzRecord
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Optimistic update so UI feels instantaneous
      setPaybackRecords(prev => [
        ...prev.filter(r => !(r.pvzCode === record.pvzCode && r.month === record.month)),
        record,
      ]);

      const res = await apiFetch('/api/v1/payback', {
        method: 'POST',
        body: JSON.stringify({ record }),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        if (Array.isArray(data.records)) {
          setPaybackRecords(data.records);
        }
        if (data.templates) {
          setPaybackTemplates(data.templates);
        }
        return { success: true };
      }
      const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка сохранения данных окупаемости';
      return { success: false, error: errorMsg };
    } catch (err: any) {
      return { success: false, error: err.message || 'Сетевая ошибка' };
    }
  };

  const savePaybackArticle = async (
    type: 'income' | 'expense',
    action: 'add' | 'edit' | 'delete',
    name: string,
    oldName?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/payback/article', {
        method: 'POST',
        body: JSON.stringify({ type, action, name, oldName }),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        if (data.templates) setPaybackTemplates(data.templates);
        if (Array.isArray(data.records)) setPaybackRecords(data.records);
        return { success: true };
      }
      const errorMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Ошибка изменения статьи';
      return { success: false, error: errorMsg };
    } catch (err: any) {
      return { success: false, error: err.message || 'Сетевая ошибка' };
    }
  };

  const deletePaybackRecord = async (
    pvzCode: string,
    month: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/payback/${encodeURIComponent(pvzCode)}/${encodeURIComponent(month)}`, {
        method: 'DELETE',
      });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        if (Array.isArray(data.records)) {
          setPaybackRecords(data.records);
        } else {
          setPaybackRecords(prev => prev.filter(r => !(r.pvzCode === pvzCode && r.month === month)));
        }
        return { success: true };
      }
      return { success: false, error: data?.error || 'Ошибка удаления записи' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Сетевая ошибка' };
    }
  };

  // Opening Alerts
  const checkOpeningAlerts = async (): Promise<{
    success: boolean;
    missing?: string[];
    sdChecked?: boolean;
    bdChecked?: boolean;
    error?: string;
  }> => {
    try {
      const res = await apiFetch('/api/v1/checkin-alerts', { method: 'POST' });
      const { ok, data } = await safeJson(res);
      if (ok && data && data.success) {
        setOpeningAlerts(data);
        return {
          success: true,
          missing: data.missing || [],
          sdChecked: data.sdChecked,
          bdChecked: data.bdChecked,
        };
      }
    } catch (err) {
      console.warn('[AppContext] Remote checkin-alerts failed, using local check:', err);
    }

    // Fallback: Compute opening status directly from local records and pickup points
    const activeLocs = pickupPoints.filter(p => !p.isArchived && p.active !== false).map(p => p.code);
    const locsToCheck = activeLocs;
    const todayCheckins = records.filter(r => r.date === todayDate && !!r.shiftType);
    const checkedCodes = new Set(todayCheckins.map(r => r.location));
    const missing = locsToCheck.filter(code => !checkedCodes.has(code));

    const result = {
      success: true,
      missing,
      checkedCodes: Array.from(checkedCodes),
    };
    setOpeningAlerts(result);
    return result;
  };

  const sendMessageToManager = async (_employeeId: string, message: string): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/v1/messages', {
        method: 'POST',
        body: JSON.stringify({ message: message.trim() }),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        await refreshData();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error sending message:', err);
      return false;
    }
  };

  const submitRegistration = async (name: string, telegramUsername?: string): Promise<{ success: boolean; error?: string; id?: string }> => {
    try {
      const res = await apiFetch('/api/v1/applications', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), telegramUsername }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка отправки заявки' };
      }
      await refreshData();
      return { success: true, id: data.applicationId };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const handleApplication = async (
    appId: string,
    action: 'accept' | 'reject',
    note?: string,
    generatedLogin?: string,
    generatedPassword?: string,
    assignedLocations?: LocationType[]
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/applications/${appId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          note,
          generatedLogin,
          generatedPassword,
          assignedLocations: assignedLocations || [],
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        return { success: false, error: data.error?.message || 'Ошибка обработки заявки' };
      }
      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const deactivateStaff = async (staffId: string): Promise<{ success: boolean; error?: string }> => {
    return await toggleEmployeeAccess(staffId, false);
  };

  const restoreStaff = async (staffId: string): Promise<{ success: boolean; error?: string }> => {
    const prevStaffList = [...staffList];
    setStaffList(prev => prev.map(s => (s.id === staffId ? { ...s, status: 'active', hasAccess: true } : s)));
    try {
      const res = await apiFetch(`/api/v1/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        setStaffList(prevStaffList);
        return { success: false, error: data.error?.message || 'Ошибка восстановления доступа' };
      }
      refreshData().catch(e => console.warn('[AppContext] Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      setStaffList(prevStaffList);
      console.error('Error restoring staff:', err);
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const archiveStaff = async (staffId: string): Promise<{ success: boolean; error?: string }> => {
    const prevStaffList = [...staffList];
    setStaffList(prev => prev.map(s => (s.id === staffId ? { ...s, status: 'archived', hasAccess: false } : s)));
    try {
      const res = await apiFetch(`/api/v1/staff/${staffId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        setStaffList(prevStaffList);
        return { success: false, error: data.error?.message || 'Ошибка архивации сотрудника' };
      }
      refreshData().catch(e => console.warn('[AppContext] Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      setStaffList(prevStaffList);
      console.error('Error archiving staff:', err);
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const deleteStaffPermanently = async (
    staffId: string,
    confirmation = 'DELETE USER'
  ): Promise<{ success: boolean; error?: string }> => {
    const prevStaffList = [...staffList];
    setStaffList(prev => prev.filter(s => s.id !== staffId));
    try {
      const res = await apiFetch(`/api/v1/staff/${staffId}?hard=true`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmation }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.success) {
        setStaffList(prevStaffList);
        return { success: false, error: data.error?.message || 'Ошибка удаления' };
      }
      refreshData().catch(e => console.warn('[AppContext] Background refreshData error:', e));
      return { success: true };
    } catch (err: any) {
      setStaffList(prevStaffList);
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const sendThankYou = async (location: string) => {
    try {
      await apiFetch('/api/v1/notifications/thank-you', {
        method: 'POST',
        body: JSON.stringify({ location }),
      });
      await refreshData();
    } catch (err) {
      console.error('Error sending thank you:', err);
    }
  };

  const restartBot = async () => {
    setIsBotRestarting(true);
    try {
      const res = await apiFetch('/api/v1/bot/restart', { method: 'POST' });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        await refreshData();
      }
    } catch (err) {
      console.error('Error restarting bot:', err);
    } finally {
      setIsBotRestarting(false);
    }
  };

  const markMessageRead = async (msgId: string) => {
    try {
      await apiFetch(`/api/v1/messages/${msgId}/read`, { method: 'PATCH' });
      await refreshData();
    } catch (err) {
      console.error(err);
    }
  };

  const replyToMessage = async (messageId: string, replyText: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch(`/api/v1/messages/${messageId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ replyText: replyText.trim() }),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        await refreshData();
        return { success: true };
      }
      return { success: false, error: data.error?.message || 'Ошибка отправки ответа' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети' };
    }
  };

  const markAllMessagesRead = async () => {
    try {
      await apiFetch('/api/v1/messages/read-all', { method: 'POST' });
      await refreshData();
    } catch (err) {
      console.error(err);
    }
  };

  const markNotificationRead = async (notifId: string) => {
    try {
      await apiFetch(`/api/v1/notifications/${notifId}/read`, { method: 'PATCH' });
      await refreshData();
    } catch (err) {
      console.error(err);
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
      await refreshData();
    } catch (err) {
      console.error(err);
    }
  };

  const dismissNotification = async (notifId: string) => {
    try {
      await apiFetch(`/api/v1/notifications/${notifId}`, { method: 'DELETE' });
      await refreshData();
    } catch (err) {
      console.error(err);
    }
  };

  const resetLocalUIState = () => {
    localStorage.clear();
    refreshData();
  };

  const sendReportToTelegram = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/telegram/report', { method: 'POST' });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        return { success: true };
      }
      return { success: false, error: data.error?.message || 'Ошибка отправки отчета в Telegram' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Ошибка сети при отправке отчета' };
    }
  };

  const fetchTelegramSettings = useCallback(async (): Promise<TelegramSettings | null> => {
    try {
      const res = await apiFetch('/api/v1/telegram/settings');
      const { ok, data } = await safeJson(res);
      if (ok && data?.success && data.settings) {
        setTelegramSettings(data.settings);
        return data.settings;
      }
    } catch (e) {
      console.warn('[AppContext] Failed to load telegram settings:', e);
    }
    return null;
  }, [apiFetch]);

  const saveTelegramSettings = async (
    botToken: string,
    managerChatId: string
  ): Promise<{ success: boolean; error?: string; botUsername?: string }> => {
    try {
      const res = await apiFetch('/api/v1/telegram/settings', {
        method: 'POST',
        body: JSON.stringify({ botToken, managerChatId }),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data?.success) {
        if (data.settings) {
          setTelegramSettings(data.settings);
        } else {
          setTelegramSettings({
            isConfigured: true,
            botToken: botToken.trim(),
            managerChatId: managerChatId.trim(),
            botUsername: data.botUsername,
            updatedAt: new Date().toISOString(),
          });
        }
        return { success: true, botUsername: data.botUsername };
      }
      return { success: false, error: data?.error?.message || 'Не удалось сохранить настройки Telegram' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Ошибка сети при сохранении настроек Telegram' };
    }
  };

  const testTelegramConnection = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/telegram/test', {
        method: 'POST',
      });
      const { ok, data } = await safeJson(res);
      if (ok && data?.success) {
        return { success: true };
      }
      return { success: false, error: data?.error?.message || 'Тестовое сообщение не доставлено' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Ошибка сети при проверке Telegram' };
    }
  };

  const disconnectTelegram = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/v1/telegram/settings', {
        method: 'DELETE',
      });
      const { ok, data } = await safeJson(res);
      if (ok && data?.success) {
        setTelegramSettings({
          isConfigured: false,
          botToken: '',
          managerChatId: '',
        });
        return { success: true };
      }
      return { success: false, error: data?.error?.message || 'Ошибка при отключении Telegram' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Ошибка сети при отключении Telegram' };
    }
  };

  const saveRates = useCallback(async (newRates: any) => {
    try {
      const res = await apiFetch('/api/v1/rates', {
        method: 'POST',
        body: JSON.stringify(newRates),
      });
      const { ok, data } = await safeJson(res);
      if (ok && data.success) {
        setRates(data.rates);
        return { success: true };
      }
      return { success: false, error: data.error?.message || 'Ошибка сохранения ставок на сервере' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка сети при сохранении ставок' };
    }
  }, [apiFetch]);

  // Pickup Points / Склады Management (Up to 30)
  const addPickupPoint = async (data: {
    name: string;
    code?: string;
    address?: string;
    assignedStaffIds?: string[];
    contactPhone?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    qrSecret?: string;
    zones?: string[];
  }): Promise<{ success: boolean; error?: string }> => {
    const maxLocationsLimit = authSession?.subscription?.maxLocations ?? 30;
    const activeLocsCount = pickupPoints.filter(p => !p.isArchived).length;
    if (activeLocsCount >= maxLocationsLimit) {
      return {
        success: false,
        error: `Достигнут лимит вашего тарифа (${maxLocationsLimit} складов / ПВЗ). Перейдите на более высокий тариф в разделе «Тариф и оплата».`,
      };
    }
    if (!data.name || !data.name.trim()) {
      return { success: false, error: 'Укажите название склада.' };
    }

    const pointCode = (data.code?.trim() || `СК-${pickupPoints.length + 1}`).slice(0, 18).toUpperCase();
    const tempId = `wh-${Date.now().toString(36)}`;
    const tempLoc: PickupPoint = {
      id: tempId,
      code: pointCode,
      name: data.name.trim().slice(0, 30),
      address: data.address?.trim() || '',
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radiusMeters || 300,
      qrSecret: data.qrSecret || `SKLAD-${pointCode}`,
      zones: data.zones || ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения'],
      active: true,
      assignedStaffIds: data.assignedStaffIds || [],
      contactPhone: data.contactPhone?.trim() || '',
      notes: data.notes?.trim() || '',
      createdAt: new Date().toISOString(),
    };

    // Optimistic local update so UI updates with zero delay
    setPickupPoints(prev => [...prev, tempLoc]);

    try {
      const payload = {
        name: data.name.trim().slice(0, 30),
        code: pointCode,
        address: data.address?.trim() || '',
        latitude: data.latitude,
        longitude: data.longitude,
        radiusMeters: data.radiusMeters || 300,
        qrSecret: data.qrSecret || `SKLAD-${pointCode}`,
        zones: data.zones || ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения'],
        active: true,
        assignedStaffIds: data.assignedStaffIds || [],
        contactPhone: data.contactPhone?.trim() || '',
        notes: data.notes?.trim() || '',
      };

      const res = await apiFetch('/api/v1/locations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const { ok, data: resData } = await safeJson(res);

      if (ok && resData.success && Array.isArray(resData.locations)) {
        setPickupPoints(resData.locations);

        if (Array.isArray(data.assignedStaffIds) && data.assignedStaffIds.length > 0) {
          // Perform staff credentials sync asynchronously in the background
          Promise.all(
            data.assignedStaffIds.map(async (staffId) => {
              const staff = staffList.find(s => s.id === staffId);
              if (staff) {
                const currentLocs = staff.locations || (staff.location ? [staff.location] : []);
                if (!currentLocs.includes(pointCode)) {
                  await updateEmployeeCredentials(staff.id, staff.login || staff.name, undefined, [...currentLocs, pointCode], staff.isPartTime, staff.isSenior);
                }
              }
            })
          ).catch(err => console.warn('[AppContext] Background staff sync error:', err));
        }
        return { success: true };
      }

      if (!ok || (resData && resData.success === false)) {
        // Rollback optimistic update
        setPickupPoints(prev => prev.filter(l => l.id !== tempId));
        const errorMsg = typeof resData?.error === 'string' ? resData.error : resData?.error?.message || 'Не удалось сохранить склад';
        return { success: false, error: errorMsg };
      }

      return { success: true };
    } catch (err: any) {
      setPickupPoints(prev => prev.filter(l => l.id !== tempId));
      return { success: false, error: err.message || 'Ошибка создания склада' };
    }
  };

  const updatePickupPoint = async (
    id: string,
    patch: Partial<PickupPoint>
  ): Promise<{ success: boolean; error?: string }> => {
    // Snapshot for possible rollback
    const prevPoints = [...pickupPoints];

    // Optimistic local update so UI updates immediately
    setPickupPoints(prev => prev.map(l => (l.id === id || l.code === id || l.code?.toLowerCase() === id.toLowerCase() ? { ...l, ...patch } : l)));

    try {
      const res = await apiFetch(`/api/v1/locations/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      const { ok, data: resData } = await safeJson(res);
      if (ok && resData.success && Array.isArray(resData.locations)) {
        setPickupPoints(resData.locations);

        if (Array.isArray(patch.assignedStaffIds)) {
          const point = resData.locations.find((p: any) => p.id === id || p.code === id || p.code?.toLowerCase() === id.toLowerCase());
          const locCode = patch.code || point?.code;
          if (locCode) {
            // Background staff sync in parallel without blocking the UI
            Promise.all(
              staffList.map(async (staff) => {
                const shouldHave = patch.assignedStaffIds!.includes(staff.id);
                const currentLocs = staff.locations || (staff.location ? [staff.location] : []);
                const hasIt = currentLocs.includes(locCode);

                if (shouldHave && !hasIt) {
                  await updateEmployeeCredentials(staff.id, staff.login || staff.name, undefined, [...currentLocs, locCode], staff.isPartTime, staff.isSenior);
                } else if (!shouldHave && hasIt) {
                  const filtered = currentLocs.filter(l => l !== locCode);
                  if (filtered.length > 0) {
                    await updateEmployeeCredentials(staff.id, staff.login || staff.name, undefined, filtered, staff.isPartTime, staff.isSenior);
                  }
                }
              })
            ).catch(err => console.warn('[AppContext] Background staff sync error:', err));
          }
        }

        return { success: true };
      }

      if (!ok || (resData && resData.success === false)) {
        // Rollback
        setPickupPoints(prevPoints);
        const errorMsg = resData?.error?.message || resData?.error || 'Не удалось обновить склад на сервере';
        return { success: false, error: errorMsg };
      }

      return { success: true };
    } catch (err: any) {
      setPickupPoints(prevPoints);
      return { success: false, error: err.message || 'Ошибка обновления склада' };
    }
  };

  const archivePickupPoint = async (id: string): Promise<{ success: boolean; error?: string }> => {
    return updatePickupPoint(id, { isArchived: true, active: false, archivedAt: new Date().toISOString() });
  };

  const restorePickupPoint = async (id: string): Promise<{ success: boolean; error?: string }> => {
    return updatePickupPoint(id, { isArchived: false, active: true, archivedAt: undefined });
  };

  const deletePickupPoint = async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const pointToDelete = pickupPoints.find(p => p.id === id || p.code === id || p.code.toLowerCase() === id.toLowerCase());
      const targetParam = pointToDelete?.id || id;
      const res = await apiFetch(`/api/v1/locations/${encodeURIComponent(targetParam)}`, {
        method: 'DELETE',
      });
      const { ok, data: resData } = await safeJson(res);
      if (ok && resData && resData.success && Array.isArray(resData.locations)) {
        setPickupPoints(resData.locations);
        await refreshData();
        return { success: true };
      }

      if (!ok || (resData && resData.success === false)) {
        const errorMsg = resData?.error?.message || resData?.error || 'Не удалось удалить склад на сервере';
        return { success: false, error: errorMsg };
      }

      // Fallback local update
      const updated = pickupPoints.filter(l => l.id !== id && l.code !== id && l.code.toLowerCase() !== id.toLowerCase());
      setPickupPoints(updated);
      await refreshData();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Ошибка удаления склада' };
    }
  };

  const assignStaffToPickupPoint = async (pointId: string, staffIds: string[]): Promise<{ success: boolean; error?: string }> => {
    const point = pickupPoints.find(p => p.id === pointId || p.code === pointId);
    const locCode = point?.code;

    const res = await updatePickupPoint(pointId, { assignedStaffIds: staffIds });
    if (!res.success) return res;

    if (locCode) {
      for (const staff of staffList) {
        const shouldHave = staffIds.includes(staff.id);
        const currentLocs = staff.locations || (staff.location ? [staff.location] : []);
        const hasIt = currentLocs.includes(locCode);

        if (shouldHave && !hasIt) {
          const updatedLocs = [...currentLocs, locCode];
          await updateEmployeeCredentials(staff.id, staff.login || staff.name, undefined, updatedLocs, staff.isPartTime, staff.isSenior);
        } else if (!shouldHave && hasIt) {
          const updatedLocs = currentLocs.filter(l => l !== locCode);
          if (updatedLocs.length > 0) {
            await updateEmployeeCredentials(staff.id, staff.login || staff.name, undefined, updatedLocs, staff.isPartTime, staff.isSenior);
          }
        }
      }
    }

    return { success: true };
  };

  return (
    <AppContext.Provider
      value={{
        authStatus,
        authSession,
        organization: authSession?.organization || null,
        subscription: authSession?.subscription || null,
        isReadOnlyWorkspace: Boolean(authSession?.subscription?.isReadOnly),
        billingModalOpen,
        setBillingModalOpen,
        currentRole,
        currentStaffId,
        currentStaff,
        staffList,
        records,
        cancelledDates,
        applications,
        messages,
        notifications,
        restartLogs,
        isBotRestarting,
        mskTime,
        todayDate,
        csrfToken,
        swaps,
        schedules,
        scheduleTemplates,
        availability,
        incomeGoals,
        openingAlerts,
        login,
        logout,
        registerManager,
        createOrganization,
        updateOrganization,
        refreshOrganization,
        refreshData: () => refreshData(),
        warehousePositions,
        fetchWarehousePositions,
        addWarehousePosition,
        createEmployeeAccount,
        updateEmployeeCredentials,
        toggleEmployeeAccess,
        switchStaff,
        performCheckIn,
        performCheckOut,
        cancelCheckIn,
        submitSales,
        sendMessageToManager,
        replyToMessage,
        submitRegistration,
        handleApplication,
        deactivateStaff,
        restoreStaff,
        archiveStaff,
        deleteStaffPermanently,
        sendThankYou,
        restartBot,
        markMessageRead,
        markNotificationRead,
        markAllNotificationsRead,
        markAllMessagesRead,
        dismissNotification,
        resetLocalUIState,
        resetToDefaults: resetLocalUIState,
        sendReportToTelegram,
        rates,
        saveRates,
        managerAddOrUpdateShift,
        managerDeleteShift,
        createSwapRequest,
        claimSwapRequest,
        approveSwapRequest,
        rejectSwapRequest,
        cancelSwapRequest,
        updateSwapRequest,
        savePlannedShift,
        saveSlotShifts,
        deletePlannedShift,
        clearMonthSchedules,
        saveScheduleBatch,
        publishSchedule,
        saveScheduleTemplate,
        deleteScheduleTemplate,
        setAvailability,
        deleteAvailability,
        updateAvailabilityStatus,
        saveIncomeGoal,
        paybackRecords,
        paybackTemplates,
        savePaybackRecord,
        savePaybackArticle,
        deletePaybackRecord,
        checkOpeningAlerts,
        pickupPoints,
        addPickupPoint,
        updatePickupPoint,
        archivePickupPoint,
        restorePickupPoint,
        deletePickupPoint,
        assignStaffToPickupPoint,
        apiFetch,
        telegramSettings,
        fetchTelegramSettings,
        saveTelegramSettings,
        testTelegramConnection,
        disconnectTelegram,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
