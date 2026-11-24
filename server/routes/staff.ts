import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index';
import { getOrgSetting, setOrgSetting } from '../db/orgSettings';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { checkStaffQuota } from '../services/subscription';
import { logAudit } from '../services/audit';

export const staffRouter = Router();

const DEFAULT_POSITIONS = [
  'Начальник склада',
  'Кладовщик',
  'Сборщик',
  'Упаковщик',
  'Сборщик/упаковщик',
  'Грузчик',
  'Приемщик',
  'Охранник',
  'Администратор',
  'Разнорабочий',
  'Работник склада',
];

async function getWarehousePositions(organizationId: string): Promise<string[]> {
  const custom = await getOrgSetting<string[]>(organizationId, 'warehouse_positions', []);
  return Array.from(new Set([...DEFAULT_POSITIONS, ...(Array.isArray(custom) ? custom : [])]));
}

// GET /api/v1/staff/positions
staffRouter.get('/positions', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const positions = await getWarehousePositions(req.user!.organizationId!);
    res.json({ success: true, positions });
  } catch (err) {
    console.error('[Staff] Get positions error:', err);
    res.json({ success: true, positions: DEFAULT_POSITIONS });
  }
});

// POST /api/v1/staff/positions
staffRouter.post('/positions', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { name } = req.body;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      res.status(400).json({ success: false, error: { message: 'Название должности обязательно' } });
      return;
    }

    const currentPositions = await getWarehousePositions(orgId);
    if (!currentPositions.includes(cleanName)) {
      currentPositions.push(cleanName);
      await setOrgSetting(orgId, 'warehouse_positions', currentPositions);
    }

    res.json({ success: true, positions: currentPositions });
  } catch (err: any) {
    console.error('[Staff] Add position error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка сохранения должности' } });
  }
});

// GET /api/v1/staff
staffRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const isManager = req.user?.role === 'manager';

    const usersQuery = isManager
      ? `SELECT id, login, password_plain, name, role, status, is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate, created_at, updated_at
         FROM users
         WHERE active_organization_id = $1 AND role = 'employee'
         ORDER BY name ASC`
      : `SELECT id, name, role, status, is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate
         FROM users
         WHERE active_organization_id = $1 AND role = 'employee' AND status = 'active'
         ORDER BY name ASC`;

    const usersRes = await db.query(usersQuery, [orgId]);

    const userLocsRes = await db.query<{ user_id: string; code: string }>(
      `SELECT ul.user_id, l.code
       FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
       WHERE l.organization_id = $1`,
      [orgId]
    );

    const locMap = new Map<string, string[]>();
    for (const row of userLocsRes.rows) {
      if (!locMap.has(row.user_id)) {
        locMap.set(row.user_id, []);
      }
      locMap.get(row.user_id)!.push(row.code);
    }

    const staffList = usersRes.rows.map(u => ({
      id: u.id,
      name: u.name,
      login: isManager ? u.login : undefined,
      password: isManager ? u.password_plain || undefined : undefined,
      role: u.role,
      status: u.status,
      isPartTime: Boolean(u.is_part_time),
      isSenior: Boolean(u.is_senior),
      hasAccess: u.status === 'active',
      telegramUsername: u.telegram_username,
      position: u.position || 'Работник склада',
      payType: u.pay_type || 'hourly',
      hourlyRate: u.hourly_rate != null ? Number(u.hourly_rate) : 350,
      shiftRate: u.shift_rate != null ? Number(u.shift_rate) : 3500,
      nightRate: u.night_rate != null ? Number(u.night_rate) : 0,
      locations: locMap.get(u.id) || [],
      registeredAt: u.created_at,
    }));

    res.json({ success: true, staff: staffList });
  } catch (err) {
    console.error('[Staff] Get staff error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения сотрудников' } });
  }
});

const staffCreateSchema = z.object({
  name: z.string().min(1, 'Имя обязательно'),
  login: z.string().min(1, 'Логин обязателен'),
  password: z.string().min(1, 'Пароль обязателен'),
  locations: z.array(z.string()).min(1, 'Необходимо выбрать хотя бы одно место работы'),
  isPartTime: z.boolean().default(false),
  isSenior: z.boolean().default(false),
  telegramUsername: z.string().optional(),
  position: z.string().optional(),
  payType: z.enum(['hourly', 'shift']).default('hourly'),
  hourlyRate: z.number().default(350),
  shiftRate: z.number().default(3500),
  nightRate: z.number().default(0),
});

