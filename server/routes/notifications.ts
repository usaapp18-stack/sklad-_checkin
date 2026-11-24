import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { telegramService } from '../services/telegram';

export const notificationsRouter = Router();

// GET /api/v1/notifications
notificationsRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      res.json({ success: true, notifications: [] });
      return;
    }

    const isManager = req.user!.role === 'manager';

    const query = isManager
      ? `SELECT id, user_id, to_all, title, text, type, is_read, source, created_at
         FROM notifications
         WHERE organization_id = $1
         ORDER BY created_at DESC LIMIT 100`
      : `SELECT id, user_id, to_all, title, text, type, is_read, source, created_at
         FROM notifications
         WHERE organization_id = $1 AND (user_id = $2 OR to_all = TRUE)
         ORDER BY created_at DESC LIMIT 100`;

    const params = isManager ? [orgId] : [orgId, req.user!.id];
    const result = await db.query(query, params);

    const notifications = result.rows.map(r => ({
      id: r.id,
      toEmployeeId: r.to_all ? 'all' : r.user_id,
      title: r.title,
      text: r.text,
      type: r.type,
      read: Boolean(r.is_read),
      source: r.source,
      timestamp: r.created_at,
    }));

    res.json({ success: true, notifications });
  } catch (err) {
    console.error('[Notifications] Get notifications error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения уведомлений' } });
  }
});

// PATCH /api/v1/notifications/:id/read
notificationsRouter.patch('/:id/read', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const isManager = req.user!.role === 'manager';

    const notifRes = await db.query<{ id: string; user_id: string; to_all: number | boolean }>(
      'SELECT id, user_id, to_all FROM notifications WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (notifRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Уведомление не найдено' } });
      return;
    }

    const notif = notifRes.rows[0];
    if (!isManager && notif.user_id !== req.user!.id && !notif.to_all) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Доступ запрещён. Вы не можете менять чужие уведомления' },
      });
      return;
    }

    await db.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND organization_id = $2', [id, orgId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Mark read error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка обновления статуса' } });
  }
});

// POST /api/v1/notifications/read-all
notificationsRouter.post('/read-all', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    if (req.user!.role === 'manager') {
      await db.query('UPDATE notifications SET is_read = TRUE WHERE organization_id = $1', [orgId]);
    } else {
      await db.query(
        'UPDATE notifications SET is_read = TRUE WHERE organization_id = $1 AND (user_id = $2 OR to_all = TRUE)',
        [orgId, req.user!.id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Read all error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка обновления статуса' } });
  }
});

// DELETE /api/v1/notifications/:id
notificationsRouter.delete('/:id', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const isManager = req.user!.role === 'manager';

    const notifRes = await db.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM notifications WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (notifRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Уведомление не найдено' } });
      return;
    }

    const notif = notifRes.rows[0];
    if (!isManager && notif.user_id !== req.user!.id) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Доступ запрещён. Вы не можете удалять чужие уведомления' },
      });
      return;
    }

    await db.query('DELETE FROM notifications WHERE id = $1 AND organization_id = $2', [id, orgId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Delete notification error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка удаления уведомления' } });
  }
});

