import React, { useState } from 'react';
import { AppContext, AppContextType } from './AppContext';
import {
  ApplicationRequest,
  AvailabilityRequest,
  CheckInRecord,
  DEFAULT_WAREHOUSE_POSITIONS,
  IncomeGoal,
  ManagerMessage,
  PaybackPvzRecord,
  PickupPoint,
  PlannedShift,
  ScheduleTemplate,
  ShiftSwapRequest,
  StaffMember,
  StaffNotification,
} from '../types';
import { formatMoscowDate, formatMoscowTime } from '../utils/time';

interface DemoAppProviderProps {
  demoRole: 'manager' | 'employee';
  onBlockedAction?: (reason: string) => void;
  children: React.ReactNode;
}

const DEMO_MSG =
  'Демонстрационный режим работает только для просмотра. Нажмите «Запустить 7 дней бесплатно», чтобы работать со своими складами и сотрудниками.';

export const DemoAppProvider: React.FC<DemoAppProviderProps> = ({
  demoRole,
  onBlockedAction,
  children,
}) => {
  const [billingModalOpen, setBillingModalOpen] = useState(false);
  const todayDate = formatMoscowDate();
  const mskTime = formatMoscowTime();
  const monthPrefix = todayDate.slice(0, 7);

  const dayOffset = (offsetDays: number) => {
    const base = new Date(`${todayDate}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + offsetDays);
    return base.toISOString().slice(0, 10);
  };

  const pickupPoints: PickupPoint[] = [
    {
      id: 'demo-wh-1',
      code: 'СК-СЕВЕР',
      name: 'Склад Север (Фулфилмент)',
      address: 'г. Москва, Дмитровское ш., 108Б',
      latitude: 55.8871,
      longitude: 37.5419,
      radiusMeters: 300,
      qrSecret: 'DEMO-SK-SEVER',
      zones: ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка'],
      active: true,
      assignedStaffIds: ['demo-emp-1', 'demo-emp-2', 'demo-emp-3'],
      contactPhone: '',
      notes: 'Демонстрационный объект для ознакомления с интерфейсом',
      createdAt: `${monthPrefix}-01T09:00:00.000Z`,
    },
    {
      id: 'demo-wh-2',
      code: 'СК-ЮГ',
      name: 'Терминал Юг (ПВЗ и сортировка)',
      address: 'г. Москва, Варшавское ш., 132',
      latitude: 55.6192,
      longitude: 37.6061,
      radiusMeters: 250,
      qrSecret: 'DEMO-SK-YUG',
      zones: ['Приёмка', 'Выдача заказов', 'Хранение'],
      active: true,
      assignedStaffIds: ['demo-emp-2', 'demo-emp-4', 'demo-emp-5'],
      contactPhone: '',
      notes: 'Второй демонстрационный объект',
      createdAt: `${monthPrefix}-01T09:00:00.000Z`,
    },
  ];

  const staffList: StaffMember[] = [
    {
      id: 'demo-emp-1',
      name: 'Алексей Смирнов',
      login: 'smirnov',
      hasAccess: true,
      role: 'employee',
      status: 'active',
      registeredAt: `${monthPrefix}-01T08:00:00.000Z`,
      locations: ['СК-СЕВЕР'],
      location: 'СК-СЕВЕР',
      position: 'Старший кладовщик',
      payType: 'shift',
      hourlyRate: 380,
      shiftRate: 4000,
      nightRate: 600,
      isSenior: true,
      isPartTime: false,
      telegramUsername: '@smirnov_demo',
    },
    {
      id: 'demo-emp-2',
      name: 'Мария Козлова',
      login: 'kozlova',
      hasAccess: true,
      role: 'employee',
      status: 'active',
      registeredAt: `${monthPrefix}-01T08:15:00.000Z`,
      locations: ['СК-СЕВЕР', 'СК-ЮГ'],
      location: 'СК-СЕВЕР',
      position: 'Сборщик заказов',
      payType: 'hourly',
      hourlyRate: 360,
      shiftRate: 3600,
      nightRate: 500,
      isSenior: false,
      isPartTime: false,
    },
    {
      id: 'demo-emp-3',
      name: 'Дмитрий Волков',
      login: 'volkov',
      hasAccess: true,
      role: 'employee',
      status: 'active',
      registeredAt: `${monthPrefix}-02T09:00:00.000Z`,
      locations: ['СК-СЕВЕР'],
      location: 'СК-СЕВЕР',
      position: 'Водитель погрузчика',
      payType: 'shift',
      hourlyRate: 400,
      shiftRate: 4200,
      nightRate: 700,
      isSenior: false,
      isPartTime: false,
    },
    {
      id: 'demo-emp-4',
      name: 'Елена Соколова',
      login: 'sokolova',
      hasAccess: true,
      role: 'employee',
      status: 'active',
      registeredAt: `${monthPrefix}-02T10:00:00.000Z`,
      locations: ['СК-ЮГ'],
      location: 'СК-ЮГ',
      position: 'Упаковщик',
      payType: 'hourly',
      hourlyRate: 340,
      shiftRate: 3400,
      nightRate: 0,
      isSenior: false,
      isPartTime: false,
    },
    {
      id: 'demo-emp-5',
      name: 'Артём Морозов',
      login: 'morozov',
      hasAccess: true,
      role: 'employee',
      status: 'active',
      registeredAt: `${monthPrefix}-03T11:00:00.000Z`,
      locations: ['СК-ЮГ'],
      location: 'СК-ЮГ',
      position: 'Подработчик (приёмка)',
      payType: 'hourly',
      hourlyRate: 350,
      shiftRate: 2100,
      nightRate: 0,
      isSenior: false,
      isPartTime: true,
    },
  ];

  const records: CheckInRecord[] = [
    {
      id: 'demo-rec-1',
      employeeId: 'demo-emp-1',
      employeeName: 'Алексей Смирнов',
      date: todayDate,
      shiftType: 'day12',
      location: 'СК-СЕВЕР',
      checkedInAt: `${todayDate}T08:56:00.000Z`,
      qrVerified: true,
      geoVerified: true,
      zone: 'Приёмка',
      timestamp: `${todayDate}T08:56:00.000Z`,
    },
    {
      id: 'demo-rec-2',
      employeeId: 'demo-emp-2',
      employeeName: 'Мария Козлова',
      date: todayDate,
      shiftType: 'standard8',
      location: 'СК-СЕВЕР',
      checkedInAt: `${todayDate}T09:02:00.000Z`,
      qrVerified: true,
      geoVerified: true,
      zone: 'Сборка',
      timestamp: `${todayDate}T09:02:00.000Z`,
    },
    {
      id: 'demo-rec-3',
      employeeId: 'demo-emp-4',
      employeeName: 'Елена Соколова',
      date: todayDate,
      shiftType: 'day12',
      location: 'СК-ЮГ',
      checkedInAt: `${todayDate}T08:59:00.000Z`,
      qrVerified: true,
      geoVerified: true,
      zone: 'Упаковка',
      timestamp: `${todayDate}T08:59:00.000Z`,
    },
    {
      id: 'demo-rec-4',
      employeeId: 'demo-emp-1',
      employeeName: 'Алексей Смирнов',
      date: dayOffset(-1),
      shiftType: 'day12',
      location: 'СК-СЕВЕР',
      checkedInAt: `${dayOffset(-1)}T09:00:00.000Z`,
      checkOutAt: `${dayOffset(-1)}T21:05:00.000Z`,
      breakMinutes: 60,
      workedHours: 11,
      qrVerified: true,
      geoVerified: true,
      zone: 'Приёмка',
      timestamp: `${dayOffset(-1)}T21:05:00.000Z`,
    },
    {
      id: 'demo-rec-5',
      employeeId: 'demo-emp-2',
      employeeName: 'Мария Козлова',
      date: dayOffset(-1),
      shiftType: 'day12',
      location: 'СК-ЮГ',
      checkedInAt: `${dayOffset(-1)}T09:04:00.000Z`,
      checkOutAt: `${dayOffset(-1)}T21:00:00.000Z`,
      breakMinutes: 60,
      workedHours: 11,
      qrVerified: true,
      geoVerified: false,
      zone: 'Выдача заказов',
      timestamp: `${dayOffset(-1)}T21:00:00.000Z`,
    },
    {
      id: 'demo-rec-6',
      employeeId: 'demo-emp-3',
      employeeName: 'Дмитрий Волков',
      date: dayOffset(-2),
      shiftType: 'night12',
      location: 'СК-СЕВЕР',
      checkedInAt: `${dayOffset(-2)}T21:00:00.000Z`,
      checkOutAt: `${dayOffset(-1)}T09:00:00.000Z`,
      breakMinutes: 60,
      workedHours: 11,
      qrVerified: true,
      geoVerified: true,
      zone: 'Отгрузка',
      timestamp: `${dayOffset(-1)}T09:00:00.000Z`,
    },
    {
      id: 'demo-rec-7',
      employeeId: 'demo-emp-5',
      employeeName: 'Артём Морозов',
      date: dayOffset(-2),
      shiftType: 'part6',
      location: 'СК-ЮГ',
      checkedInAt: `${dayOffset(-2)}T14:00:00.000Z`,
      checkOutAt: `${dayOffset(-2)}T20:00:00.000Z`,
      breakMinutes: 0,
      workedHours: 6,
      qrVerified: false,
      geoVerified: true,
      zone: 'Приёмка',
      timestamp: `${dayOffset(-2)}T20:00:00.000Z`,
    },
  ];

  const schedules: PlannedShift[] = [
    {
      id: 'demo-sch-1',
      date: todayDate,
      location: 'СК-СЕВЕР',
      employeeId: 'demo-emp-1',
      employeeName: 'Алексей Смирнов',
      shiftType: 'day12',
      note: 'Приёмка утренней поставки',
    },
    {
      id: 'demo-sch-2',
      date: todayDate,
      location: 'СК-СЕВЕР',
      employeeId: 'demo-emp-2',
      employeeName: 'Мария Козлова',
      shiftType: 'standard8',
    },
    {
      id: 'demo-sch-3',
      date: dayOffset(1),
      location: 'СК-СЕВЕР',
      employeeId: 'demo-emp-3',
      employeeName: 'Дмитрий Волков',
      shiftType: 'day12',
    },
    {
      id: 'demo-sch-4',
      date: dayOffset(1),
      location: 'СК-ЮГ',
      employeeId: 'demo-emp-4',
      employeeName: 'Елена Соколова',
      shiftType: 'day12',
    },
    {
      id: 'demo-sch-5',
      date: dayOffset(2),
      location: 'СК-ЮГ',
      employeeId: 'demo-emp-5',
      employeeName: 'Артём Морозов',
      shiftType: 'part6',
    },
  ];

  const swaps: ShiftSwapRequest[] = [
    {
      id: 'demo-swap-1',
      date: dayOffset(2),
      location: 'СК-СЕВЕР',
      shiftType: 'day12',
      requesterId: 'demo-emp-2',
      requesterName: 'Мария Козлова',
      status: 'open',
      reason: 'Семейные обстоятельства, нужна подмена на 1 смену',
      createdAt: `${todayDate}T08:30:00.000Z`,
    },
    {
      id: 'demo-swap-2',
      date: dayOffset(3),
      location: 'СК-ЮГ',
      shiftType: 'day12',
      requesterId: 'demo-emp-4',
      requesterName: 'Елена Соколова',
      candidateId: 'demo-emp-5',
      candidateName: 'Артём Морозов',
      status: 'claimed',
      reason: 'Прошу перенести смену на коллегу',
      createdAt: `${dayOffset(-1)}T16:10:00.000Z`,
    },
  ];

  const scheduleTemplates: ScheduleTemplate[] = [
    {
      id: 'demo-tpl-1',
      name: 'Основная бригада 2/2 (Север)',
      location: 'СК-СЕВЕР',
      scenarioType: '2/2',
      mainStaffIds: ['demo-emp-1', 'demo-emp-2'],
      defaultShiftType: 'day12',
      createdAt: `${monthPrefix}-01T10:00:00.000Z`,
    },
  ];

  const availability: AvailabilityRequest[] = [
    {
      id: 'demo-av-1',
      employeeId: 'demo-emp-3',
      employeeName: 'Дмитрий Волков',
      date: dayOffset(4),
      type: 'preferred',
      comment: 'Готов выйти в дневную смену',
      createdAt: `${todayDate}T07:00:00.000Z`,
      status: 'approved',
    },
  ];

  const incomeGoals: IncomeGoal[] = [
    { employeeId: 'demo-emp-1', month: monthPrefix, targetAmount: 65000 },
  ];

  const applications: ApplicationRequest[] = [
    {
      id: 'demo-app-1',
      name: 'Игорь Никитин',
      position: 'Комплектовщик',
      telegramUsername: '@nikitin_demo',
      createdAt: `${todayDate}T09:15:00.000Z`,
      status: 'pending',
    },
  ];

  const messages: ManagerMessage[] = [
    {
      id: 'demo-msg-1',
      fromEmployeeId: 'demo-emp-2',
      fromEmployeeName: 'Мария Козлова',
      message: 'Здравствуйте! Разместила заявку на биржу смен на послезавтра, посмотрите пожалуйста.',
      timestamp: `${todayDate}T09:05:00.000Z`,
      read: false,
    },
  ];

  const notifications: StaffNotification[] = [
    {
      id: 'demo-notif-1',
      toEmployeeId: 'all',
      title: 'Демонстрационный контур SKLADIN',
      text: 'Все данные в разделе /demo отображаются в изолированном режиме просмотра и не записываются в рабочую базу.',
      type: 'system',
      timestamp: `${todayDate}T08:00:00.000Z`,
      read: false,
    },
  ];

  const paybackRecords: PaybackPvzRecord[] = [
    {
      pvzCode: 'СК-СЕВЕР',
      month: monthPrefix,
      incomes: [{ id: 'inc-1', name: 'Выручка фулфилмента', amount: 420000 }],
      expenses: [
        { id: 'exp-1', name: 'Аренда склада', amount: 145000 },
        { id: 'exp-2', name: 'ФОТ персонала', amount: 162000 },
      ],
      updatedAt: `${todayDate}T10:00:00.000Z`,
    },
  ];

  const rates = {
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
    ],
    bonuses: [
      { code: 'seniorBonus', name: 'Доплата Старшему (Ст.С.)', value: 500, isArchived: false, target: 'senior' },
    ],
  };

  const blockedResult = async (actionLabel?: string): Promise<{ success: boolean; error?: string }> => {
    const msg = actionLabel
      ? `Действие «${actionLabel}» недоступно в демо-режиме. ${DEMO_MSG}`
      : DEMO_MSG;
    onBlockedAction?.(msg);
    return { success: false, error: msg };
  };

  const blockedBool = async (actionLabel?: string): Promise<boolean> => {
    await blockedResult(actionLabel);
    return false;
  };

  const blockedVoid = async () => {
    onBlockedAction?.(DEMO_MSG);
  };

  const demoOrganization = {
    id: 'demo-org',
    name: 'Демо-склад «Логистика Про»',
    timezone: 'Europe/Moscow',
  };

  const demoSubscription = {
    id: 'demo-sub',
    organizationId: 'demo-org',
    tariffId: 'business' as const,
    tariffName: 'Бизнес (Демо)',
    status: 'demo' as const,
    billingPeriodMonths: 1 as const,
    maxLocations: 2,
    maxStaff: 5,
    isReadOnly: true,
  };

  const currentEmployee = staffList[0];

  const contextValue: AppContextType = {
    authStatus: 'AUTHENTICATED',
    authSession: {
      role: demoRole,
      staffId: demoRole === 'manager' ? 'demo-manager' : currentEmployee.id,
      name: demoRole === 'manager' ? 'Демо Руководитель' : currentEmployee.name,
      login: demoRole === 'manager' ? 'demo-manager' : currentEmployee.login,
      organizationId: 'demo-org',
      orgRole: demoRole === 'manager' ? 'owner' : 'employee',
      organization: demoOrganization,
      subscription: demoSubscription,
      locations: demoRole === 'manager' ? ['СК-СЕВЕР', 'СК-ЮГ'] : currentEmployee.locations,
      position: demoRole === 'manager' ? 'Начальник склада' : currentEmployee.position,
      payType: currentEmployee.payType,
      hourlyRate: currentEmployee.hourlyRate,
      shiftRate: currentEmployee.shiftRate,
      nightRate: currentEmployee.nightRate,
      isSenior: currentEmployee.isSenior,
      isPartTime: false,
    },
    organization: demoOrganization,
    subscription: demoSubscription,
    isReadOnlyWorkspace: true,
    billingModalOpen,
    setBillingModalOpen,
    currentRole: demoRole,
    currentStaffId: demoRole === 'manager' ? 'demo-manager' : currentEmployee.id,
    currentStaff: demoRole === 'employee' ? currentEmployee : undefined,
    staffList,
    records,
    cancelledDates: [],
    applications,
    messages,
    notifications,
    restartLogs: [],
    swaps,
    schedules,
    scheduleTemplates,
    availability,
    incomeGoals,
    paybackRecords,
    paybackTemplates: { customIncomeArticles: [], customExpenseArticles: [] },
    pickupPoints,
    openingAlerts: { success: true, missing: [] },
    isBotRestarting: false,
    mskTime,
    todayDate,
    csrfToken: 'demo',

    login: async () => blockedResult('Вход'),
    logout: async () => {},
    registerManager: async () => blockedResult('Регистрация'),
    createOrganization: async () => blockedResult('Создание организации'),
    updateOrganization: async () => blockedResult('Редактирование организации'),
    refreshOrganization: async () => {},
    refreshData: async () => {},

    warehousePositions: [...DEFAULT_WAREHOUSE_POSITIONS],
    fetchWarehousePositions: async () => [...DEFAULT_WAREHOUSE_POSITIONS],
    addWarehousePosition: async () => blockedResult('Добавление должности'),
    createEmployeeAccount: async () => blockedResult('Добавление сотрудника'),
    updateEmployeeCredentials: async () => blockedResult('Изменение сотрудника'),
    toggleEmployeeAccess: async () => blockedResult('Изменение доступа'),

    switchStaff: () => {},
    performCheckIn: async () => blockedResult('Отметка Check-in'),
    performCheckOut: async () => blockedResult('Завершение смены Check-out'),
    cancelCheckIn: async () => blockedResult('Отмена смены'),
    submitSales: async () => blockedResult('Сохранение кассы'),
    sendMessageToManager: async () => blockedBool('Отправка сообщения'),
    replyToMessage: async () => blockedResult('Ответ сотруднику'),
    submitRegistration: async () => blockedResult('Подача анкеты'),
    handleApplication: async () => blockedResult('Обработка анкеты'),
    deactivateStaff: async () => blockedResult('Деактивация сотрудника'),
    restoreStaff: async () => blockedResult('Восстановление сотрудника'),
    archiveStaff: async () => blockedResult('Архивация сотрудника'),
    deleteStaffPermanently: async () => blockedResult('Удаление сотрудника'),
    sendThankYou: blockedVoid,
    restartBot: blockedVoid,
    markMessageRead: blockedVoid,
    markNotificationRead: blockedVoid,
    markAllNotificationsRead: blockedVoid,
    markAllMessagesRead: blockedVoid,
    dismissNotification: blockedVoid,
    resetLocalUIState: () => {},
    resetToDefaults: () => {},
    sendReportToTelegram: async () => blockedResult('Отправка отчёта в Telegram'),
    rates,
    saveRates: async () => blockedResult('Сохранение тарифов и ставок'),
    managerAddOrUpdateShift: async () => blockedResult('Редактирование смены'),
    managerDeleteShift: async () => blockedResult('Удаление смены'),

    createSwapRequest: async () => blockedResult('Создание заявки на обмен'),
    claimSwapRequest: async () => blockedResult('Отклик на смену'),
    approveSwapRequest: async () => blockedResult('Одобрение обмена'),
    rejectSwapRequest: async () => blockedResult('Отклонение обмена'),
    cancelSwapRequest: async () => blockedResult('Отмена обмена'),
    updateSwapRequest: async () => blockedResult('Изменение заявки'),

    savePlannedShift: async () => blockedResult('Планирование смены'),
    saveSlotShifts: async () => blockedResult('Редактирование слота'),
    deletePlannedShift: async () => blockedResult('Удаление плановой смены'),
    clearMonthSchedules: async () => blockedResult('Очистка графика'),
    saveScheduleBatch: async () => blockedResult('Сохранение графика'),
    publishSchedule: async () => blockedResult('Публикация графика'),
    saveScheduleTemplate: async () => blockedResult('Сохранение шаблона'),
    deleteScheduleTemplate: async () => blockedResult('Удаление шаблона'),

    setAvailability: async () => blockedResult('Сохранение пожелания'),
    deleteAvailability: async () => blockedResult('Удаление пожелания'),
    updateAvailabilityStatus: async () => blockedResult('Обновление статуса пожелания'),
    saveIncomeGoal: async () => blockedResult('Сохранение цели дохода'),
    savePaybackRecord: async () => blockedResult('Сохранение финансового отчёта'),
    savePaybackArticle: async () => blockedResult('Изменение статьи'),
    deletePaybackRecord: async () => blockedResult('Удаление финансового отчёта'),
    checkOpeningAlerts: async () => ({ success: true, missing: [] }),

    addPickupPoint: async () => blockedResult('Добавление склада / ПВЗ'),
    updatePickupPoint: async () => blockedResult('Изменение склада / ПВЗ'),
    archivePickupPoint: async () => blockedResult('Архивация склада'),
    restorePickupPoint: async () => blockedResult('Восстановление склада'),
    deletePickupPoint: async () => blockedResult('Удаление склада'),
    assignStaffToPickupPoint: async () => blockedResult('Назначение сотрудников'),

    apiFetch: async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'DEMO_READONLY', message: DEMO_MSG },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),

    telegramSettings: {
      isConfigured: false,
      botToken: '',
      managerChatId: '',
    },
    fetchTelegramSettings: async () => null,
    saveTelegramSettings: async () => blockedResult('Настройка Telegram'),
    testTelegramConnection: async () => blockedResult('Тест Telegram'),
    disconnectTelegram: async () => blockedResult('Отключение Telegram'),
  };

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};
