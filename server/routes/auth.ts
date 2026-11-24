import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index';
import { loginRateLimiter, requireAuth, hashSessionToken, setCsrfCookie } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { getOrganizationById, getOrganizationSubscription } from '../services/subscription';

export const authRouter = Router();

const loginSchema = z.object({
  login: z.string().min(1, 'Логин не может быть пустым'),
  password: z.string().min(1, 'Пароль не может быть пустым'),
});

const registerManagerSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите ФИО (минимум 2 символа)').max(150),
  email: z.string().trim().email('Укажите корректный Email').max(180),
  phone: z.string().trim().min(10, 'Укажите корректный номер телефона').max(30),
  password: z.string().min(6, 'Пароль должен содержать не менее 6 символов').max(128),
  acceptPrivacy: z.literal(true, {
    message: 'Необходимо согласие на обработку персональных данных',
  }),
  acceptTerms: z.literal(true, {
    message: 'Необходимо принять условия пользовательского соглашения',
  }),
});

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '+7' + digits;
  }
  return input.trim();
}

// GET /api/v1/auth/csrf-token
authRouter.get('/csrf-token', (req: Request, res: Response): void => {
  const csrfToken = setCsrfCookie(res, req);
  res.json({ success: true, csrfToken });
});

// POST /api/v1/auth/register-manager
// Public manager registration: creates user account ONLY (organization is created inside /app onboarding).
authRouter.post('/register-manager', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = registerManagerSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Проверьте заполнение полей' },
      });
      return;
    }

    const { fullName, email, phone, password } = parse.data;
    const cleanEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.replace(/\D/g, '').length < 11) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Введите корректный номер телефона в формате +7...' },
      });
      return;
    }

    // Check conflicts across email, phone, and login
    const dupRes = await db.query<{ id: string }>(
      `SELECT id FROM users
       WHERE LOWER(email) = LOWER($1)
          OR phone = $2
          OR LOWER(login) = LOWER($1)
          OR login = $2`,
      [cleanEmail, normalizedPhone]
    );
    if (dupRes.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: {
          code: 'ACCOUNT_EXISTS',
          message: 'Пользователь с таким Email или номером телефона уже зарегистрирован. Выполните вход.',
        },
      });
      return;
    }

    const userId = `mgr-${uuidv4()}`;
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const nowIso = new Date().toISOString();

    await db.query(
      `INSERT INTO users (
         id, login, password_hash, name, email, phone, role, status,
         active_organization_id, is_part_time, is_senior, position,
         consent_privacy_at, consent_terms_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'manager', 'active', NULL, FALSE, FALSE, 'Начальник склада', $7, $7)`,
      [userId, normalizedPhone, passwordHash, fullName.trim(), cleanEmail, normalizedPhone, nowIso]
    );

    // Issue session immediately
    const sessionToken = uuidv4();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db.query(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [`sess-${uuidv4()}`, userId, tokenHash, expiresAt]
    );

    const isHttps =
      Boolean(req.secure) ||
      req.headers['x-forwarded-proto'] === 'https' ||
      process.env.NODE_ENV === 'production';

    res.cookie('pvz_session', sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      ...(isHttps ? { partitioned: true } : {}),
    } as any);

    const csrfToken = setCsrfCookie(res, req);
    await logAudit(req, userId, 'REGISTER_MANAGER', 'user', userId, { email: cleanEmail, phone: normalizedPhone }, null);

    res.status(201).json({
      success: true,
      token: sessionToken,
      csrfToken,
      user: {
        id: userId,
        login: normalizedPhone,
        email: cleanEmail,
        phone: normalizedPhone,
        name: fullName.trim(),
        role: 'manager',
        status: 'active',
        organization_id: null,
        org_role: null,
        organization: null,
        subscription: null,
        is_part_time: false,
        is_senior: false,
        position: 'Начальник склада',
        pay_type: 'hourly',
        hourly_rate: 350,
        shift_rate: 3500,
        night_rate: 0,
        locations: [],
      },
    });
  } catch (err) {
    console.error('[Auth] Register manager error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Внутренняя ошибка сервера при регистрации' },
    });
  }
});

