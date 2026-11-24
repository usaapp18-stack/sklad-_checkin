import { db } from '../db/index';
import { telegramService } from './telegram';
import { runTrialLifecycleChecks } from './subscription';
import { v4 as uuidv4 } from 'uuid';

interface ScheduledJobStatus {
  name: string;
  time: string;
  lastRun?: string;
  status: 'idle' | 'running' | 'completed' | 'error';
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private startTime: number = Date.now();
  private lastHeartbeat: string = new Date().toISOString();
  private executedJobs = new Set<string>();
  private lastTrialCheckAt = 0;

  private jobs: Record<string, ScheduledJobStatus> = {
    '20:00': { name: 'Напоминание о Check-in', time: '20:00', status: 'idle' },
    '20:50': { name: 'Напоминание о вводе выручки', time: '20:50', status: 'idle' },
    '21:10': { name: 'Срочное предупреждение (выручка)', time: '21:10', status: 'idle' },
    '21:15': { name: 'Ежедневный сводный отчет в Telegram', time: '21:15', status: 'idle' },
  };

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = Date.now();
    this.lastHeartbeat = new Date().toISOString();
    console.log('[Scheduler] Authoritative Node.js scheduler started (Timezone: Europe/Moscow).');

    this.timer = setInterval(() => {
      this.lastHeartbeat = new Date().toISOString();
      this.tick();
    }, 30 * 1000);

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000);

    this.cleanupExpiredSessions();
    runTrialLifecycleChecks().catch(() => {});
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.isRunning = false;
    console.log('[Scheduler] Node.js scheduler stopped.');
  }

  async restart(initiatedBy = 'Руководитель', organizationId?: string): Promise<void> {
    this.stop();
    this.start();
    await this.recordBotLog(
      'restart',
      initiatedBy,
      'success',
      `Планировщик и Telegram-сервис перезапущены успешно (pid=${process.pid}).`,
      organizationId
    );
  }

  getStatus() {
    return {
      scheduler: {
        running: this.isRunning,
        pid: process.pid,
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        timezone: 'Europe/Moscow',
        lastHeartbeat: this.lastHeartbeat,
        jobs: Object.values(this.jobs),
      },
      telegram: {
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        managerId: telegramService.getManagerChatId(),
      },
    };
  }

  private async cleanupExpiredSessions(): Promise<void> {
    try {
      await db.query('DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP');

      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: 'numeric',
      }).formatToParts(now);

      const year = parseInt(parts.find(p => p.type === 'year')?.value || `${now.getFullYear()}`, 10);
      const month = parseInt(parts.find(p => p.type === 'month')?.value || `${now.getMonth() + 1}`, 10);

      let targetYear = year;
      let targetMonth = month - 3;
      if (targetMonth < 1) {
        targetMonth += 12;
        targetYear -= 1;
      }
      const cutoffDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
      await db.query('DELETE FROM shift_swaps WHERE date < $1', [cutoffDate]);
      db.checkpointSqlite('PASSIVE');
    } catch (err) {
      console.warn('[Scheduler] Periodic retention cleanup warning:', err);
    }
  }

  private async recordBotLog(
    action: string,
    initiatedBy: string,
    status: string,
    details: string,
    organizationId?: string | null
  ): Promise<void> {
    try {
      const id = `rst-${uuidv4()}`;
      await db.query(
        'INSERT INTO bot_logs (id, organization_id, action, initiated_by, status, details) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, organizationId || null, action, initiatedBy, status, details]
      );
    } catch (err) {
      console.error('[Scheduler] Failed to write bot log:', err);
    }
  }

  private getMoscowTime(): { timeStr: string; dateStr: string; hour: number; minute: number } {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';

    return {
      timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      dateStr: `${year}-${month}-${day}`,
      hour,
      minute,
    };
  }

  private async tick(): Promise<void> {
    const { timeStr, dateStr } = this.getMoscowTime();

    // Check trial & subscription expiration lifecycle every 5 minutes
    if (Date.now() - this.lastTrialCheckAt >= 5 * 60 * 1000) {
      this.lastTrialCheckAt = Date.now();
      await runTrialLifecycleChecks();
    }

    if (timeStr === '20:00') {
      const key = `checkin-reminder-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runCheckInReminder(dateStr);
      }
    } else if (timeStr === '20:50') {
      const key = `sales-reminder-normal-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runSalesReminder(dateStr, false);
      }
    } else if (timeStr === '21:10') {
      const key = `sales-reminder-urgent-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runSalesReminder(dateStr, true);
      }
    } else if (timeStr === '21:15') {
      const key = `daily-report-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runDailyReport(dateStr);
      }
    }

    await this.processCustomScheduledNotifications(timeStr, dateStr);
  }

  private async getActiveOrgIds(): Promise<string[]> {
    const res = await db.query<{ organization_id: string }>(
      "SELECT organization_id FROM subscriptions WHERE status IN ('trial', 'active')"
    );
    return res.rows.map(r => r.organization_id);
  }

  private async runCheckInReminder(dateStr: string): Promise<void> {
    try {
      this.jobs['20:00'].status = 'running';
      const orgIds = await this.getActiveOrgIds();
      for (const orgId of orgIds) {
        const staffRes = await db.query<{ id: string }>(
          "SELECT id FROM users WHERE active_organization_id = $1 AND role = 'employee' AND status = 'active'",
          [orgId]
        );
        const checkinsRes = await db.query<{ user_id: string }>(
          'SELECT user_id FROM checkins WHERE organization_id = $1 AND date = $2',
          [orgId, dateStr]
        );
        const checkedIds = new Set(checkinsRes.rows.map(c => c.user_id));
        const missingStaff = staffRes.rows.filter(s => !checkedIds.has(s.id));

        for (const emp of missingStaff) {
          await db.query(
            `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
             VALUES ($1, $2, $3, $4, $5, 'system', 'scheduler')`,
            [
              `notif-${uuidv4()}`,
              orgId,
              emp.id,
              'Напоминание о смене',
              'Пожалуйста, не забудьте отметиться (Check-in) в системе.',
            ]
          );
        }
      }
      this.jobs['20:00'].lastRun = new Date().toISOString();
      this.jobs['20:00'].status = 'completed';
    } catch (err) {
      console.error('[Scheduler] Error in 20:00 job:', err);
      this.jobs['20:00'].status = 'error';
    }
  }

  private async runSalesReminder(dateStr: string, isUrgent: boolean): Promise<void> {
    const jobKey = isUrgent ? '21:10' : '20:50';
    try {
      this.jobs[jobKey].status = 'running';
      const orgIds = await this.getActiveOrgIds();
      for (const orgId of orgIds) {
        const pendingRes = await db.query<{ user_id: string }>(
          `SELECT c.user_id
           FROM checkins c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN sales s ON s.checkin_id = c.id
           WHERE c.organization_id = $1 AND c.date = $2 AND s.id IS NULL AND u.status = 'active'`,
          [orgId, dateStr]
        );

        for (const row of pendingRes.rows) {
          const title = isUrgent ? '⚠️ СРОЧНО: Внесите выручку!' : '📊 Напоминание о выручке';
          const text = isUrgent
            ? 'До 21:15 необходимо закрыть смену и внести данные по кассе!'
            : 'Смена подходит к концу. Пожалуйста, внесите данные по смене.';

          await db.query(
            `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
             VALUES ($1, $2, $3, $4, $5, 'system', 'scheduler')`,
            [`notif-${uuidv4()}`, orgId, row.user_id, title, text]
          );
        }
      }

      this.jobs[jobKey].lastRun = new Date().toISOString();
      this.jobs[jobKey].status = 'completed';
    } catch (err) {
      console.error(`[Scheduler] Error in ${jobKey} job:`, err);
      this.jobs[jobKey].status = 'error';
    }
  }

  private async runDailyReport(dateStr: string): Promise<void> {
    try {
      this.jobs['21:15'].status = 'running';
      const orgIds = await this.getActiveOrgIds();
      for (const orgId of orgIds) {
        if (!(await telegramService.isConfiguredForOrg(orgId))) continue;
        const res = await telegramService.sendDailySalesReportForOrg(orgId, dateStr);
        await this.recordBotLog(
          'daily_report',
          'Планировщик',
          res.success ? 'success' : 'error',
          res.success ? `Ежедневный отчет за ${dateStr} отправлен.` : `Ошибка отчета: ${res.error}`,
          orgId
        );
      }
      this.jobs['21:15'].status = 'completed';
      this.jobs['21:15'].lastRun = new Date().toISOString();
    } catch (err) {
      console.error('[Scheduler] Error in 21:15 daily report job:', err);
      this.jobs['21:15'].status = 'error';
    }
  }

  private async processCustomScheduledNotifications(timeStr: string, dateStr: string): Promise<void> {
    try {
      const rules = await db.query<{
        id: string;
        organization_id: string | null;
        title: string;
        text: string;
        schedule_type: string;
        time_of_day: string;
        target_role: string;
      }>(
        `SELECT id, organization_id, title, text, schedule_type, time_of_day, target_role
         FROM scheduled_notifications
         WHERE time_of_day = $1 AND is_active = TRUE AND organization_id IS NOT NULL`,
        [timeStr]
      );

      for (const rule of rules.rows) {
        if (!rule.organization_id) continue;
        const idempotencyKey = `custom-notif-${rule.id}-${dateStr}`;
        if (this.executedJobs.has(idempotencyKey)) continue;
        this.executedJobs.add(idempotencyKey);

        let usersQuery = "SELECT id FROM users WHERE active_organization_id = $1 AND role = 'employee' AND status = 'active'";
        if (rule.target_role === 'standard') {
          usersQuery += ' AND is_part_time = FALSE';
        } else if (rule.target_role === 'part_time') {
          usersQuery += ' AND is_part_time = TRUE';
        }

        const employees = await db.query<{ id: string }>(usersQuery, [rule.organization_id]);
        for (const emp of employees.rows) {
          await db.query(
            `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
             VALUES ($1, $2, $3, $4, $5, 'system', 'scheduler')`,
            [`notif-${uuidv4()}`, rule.organization_id, emp.id, rule.title, rule.text]
          );
        }

        const targetLabel =
          rule.target_role === 'all' ? 'Все сотрудники' : rule.target_role === 'standard' ? 'Штатный персонал' : 'Подработчики';
        const telegramMessage = `*${rule.title}*\n\n${rule.text}\n\n─────────────────\nПолучатели: ${targetLabel}\nВремя: ${rule.time_of_day} МСК`;
        const broadcastRes = await telegramService.sendBroadcastToStaffForOrg(
          rule.organization_id,
          telegramMessage,
          rule.target_role as any
        );

        await this.recordBotLog(
          'scheduled_broadcast',
          'Планировщик',
          broadcastRes.success ? 'success' : 'error',
          `Рассылка "${rule.title}" (${targetLabel}, доставлено: ${broadcastRes.deliveredCount} сотрудн.).`,
          rule.organization_id
        );
      }
    } catch (err) {
      console.error('[Scheduler] Error processing custom scheduled notifications:', err);
    }
  }
}

export const schedulerService = new SchedulerService();