// POST /api/v1/staff (Manager only, quota & active subscription enforced)
staffRouter.post('/', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
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

    const parse = staffCreateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const { name, login, password, locations, isPartTime, isSenior, telegramUsername, position, payType, hourlyRate, shiftRate, nightRate } = parse.data;
    const cleanLogin = login.trim();

    if (!locations || locations.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Необходимо указать хотя бы одну локацию' },
      });
      return;
    }

    const existing = await db.query('SELECT id FROM users WHERE LOWER(login) = LOWER($1)', [cleanLogin]);
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: { code: 'LOGIN_EXISTS', message: 'Сотрудник с таким логином уже зарегистрирован' },
      });
      return;
    }

    const userId = `emp-${uuidv4()}`;
    const salt = bcrypt.genSaltSync(10);
    const cleanPassword = password.trim();
    const passwordHash = bcrypt.hashSync(cleanPassword, salt);
    const pos = position?.trim() || 'Работник склада';
    const pType = payType || 'hourly';
    const hRate = hourlyRate != null ? Number(hourlyRate) : 350;
    const sRate = shiftRate != null ? Number(shiftRate) : 3500;
    const nRate = nightRate != null ? Number(nightRate) : 0;

    await db.transaction(async client => {
      await client.query(
        `INSERT INTO users (
           id, login, password_hash, password_plain, name, role, status, active_organization_id,
           is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [userId, cleanLogin, passwordHash, cleanPassword, name.trim(), 'employee', 'active', orgId, isPartTime, isSenior, telegramUsername?.trim() || null, pos, pType, hRate, sRate, nRate]
      );

      await client.query(
        `INSERT INTO organization_members (id, organization_id, user_id, org_role, status)
         VALUES ($1, $2, $3, 'employee', 'active')`,
        [`mem-${uuidv4()}`, orgId, userId]
      );

      for (const locCode of locations) {
        const locRes = await client.query<{ id: string }>(
          'SELECT id FROM locations WHERE organization_id = $1 AND code = $2',
          [orgId, locCode]
        );
        let locId = locRes.rows[0]?.id;
        if (!locId) {
          locId = `loc-${uuidv4()}`;
          await client.query(
            'INSERT INTO locations (id, organization_id, code, name) VALUES ($1, $2, $3, $4)',
            [locId, orgId, locCode, `Склад ${locCode}`]
          );
        }
        await client.query('INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)', [userId, locId]);
      }

      await client.query(
        `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `notif-${uuidv4()}`,
          orgId,
          userId,
          'Добро пожаловать в команду!',
          `Ваша учетная запись активирована. Логин: "${cleanLogin}". Должность: ${pos}. Доступные склады: ${locations.join(', ')}.`,
          'system',
          'manager',
        ]
      );
    });

    await logAudit(req, req.user!.id, 'CREATE_STAFF', 'user', userId, { name, login: cleanLogin, locations, isSenior, position: pos, payType: pType });

    res.status(201).json({
      success: true,
      staff: {
        id: userId,
        name: name.trim(),
        login: cleanLogin,
        password: cleanPassword,
        role: 'employee',
        status: 'active',
        isPartTime,
        isSenior,
        hasAccess: true,
        position: pos,
        payType: pType,
        hourlyRate: hRate,
        shiftRate: sRate,
        nightRate: nRate,
        locations,
      },
    });
  } catch (err) {
    console.error('[Staff] Create staff error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка при создании сотрудника' } });
  }
});

const staffUpdateSchema = z.object({
  name: z.string().optional(),
  login: z.string().optional(),
  password: z.string().optional(),
  locations: z.array(z.string()).optional(),
  isPartTime: z.boolean().optional(),
  isSenior: z.boolean().optional(),
  status: z.enum(['active', 'blocked', 'archived', 'deactivated']).optional(),
  telegramUsername: z.string().optional(),
  position: z.string().optional(),
  payType: z.enum(['hourly', 'shift']).optional(),
  hourlyRate: z.number().optional(),
  shiftRate: z.number().optional(),
  nightRate: z.number().optional(),
});

