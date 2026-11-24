import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { telegramService } from '../services/telegram';
import { logAudit } from '../services/audit';

export const telegramRouter = Router();

const sendSchema = z.object({
  message: z.string().min(1, 'Сообщение не может быть пустым'),
  chatId: z.string().optional(),
});

// POST /api/v1/telegram/send
telegramRouter.post('/send', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const parse = sendSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const { message, chatId } = parse.data;
    const isManager = req.user!.role === 'manager';
    const settings = await telegramService.getSettingsForOrg(orgId);

    if (isManager && chatId && settings.managerChatId && chatId !== settings.managerChatId) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_CHAT_ID',
          message: 'Отправка сообщений разрешена только в авторизованный чат руководителя',
        },
      });
      return;
    }

    const result = await telegramService.sendMessageForOrg(orgId, message);

    if (!result.success) {
      res.status(502).json({
        success: false,
        error: { code: 'TELEGRAM_ERROR', message: result.error || 'Ошибка отправки в Telegram' },
      });
      return;
    }

    res.json({
      success: true,
      simulated: result.simulated,
      message: result.simulated
        ? 'Сообщение обработано (токен Telegram не задан, вывод направлен в журнал)'
        : 'Сообщение успешно отправлено в Telegram',
    });
  } catch (err) {
    console.error('[Telegram] Send error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Внутренняя ошибка отправки' } });
  }
});

// POST /api/v1/telegram/notify
telegramRouter.post('/notify', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: { message: 'Текст сообщения обязателен' } });
      return;
    }

    const result = await telegramService.sendMessageForOrg(orgId, message);
    res.json({
      success: result.success,
      simulated: result.simulated,
      message: result.simulated
        ? 'Уведомление обработано (токен Telegram не задан)'
        : 'Уведомление успешно отправлено в Telegram',
    });
  } catch (err) {
    console.error('[Telegram] Notify error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка доставки уведомления' } });
  }
});

// GET /api/v1/telegram/settings
telegramRouter.get('/settings', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const settings = await telegramService.getSettingsForOrg(orgId);
    const isConfigured = Boolean(settings.botToken && settings.managerChatId);
    res.json({
      success: true,
      settings: {
        isConfigured,
        botToken: settings.botToken,
        managerChatId: settings.managerChatId,
        botUsername: settings.botUsername,
        updatedAt: settings.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Telegram] Settings error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка получения настроек Telegram' } });
  }
});

// POST /api/v1/telegram/settings
telegramRouter.post('/settings', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { botToken, managerChatId } = req.body || {};
    const trimmedToken = (botToken || '').trim();
    const trimmedChat = (managerChatId || '').trim();

    if (!trimmedToken || !trimmedChat) {
      res.status(400).json({ success: false, error: { message: 'Укажите токен бота и ID чата руководителя' } });
      return;
    }

    let botUsername = '';
    try {
      const checkRes = await fetch(`https://api.telegram.org/bot${trimmedToken}/getMe`);
      const checkData = await checkRes.json();
      if (!checkData.ok) {
        res.status(400).json({ success: false, error: { message: 'Неверный токен бота. Telegram отклонил авторизацию.' } });
        return;
      }
      botUsername = checkData.result?.username || '';
    } catch (e: any) {
      res.status(400).json({ success: false, error: { message: 'Не удалось проверить токен в Telegram API: ' + e.message } });
      return;
    }

    const updatedAt = new Date().toISOString();
    await telegramService.setSettingsForOrg(orgId, {
      botToken: trimmedToken,
      managerChatId: trimmedChat,
      botUsername,
      updatedAt,
    });

    await logAudit(req, req.user!.id, 'UPDATE_TELEGRAM_SETTINGS', 'system', null, { managerChatId: trimmedChat, botUsername });

    res.json({
      success: true,
      settings: {
        isConfigured: true,
        botToken: trimmedToken,
        managerChatId: trimmedChat,
        botUsername,
        updatedAt,
      },
    });
  } catch (err) {
    console.error('[Telegram] Save settings error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка сохранения настроек' } });
  }
});

// DELETE /api/v1/telegram/settings
telegramRouter.delete('/settings', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    await telegramService.clearSettingsForOrg(orgId);
    await logAudit(req, req.user!.id, 'DISCONNECT_TELEGRAM', 'system', null, {});
    res.json({ success: true });
  } catch (err) {
    console.error('[Telegram] Delete settings error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка отключения Telegram' } });
  }
});

// POST /api/v1/telegram/test
telegramRouter.post('/test', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { botToken, managerChatId } = req.body || {};
    const settings = await telegramService.getSettingsForOrg(orgId);
    const token = (botToken || settings.botToken || '').trim();
    const chatId = (managerChatId || settings.managerChatId || '').trim();

    if (!token || !chatId) {
      res.status(400).json({ success: false, error: { message: 'Сначала заполните токен бота и ID чата руководителя' } });
      return;
    }

    const nowStr = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());

    const testMsg =
      `📋 *Тестовое сообщение из панели управления SKLADIN*\n\n` +
      `Интеграция с Telegram успешно подключена!\n` +
      `⏰ Время отправки: *${nowStr}* (МСК)\n\n` +
      `Сюда будут приходить уведомления о выходах на смену, явках сотрудников, заявках и бирже смен.`;

    const resSend = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMsg,
        parse_mode: 'Markdown',
      }),
    });
    const dataSend = await resSend.json();

    if (dataSend && dataSend.ok) {
      res.json({ success: true, message: 'Тестовое сообщение успешно отправлено в Telegram!' });
    } else {
      res.status(400).json({
        success: false,
        error: {
          message:
            dataSend?.description ||
            'Ошибка отправки. Убедитесь, что вы нажали START в диалоге с ботом и указали верный Chat ID.',
        },
      });
    }
  } catch (err) {
    console.error('[Telegram] Test error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка сети при отправке тестового сообщения' } });
  }
});

// GET /api/v1/telegram/templates
telegramRouter.get('/templates', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await telegramService.getTemplatesForOrg(req.user!.organizationId!);
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[Telegram] Get templates error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка получения шаблонов Telegram' } });
  }
});

// POST /api/v1/telegram/templates
telegramRouter.post('/templates', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { templates } = req.body || {};
    if (!templates || typeof templates !== 'object') {
      res.status(400).json({ success: false, error: { message: 'Неверный формат данных шаблонов' } });
      return;
    }

    await telegramService.setTemplatesForOrg(orgId, templates);
    await logAudit(req, req.user!.id, 'UPDATE_TELEGRAM_TEMPLATES', 'system', null, { templateKeys: Object.keys(templates) });

    res.json({ success: true, templates: await telegramService.getTemplatesForOrg(orgId) });
  } catch (err) {
    console.error('[Telegram] Save templates error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка сохранения шаблонов' } });
  }
});
