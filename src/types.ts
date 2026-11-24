export type ShiftType =
  | 'day12'
  | 'night12'
  | 'standard8'
  | 'part4'
  | 'part6'
  | 'daily24'
  | 'standard'
  | '400+'
  | '500+'
  | '8h'
  | '4h'
  | 'rate400'
  | 'rate500'
  | 'shift8h'
  | 'shift4h'
  | (string & {});

export const SHIFT_LABELS: Record<string, string> = {
  'day12': 'Дневная смена (12ч)',
  'night12': 'Ночная смена (12ч)',
  'standard8': 'Стандартная (8ч)',
  'part4': 'Подработка (4ч)',
  'part6': 'Подработка (6ч)',
  'daily24': 'Суточная (24ч)',
  // Backwards compatibility for legacy records
  'standard': 'Дневная смена (12ч)',
  '400+': 'Дневная (усиленная)',
  '500+': 'Смена (пиковая)',
  '8h': '8 часов',
  '4h': '4 часа',
  'rate400': 'Дневная смена',
  'rate500': 'Ночная смена',
  'shift8h': '8 часов',
  'shift4h': '4 часа',
};

export const DEFAULT_WAREHOUSE_POSITIONS = [
  'Начальник склада',
  'Кладовщик',
  'Сборщик',
  'Упаковщик',
  'Сборщик/упаковщик',
  'Грузчик',
  'Приемщик',
  'Охранник',
  'Администратор',
  'Разнорабочий',
  'Работник склада',
] as const;

export type WarehousePosition = typeof DEFAULT_WAREHOUSE_POSITIONS[number] | (string & {});

export type StaffStatus = 'pending' | 'active' | 'deactivated' | 'blocked' | 'archived';

export interface CategorySales {
  cash: number;
  card: number;
}

export interface DailySales {
  cash?: number;
  card?: number;
  total?: number;
  photo?: CategorySales;
  print?: CategorySales;
  lamination?: CategorySales;
}

/**
 * Warehouse / Location Model (formerly PickupPoint)
 */
export interface PickupPoint {
  id: string;
  code: string; // e.g. "СК-1", "СК-СЕВЕР", "ТЕРМ-А"
  name: string; // e.g. "Склад Северный (Терминал А)"
  address?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number; // default radius for geo-verification (e.g. 250m)
  qrSecret?: string; // Secret token encoded in warehouse QR code
  zones?: string[]; // e.g. ['Приёмка', 'Комплектация', 'Упаковка', 'Отгрузка']
  active: boolean;
  isArchived?: boolean;
  archivedAt?: string;
  assignedStaffIds?: string[];
  contactPhone?: string;
  notes?: string;
  createdAt?: string;
}

// Alias for clear semantics
export type Warehouse = PickupPoint;

export type LocationType = string;

export interface CheckInRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  shiftType: ShiftType | null;
  location?: LocationType; // Warehouse code e.g. "СК-1"
  zone?: string; // Warehouse zone e.g. "Приёмка", "Сборка"
  checkedInAt?: string; // ISO string
  checkOutAt?: string; // ISO string for shift completion
  workedHours?: number; // Calculated hours worked
  breakMinutes?: number; // Default 60 minutes lunch/break
  timestamp?: string; // fallback historical ISO string
  editCount?: number;
  cancelCount?: number;
  qrVerified?: boolean; // Verified with warehouse QR
  geoVerified?: boolean; // Verified with warehouse GPS coordinates
  isNightShift?: boolean; // Whether the shift had night hours
  calculatedSalary?: number; // Total calculated salary for this shift
  notes?: string;
  baseRate?: number;
  // Legacy fields kept optional for non-breaking backward compatibility
  initialCash?: number;
  finalCash?: number;
  collectedCash?: number;
  cashNotes?: string;
  sales?: DailySales | null;
  salesSubmittedAt?: string;
}

export interface ShiftSwapRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  date: string; // YYYY-MM-DD
  shiftType: ShiftType;
  location: LocationType;
  reason?: string;
  candidateId?: string;
  candidateName?: string;
  status: 'open' | 'claimed' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
  resolvedAt?: string;
}

export interface PlannedShift {
  id: string;
  date: string; // YYYY-MM-DD
  location: LocationType;
  employeeId: string;
  employeeName: string;
  shiftType: ShiftType;
  zone?: string;
  note?: string;
  createdAt?: string;
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  location: string;
  scenarioType: '2/2' | '3/3' | '2/2+P' | '5/2' | 'custom';
  mainStaffIds: string[];
  partTimeStaffIds?: string[];
  defaultShiftType?: ShiftType;
  notes?: string;
  createdAt: string;
}