// POST /api/v1/auth/login
authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parseResult.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const { login, password } = parseResult.data;
    const cleanLogin = login.trim();
    const normalizedPhone = normalizePhone(cleanLogin);

    const userRes = await db.query<{
      id: string;
      login: string;
      email?: string;
      phone?: string;
      password_hash: string;
      name: string;
      role: 'manager' | 'employee';
      status: 'active' | 'blocked' | 'archived';
      active_organization_id?: string | null;
      is_part_time: boolean;
      is_senior: boolean;
      telegram_username?: string;
      position?: string;
      pay_type?: string;
      hourly_rate?: number;
      shift_rate?: number;
      night_rate?: number;
    }>(
      `SELECT id, login, email, phone, password_hash, name, role, status, active_organization_id,
              is_part_time, is_senior, telegram_username, position, pay_type, hourly_rate, shift_rate, night_rate
       FROM users
       WHERE LOWER(login) = LOWER($1)
          OR login = $2
          OR LOWER(COALESCE(email, '')) = LOWER($1)
          OR COALESCE(phone, '') = $2`,
      [cleanLogin, normalizedPhone]
    );

    if (userRes.rows.length === 0) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Неверный логин или пароль' },
      });
      return;
    }

    const user = userRes.rows[0];

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Неверный логин или пароль' },
      });
      return;
    }

    if (user.status === 'blocked' || user.status === 'archived') {
      res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_BLOCKED', message: 'Учетная запись заблокирована или архивирована' },
      });
      return;
    }

    let organizationId: string | null = user.active_organization_id || null;
    let orgRole: string | null = null;
    if (organizationId) {
      const mem = await db.query<{ org_role: string }>(
        'SELECT org_role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [organizationId, user.id]
      );
      orgRole = mem.rows[0]?.org_role || user.role;
    } else {
      const mem = await db.query<{ organization_id: string; org_role: string }>(
        "SELECT organization_id, org_role FROM organization_members WHERE user_id = $1 AND status = 'active' LIMIT 1",
        [user.id]
      );
      if (mem.rows.length > 0) {
        organizationId = mem.rows[0].organization_id;
        orgRole = mem.rows[0].org_role;
      }
    }

    const [organization, subscription] = organizationId
      ? await Promise.all([
          getOrganizationById(organizationId),
          getOrganizationSubscription(organizationId),
        ])
      : [null, null];

    const sessionToken = uuidv4();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db.query(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [`sess-${uuidv4()}`, user.id, tokenHash, expiresAt]
    );

    const locRes = organizationId
      ? await db.query<{ code: string }>(
          `SELECT l.code FROM locations l
           JOIN user_locations ul ON ul.location_id = l.id
           WHERE ul.user_id = $1 AND l.organization_id = $2`,
          [user.id, organizationId]
        )
      : { rows: [] as { code: string }[] };
    const locations = locRes.rows.map(r => r.code);

    const isHttps =
      Boolean(req.secure) ||
      req.headers['x-forwarded-proto'] === 'https' ||
      process.env.NODE_ENV === 'production';

    res.cookie('pvz_session', sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      ...(isHttps ? { partitioned: true } : {}),
    } as any);

    const csrfToken = setCsrfCookie(res, req);

    await logAudit(req, user.id, 'LOGIN', 'user', user.id, { role: user.role, login: user.login }, organizationId);

    res.json({
      success: true,
      token: sessionToken,
      csrfToken,
      user: {
        id: user.id,
        login: user.login,
        email: user.email || undefined,
        phone: user.phone || undefined,
        name: user.name,
        role: user.role,
        status: user.status,
        organization_id: organizationId,
        org_role: orgRole,
        organization,
        subscription,
        is_part_time: Boolean(user.is_part_time),
        is_senior: Boolean(user.is_senior),
        telegram_username: user.telegram_username,
        position: user.position || 'Работник склада',
        pay_type: user.pay_type || 'hourly',
        hourly_rate: user.hourly_rate != null ? Number(user.hourly_rate) : 350,
        shift_rate: user.shift_rate != null ? Number(user.shift_rate) : 3500,
        night_rate: user.night_rate != null ? Number(user.night_rate) : 0,
        locations,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Внутренняя ошибка сервера при входе' },
    });
  }
});

// POST /api/v1/auth/logout
authRouter.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    let token = req.cookies?.pvz_session;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      const tokenHash = hashSessionToken(token);
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    }

    res.clearCookie('pvz_session');
    res.clearCookie('pvz_csrf');

    if (req.user) {
      await logAudit(req, req.user.id, 'LOGOUT', 'user', req.user.id);
    }

    res.json({ success: true, message: 'Успешный выход из системы' });
  } catch (err) {
    console.error('[Auth] Logout error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Ошибка при выходе из системы' },
    });
  }
});

// GET /api/v1/auth/me
authRouter.get('/me', requireAuth, (req: Request, res: Response): void => {
  const csrfToken = req.cookies?.pvz_csrf || setCsrfCookie(res, req);

  res.json({
    success: true,
    csrfToken,
    user: {
      id: req.user!.id,
      login: req.user!.login,
      email: req.user!.email,
      phone: req.user!.phone,
      name: req.user!.name,
      role: req.user!.role,
      status: req.user!.status,
      organization_id: req.user!.organizationId,
      org_role: req.user!.orgRole,
      organization: req.user!.organization || null,
      subscription: req.user!.subscription || null,
      is_part_time: req.user!.isPartTime,
      is_senior: req.user!.isSenior,
      telegram_username: req.user!.telegramUsername,
      position: req.user!.position || 'Работник склада',
      pay_type: req.user!.payType || 'hourly',
      hourly_rate: req.user!.hourlyRate ?? 350,
      shift_rate: req.user!.shiftRate ?? 3500,
      night_rate: req.user!.nightRate ?? 0,
      locations: req.user!.locations,
    },
  });
});
