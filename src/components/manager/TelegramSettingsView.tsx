import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  Edit2,
  Lock,
  Check,
  FileText,
  AlertTriangle,
} from 'lucide-react';

interface TelegramTemplateItem {
  id: string;
  name: string;
  description: string;
  variables: string[];
  template: string;
}

const DEFAULT_TEMPLATES: Record<string, TelegramTemplateItem> = {
  checkin: {
    id: 'checkin',
    name: 'Отметка Check-in',
    description: 'Уведомление руководителю о начале смены сотрудником на складе',
    variables: ['{employeeName}', '{location}', '{shiftType}', '{date}'],
    template: '🔔 *Новая отметка Check-in!*\n\n👤 *Сотрудник:* {employeeName}\n📍 *Склад:* {location}\n🕒 *Смена:* {shiftType}\n📅 *Дата:* {date}',
  },
  daily_report: {
    id: 'daily_report',
    name: 'Вечерний сводный отчет (21:15)',
    description: 'Итоговая сводка выручки по сотрудникам, наличным, картам и премиям',
    variables: ['{date}', '{staffList}', '{totalRevenue}', '{totalBonus}', '{totalCash}', '{totalCard}'],
    template: '💰 *Отчёт по продажам на {date}*\n\n{staffList}\n\n─────────────────\n💵 Итог дня: *{totalRevenue} ₽*\n🎁 Премия: *{totalBonus} ₽*\n💵 Наличные: *{totalCash} ₽*\n💳 Безналичные: *{totalCard} ₽*',
  },
  swap_status: {
    id: 'swap_status',
    name: 'Решение по бирже смен',
    description: 'Оповещение о согласовании или отклонении заявки на передачу смены',
    variables: ['{status}', '{date}', '{location}', '{requesterName}', '{candidateName}'],
    template: '📋 *Решение по замене смены: {status}*\n📅 Дата: *{date}* ({location})\n👤 Передал: *{requesterName}*\n👤 Принял: *{candidateName}*',
  },
};