export interface AvailabilityRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  type: 'unavailable' | 'vacation' | 'study' | 'sick' | 'preferred';
  comment?: string;
  createdAt: string;
  status?: 'pending' | 'approved' | 'rejected';
}

export interface IncomeGoal {
  employeeId: string;
  month: string; // YYYY-MM
  targetAmount: number;
}

export interface StaffMember {
  id: string;
  name: string;
  login: string;
  hasAccess: boolean;
  telegramUsername?: string;
  role: 'employee';
  status: StaffStatus;
  registeredAt: string;
  locations: LocationType[];
  location?: LocationType; // fallback for legacy data
  position?: string; // Должность (Кладовщик, Сборщик, Грузчик и т.д.)
  payType?: 'hourly' | 'shift'; // Тип оплаты: почасовая или за смену
  hourlyRate?: number; // Почасовая ставка (руб/час)
  shiftRate?: number; // Фиксированная ставка за смену (руб/смена)
  nightRate?: number; // Ночная ставка или надбавка
  isPartTime?: boolean; // статус "Подработчик"
  isSenior?: boolean; // статус старшего сотрудника / бригадира
  password?: string;
}

export type SubscriptionStatus = 'demo' | 'trial' | 'active' | 'expired_readonly';

export interface OrganizationInfo {
  id: string;
  name: string;
  slug?: string;
  inn?: string;
  timezone: string;
  ownerUserId?: string;
  createdAt?: string;
}

export interface SubscriptionInfo {
  id: string;
  organizationId: string;
  tariffId: 'start' | 'business' | 'maximum';
  tariffName: string;
  status: SubscriptionStatus;
  billingPeriodMonths: 1 | 3 | 6 | 12;
  maxLocations: number;
  maxStaff: number;
  trialStartedAt?: string;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  daysRemaining?: number;
  hoursRemaining?: number;
  showTrialDay4Warning?: boolean;
  isReadOnly: boolean;
  selectedTariffId?: 'start' | 'business' | 'maximum';
  selectedPeriodMonths?: 1 | 3 | 6 | 12;
}

export interface BillingPaymentItem {
  id: string;
  tariffId: 'start' | 'business' | 'maximum';
  periodMonths: 1 | 3 | 6 | 12;
  discountPercent: number;
  amountRub: number;
  paymentMethod: 'card' | 'sbp' | 'invoice' | 'yandex_split';
  provider: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled' | 'failed';
  invoiceNumber?: string;
  confirmationUrl?: string;
  createdAt: string;
  paidAt?: string;
}

export interface AuthSession {
  role: 'manager' | 'employee';
  staffId?: string;
  name: string;
  login: string;
  email?: string;
  phone?: string;
  organizationId?: string | null;
  orgRole?: 'owner' | 'manager' | 'employee' | null;
  organization?: OrganizationInfo | null;
  subscription?: SubscriptionInfo | null;
  locations?: LocationType[];
  position?: string;
  payType?: 'hourly' | 'shift';
  hourlyRate?: number;
  shiftRate?: number;
  nightRate?: number;
  isPartTime?: boolean;
  isSenior?: boolean;
  telegramUsername?: string;
}

export interface ApplicationRequest {
  id: string;
  name: string;
  position?: string;
  phone?: string;
  telegramUsername?: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'accepted' | 'rejected' | 'cancelled';
  decidedAt?: string;
  note?: string;
  generatedLogin?: string;
  submittedAt?: string;
}

export interface ManagerMessage {
  id: string;
  fromEmployeeId: string;
  fromEmployeeName: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface StaffNotification {
  id: string;
  toEmployeeId: string | 'all';
  title: string;
  text: string;
  type: 'status_update' | 'thank_you' | 'reminder' | 'system' | 'report';
  timestamp: string;
  read: boolean;
  location?: string;
}

export interface BotRestartLog {
  id: string;
  timestamp: string;
  initiatedBy: string;
  status: 'success' | 'running' | 'failed';
  outputLogs: string[];
}

export interface PaybackArticleItem {
  id: string;
  name: string;
  amount: number;
  isDefault?: boolean;
}

export interface PaybackPvzRecord {
  pvzCode: string;
  month: string;
  incomes: PaybackArticleItem[];
  expenses: PaybackArticleItem[];
  updatedAt?: string;
}

export interface PaybackArticleTemplates {
  incomeArticles?: string[];
  expenseArticles?: string[];
  customIncomeArticles?: string[];
  customExpenseArticles?: string[];
}

export interface TelegramSettings {
  isConfigured: boolean;
  botToken: string;
  managerChatId: string;
  botUsername?: string;
  updatedAt?: string;
}
