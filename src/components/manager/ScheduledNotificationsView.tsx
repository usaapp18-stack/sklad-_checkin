import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { CustomSelect } from '../common/CustomSelect';
import {
  Clock,
  Plus,
  Trash2,
  Send,
  Users,
  ToggleLeft,
  ToggleRight,
  X,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface ScheduledRule {
  id: string;
  title: string;
  text: string;
  scheduleType: 'daily' | 'one_time';
  timeOfDay: string; // HH:MM
  targetRole: 'all' | 'standard' | 'part_time';
  isActive: boolean;
}

export const ScheduledNotificationsView: React.FC = () => {
  const { csrfToken, apiFetch, telegramSettings } = useApp();

  const [schedules, setSchedules] = useState<ScheduledRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sendingTestId, setSendingTestId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [scheduleType, setScheduleType] = useState<'daily' | 'one_time'>('daily');
  const [timeOfDay, setTimeOfDay] = useState('20:50');
  const [targetRole, setTargetRole] = useState<'all' | 'standard' | 'part_time'>('all');

  const fetchSchedules = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/v1/notifications/schedules');
      const data = await res.json();
      if (data.success) {
        setSchedules(data.schedules || []);
      }
    } catch (err) {
      console.error('Error fetching schedules:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) {
      setErrorMsg('Пожалуйста, укажите тему рассылки и текст сообщения.');
      return;
    }

    const parts = timeOfDay.split(':');
    let h = parseInt(parts[0] || '20', 10);
    let m = parseInt(parts[1] || '50', 10);
    if (isNaN(h) || h < 0) h = 0;
    if (h > 23) h = 23;
    if (isNaN(m) || m < 0) m = 0;
    if (m > 59) m = 59;
    const cleanTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const res = await apiFetch('/api/v1/notifications/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          title: title.trim(),
          text: text.trim(),
          scheduleType,
          timeOfDay: cleanTime,
          targetRole,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMsg('Правило рассылки в Telegram успешно сохранено.');
        setTitle('');
        setText('');
        setTimeout(() => setSuccessMsg(''), 4000);
        fetchSchedules();
      } else {
        setErrorMsg(data.error?.message || 'Ошибка сохранения правила рассылки.');
      }
    } catch (err) {
      console.error('Create schedule error:', err);
      setErrorMsg('Не удалось связаться с сервером.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleSchedule = async (id: string, currentStatus: boolean) => {
    try {
      const res = await apiFetch(`/api/v1/notifications/schedules/${id}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ isActive: !currentStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setSchedules(prev =>
          prev.map(s => (s.id === id ? { ...s, isActive: !currentStatus } : s))
        );
      }
    } catch (err) {
      console.error('Toggle schedule error:', err);
    }
  };

  const handleTestSend = async (rule: ScheduledRule) => {
    setSendingTestId(rule.id);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await apiFetch(`/api/v1/notifications/schedules/${rule.id}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`Сообщение по правилу «${rule.title}» успешно отправлено в Telegram.`);
        setTimeout(() => setSuccessMsg(''), 4500);
      } else {
        setErrorMsg(data.error?.message || 'Не удалось отправить сообщение в Telegram.');
      }
    } catch (err) {
      console.error('Test send schedule error:', err);
      setErrorMsg('Ошибка связи с сервером при отправке в Telegram.');
    } finally {
      setSendingTestId(null);
    }
  };

  const handleConfirmDeleteSchedule = async () => {
    if (!deletingId) return;
    try {
      const res = await apiFetch(`/api/v1/notifications/schedules/${deletingId}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      });
      const data = await res.json();
      if (data.success) {
        setSchedules(prev => prev.filter(s => s.id !== deletingId));
      }
    } catch (err) {
      console.error('Delete schedule error:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const isTelegramConfigured = Boolean(telegramSettings?.isConfigured);

  return (
    <div className="space-y-5">
      {/* Header Info Block */}
      <div className="p-4 rounded-md bg-white border border-[#d9dbe0]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#111111] tracking-wide uppercase">
              Планировщик рассылок в Telegram
            </h2>
            <p className="text-xs text-[#5d6270] mt-1">
              Автоматическая отправка уведомлений и напоминаний сотрудникам через Telegram-бота по установленному времени (МСК).
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                isTelegramConfigured ? 'text-[#2f63ff]' : 'text-[#b45309]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-xs ${
                  isTelegramConfigured ? 'bg-[#2f63ff]' : 'bg-amber-400'
                }`}
              />
              {isTelegramConfigured
                ? `Бот активен ${telegramSettings?.botUsername ? `(@${telegramSettings.botUsername})` : ''}`
                : 'Бот не подключен'}
            </span>
            <button
              type="button"
              onClick={fetchSchedules}
              disabled={isLoading}
              className="p-1.5 rounded bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] hover:text-[#111111] border border-[#d9dbe0] transition-colors cursor-pointer"
              title="Обновить список правил"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {!isTelegramConfigured && (
          <div className="mt-3 flex items-start gap-2 text-[11px] text-[#b45309] bg-amber-50/70 p-2.5 rounded-md border border-amber-200">
            <AlertCircle className="w-4 h-4 text-[#b45309] shrink-0 mt-0.5" />
            <span>
              Telegram-бот не настроен. Рассылки будут сохраняться в системе. Для реальной отправки в Telegram укажите токен бота в разделе «Telegram-уведомления».
            </span>
          </div>
        )}
      </div>

      {/* Status Notifications */}
      {errorMsg && (
        <div className="p-3 rounded-md border text-xs leading-relaxed flex items-start justify-between gap-2 bg-rose-50 border-rose-200 text-rose-800">
          <span className="font-medium">{errorMsg}</span>
          <button
            onClick={() => setErrorMsg('')}
            className="text-rose-600 hover:text-rose-900 shrink-0 ml-2 p-0.5 cursor-pointer"
            title="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-md border border-[#a9bcff] text-xs leading-relaxed flex items-start justify-between gap-2 bg-[#eef2ff] text-[#111111]">
          <span className="text-[#111111] font-medium">{successMsg}</span>
          <button
            onClick={() => setSuccessMsg('')}
            className="text-[#5d6270] hover:text-[#111111] shrink-0 ml-2 p-0.5 cursor-pointer"
            title="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Form Panel */}
        <div className="lg:col-span-1 bg-white border border-[#d9dbe0] rounded-md p-4 space-y-4 self-start">
          <div className="flex items-center gap-2 border-b border-[#e5e7eb] pb-3">
            <Plus className="w-4 h-4 text-[#2f63ff]" />
            <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
              Новое правило рассылки
            </h3>
          </div>

          <form onSubmit={handleCreateSchedule} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-[#2d313b] font-medium mb-1">
                Тема рассылки <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Например: Сверка табеля и сдача смены"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-white border border-[#d9dbe0] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20 rounded px-3 py-2 text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-[#2d313b] font-medium mb-1">
                Текст сообщения в Telegram <span className="text-rose-600">*</span>
              </label>
              <textarea
                required
                rows={3}
                placeholder="Не забудьте отметить закрытие смены (Check-out) и сдать инвентарь до 20:00!"
                value={text}
                onChange={e => setText(e.target.value)}
                className="w-full bg-white border border-[#d9dbe0] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20 rounded px-3 py-2 text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-[#2d313b] font-medium mb-1">Регулярность</label>
              <CustomSelect<'daily' | 'one_time'>
                value={scheduleType}
                onChange={v => setScheduleType(v)}
                menuHeaderTitle="Регулярность отправки"
                options={[
                  { value: 'daily', label: 'Ежедневно' },
                  { value: 'one_time', label: 'Одноразово' },
                ]}
              />
            </div>

            {/* Time Setting: ЧЧ:ММ */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[#2d313b] font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#2f63ff]" />
                  <span>Время отправки (МСК) <span className="text-rose-600">*</span></span>
                </label>
                <span className="text-xs font-mono font-semibold text-[#2f63ff] tabular-nums">
                  {timeOfDay} МСК
                </span>
              </div>

              <div className="bg-[#f7f9ff] border border-[#d9dbe0] rounded-md p-3 space-y-3">
                <input
                  type="time"
                  required
                  value={timeOfDay}
                  onChange={e => setTimeOfDay(e.target.value)}
                  className="w-full bg-white border border-[#d9dbe0] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20 rounded px-3 py-2 text-sm text-[#111111] font-mono font-semibold focus:outline-none transition-colors"
                />

                {/* Quick Presets */}
                <div className="pt-2 border-t border-[#e5e7eb]">
                  <div className="text-[10px] text-[#5d6270] mb-1.5 text-center font-medium">
                    Быстрая установка ЧЧ:ММ:
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {[
                      { t: '09:00', label: '09:00' },
                      { t: '12:00', label: '12:00' },
                      { t: '18:00', label: '18:00' },
                      { t: '20:50', label: '20:50' },
                      { t: '21:00', label: '21:00' },
                    ].map(preset => {
                      const isCurrent = timeOfDay === preset.t;
                      return (
                        <button
                          key={preset.t}
                          type="button"
                          onClick={() => setTimeOfDay(preset.t)}
                          className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-[#2f63ff] text-white font-bold'
                              : 'bg-white hover:bg-[#eef2ff] text-[#2d313b] border border-[#d9dbe0]'
                          }`}
                        >
                          {preset.t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[#2d313b] font-medium mb-1">Получатели</label>
              <CustomSelect<'all' | 'standard' | 'part_time'>
                value={targetRole}
                onChange={v => setTargetRole(v)}
                menuHeaderTitle="Получатели рассылки"
                direction="up"
                options={[
                  { value: 'all', label: 'Все сотрудники' },
                  { value: 'standard', label: 'Только штатный персонал' },
                  { value: 'part_time', label: 'Только подработчики' },
                ]}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold rounded text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Сохранить правило</span>
            </button>
          </form>
        </div>

        {/* Schedules List Panel */}
        <div className="lg:col-span-2 bg-white border border-[#d9dbe0] rounded-md overflow-hidden self-start">
          <div className="px-4 py-3 bg-[#f7f9ff] border-b border-[#e5e7eb] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#111111] tracking-wide uppercase flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Правила рассылок ({schedules.length})</span>
            </h3>
            {isLoading && <span className="text-[11px] text-[#5d6270]">Обновление данных...</span>}
          </div>

          {schedules.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-xs text-[#111111] font-semibold">Активных расписаний не создано</p>
              <p className="text-[11px] text-[#5d6270] max-w-sm mx-auto">
                Создайте первое правило в панели слева (например, напоминание о закрытии смены в 20:50).
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#e5e7eb]">
              {schedules.map(rule => (
                <div
                  key={rule.id}
                  className={`p-3.5 sm:px-4 transition-colors space-y-2 ${
                    rule.isActive
                      ? 'bg-white'
                      : 'bg-[#f7f9ff]/60 opacity-75'
                  }`}
                >
                  {/* Rule Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="font-mono font-semibold text-[#2f63ff] tabular-nums">
                          {rule.timeOfDay} МСК
                        </span>
                        <span className="text-[#d9dbe0]">·</span>
                        <span className="text-[11px] font-medium text-[#111111]">
                          {rule.scheduleType === 'daily' ? 'Ежедневно' : 'Одноразово'}
                        </span>
                        <span className="text-[#d9dbe0]">·</span>
                        <span className="text-[11px] text-[#5d6270] flex items-center gap-1 font-medium">
                          <Users className="w-3 h-3 text-[#2f63ff]" />
                          {rule.targetRole === 'all'
                            ? 'Все сотрудники'
                            : rule.targetRole === 'standard'
                            ? 'Штатный персонал'
                            : 'Подработчики'}
                        </span>
                      </div>
                      <h4 className="text-xs font-semibold text-[#111111]">{rule.title}</h4>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTestSend(rule)}
                        disabled={sendingTestId === rule.id}
                        className="px-2 py-1 rounded bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] text-[11px] font-medium transition-colors disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                        title="Отправить тестовое сообщение в Telegram сейчас"
                      >
                        <Send className="w-3 h-3 text-[#2f63ff]" />
                        <span>{sendingTestId === rule.id ? 'Отправка...' : 'Отправить'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleSchedule(rule.id, rule.isActive)}
                        title={rule.isActive ? 'Деактивировать правило' : 'Активировать правило'}
                        className="p-1 text-[#2d313b] hover:text-[#111111] transition-colors cursor-pointer"
                      >
                        {rule.isActive ? (
                          <ToggleRight className="w-5 h-5 text-[#2f63ff]" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-[#5d6270]" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeletingId(rule.id)}
                        title="Удалить правило"
                        className="p-1 text-[#5d6270] hover:text-rose-600 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Rule Message Text */}
                  <p className="text-xs text-[#2d313b] bg-[#f7f9ff] px-3 py-2 rounded border border-[#e5e7eb] leading-relaxed font-mono whitespace-pre-wrap">
                    {rule.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Rule Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 bg-[#111111]/55 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-sm overflow-hidden p-5 space-y-4 text-[#111111]">
            <div className="flex items-center gap-2.5">
              <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">Удаление правила</h3>
                <p className="text-xs text-[#5d6270]">Подтвердите удаление рассылки</p>
              </div>
            </div>
            <p className="text-xs text-[#2d313b]">
              Вы действительно хотите удалить данное правило рассылки в Telegram?
            </p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e7eb]">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                className="px-3 py-1.5 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#2d313b] hover:text-[#111111] rounded text-xs font-medium transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSchedule}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
