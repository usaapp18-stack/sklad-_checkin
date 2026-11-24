import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { logAudit } from '../services/audit';

export const messagesRouter = Router();

// GET /api/v1/messages
messagesRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const isManager = req.user!.role === 'manager';

    const query = isManager
      ? `SELECT m.id, m.from_user_id, u.name as from_user_name, m.message, m.is_read, m.created_at
         FROM messages m
         JOIN users u ON u.id = m.from_user_id
         WHERE m.organization_id = $1
         ORDER BY m.created_at DESC`
      : `SELECT m.id, m.from_user_id, u.name as from_user_name, m.message, m.is_read, m.created_at
         FROM messages m
         JOIN users u ON u.id = m.from_user_id
         WHERE m.organization_id = $1 AND m.from_user_id = $2
         ORDER BY m.created_at DESC`;

    const params = isManager ? [orgId] : [orgId, req.user!.id];
    const result = await db.query(query, params);

    const messages = result.rows.map(r => ({
      id: r.id,
      fromEmployeeId: r.from_user_id,
      fromEmployeeName: r.from_user_name,
      message: r.message,
      read: Boolean(r.is_read),
      timestamp: r.created_at,
    }));

    res.json({ success: true, messages });
  } catch (err) {
    console.error('[Messages] Get messages error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения сообщений' } });
  }
});

const createMessageSchema = z.object({
  message: z.string().min(1, 'Текст сообщения не может быть пустым'),
});

// POST /api/v1/messages
messagesRouter.post('/', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const parse = createMessageSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const fromUserId = req.user!.id;
    const msgId = `msg-${uuidv4()}`;

    await db.query(
      'INSERT INTO messages (id, organization_id, from_user_id, message) VALUES ($1, $2, $3, $4)',
      [msgId, orgId, fromUserId, parse.data.message.trim()]
    );

    await logAudit(req, req.user!.id, 'SEND_MESSAGE', 'message', msgId);

    res.status(201).json({
      success: true,
      message: {
        id: msgId,
        fromEmployeeId: fromUserId,
        fromEmployeeName: req.user!.name,
        message: parse.data.message.trim(),
        read: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[Messages] Post message error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка отправки сообщения' } });
  }
});

// PATCH /api/v1/messages/:id/read
messagesRouter.patch('/:id/read', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const isManager = req.user!.role === 'manager';

    const checkRes = await db.query<{ id: string; from_user_id: string }>(
      'SELECT id, from_user_id FROM messages WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (checkRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } });
      return;
    }

    const msg = checkRes.rows[0];
    if (!isManager && msg.from_user_id !== req.user!.id) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Доступ запрещён. Вы не можете менять статус чужого сообщения' },
      });
      return;
    }

    await db.query('UPDATE messages SET is_read = TRUE WHERE id = $1 AND organization_id = $2', [id, orgId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Messages] Mark read error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка обновления статуса' } });
  }
});

// POST /api/v1/messages/read-all
messagesRouter.post('/read-all', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const isManager = req.user!.role === 'manager';

    if (isManager) {
      await db.query('UPDATE messages SET is_read = TRUE WHERE organization_id = $1', [orgId]);
    } else {
      await db.query('UPDATE messages SET is_read = TRUE WHERE organization_id = $1 AND from_user_id = $2', [
        orgId,
        req.user!.id,
      ]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Messages] Read all error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка обновления статуса' } });
  }
});

// POST /api/v1/messages/:id/reply
messagesRouter.post('/:id/reply', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    if (req.user!.role !== 'manager') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Только руководитель может отвечать на сообщения' } });
      return;
    }

    const { id } = req.params;
    const { replyText } = req.body;

    if (!replyText || typeof replyText !== 'string' || !replyText.trim()) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Введите текст ответа' } });
      return;
    }

    const msgRes = await db.query<{ id: string; from_user_id: string; message: string }>(
      'SELECT id, from_user_id, message FROM messages WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (msgRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Сообщение не найдено' } });
      return;
    }

    const origMsg = msgRes.rows[0];
    const notifId = `notif-${uuidv4()}`;
    await db.query(
      `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [notifId, orgId, origMsg.from_user_id, 'Ответ от руководителя', replyText.trim(), 'system', 'manager']
    );

    await db.query('UPDATE messages SET is_read = TRUE WHERE id = $1 AND organization_id = $2', [id, orgId]);
    await logAudit(req, req.user!.id, 'REPLY_MESSAGE', 'message', id, { targetUserId: origMsg.from_user_id });

    res.json({ success: true, notificationId: notifId });
  } catch (err) {
    console.error('[Messages] Reply error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка отправки ответа' } });
  }
});
