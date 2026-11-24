import { db } from '../db/index';
import { DEFAULT_LEGACY_ORG_ID, getOrgSetting, setOrgSetting } from '../db/orgSettings';

const SHIFT_LABELS: Record<string, string> = {
  day12: 'День 12ч (08:00–20:00)',
  night12: 'Ночь 12ч (20:00–08:00)',
  standard8: 'Смена 8ч',
  part6: 'Подработка 6ч',
  part4: 'Подработка 4ч',
  daily24: 'Сутки 24ч',
  standard: 'Дневная смена',
  '400+': 'Расширенная',
  '500+': 'Полная',
  '8h': '8 часов',
  '6h': '6 часов',
  '4h': '4 часа',
  shift8h: '8 часов',
  shift4h: '4 часа',
};

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export interface TelegramTemplateItem {
  id: string;
  name: string;
  description: string;
  variables: string[];
  template: string;
}

export interface OrgTelegramConfig {
  botToken: string;
  managerChatId: string;
  botUsername: string;
  updatedAt?: string;
}

export const DEFAULT_TELEGRAM_TEMPLATES: Record<string, TelegramTemplateItem> = {
  checkin: {
    id: 'checkin',
    name: 'Отметка Check-in',
    description: 'Уведомление руководителю о начале смены сотрудником',
    variables: ['{employeeName}', '{location}', '{shiftType}', '{date}'],
    template: '🔔 *Новая отметка Check-in!*\n\n👤 *Сотрудник:* {employeeName}\n📍 *Склад:* {location}\n🕒 *Смена:* {shiftType}\n📅 *Дата:* {date}',
  },
  daily_report: {
    id: 'daily_report',
    name: 'Ежедневный сводный отчет (21:15)',
    description: 'Вечерняя сводка по продажам, выручке и премиям',
    variables: ['{date}', '{staffList}', '{totalRevenue}', '{totalBonus}', '{totalCash}', '{totalCard}'],
    template: '💰 *Отчёт по продажам на {date}*\n\n{staffList}\n\n─────────────────\n💵 Итог дня: *{totalRevenue} ₽*\n🎁 Премия: *{totalBonus} ₽*\n💵 Наличные: *{totalCash} ₽*\n💳 Безналичные: *{totalCard} ₽*',
  },
  swap_status: {
    id: 'swap_status',
    name: 'Решение по замене смены',
    description: 'Уведомление при согласовании или отклонении заявки биржи',
    variables: ['{status}', '{date}', '{location}', '{requesterName}', '{candidateName}'],
    template: '📋 *Решение по замене смены: {status}*\n📅 Дата: *{date}* ({location})\n👤 Передал: *{requesterName}*\n👤 Принял: *{candidateName}*',
  },
  thank_you: {
    id: 'thank_you',
    name: 'Благодарность сотруднику',
    description: 'Отправка благодарности сотруднику смены от руководителя',
    variables: ['{location}'],
    template: '❤️ *Благодарность от руководителя*\nРуководитель выражает огромную благодарность за отличную работу на складе {location}! Так держать!',
  },
};

export class TelegramService {
  private knownUserChats = new Map<string, string>();

  async getSettingsForOrg(organizationId: string): Promise<OrgTelegramConfig> {
    const stored = await getOrgSetting<OrgTelegramConfig | null>(organizationId, 'telegram_settings', null);
    if (stored && (stored.botToken || stored.managerChatId)) {
      return stored;
    }
    if (organizationId === DEFAULT_LEGACY_ORG_ID) {
      return {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        managerChatId: process.env.MANAGER_TELEGRAM_ID || '',
        botUsername: '',
        updatedAt: undefined,
      };
    }
    return {
      botToken: '',
      managerChatId: '',
      botUsername: '',
      updatedAt: undefined,
    };
  }

  async setSettingsForOrg(organizationId: string, settings: OrgTelegramConfig): Promise<void> {
    await setOrgSetting(organizationId, 'telegram_settings', {
      botToken: settings.botToken,
      managerChatId: settings.managerChatId,
      botUsername: settings.botUsername || '',
      updatedAt: settings.updatedAt || new Date().toISOString(),
    });
  }

  async clearSettingsForOrg(organizationId: string): Promise<void> {
    await setOrgSetting(organizationId, 'telegram_settings', {
      botToken: '',
      managerChatId: '',
      botUsername: '',
      updatedAt: new Date().toISOString(),
    });
  }

  async isConfiguredForOrg(organizationId: string): Promise<boolean> {
    const s = await this.getSettingsForOrg(organizationId);
    return Boolean(s.botToken && s.managerChatId);
  }

