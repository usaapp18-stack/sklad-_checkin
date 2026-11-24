import { Router, Request, Response } from 'express';
import { db } from '../db/index';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { schedulerService } from '../services/scheduler';
import { telegramService } from '../services/telegram';
import { logAudit } from '../services/audit';

export const botRouter = Router();

// GET /api/v1/bot/status
botRouter.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const status = schedulerService.getStatus();
  const orgId = req.user?.organizationId;
  const tgConfigured = orgId ? await telegramService.isConfiguredForOrg(orgId) : false;

  res.json({
    success: true,
    status: {
      ...status,
      telegramConfigured: tgConfigured,
    },
  });
});

// GET /api/v1/bot/logs
botRouter.get('/logs', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const result = await db.query(
      'SELECT id, action, initiated_by, status, details, created_at FROM bot_logs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50',
      [orgId]
    );

    const logs = result.rows.map(r => ({
      id: r.id,
      timestamp: r.created_at,
      initiatedBy: r.initiated_by,
      status: r.status,
      outputLogs: [
        `[${new Date(r.created_at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}] Действие: ${r.action}`,
        `[${new Date(r.created_at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}] Инициатор: ${r.initiated_by}`,
        `[${new Date(r.created_at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}] Статус: ${r.status}`,
        r.details ? `[${new Date(r.created_at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}] ${r.details}` : '',
      ].filter(Boolean),
    }));

    res.json({ success: true, logs });
  } catch (err) {
    console.error('[Bot] Get logs error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения логов' } });
  }
});

// POST /api/v1/bot/restart
botRouter.post('/restart', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const initiatedBy = req.user?.name || 'Руководитель';
    await schedulerService.restart(initiatedBy, req.user!.organizationId!);
    await logAudit(req, req.user!.id, 'RESTART_BOT', 'bot', null);

    res.json({
      success: true,
      message: 'Сервис Telegram и планировщик успешно перезапущены',
      status: schedulerService.getStatus(),
    });
  } catch (err) {
    console.error('[Bot] Restart error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка перезапуска бота' } });
  }
});