export const TelegramSettingsView: React.FC = () => {
  const {
    telegramSettings,
    fetchTelegramSettings,
    saveTelegramSettings,
    testTelegramConnection,
    disconnectTelegram,
    apiFetch,
  } = useApp();

  const [botToken, setBotToken] = useState('');
  const [managerChatId, setManagerChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isEditingParams, setIsEditingParams] = useState(false);

  const [saveStatus, setSaveStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({
    type: 'idle',
  });
  const [testStatus, setTestStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({
    type: 'idle',
  });
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);

  // Templates state
  const [templates, setTemplates] = useState<Record<string, TelegramTemplateItem>>(DEFAULT_TEMPLATES);
  const [activeTemplateKey, setActiveTemplateKey] = useState<string>('daily_report');

  const isConfigured = !!telegramSettings?.isConfigured;

  useEffect(() => {
    if (telegramSettings) {
      if (telegramSettings.botToken) {
        setBotToken(telegramSettings.botToken);
      }
      if (telegramSettings.managerChatId) {
        setManagerChatId(telegramSettings.managerChatId);
      }
    }
  }, [telegramSettings]);

  useEffect(() => {
    fetchTelegramSettings();
    loadTemplates();
  }, [fetchTelegramSettings]);

  const loadTemplates = async () => {
    try {
      const res = await apiFetch('/api/v1/telegram/templates');
      const data = await res.json();
      if (data.success && data.templates && typeof data.templates === 'object') {
        setTemplates(prev => ({
          ...prev,
          ...data.templates,
        }));
      }
    } catch (e) {
      console.warn('Failed to load telegram templates:', e);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanToken = botToken.trim();
    const cleanChatId = managerChatId.trim();

    if (!cleanToken) {
      setSaveStatus({ type: 'error', message: 'Укажите токен бота Telegram.' });
      return;
    }
    if (!cleanChatId) {
      setSaveStatus({ type: 'error', message: 'Укажите Chat ID руководителя.' });
      return;
    }

    if (cleanChatId.startsWith('@')) {
      setSaveStatus({
        type: 'error',
        message: 'Chat ID должен быть числовым (например, 123456789), а не юзернеймом (@имя). Узнайте свой числовой ID у бота @userinfobot.',
      });
      return;
    }

    if (!/^-?\d+$/.test(cleanChatId)) {
      setSaveStatus({
        type: 'error',
        message: 'Chat ID должен состоять только из цифр (например: 320314713). Узнайте свой числовой ID у бота @userinfobot в Telegram.',
      });
      return;
    }

    setIsSaving(true);
    setSaveStatus({ type: 'idle' });
    setTestStatus({ type: 'idle' });

    try {
      const result = await saveTelegramSettings(cleanToken, cleanChatId);
      if (result.success) {
        setIsEditingParams(false);
        setSaveStatus({
          type: 'success',
          message: `Параметры успешно сохранены.${
            result.botUsername ? ` Имя бота: @${result.botUsername}.` : ''
          } Параметры защищены от случайной правки.`,
        });
        setTimeout(() => setSaveStatus({ type: 'idle' }), 6000);
      } else {
        setSaveStatus({
          type: 'error',
          message: result.error || 'Не удалось применить параметры. Проверьте корректность токена.',
        });
      }
    } catch (err: any) {
      setSaveStatus({
        type: 'error',
        message: err.message || 'Ошибка связи с сервером при сохранении.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEditParams = () => {
    setIsEditingParams(false);
    if (telegramSettings) {
      setBotToken(telegramSettings.botToken || '');
      setManagerChatId(telegramSettings.managerChatId || '');
    }
    setSaveStatus({ type: 'idle' });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus({ type: 'idle' });

    try {
      const result = await testTelegramConnection();
      if (result.success) {
        setTestStatus({
          type: 'success',
          message: 'Тестовое сообщение доставлено. Соединение с Telegram установлено.',
        });
      } else {
        const errorMsg = result.error || 'Не удалось доставить тестовое сообщение.';
        if (
          errorMsg.includes('403') ||
          errorMsg.toLowerCase().includes('initiate') ||
          errorMsg.toLowerCase().includes('start')
        ) {
          setTestStatus({
            type: 'error',
            message: `${errorMsg} Требуется активация диалога: откройте диалог с ботом в Telegram и отправьте команду /start, затем повторите проверку.`,
          });
        } else {
          setTestStatus({
            type: 'error',
            message: errorMsg,
          });
        }
      }
    } catch (err: any) {
      setTestStatus({
        type: 'error',
        message: err.message || 'Ошибка сети при отправке тестового сообщения.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const executeDisconnect = async () => {
    setShowDisconnectConfirm(false);
    setIsDisconnecting(true);
    try {
      const result = await disconnectTelegram();
      if (result.success) {
        setBotToken('');
        setManagerChatId('');
        setIsEditingParams(true);
        setSaveStatus({
          type: 'success',
          message: 'Интеграция отключена. Параметры очищены.',
        });
        setTimeout(() => setSaveStatus({ type: 'idle' }), 5000);
      } else {
        setSaveStatus({
          type: 'error',
          message: result.error || 'Не удалось отключить интеграцию.',
        });
      }
    } catch (err: any) {
      setSaveStatus({
        type: 'error',
        message: err.message || 'Ошибка при обращении к серверу.',
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const activeTemplate = templates[activeTemplateKey] || DEFAULT_TEMPLATES[activeTemplateKey];

  const getSimulatedPreview = (tplText: string) => {
    return tplText
      .replace(/{employeeName}/g, 'Иван Смирнов')
      .replace(/{location}/g, 'СК-1 (Северный)')
      .replace(/{shiftType}/g, 'Дневная смена')
      .replace(/{date}/g, '29.10.2026')
      .replace(/{status}/g, 'ОДОБРЕНА')
      .replace(/{requesterName}/g, 'Анна Кузнецова')
      .replace(/{candidateName}/g, 'Иван Смирнов')
      .replace(/{staffList}/g, '• Иван Смирнов (Дневная смена, СК-1): 18 400 ₽\n• Анна К. (Ночная смена, СК-2): 24 100 ₽')
      .replace(/{totalRevenue}/g, '42 500')
      .replace(/{totalBonus}/g, '1 500')
      .replace(/{totalCash}/g, '12 000')
      .replace(/{totalCard}/g, '30 500');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      {/* Page Header */}
      <div className="pb-3 border-b border-[#e5e7eb]">
        <h1 className="text-lg font-semibold text-[#111111] tracking-tight">
          Интеграция с Telegram
        </h1>
        <p className="text-xs text-[#5d6270] mt-0.5">
          Параметры бота, управление доступом, шаблоны отчетов для руководителя и рассылка сотрудникам.
        </p>
      </div>

      {/* Status Panel */}
      <div className="p-4 rounded-md bg-white border border-[#d9dbe0] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start md:items-center gap-3">
          <span
            className={`w-2 h-2 rounded-xs mt-1.5 md:mt-0 shrink-0 ${
              isConfigured ? 'bg-[#2f63ff]' : 'bg-[#5d6270]'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#111111]">
                {isConfigured ? 'Интеграция активна' : 'Интеграция не настроена'}
              </span>
              {isConfigured && telegramSettings?.botUsername && (
                <span className="text-[11px] font-mono text-[#2f63ff] font-medium">
                  @{telegramSettings.botUsername}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#5d6270] mt-0.5 font-mono">
              {isConfigured
                ? `Chat ID: ${telegramSettings?.managerChatId || '—'}${
                    telegramSettings?.updatedAt
                      ? ` · Изменено: ${new Date(telegramSettings.updatedAt).toLocaleDateString('ru-RU')}`
                      : ''
                  }`
                : 'По умолчанию отправка отключена. Заполните токен бота и ID получателя ниже.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
          {isConfigured && (
            <>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3 py-1.5 rounded bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isTesting ? 'Проверка...' : 'Проверить связь'}
              </button>

              <button
                type="button"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={isDisconnecting}
                className="px-3 py-1.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isDisconnecting ? 'Отключение...' : 'Отключить'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => fetchTelegramSettings()}
            className="p-1.5 rounded bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] transition-colors cursor-pointer"
            title="Синхронизировать статус"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Status Notifications */}
      {testStatus.type !== 'idle' && (
        <div
          className={`p-3 rounded-md border text-xs leading-relaxed flex items-start justify-between gap-2 ${
            testStatus.type === 'success'
              ? 'bg-[#eef2ff] border-[#a9bcff] text-[#111111]'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="font-medium">{testStatus.message}</span>
          <button
            onClick={() => setTestStatus({ type: 'idle' })}
            className="text-[#5d6270] hover:text-[#111111] shrink-0 ml-2 p-0.5 cursor-pointer"
            title="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {saveStatus.type !== 'idle' && (
        <div
          className={`p-3 rounded-md border text-xs leading-relaxed flex items-start justify-between gap-2 ${
            saveStatus.type === 'success'
              ? 'bg-[#eef2ff] border-[#a9bcff] text-[#111111]'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="font-medium">{saveStatus.message}</span>
          <button
            onClick={() => setSaveStatus({ type: 'idle' })}
            className="text-[#5d6270] hover:text-[#111111] shrink-0 ml-2 p-0.5 cursor-pointer"
            title="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Settings Form with Accidental Edit Protection */}
      <div className="bg-white border border-[#d9dbe0] rounded-md p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#e5e7eb]">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
              Параметры подключения
            </h2>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                isEditingParams ? 'text-[#b45309]' : 'text-[#5d6270]'
              }`}
            >
              {isEditingParams ? (
                <>
                  <Edit2 className="w-3 h-3 text-[#b45309]" />
                  <span>Режим редактирования</span>
                </>
              ) : (
                <>
                  <Lock className="w-3 h-3 text-[#2f63ff]" />
                  <span>Защищено от случайной правки</span>
                </>
              )}
            </span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[#2d313b] font-medium flex items-center gap-1.5">
                <span>Токен бота (Bot Token)</span>
                <span className="text-rose-600">*</span>
                {!isEditingParams && <Lock className="w-3 h-3 text-[#5d6270]" />}
              </label>
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[#2f63ff] hover:text-[#1f4fe0] font-medium inline-flex items-center gap-1"
              >
                <span>@BotFather</span>
                <ExternalLink className="w-3 h-3 text-[#5d6270]" />
              </a>
            </div>

            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={botToken}
                onChange={e => setBotToken(e.target.value)}
                disabled={!isEditingParams}
                placeholder="1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567"
                required
                className={`w-full border rounded px-3 py-2 text-xs font-mono placeholder:text-[#5d6270]/60 focus:outline-none transition-colors pr-9 ${
                  !isEditingParams
                    ? 'bg-[#f7f9ff] border-[#d9dbe0] text-[#5d6270] cursor-not-allowed select-none'
                    : 'bg-white border-[#d9dbe0] text-[#111111] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#5d6270] hover:text-[#111111] p-0.5 cursor-pointer"
                title={showToken ? 'Скрыть' : 'Показать'}
              >
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-[#5d6270] mt-1">
              Ключ доступа к Bot API, полученный от @BotFather в Telegram.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[#2d313b] font-medium flex items-center gap-1.5">
                <span>Chat ID руководителя</span>
                <span className="text-rose-600">*</span>
                {!isEditingParams && <Lock className="w-3 h-3 text-[#5d6270]" />}
              </label>
              <a
                href="https://t.me/userinfobot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[#2f63ff] hover:text-[#1f4fe0] font-medium inline-flex items-center gap-1"
              >
                <span>@userinfobot</span>
                <ExternalLink className="w-3 h-3 text-[#5d6270]" />
              </a>
            </div>

            <input
              type="text"
              value={managerChatId}
              onChange={e => setManagerChatId(e.target.value)}
              disabled={!isEditingParams}
              placeholder="320314713"
              required
              className={`w-full border rounded px-3 py-2 text-xs font-mono placeholder:text-[#5d6270]/60 focus:outline-none transition-colors ${
                !isEditingParams
                  ? 'bg-[#f7f9ff] border-[#d9dbe0] text-[#5d6270] cursor-not-allowed select-none'
                  : 'bg-white border-[#d9dbe0] text-[#111111] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20'
              }`}
            />
            <p className="text-[11px] text-[#5d6270] mt-1">
              Идентификатор руководителя в Telegram (числовой Chat ID, например: 320314713).
            </p>
          </div>

          {isEditingParams && (
            <div className="p-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded text-[11px] text-[#2d313b] leading-relaxed">
              <span className="text-[#111111] font-semibold">Важно:</span> Перед сохранением и проверкой связи обязательно откройте диалог с созданным ботом в приложении Telegram и выполните команду <span className="font-mono font-semibold text-[#2f63ff]">/start</span>.
            </div>
          )}

          {/* Explicit Action Buttons */}
          <div className="pt-3 border-t border-[#e5e7eb] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-[11px] text-[#5d6270]">
              {!isEditingParams ? (
                <span>Для изменения токена или Chat ID нажмите кнопку «Редактировать».</span>
              ) : (
                <span className="text-[#b45309] font-medium">Поля открыты для редактирования. Внесите изменения и нажмите «Сохранить».</span>
              )}
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              {!isEditingParams ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditingParams(true)}
                    className="px-4 py-2 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-[#2f63ff]" />
                    <span>Редактировать</span>
                  </button>

                  <button
                    type="button"
                    disabled
                    className="px-4 py-2 bg-[#f7f9ff] text-[#5d6270] border border-[#d9dbe0] rounded text-xs font-semibold flex items-center gap-1.5 cursor-not-allowed"
                    title="Нажмите «Редактировать» перед сохранением"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Сохранить</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleCancelEditParams}
                    className="px-3.5 py-2 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2d313b] hover:text-[#111111] text-xs rounded font-medium transition-colors cursor-pointer"
                  >
                    Отмена
                  </button>

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="py-1.5 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold text-xs rounded transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Сохранение...' : 'Сохранить'}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Telegram Report Templates Section */}
      <div className="bg-white border border-[#d9dbe0] rounded-md p-5 space-y-4">
        <div className="pb-3 border-b border-[#e5e7eb]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#111111] flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-[#2f63ff]" />
            <span>Шаблоны Telegram-отчетов для руководителя</span>
          </h2>
        </div>

        {/* Template Selector Tabs */}
        <div className="flex flex-wrap gap-1.5 p-1 bg-[#f7f9ff] rounded-md border border-[#d9dbe0]">
          {Object.entries(templates).map(([key, tpl]) => {
            const isActive = activeTemplateKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setActiveTemplateKey(key);
                }}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#111111] text-white font-semibold'
                    : 'text-[#2d313b] hover:text-[#111111] hover:bg-[#eef2ff]'
                }`}
              >
                {tpl.name}
              </button>
            );
          })}
        </div>

        {/* Template Preview */}
        <div className="border border-[#d9dbe0] rounded-md overflow-hidden">
          <div className="px-3 py-2 bg-[#f7f9ff] border-b border-[#e5e7eb] text-[11px] text-[#5d6270] font-medium">
            Пример отображения в Telegram:
          </div>
          <div className="p-3 bg-white text-xs font-mono text-[#111111] whitespace-pre-wrap leading-relaxed">
            {getSimulatedPreview(activeTemplate.template)}
          </div>
        </div>
      </div>

      {/* Technical Documentation / Setup Reference */}
      <div className="bg-white border border-[#d9dbe0] rounded-md overflow-hidden">
        <button
          type="button"
          onClick={() => setIsInstructionsOpen(!isInstructionsOpen)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#f7f9ff] transition-colors cursor-pointer"
        >
          <span className="text-xs font-semibold text-[#111111]">
            Справка по регистрации и настройке бота
          </span>
          {isInstructionsOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-[#2f63ff]" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[#2f63ff]" />
          )}
        </button>

        {isInstructionsOpen && (
          <div className="px-4 pb-4 pt-3 border-t border-[#e5e7eb] text-xs text-[#2d313b] space-y-2.5 bg-[#f7f9ff]/50">
            <div className="space-y-1">
              <span className="text-[#111111] font-semibold">1. Регистрация бота:</span>
              <p className="text-[11px] leading-relaxed">
                Откройте диалог с официальным сервисом @BotFather в Telegram. Отправьте команду <span className="font-mono font-semibold text-[#2f63ff]">/newbot</span>. Укажите экранное имя бота и системный username с окончанием bot (например, <span className="font-mono font-semibold text-[#2f63ff]">skladin_alerts_bot</span>). Скопируйте предоставленный HTTP API токен.
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-[#111111] font-semibold">2. Определение Chat ID:</span>
              <p className="text-[11px] leading-relaxed">
                Откройте бот @userinfobot или @getmyid_bot в Telegram и отправьте команду <span className="font-mono font-semibold text-[#2f63ff]">/start</span>. Скопируйте цифровое значение из строки Id.
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-[#111111] font-semibold">3. Рассылка сотрудникам:</span>
              <p className="text-[11px] leading-relaxed">
                Если в карточке сотрудника указан Telegram юзернейм (например, @ivan_sklad), планировщик автоматически доставляет рассылки и напоминания сотруднику в личные сообщения Telegram.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Monolithic Notification Scenarios Reference */}
      <div className="bg-white border border-[#d9dbe0] rounded-md p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111] mb-3 pb-2 border-b border-[#e5e7eb]">
          Сценарии автоматической отправки
        </h3>

        <div className="divide-y divide-[#e5e7eb] text-xs">
          <div className="py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <span className="font-semibold text-[#111111] shrink-0 sm:w-56">Открытие смены (Check-in)</span>
            <span className="text-[#5d6270] text-[11px]">Фиксация выхода сотрудника на склад, время явки, участок работы.</span>
          </div>

          <div className="py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <span className="font-semibold text-[#111111] shrink-0 sm:w-56">Закрытие смены и касса</span>
            <span className="text-[#5d6270] text-[11px]">Фактическая сумма наличных, безналичный расчет, фотоуслуги, печать, ламинация.</span>
          </div>

          <div className="py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <span className="font-semibold text-[#111111] shrink-0 sm:w-56">Контроль открытия складов / смен</span>
            <span className="text-[#5d6270] text-[11px]">Оповещение руководителя при отсутствии явки сотрудника к началу смены.</span>
          </div>

          <div className="py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <span className="font-semibold text-[#111111] shrink-0 sm:w-56">Биржа смен</span>
            <span className="text-[#5d6270] text-[11px]">Публикация запроса на подмену, принятие смены коллегой или отмена запроса.</span>
          </div>

          <div className="py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <span className="font-semibold text-[#111111] shrink-0 sm:w-56">Анкеты кандидатов</span>
            <span className="text-[#5d6270] text-[11px]">Поступление новой заявки соискателя на регистрацию в учетной системе.</span>
          </div>

          <div className="py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <span className="font-semibold text-[#111111] shrink-0 sm:w-56">Обращения персонала</span>
            <span className="text-[#5d6270] text-[11px]">Оперативные сообщения сотрудников из интерфейса рабочего места.</span>
          </div>

          <div className="py-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <span className="font-semibold text-[#111111] shrink-0 sm:w-56">Сводная отчетность</span>
            <span className="text-[#5d6270] text-[11px]">Ежедневная сводка явок и смен по всем складам по запросу или расписанию.</span>
          </div>
        </div>
      </div>

      {/* Disconnect Confirmation Modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-sm overflow-hidden p-5 space-y-4 text-[#111111]">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">Отключение Telegram</h3>
                <p className="text-xs text-[#5d6270]">Параметры подключения будут очищены</p>
              </div>
            </div>
            <p className="text-xs text-[#2d313b] leading-relaxed">
              Отключить интеграцию с Telegram? Отправка уведомлений руководителю и автоматических рассылок будет приостановлена.
            </p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
              <button
                type="button"
                onClick={() => setShowDisconnectConfirm(false)}
                className="px-3 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={executeDisconnect}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                Отключить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