// PATCH /api/v1/staff/:id
staffRouter.patch('/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const parse = staffUpdateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const { name, login, password, locations, isPartTime, isSenior, status, telegramUsername, position, payType, hourlyRate, shiftRate, nightRate } = parse.data;

    if (locations && locations.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Необходимо указать хотя бы одну локацию' },
      });
      return;
    }

    const userRes = await db.query<{ id: string; status: string }>(
      'SELECT id, status FROM users WHERE id = $1 AND active_organization_id = $2',
      [id, orgId]
    );
    if (userRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Сотрудник не найден' } });
      return;
    }

    // Check quota if restoring an archived employee
    if (userRes.rows[0].status === 'archived' && status === 'active') {
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
    }

    if (login) {
      const conflictRes = await db.query('SELECT id FROM users WHERE LOWER(login) = LOWER($1) AND id != $2', [
        login.trim(),
        id,
      ]);
      if (conflictRes.rows.length > 0) {
        res.status(409).json({ success: false, error: { code: 'LOGIN_EXISTS', message: 'Такой логин уже занят' } });
        return;
      }
    }

    await db.transaction(async client => {
      const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const params: any[] = [];

      if (name) {
        params.push(name.trim());
        updates.push(`name = $${params.length}`);
      }
      if (login) {
        params.push(login.trim());
        updates.push(`login = $${params.length}`);
      }
      if (password && password.trim().length > 0) {
        const cleanPassword = password.trim();
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(cleanPassword, salt);
        params.push(hash);
        updates.push(`password_hash = $${params.length}`);
        params.push(cleanPassword);
        updates.push(`password_plain = $${params.length}`);
      }
      if (isPartTime !== undefined) {
        params.push(isPartTime);
        updates.push(`is_part_time = $${params.length}`);
      }
      if (isSenior !== undefined) {
        params.push(isSenior);
        updates.push(`is_senior = $${params.length}`);
      }
      if (status) {
        const canonicalStatus = status === 'deactivated' ? 'blocked' : status;
        params.push(canonicalStatus);
        updates.push(`status = $${params.length}`);

        await client.query(
          'UPDATE organization_members SET status = $1 WHERE organization_id = $2 AND user_id = $3',
          [canonicalStatus, orgId, id]
        );

        if (canonicalStatus === 'blocked' || canonicalStatus === 'archived') {
          await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
        }
      }
      if (telegramUsername !== undefined) {
        params.push(telegramUsername.trim() || null);
        updates.push(`telegram_username = $${params.length}`);
      }
      if (position !== undefined) {
        params.push(position.trim() || 'Работник склада');
        updates.push(`position = $${params.length}`);
      }
      if (payType !== undefined) {
        params.push(payType);
        updates.push(`pay_type = $${params.length}`);
      }
      if (hourlyRate !== undefined) {
        params.push(Number(hourlyRate));
        updates.push(`hourly_rate = $${params.length}`);
      }
      if (shiftRate !== undefined) {
        params.push(Number(shiftRate));
        updates.push(`shift_rate = $${params.length}`);
      }
      if (nightRate !== undefined) {
        params.push(Number(nightRate));
        updates.push(`night_rate = $${params.length}`);
      }

      params.push(id, orgId);
      await client.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND active_organization_id = $${params.length}`,
        params
      );

      if (locations) {
        await client.query('DELETE FROM user_locations WHERE user_id = $1', [id]);
        for (const locCode of locations) {
          const locRes = await client.query<{ id: string }>(
            'SELECT id FROM locations WHERE organization_id = $1 AND code = $2',
            [orgId, locCode]
          );
          let locId = locRes.rows[0]?.id;
          if (!locId) {
            locId = `loc-${uuidv4()}`;
            await client.query(
              'INSERT INTO locations (id, organization_id, code, name) VALUES ($1, $2, $3, $4)',
              [locId, orgId, locCode, `Склад ${locCode}`]
            );
          }
          await client.query('INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)', [id, locId]);
        }
      }
    });

    await logAudit(req, req.user!.id, 'UPDATE_STAFF', 'user', id, { name, login, status, locations });

    res.json({ success: true });
  } catch (err) {
    console.error('[Staff] Update staff error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка при обновлении сотрудника' } });
  }
});

// DELETE /api/v1/staff/:id
staffRouter.delete('/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const isHardDelete = req.query.hard === 'true';

    const userRes = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM users WHERE id = $1 AND active_organization_id = $2',
      [id, orgId]
    );
    if (userRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Сотрудник не найден' } });
      return;
    }

    if (isHardDelete) {
      const { confirmation } = req.body || {};
      if (confirmation !== 'DELETE USER') {
        res.status(400).json({
          success: false,
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Для безвозвратного удаления требуется явное подтверждение: confirmation="DELETE USER"',
          },
        });
        return;
      }

      await db.transaction(async client => {
        await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
        await client.query('DELETE FROM user_locations WHERE user_id = $1', [id]);
        await client.query('DELETE FROM messages WHERE from_user_id = $1 AND organization_id = $2', [id, orgId]);
        await client.query('DELETE FROM notifications WHERE user_id = $1 AND organization_id = $2', [id, orgId]);
        await client.query('DELETE FROM sales WHERE user_id = $1 AND organization_id = $2', [id, orgId]);
        await client.query('DELETE FROM checkins WHERE user_id = $1 AND organization_id = $2', [id, orgId]);
        await client.query('DELETE FROM organization_members WHERE user_id = $1 AND organization_id = $2', [id, orgId]);
        await client.query('DELETE FROM users WHERE id = $1 AND active_organization_id = $2', [id, orgId]);
      });
      await logAudit(req, req.user!.id, 'HARD_DELETE_STAFF', 'user', id, { name: userRes.rows[0].name });
    } else {
      await db.query("UPDATE users SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND active_organization_id = $2", [id, orgId]);
      await db.query("UPDATE organization_members SET status = 'archived' WHERE user_id = $1 AND organization_id = $2", [id, orgId]);
      await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      await logAudit(req, req.user!.id, 'ARCHIVE_STAFF', 'user', id, { name: userRes.rows[0].name });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Staff] Delete staff error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка при удалении сотрудника' } });
  }
});
