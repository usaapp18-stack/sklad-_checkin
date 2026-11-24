import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index';
import { DEFAULT_LEGACY_ORG_ID } from '../db/orgSettings';
import { requireManager, requireOrganization, requireActiveWriteAccess, applicationRateLimiter } from '../middleware/auth';
import { checkStaffQuota } from '../services/subscription';
import { logAudit } from '../services/audit';

export const applicationsRouter = Router();

// GET /api/v1/applications (Manager only, org-scoped)
applicationsRouter.get('/', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const result = await db.query(
      'SELECT id, name, telegram_username, status, note, assigned_login, created_at, updated_at FROM applications WHERE organization_id = $1 ORDER BY created_at DESC',
      [orgId]
    );

    const applications = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      telegramUsername: r.telegram_username,
      status: r.status,
      note: r.note,
      generatedLogin: r.assigned_login,
      submittedAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      decidedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
    }));

    res.json({ success: true, applications });
  } catch (err) {
    console.error('[Applications] Get applications error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения заявок' } });
  }
});

const submitAppSchema = z.object({
  name: z.string().min(1, 'Имя обязательно'),
  telegramUsername: z.string().optional(),
  organizationId: z.string().optional(),
});

// POST /api/v1/applications (Public employee registration request)
applicationsRouter.post('/', applicationRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = submitAppSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const { name, telegramUsername, organizationId } = parse.data;
    const appId = `app-${uuidv4()}`;

    let resolvedOrgId: string | null = req.user?.organizationId || null;
    if (!resolvedOrgId && organizationId?.trim()) {
      const orgCheck = await db.query<{ id: string }>(
        'SELECT id FROM organizations WHERE id = $1 OR slug = $1',
        [organizationId.trim()]
      );
      if (orgCheck.rows.length > 0) {
        resolvedOrgId = orgCheck.rows[0].id;
      }
    }
    if (!resolvedOrgId) {
      const defaultOrgCheck = await db.query<{ id: string }>(
        'SELECT id FROM organizations WHERE id = $1',
        [DEFAULT_LEGACY_ORG_ID]
      );
      resolvedOrgId = defaultOrgCheck.rows[0]?.id || null;
    }

    await db.query(
      'INSERT INTO applications (id, organization_id, name, telegram_username, status) VALUES ($1, $2, $3, $4, $5)',
      [appId, resolvedOrgId, name.trim(), telegramUsername?.trim() || null, 'pending']
    );

    res.status(201).json({
      success: true,
      applicationId: appId,
      message: 'Заявка успешно отправлена на рассмотрение руководителю',
    });
  } catch (err) {
    console.error('[Applications] Submit application error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка при отправке заявки' } });
  }
});

const handleAppSchema = z.object({
  action: z.enum(['accept', 'reject']),
  note: z.string().optional(),
  generatedLogin: z.string().optional(),
  generatedPassword: z.string().optional(),
  assignedLocations: z.array(z.string()).default([]),
  isSenior: z.boolean().default(false),
});

// PATCH /api/v1/applications/:id (Manager only)
applicationsRouter.patch('/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const parse = handleAppSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const { action, note, generatedLogin, generatedPassword, assignedLocations, isSenior } = parse.data;

    const appRes = await db.query<{ id: string; name: string; telegram_username?: string; status: string }>(
      'SELECT id, name, telegram_username, status FROM applications WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (appRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } });
      return;
    }

    const app = appRes.rows[0];

    if (action === 'accept') {
      const quota = await checkStaffQuota(orgId);
      if (!quota.allowed) {
        res.status(403).json({
          success: false,
          error: {
            code: 'QUOTA_EXCEEDED',
            message: quota.message || 'Достигнут лимит сотрудников по вашему тарифу',
          },
        });
        return;
      }

      if (!generatedLogin || !generatedPassword) {
        res.status(400).json({
          success: false,
          error: { code: 'CREDENTIALS_REQUIRED', message: 'Для одобрения требуется логин и пароль' },
        });
        return;
      }

      const cleanLogin = generatedLogin.trim();
      const existingUser = await db.query('SELECT id FROM users WHERE LOWER(login) = LOWER($1)', [cleanLogin]);
      if (existingUser.rows.length > 0) {
        res.status(409).json({
          success: false,
          error: { code: 'LOGIN_EXISTS', message: `Логин «${cleanLogin}» уже занят` },
        });
        return;
      }

      const newUserId = `emp-${uuidv4()}`;
      const salt = bcrypt.genSaltSync(10);
      const cleanPass = generatedPassword.trim();
      const hash = bcrypt.hashSync(cleanPass, salt);

      await db.transaction(async client => {
        await client.query(
          `INSERT INTO users (id, login, password_hash, password_plain, name, role, status, active_organization_id, is_part_time, is_senior, telegram_username)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [newUserId, cleanLogin, hash, cleanPass, app.name, 'employee', 'active', orgId, false, isSenior, app.telegram_username]
        );

        await client.query(
          `INSERT INTO organization_members (id, organization_id, user_id, org_role, status)
           VALUES ($1, $2, $3, 'employee', 'active')`,
          [`mem-${uuidv4()}`, orgId, newUserId]
        );

        for (const locCode of assignedLocations) {
          const locRes = await client.query<{ id: string }>(
            'SELECT id FROM locations WHERE organization_id = $1 AND code = $2',
            [orgId, locCode]
          );
          if (locRes.rows.length > 0) {
            await client.query('INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)', [
              newUserId,
              locRes.rows[0].id,
            ]);
          }
        }

        await client.query(
          "UPDATE applications SET status = 'approved', note = $1, assigned_login = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND organization_id = $4",
          [note?.trim() || null, cleanLogin, id, orgId]
        );

        await client.query(
          `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            `notif-${uuidv4()}`,
            orgId,
            newUserId,
            'Заявка одобрена!',
            `Ваша заявка на регистрацию одобрена. Ваш логин: "${cleanLogin}".`,
            'system',
            'manager',
          ]
        );
      });

      await logAudit(req, req.user!.id, 'APPROVE_APPLICATION', 'application', id, { newUserId, login: cleanLogin });
    } else {
      await db.query(
        "UPDATE applications SET status = 'rejected', note = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND organization_id = $3",
        [note?.trim() || null, id, orgId]
      );
      await logAudit(req, req.user!.id, 'REJECT_APPLICATION', 'application', id, { note });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Applications] Handle application error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка обработки заявки' } });
  }
});