// POST /api/v1/notifications/thank-you
notificationsRouter.post('/thank-you', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { location } = req.body;
    if (!location || typeof location !== 'string' || !location.trim()) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Неверная локация' } });
      return;
    }

    const emps = await db.query<{ id: string; name: string }>(
      `SELECT u.id, u.name
       FROM users u
       JOIN user_locations ul ON ul.user_id = u.id
       JOIN locations l ON l.id = ul.location_id
       WHERE l.organization_id = $1 AND l.code = $2 AND u.active_organization_id = $1 AND u.role = 'employee' AND u.status = 'active'`,
      [orgId, location]
    );

    for (const emp of emps.rows) {
      await db.query(
        `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `notif-${uuidv4()}`,
          orgId,
          emp.id,
          'Благодарность от руководителя ❤️',
          `Руководитель выражает огромную благодарность за отличную работу на складе ${location}! Так держать!`,
          'bonus',
          'manager',
        ]
      );
    }

    await logAudit(req, req.user!.id, 'SEND_THANK_YOU', 'notification', null, { location, count: emps.rows.length });
    res.json({ success: true, count: emps.rows.length });
  } catch (err) {
    console.error('[Notifications] Thank you error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка отправки благодарности' } });
  }
});

// GET /api/v1/notifications/schedules
notificationsRouter.get('/schedules', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const result = await db.query(
      'SELECT id, title, text, schedule_type, time_of_day, target_role, is_active FROM scheduled_notifications WHERE organization_id = $1 ORDER BY created_at DESC',
      [orgId]
    );
    const schedules = result.rows.map(r => ({
      id: r.id,
      title: r.title,
      text: r.text,
      scheduleType: r.schedule_type,
      timeOfDay: r.time_of_day,
      targetRole: r.target_role,
      isActive: Boolean(r.is_active),
    }));
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('[Notifications] Get schedules error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения расписаний' } });
  }
});

// POST /api/v1/notifications/schedules
notificationsRouter.post('/schedules', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { title, text, scheduleType, timeOfDay, targetRole } = req.body;
    if (!title || !text || !scheduleType || !timeOfDay || !targetRole) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Заполните все поля' } });
      return;
    }

    const id = `sched-${uuidv4()}`;
    await db.query(
      `INSERT INTO scheduled_notifications (id, organization_id, title, text, schedule_type, time_of_day, target_role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
      [id, orgId, title, text, scheduleType, timeOfDay, targetRole]
    );

    await logAudit(req, req.user!.id, 'CREATE_SCHEDULED_NOTIFICATION', 'notification', id, { title, scheduleType, timeOfDay });
    res.json({ success: true, schedule: { id, title, text, scheduleType, timeOfDay, targetRole, isActive: true } });
  } catch (err) {
    console.error('[Notifications] Create schedule error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка создания расписания' } });
  }
});

// DELETE /api/v1/notifications/schedules/:id
notificationsRouter.delete('/schedules/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    await db.query('DELETE FROM scheduled_notifications WHERE id = $1 AND organization_id = $2', [id, orgId]);
    await logAudit(req, req.user!.id, 'DELETE_SCHEDULED_NOTIFICATION', 'notification', id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Delete schedule error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка удаления расписания' } });
  }
});

// PATCH /api/v1/notifications/schedules/:id/toggle
notificationsRouter.patch('/schedules/:id/toggle', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const { isActive } = req.body;

    await db.query('UPDATE scheduled_notifications SET is_active = $1 WHERE id = $2 AND organization_id = $3', [
      Boolean(isActive),
      id,
      orgId,
    ]);
    await logAudit(req, req.user!.id, 'TOGGLE_SCHEDULED_NOTIFICATION', 'notification', id, { isActive });
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Toggle schedule error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка изменения статуса' } });
  }
});

// POST /api/v1/notifications/schedules/:id/test
notificationsRouter.post('/schedules/:id/test', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const ruleRes = await db.query<{
      id: string;
      title: string;
      text: string;
      schedule_type: string;
      time_of_day: string;
      target_role: string;
    }>(
      'SELECT id, title, text, schedule_type, time_of_day, target_role FROM scheduled_notifications WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (ruleRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Правило рассылки не найдено' } });
      return;
    }

    const rule = ruleRes.rows[0];
    const targetLabel = rule.target_role === 'all' ? 'Все сотрудники' : rule.target_role === 'standard' ? 'Штатный персонал' : 'Подработчики';
    const tgMessage = `*${rule.title}*\n\n${rule.text}\n\n─────────────────\nПолучатели: ${targetLabel}\nВремя: ${rule.time_of_day} МСК`;

    const sendRes = await telegramService.sendBroadcastToStaffForOrg(orgId, tgMessage, rule.target_role as any);
    await logAudit(req, req.user!.id, 'TEST_SCHEDULED_NOTIFICATION', 'notification', id, {
      title: rule.title,
      success: sendRes.success,
      deliveredCount: sendRes.deliveredCount,
    });

    if (sendRes.success) {
      const extra = sendRes.deliveredCount > 0 ? ` (${sendRes.deliveredCount} сотрудн. с Telegram)` : '';
      res.json({
        success: true,
        message: `Рассылка успешно отправлена в Telegram${extra}`,
        deliveredCount: sendRes.deliveredCount,
      });
    } else {
      res.status(400).json({ success: false, error: { code: 'TELEGRAM_ERROR', message: sendRes.error || 'Ошибка отправки в Telegram' } });
    }
  } catch (err) {
    console.error('[Notifications] Test schedule error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка отправки тестового сообщения' } });
  }
});
