import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../db/index';
import { getOrganizationById, getOrganizationSubscription } from '../services/subscription';
import type { OrganizationInfo, SubscriptionInfo } from '../../src/types';

export interface AuthUser {
  id: string;
  login: string;
  email?: string;
  phone?: string;
  name: string;
  role: 'employee' | 'manager';
  status: string;
  organizationId: string | null;
  orgRole: 'owner' | 'manager' | 'employee' | null;
  organization?: OrganizationInfo | null;
  subscription?: SubscriptionInfo | null;
  isPartTime: boolean;
  isSenior: boolean;
  telegramUsername?: string;
  position?: string;
  payType?: 'hourly' | 'shift';
  hourlyRate?: number;
  shiftRate?: number;
  nightRate?: number;
  locations: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionToken?: string;
    }
  }
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function setCsrfCookie(res: Response, req?: Request): string {
  const token = crypto.randomBytes(32).toString('hex');
  const isHttps =
    Boolean(req?.secure) ||
    req?.headers?.['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';
  res.cookie('pvz_csrf', token, {
    httpOnly: false,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    ...(isHttps ? { partitioned: true } : {}),
  } as any);
  return token;
}

export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : req.cookies?.pvz_session;

    if (!token) {
      req.user = undefined;
      return next();
    }

    req.sessionToken = token;
    const tokenHash = hashSessionToken(token);

    const sessionRes = await db.query<{
      user_id: string;
      expires_at: string;
      login: string;
      email?: string;
      phone?: string;
      name: string;
      role: 'employee' | 'manager';
      status: string;
      active_organization_id?: string | null;
      is_part_time: number | boolean;
      is_senior: number | boolean;
      telegram_username?: string;
      position?: string;
      pay_type?: string;
      hourly_rate?: number;
      shift_rate?: number;
      night_rate?: number;
    }>(
      `SELECT s.user_id, s.expires_at, u.login, u.email, u.phone, u.name, u.role, u.status,
              u.active_organization_id, u.is_part_time, u.is_senior, u.telegram_username,
              u.position, u.pay_type, u.hourly_rate, u.shift_rate, u.night_rate
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [tokenHash]
    );

    if (sessionRes.rows.length === 0) {
      req.user = undefined;
      return next();
    }

    const session = sessionRes.rows[0];

    if (new Date(session.expires_at) < new Date()) {
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      req.user = undefined;
      return next();
    }

    if (session.status === 'blocked' || session.status === 'archived') {
      req.user = undefined;
      return next();
    }

    let organizationId: string | null = session.active_organization_id || null;
    let orgRole: 'owner' | 'manager' | 'employee' | null = null;

    if (organizationId) {
      const memRes = await db.query<{ org_role: string; status: string }>(
        'SELECT org_role, status FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [organizationId, session.user_id]
      );
      if (memRes.rows.length > 0 && memRes.rows[0].status === 'active') {
        orgRole = (memRes.rows[0].org_role as 'owner' | 'manager' | 'employee') || session.role;
      } else {
        orgRole = session.role;
      }
    } else {
      const fallbackMem = await db.query<{ organization_id: string; org_role: string }>(
        "SELECT organization_id, org_role FROM organization_members WHERE user_id = $1 AND status = 'active' LIMIT 1",
        [session.user_id]
      );
      if (fallbackMem.rows.length > 0) {
        organizationId = fallbackMem.rows[0].organization_id;
        orgRole = (fallbackMem.rows[0].org_role as 'owner' | 'manager' | 'employee') || session.role;
      }
    }

    const [organization, subscription] = organizationId
      ? await Promise.all([
          getOrganizationById(organizationId),
          getOrganizationSubscription(organizationId),
        ])
      : [null, null];

    const locRes = organizationId
      ? await db.query<{ code: string }>(
          `SELECT l.code FROM locations l
           JOIN user_locations ul ON ul.location_id = l.id
           WHERE ul.user_id = $1 AND l.organization_id = $2`,
          [session.user_id, organizationId]
        )
      : { rows: [] as { code: string }[] };

    req.user = {
      id: session.user_id,
      login: session.login,
      email: session.email || undefined,
      phone: session.phone || undefined,
      name: session.name,
      role: session.role,
      status: session.status,
      organizationId,
      orgRole,
      organization,
      subscription,
      isPartTime: Boolean(session.is_part_time),
      isSenior: Boolean(session.is_senior),
      telegramUsername: session.telegram_username,
      position: session.position || 'Работник склада',
      payType: session.pay_type === 'shift' ? 'shift' : 'hourly',
      hourlyRate: session.hourly_rate != null ? Number(session.hourly_rate) : 350,
      shiftRate: session.shift_rate != null ? Number(session.shift_rate) : 3500,
      nightRate: session.night_rate != null ? Number(session.night_rate) : 0,
      locations: locRes.rows.map(r => r.code),
    };

    next();
  } catch (err) {
    console.error('[Auth Middleware] Authentication error:', err);
    req.user = undefined;
    next();
  }
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Требуется авторизация в системе' },
    });
    return;
  }
  next();
};

export const requireManager = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Требуется авторизация в системе' },
    });
    return;
  }
  if (req.user.role !== 'manager') {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Доступ разрешен только руководителю' },
    });
    return;
  }
  next();
};

export const requireOrganization = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Требуется авторизация в системе' },
    });
    return;
  }
  if (!req.user.organizationId) {
    res.status(409).json({
      success: false,
      error: {
        code: 'ORGANIZATION_REQUIRED',
        message: 'Для начала работы создайте организацию в рабочем кабинете',
      },
    });
    return;
  }
  next();
};

export const requireActiveWriteAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Требуется авторизация в системе' },
    });
    return;
  }
  if (!req.user.organizationId) {
    res.status(409).json({
      success: false,
      error: {
        code: 'ORGANIZATION_REQUIRED',
        message: 'Для выполнения операций сначала создайте организацию',
      },
    });
    return;
  }
  if (req.user.subscription?.status === 'expired_readonly' || req.user.subscription?.isReadOnly) {
    res.status(403).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_EXPIRED_READONLY',
        message:
          'Срок действия пробного периода или подписки истёк. Включён режим только для чтения. Оформите подписку, чтобы вносить изменения.',
      },
    });
    return;
  }
  next();
};

interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const ipRateLimits = new Map<string, RateLimitEntry>();

export const loginRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 15;

  const current = ipRateLimits.get(ip);
  if (!current || now > current.resetAt) {
    ipRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }

  if (current.count >= maxAttempts) {
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfterSec);
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Слишком много попыток входа. Попробуйте через ${Math.ceil(retryAfterSec / 60)} мин.`,
      },
    });
    return;
  }

  current.count++;
  next();
};

