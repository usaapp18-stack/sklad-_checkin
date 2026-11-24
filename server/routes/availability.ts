import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getOrgSetting, setOrgSetting } from '../db/orgSettings';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { AvailabilityRequest } from '../../src/types';

export const availabilityRouter = Router();

async function getStoredAvailability(organizationId: string): Promise<AvailabilityRequest[]> {
  return getOrgSetting<AvailabilityRequest[]>(organizationId, 'staff_availability', []);
}

async function saveStoredAvailability(organizationId: string, list: AvailabilityRequest[]): Promise<void> {
  await setOrgSetting(organizationId, 'staff_availability', list);
}

// GET /api/v1/availability
availabilityRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const list = await getStoredAvailability(req.user!.organizationId!);
    res.json({ success: true, availability: list });
  } catch (err) {
    console.error('[Availability] Get error:', err);
    res.status(500).json({ success: false, error: 'Ошибка получения пожеланий' });
  }
});

// POST /api/v1/availability
availabilityRouter.post('/', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { date, type, comment } = req.body;
    const user = req.user!;

    if (!date || !type) {
      res.status(400).json({ success: false, error: 'Укажите дату и категорию пожелания' });
      return;
    }

    let list = await getStoredAvailability(orgId);
    list = list.filter(a => !(a.employeeId === user.id && a.date === date));

    const newReq: AvailabilityRequest = {
      id: `avail-${uuidv4()}`,
      employeeId: user.id,
      employeeName: user.name,
      date,
      type,
      comment: comment ? String(comment).trim() : '',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    list.push(newReq);
    await saveStoredAvailability(orgId, list);

    res.json({ success: true, availability: list, item: newReq });
  } catch (err) {
    console.error('[Availability] Post error:', err);
    res.status(500).json({ success: false, error: 'Ошибка сохранения пожелания' });
  }
});

// PATCH /api/v1/availability/:id
availabilityRouter.patch('/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const availId = req.params.id;
    const { status } = req.body;
    let list = await getStoredAvailability(orgId);
    list = list.map(a => (a.id === availId ? { ...a, status: status || 'approved' } : a));
    await saveStoredAvailability(orgId, list);
    res.json({ success: true, availability: list });
  } catch (err) {
    console.error('[Availability] Patch error:', err);
    res.status(500).json({ success: false, error: 'Ошибка обновления статуса пожелания' });
  }
});

// DELETE /api/v1/availability/:id
availabilityRouter.delete('/:id', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const availId = req.params.id;
    let list = await getStoredAvailability(orgId);
    const target = list.find(a => a.id === availId);
    if (target && req.user!.role !== 'manager' && target.employeeId !== req.user!.id) {
      res.status(403).json({ success: false, error: 'Вы можете удалять только свои пожелания' });
      return;
    }
    list = list.filter(a => a.id !== availId);
    await saveStoredAvailability(orgId, list);
    res.json({ success: true, availability: list });
  } catch (err) {
    console.error('[Availability] Delete error:', err);
    res.status(500).json({ success: false, error: 'Ошибка удаления пожелания' });
  }
});
