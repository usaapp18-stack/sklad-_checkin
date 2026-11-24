import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index';
import { publicContactRateLimiter } from '../middleware/auth';
import { telegramService, escapeMarkdown } from '../services/telegram';

export const publicRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Укажите ваше имя').max(150),
  contact: z.string().trim().min(3, 'Укажите телефон, Email или Telegram').max(150),
  topic: z.string().trim().min(2, 'Выберите тему обращения').max(120),
  message: z.string().trim().min(5, 'Напишите сообщение (минимум 5 символов)').max(2000),
  acceptPrivacy: z.literal(true, {
    message: 'Необходимо согласие на обработку персональных данных',
  }),
  website: z.string().optional(), // Honeypot field
});

// GET /api/v1/public/config
publicRouter.get('/config', (_req: Request, res: Response): void => {
  const contactEmail = process.env.VITE_CONTACT_EMAIL || '';
  const contactPhone = process.env.VITE_CONTACT_PHONE || '';
  const contactTelegram = process.env.VITE_CONTACT_TELEGRAM || '';
  const legalEntityName = process.env.VITE_COMPANY_NAME || 'SKLADIN';
  const yandexMetrikaId = process.env.VITE_YANDEX_METRIKA_ID || '';

  res.json({
    success: true,
    config: {
      brandName: 'SKLADIN',
      contactEmail,
      contactPhone,
      contactTelegram,
      legalEntityName,
      yandexMetrikaId,
      hasRealContacts: Boolean(contactEmail || contactPhone || contactTelegram),
    },
  });
});

// POST /api/v1/public/contact
publicRouter.post('/contact', publicContactRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = contactSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Проверьте заполнение формы' },
      });
      return;
    }

    // Honeypot check: silently ignore automated spam submissions
    if (parse.data.website && parse.data.website.trim().length > 0) {
      res.status(200).json({ success: true, message: 'Сообщение принято' });
      return;
    }

    const id = `lead-${uuidv4()}`;
    const ip = req.ip || req.socket.remoteAddress || null;
    const { name, contact, topic, message } = parse.data;

    await db.query(
      `INSERT INTO contact_leads (id, name, contact, topic, message, consent_accepted, ip, status)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, 'new')`,
      [id, name, contact, topic, message, ip]
    );

    if (telegramService.isConfigured()) {
      telegramService
        .sendMessage(
          `📩 *Новое обращение с сайта SKLADIN*\n\n` +
            `👤 Имя: *${escapeMarkdown(name)}*\n` +
            `📞 Контакт: *${escapeMarkdown(contact)}*\n` +
            `🏷 Тема: *${escapeMarkdown(topic)}*\n` +
            `💬 Сообщение:\n${escapeMarkdown(message)}`
        )
        .catch(() => {});
    }

    res.status(201).json({
      success: true,
      leadId: id,
      message: 'Обращение отправлено. Мы ответим по указанному контакту в рабочее время.',
    });
  } catch (err) {
    console.error('[Public Contact] Submit error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Ошибка отправки обращения' },
    });
  }
});
