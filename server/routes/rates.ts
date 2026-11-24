import { Router, Request, Response } from 'express';
import { getOrgSetting, setOrgSetting } from '../db/orgSettings';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';

export const ratesRouter = Router();

export const DEFAULT_RATES = {
  day12: 3500,
  night12: 4000,
  standard8: 2800,
  part6: 2100,
  part4: 1400,
  daily24: 7000,
  standard: 3500,
  '400+': 3800,
  '500+': 4200,
  '8h': 2800,
  '4h': 1400,
  partTimeShiftRate: 2100,
  nightBonus: 500,
  seniorBonus: 500,
  partTimeBonus: 0,
  shiftTypes: [
    { code: 'day12', name: 'Дневная смена (12ч)', baseRate: 3500, isArchived: false },
    { code: 'night12', name: 'Ночная смена (12ч)', baseRate: 4000, isArchived: false },
    { code: 'standard8', name: 'Стандартная (8ч)', baseRate: 2800, isArchived: false },
    { code: 'part6', name: 'Подработка (6ч)', baseRate: 2100, isArchived: false },
    { code: 'part4', name: 'Подработка (4ч)', baseRate: 1400, isArchived: false },
    { code: 'daily24', name: 'Суточная (24ч)', baseRate: 7000, isArchived: false },
  ],
  partTimeShiftTypes: [
    { code: 'part4', name: 'Подработка (4ч)', baseRate: 1400, isArchived: false },
    { code: 'part6', name: 'Подработка (6ч)', baseRate: 2100, isArchived: false },
    { code: 'pt_standard', name: 'Смена подработчика (полная)', baseRate: 2800, isArchived: false },
  ],
  bonuses: [
    { code: 'seniorBonus', name: 'Доплата Старшему (Ст.С.)', value: 500, isArchived: false, target: 'senior' },
    { code: 'partTimeBonus', name: 'Доплата Подработчику', value: 0, isArchived: false, target: 'part_time' },
  ],
};

// GET /api/v1/rates
ratesRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const parsed = await getOrgSetting<Record<string, any>>(orgId, 'rates', {});
    res.json({ success: true, rates: { ...DEFAULT_RATES, ...parsed } });
  } catch (err) {
    console.error('[Rates] Get rates error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения ставок' } });
  }
});

// POST /api/v1/rates (Manager only)
ratesRouter.post('/', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    await setOrgSetting(orgId, 'rates', req.body);
    res.json({ success: true, rates: req.body });
  } catch (err) {
    console.error('[Rates] Save rates error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка сохранения ставок' } });
  }
});
