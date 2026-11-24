import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireManager, requireOrganization } from '../middleware/auth';
import {
  createOrganizationWithTrial,
  getOrganizationById,
  getOrganizationSubscription,
  getOrganizationUsage,
} from '../services/subscription';
import { isValidTariffId, normalizeBillingPeriod } from '../../src/config/tariffs';
import { logAudit } from '../services/audit';

export const organizationRouter = Router();

const createOrgSchema = z.object({
  name: z.string().trim().min(2, 'Укажите название организации').max(120),
  inn: z.string().trim().max(20).optional(),
  timezone: z.string().trim().max(64).optional(),
  selectedPlan: z.string().optional(),
  selectedPeriod: z.union([z.number(), z.string()]).optional(),
});

const updateOrgSchema = z.object({
  name: z.string().trim().min(2, 'Укажите название организации').max(120).optional(),
  inn: z.string().trim().max(20).optional(),
  timezone: z.string().trim().max(64).optional(),
});

// GET /api/v1/organization
organizationRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      res.json({
        success: true,
        organization: null,
        subscription: null,
        usage: { locationsCount: 0, staffCount: 0 },
      });
      return;
    }

    const [organization, subscription, usage] = await Promise.all([
      getOrganizationById(orgId),
      getOrganizationSubscription(orgId),
      getOrganizationUsage(orgId),
    ]);

    res.json({ success: true, organization, subscription, usage });
  } catch (err) {
    console.error('[Organization] Get error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения данных организации' } });
  }
});

// POST /api/v1/organization (Manager creates org during /app onboarding and activates 7-day trial)
organizationRouter.post('/', requireManager, async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user!.organizationId) {
      res.status(409).json({
        success: false,
        error: { code: 'ORGANIZATION_EXISTS', message: 'Организация уже создана для вашей учётной записи' },
      });
      return;
    }

    const parse = createOrgSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Некорректные данные организации' },
      });
      return;
    }

    const { name, inn, timezone, selectedPlan, selectedPeriod } = parse.data;
    const { organization, subscription } = await createOrganizationWithTrial({
      ownerUserId: req.user!.id,
      name,
      inn,
      timezone,
      selectedTariffId: isValidTariffId(selectedPlan) ? selectedPlan : undefined,
      selectedPeriodMonths: normalizeBillingPeriod(selectedPeriod || 1),
    });

    await logAudit(
      req,
      req.user!.id,
      'CREATE_ORGANIZATION',
      'organization',
      organization.id,
      { name: organization.name, trialEndsAt: subscription.trialEndsAt },
      organization.id
    );

    res.status(201).json({
      success: true,
      organization,
      subscription,
      usage: { locationsCount: 0, staffCount: 0 },
    });
  } catch (err) {
    console.error('[Organization] Create error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка создания организации' } });
  }
});

// PATCH /api/v1/organization
organizationRouter.patch('/', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = updateOrgSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Некорректные данные' },
      });
      return;
    }

    const orgId = req.user!.organizationId!;
    const { name, inn, timezone } = parse.data;

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [];
    if (name !== undefined) {
      params.push(name);
      updates.push(`name = $${params.length}`);
    }
    if (inn !== undefined) {
      params.push(inn || null);
      updates.push(`inn = $${params.length}`);
    }
    if (timezone !== undefined) {
      params.push(timezone || 'Europe/Moscow');
      updates.push(`timezone = $${params.length}`);
    }

    params.push(orgId);
    await db.query(`UPDATE organizations SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

    const organization = await getOrganizationById(orgId);
    await logAudit(req, req.user!.id, 'UPDATE_ORGANIZATION', 'organization', orgId, { name, inn, timezone });

    res.json({ success: true, organization });
  } catch (err) {
    console.error('[Organization] Update error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка обновления организации' } });
  }
});

// GET /api/v1/organization/usage
organizationRouter.get('/usage', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const [usage, subscription] = await Promise.all([
      getOrganizationUsage(orgId),
      getOrganizationSubscription(orgId),
    ]);

    res.json({
      success: true,
      usage: {
        ...usage,
        maxLocations: subscription?.maxLocations ?? 1,
        maxStaff: subscription?.maxStaff ?? 2,
        tariffId: subscription?.tariffId ?? 'start',
        tariffName: subscription?.tariffName ?? 'Старт',
      },
    });
  } catch (err) {
    console.error('[Organization] Usage error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения статистики лимитов' } });
  }
});
