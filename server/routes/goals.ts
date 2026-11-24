import { Router, Request, Response } from 'express';
import { getOrgSetting, setOrgSetting } from '../db/orgSettings';
import { requireAuth, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { IncomeGoal } from '../../src/types';

export const goalsRouter = Router();

async function getStoredGoals(organizationId: string): Promise<IncomeGoal[]> {
  return getOrgSetting<IncomeGoal[]>(organizationId, 'income_goals', []);
}

async function saveStoredGoals(organizationId: string, goals: IncomeGoal[]): Promise<void> {
  await setOrgSetting(organizationId, 'income_goals', goals);
}

// GET /api/v1/income-goals
goalsRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const allGoals = await getStoredGoals(req.user!.organizationId!);
    const goals = req.user!.role === 'manager'
      ? allGoals
      : allGoals.filter(g => g.employeeId === req.user!.id);
    res.json({ success: true, goals });
  } catch (err) {
    console.error('[Goals] Get error:', err);
    res.status(500).json({ success: false, error: 'Ошибка загрузки целей заработка' });
  }
});

// POST /api/v1/income-goals
goalsRouter.post('/', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { employeeId, month, targetAmount } = req.body;
    const user = req.user!;
    const targetEmpId = user.role === 'manager' && employeeId ? employeeId : user.id;

    if (!month || typeof targetAmount !== 'number') {
      res.status(400).json({ success: false, error: 'Укажите месяц и финансовую цель' });
      return;
    }

    let goals = await getStoredGoals(orgId);
    goals = goals.filter(g => !(g.employeeId === targetEmpId && g.month === month));

    const newGoal: IncomeGoal = {
      employeeId: targetEmpId,
      month,
      targetAmount,
    };

    goals.push(newGoal);
    await saveStoredGoals(orgId, goals);

    res.json({ success: true, goals, goal: newGoal });
  } catch (err) {
    console.error('[Goals] Post error:', err);
    res.status(500).json({ success: false, error: 'Ошибка сохранения цели' });
  }
});