const appRateLimits = new Map<string, RateLimitEntry>();

export const applicationRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 5;

  const current = appRateLimits.get(ip);
  if (!current || now > current.resetAt) {
    appRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }

  if (current.count >= maxAttempts) {
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfterSec);
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Слишком много заявок. Попробуйте через ${Math.ceil(retryAfterSec / 60)} мин.`,
      },
    });
    return;
  }

  current.count++;
  next();
};

const publicContactLimits = new Map<string, RateLimitEntry>();

export const publicContactRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 6;

  const current = publicContactLimits.get(ip);
  if (!current || now > current.resetAt) {
    publicContactLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }

  if (current.count >= maxAttempts) {
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfterSec);
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Слишком много обращений. Попробуйте через ${Math.ceil(retryAfterSec / 60)} мин.`,
      },
    });
    return;
  }

  current.count++;
  next();
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const originalUrl = req.originalUrl || req.url;
  if (
    originalUrl.startsWith('/api/v1/auth/login') ||
    originalUrl.startsWith('/api/auth/login') ||
    originalUrl.startsWith('/api/v1/auth/register-manager') ||
    originalUrl.startsWith('/api/auth/register-manager') ||
    originalUrl === '/api/v1/applications' ||
    originalUrl === '/api/applications' ||
    originalUrl.startsWith('/api/v1/public/contact') ||
    originalUrl.startsWith('/api/public/contact') ||
    originalUrl.startsWith('/api/v1/billing/webhooks/') ||
    originalUrl.startsWith('/api/billing/webhooks/') ||
    originalUrl.startsWith('/api/v1/auth/csrf-token') ||
    originalUrl.startsWith('/api/auth/csrf-token')
  ) {
    return next();
  }

  if (req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }

  const cookieToken = req.cookies?.pvz_csrf;
  const headerToken = req.headers['x-csrf-token'] as string;

  if (cookieToken && headerToken && cookieToken === headerToken) {
    return next();
  }

  if (req.user) {
    if (headerToken && cookieToken && headerToken !== cookieToken) {
      res.status(403).json({
        success: false,
        error: {
          code: 'CSRF_INVALID',
          message: 'Ошибка CSRF-валидации запроса',
        },
      });
      return;
    }
    return next();
  }

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({
      success: false,
      error: {
        code: 'CSRF_INVALID',
        message: 'Ошибка CSRF-валидации запроса',
      },
    });
    return;
  }

  next();
};