  // Legacy env-level helpers (used only by global leads / fallback)
  isConfigured(): boolean {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.MANAGER_TELEGRAM_ID);
  }

  getManagerChatId(): string {
    return process.env.MANAGER_TELEGRAM_ID || '';
  }

  async sendMessageWithToken(
    text: string,
    token: string,
    targetChatId: string
  ): Promise<{ success: boolean; simulated?: boolean; error?: string }> {
    if (!token || !targetChatId) {
      return { success: true, simulated: true };
    }

    try {
      let response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      let resData = await response.json();

      if (!response.ok || !resData.ok) {
        response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            text,
          }),
        });
        resData = await response.json();
      }

      if (!response.ok || !resData.ok) {
        return { success: false, error: resData.description || 'Ошибка Telegram API' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async sendMessage(text: string, chatId?: string): Promise<{ success: boolean; simulated?: boolean; error?: string }> {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const targetChatId = chatId || process.env.MANAGER_TELEGRAM_ID || '';
    return this.sendMessageWithToken(text, token, targetChatId);
  }

  async sendMessageForOrg(
    organizationId: string,
    text: string,
    chatId?: string
  ): Promise<{ success: boolean; simulated?: boolean; error?: string }> {
    const cfg = await this.getSettingsForOrg(organizationId);
    const targetChat = chatId || cfg.managerChatId;
    return this.sendMessageWithToken(text, cfg.botToken, targetChat);
  }

  async generateDailySalesReportTextForOrg(organizationId: string, targetDate?: string): Promise<string> {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const dateFormatted = `${year}-${month}-${day}`;
    const displayDate = `${day}.${month}.${year}`;
    const dateToQuery = targetDate || dateFormatted;

    const staffRes = await db.query<{ id: string; name: string }>(
      "SELECT id, name FROM users WHERE active_organization_id = $1 AND role = 'employee' AND status = 'active' ORDER BY name ASC",
      [organizationId]
    );

    const checkinsRes = await db.query<{
      user_id: string;
      location_code: string;
      shift_type: string;
    }>(
      'SELECT user_id, location_code, shift_type FROM checkins WHERE organization_id = $1 AND date = $2',
      [organizationId, dateToQuery]
    );

    const salesRes = await db.query<{
      user_id: string;
      total: number;
      photo_cash: number;
      photo_card: number;
      print_cash: number;
      print_card: number;
      lamination_cash: number;
      lamination_card: number;
      bonus: number;
    }>(
      'SELECT user_id, total, photo_cash, photo_card, print_cash, print_card, lamination_cash, lamination_card, bonus FROM sales WHERE organization_id = $1 AND date = $2',
      [organizationId, dateToQuery]
    );

    const checkinMap = new Map(checkinsRes.rows.map(c => [c.user_id, c]));
    const salesMap = new Map(salesRes.rows.map(s => [s.user_id, s]));

    let totalRevenue = 0;
    let totalCash = 0;
    let totalCard = 0;
    let totalBonus = 0;

    const lines: string[] = [`💰 *Отчёт по продажам на ${displayDate}*\n`];

    if (staffRes.rows.length === 0) {
      lines.push('_(Активных сотрудников в системе нет)_');
    } else {
      for (const emp of staffRes.rows) {
        const safeName = escapeMarkdown(emp.name);
        const checkin = checkinMap.get(emp.id);
        if (!checkin) {
          lines.push(`🔴 ${safeName} — нет check-in`);
        } else {
          const shiftLabel = SHIFT_LABELS[checkin.shift_type] || checkin.shift_type;
          const sale = salesMap.get(emp.id);
          if (sale) {
            const empTotal = Number(sale.total || 0);
            const empCash = Number(sale.photo_cash || 0) + Number(sale.print_cash || 0) + Number(sale.lamination_cash || 0);
            const empCard = Number(sale.photo_card || 0) + Number(sale.print_card || 0) + Number(sale.lamination_card || 0);
            const empBonus = Number(sale.bonus || 0);

            totalRevenue += empTotal;
            totalCash += empCash;
            totalCard += empCard;
            totalBonus += empBonus;

            lines.push(
              `🟢 ${safeName} (${shiftLabel}, ${checkin.location_code}): *${empTotal.toLocaleString('ru-RU')} ₽* (нал: ${empCash.toLocaleString('ru-RU')} / б/нал: ${empCard.toLocaleString('ru-RU')})`
            );
          } else {
            lines.push(`🟡 ${safeName} (${shiftLabel}, ${checkin.location_code}) — нет продаж`);
          }
        }
      }
    }

    lines.push('\n─────────────────');
    lines.push(`💵 Итог дня: *${totalRevenue.toLocaleString('ru-RU')} ₽*`);
    lines.push(`🎁 Премия: *${totalBonus.toLocaleString('ru-RU')} ₽*`);
    lines.push(`💵 Наличные: *${totalCash.toLocaleString('ru-RU')} ₽*`);
    lines.push(`💳 Безналичные: *${totalCard.toLocaleString('ru-RU')} ₽*`);

    return lines.join('\n');
  }

  async sendDailySalesReportForOrg(
    organizationId: string,
    targetDate?: string
  ): Promise<{ success: boolean; simulated?: boolean; text?: string; error?: string }> {
    const text = await this.generateDailySalesReportTextForOrg(organizationId, targetDate);
    const sendResult = await this.sendMessageForOrg(organizationId, text);
    return {
      success: sendResult.success,
      simulated: sendResult.simulated,
      text,
      error: sendResult.error,
    };
  }

  async sendDailySalesReport(
    targetDate?: string,
    organizationId = 'org-default'
  ): Promise<{ success: boolean; simulated?: boolean; text?: string; error?: string }> {
    return this.sendDailySalesReportForOrg(organizationId, targetDate);
  }

  async getTemplatesForOrg(organizationId: string): Promise<Record<string, TelegramTemplateItem>> {
    const stored = await getOrgSetting<Record<string, TelegramTemplateItem> | null>(
      organizationId,
      'telegram_templates',
      null
    );
    return stored ? { ...DEFAULT_TELEGRAM_TEMPLATES, ...stored } : { ...DEFAULT_TELEGRAM_TEMPLATES };
  }

  async setTemplatesForOrg(
    organizationId: string,
    templates: Record<string, Partial<TelegramTemplateItem>>
  ): Promise<void> {
    const current = await this.getTemplatesForOrg(organizationId);
    for (const [key, tpl] of Object.entries(templates)) {
      if (current[key]) {
        current[key] = { ...current[key], ...tpl };
      }
    }
    await setOrgSetting(organizationId, 'telegram_templates', current);
  }

  async syncUpdatesWithToken(token: string): Promise<void> {
    if (!token) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=1`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          const msg = update.message || update.edited_message || update.channel_post;
          if (!msg) continue;
          const chatId = msg.chat?.id;
          if (!chatId) continue;

          if (msg.from?.username) {
            const clean = msg.from.username.trim().replace(/^@/, '').toLowerCase();
            this.knownUserChats.set(clean, String(chatId));
          }
          if (msg.chat?.username) {
            const clean = msg.chat.username.trim().replace(/^@/, '').toLowerCase();
            this.knownUserChats.set(clean, String(chatId));
          }
        }
      }
    } catch {}
  }

  async resolveChatIdForUsername(usernameOrId: string, token: string): Promise<string> {
    const trimmed = (usernameOrId || '').trim();
    if (!trimmed) return '';
    if (/^-?\d+$/.test(trimmed)) return trimmed;

    const clean = trimmed.replace(/^@/, '').toLowerCase();
    if (this.knownUserChats.has(clean)) {
      return this.knownUserChats.get(clean)!;
    }

    await this.syncUpdatesWithToken(token);
    if (this.knownUserChats.has(clean)) {
      return this.knownUserChats.get(clean)!;
    }
    return `@${clean}`;
  }

  async sendBroadcastToStaffForOrg(
    organizationId: string,
    text: string,
    targetRole: 'all' | 'standard' | 'part_time' = 'all'
  ): Promise<{ success: boolean; deliveredCount: number; staffCount: number; error?: string }> {
    const cfg = await this.getSettingsForOrg(organizationId);
    if (!cfg.botToken) {
      return { success: true, deliveredCount: 0, staffCount: 0 };
    }

    await this.syncUpdatesWithToken(cfg.botToken);

    let query = `SELECT id, name, telegram_username FROM users WHERE active_organization_id = $1 AND role = 'employee' AND status = 'active' AND telegram_username IS NOT NULL AND TRIM(telegram_username) != ''`;
    if (targetRole === 'standard') {
      query += ' AND is_part_time = FALSE';
    } else if (targetRole === 'part_time') {
      query += ' AND is_part_time = TRUE';
    }

    let staffMembers: { id: string; name: string; telegram_username: string }[] = [];
    try {
      const res = await db.query<{ id: string; name: string; telegram_username: string }>(query, [organizationId]);
      staffMembers = res.rows;
    } catch {}

    let deliveredCount = 0;
    const sentChatIds = new Set<string>();

    for (const emp of staffMembers) {
      const target = await this.resolveChatIdForUsername(emp.telegram_username, cfg.botToken);
      if (!target || sentChatIds.has(target)) continue;
      sentChatIds.add(target);

      const sendRes = await this.sendMessageWithToken(text, cfg.botToken, target);
      if (sendRes.success) {
        deliveredCount++;
      }
    }

    if (cfg.managerChatId && !sentChatIds.has(cfg.managerChatId)) {
      await this.sendMessageWithToken(text, cfg.botToken, cfg.managerChatId);
    }

    return {
      success: true,
      deliveredCount,
      staffCount: staffMembers.length,
    };
  }
}

export const telegramService = new TelegramService();
