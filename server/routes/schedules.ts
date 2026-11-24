import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index';
import { getOrgSetting, setOrgSetting } from '../db/orgSettings';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { PlannedShift, ScheduleTemplate } from '../../src/types';

export const schedulesRouter = Router();

async function getStoredSchedules(organizationId: string): Promise<PlannedShift[]> {
  return getOrgSetting<PlannedShift[]>(organizationId, 'planned_schedules', []);
}

async function saveStoredSchedules(organizationId: string, schedules: PlannedShift[]): Promise<void> {
  await setOrgSetting(organizationId, 'planned_schedules', schedules);
}

async function getStoredTemplates(organizationId: string): Promise<ScheduleTemplate[]> {
  return getOrgSetting<ScheduleTemplate[]>(organizationId, 'schedule_templates', []);
}

async function saveStoredTemplates(organizationId: string, templates: ScheduleTemplate[]): Promise<void> {
  await setOrgSetting(organizationId, 'schedule_templates', templates);
}

// GET /api/v1/schedules
schedulesRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const schedules = await getStoredSchedules(req.user!.organizationId!);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('[Schedules] Get error:', err);
    res.status(500).json({ success: false, error: 'Ошибка получения графика смен' });
  }
});

// GET /api/v1/schedules/templates
schedulesRouter.get('/templates', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await getStoredTemplates(req.user!.organizationId!);
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[Schedule Templates] Get error:', err);
    res.status(500).json({ success: false, error: 'Ошибка получения шаблонов' });
  }
});

// POST /api/v1/schedules/templates
schedulesRouter.post('/templates', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id, name, location, scenarioType, mainStaffIds, partTimeStaffIds, defaultShiftType, notes } = req.body;
    if (!name || !location || !scenarioType) {
      res.status(400).json({ success: false, error: 'Заполните обязательные поля шаблона' });
      return;
    }

    let templates = await getStoredTemplates(orgId);
    const templateId = id || `tpl-${uuidv4()}`;

    const newTemplate: ScheduleTemplate = {
      id: templateId,
      name: String(name).trim(),
      location: String(location).trim(),
      scenarioType,
      mainStaffIds: Array.isArray(mainStaffIds) ? mainStaffIds : [],
      partTimeStaffIds: Array.isArray(partTimeStaffIds) ? partTimeStaffIds : [],
      defaultShiftType: defaultShiftType || 'day12',
      notes: notes ? String(notes).trim() : '',
      createdAt: new Date().toISOString(),
    };

    templates = templates.filter(t => t.id !== templateId);
    templates.push(newTemplate);
    await saveStoredTemplates(orgId, templates);

    res.json({ success: true, templates, template: newTemplate });
  } catch (err) {
    console.error('[Schedule Templates] Save error:', err);
    res.status(500).json({ success: false, error: 'Ошибка сохранения шаблона' });
  }
});

// DELETE /api/v1/schedules/templates/:id
schedulesRouter.delete('/templates/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const templateId = req.params.id;
    let templates = await getStoredTemplates(orgId);
    templates = templates.filter(t => t.id !== templateId);
    await saveStoredTemplates(orgId, templates);
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[Schedule Templates] Delete error:', err);
    res.status(500).json({ success: false, error: 'Ошибка удаления шаблона' });
  }
});

// POST /api/v1/schedules
schedulesRouter.post('/', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { batch, replaceMonth, replaceLocation, date, location, employeeId, employeeName, shiftType, note } = req.body;
    let schedules = await getStoredSchedules(orgId);

    if (Array.isArray(batch)) {
      if (replaceMonth) {
        schedules = schedules.filter(s => {
          const matchMonth = s.date.startsWith(replaceMonth);
          const matchLoc = replaceLocation ? s.location === replaceLocation : true;
          return !(matchMonth && matchLoc);
        });
      } else {
        for (const item of batch) {
          schedules = schedules.filter(s => !(s.date === item.date && s.location === item.location && s.employeeId === item.employeeId));
        }
      }

      for (const item of batch) {
        const conflict = schedules.find(
          s => s.employeeId === item.employeeId && s.date === item.date && s.location !== item.location
        );
        if (!conflict) {
          schedules.push({
            ...item,
            id: item.id || `sch-${uuidv4()}`,
            createdAt: item.createdAt || new Date().toISOString(),
          });
        }
      }
      await saveStoredSchedules(orgId, schedules);
      res.json({ success: true, schedules });
      return;
    }

    if (!date || !location || !employeeId) {
      res.status(400).json({ success: false, error: 'Укажите дату, склад и сотрудника' });
      return;
    }

    const conflictShift = schedules.find(
      s => s.employeeId === employeeId && s.date === date && s.location !== location
    );
    if (conflictShift) {
      res.status(400).json({
        success: false,
        error: `Сотрудник ${employeeName || 'Сотрудник'} уже назначен на смену на складе "${conflictShift.location}" на ${date}. Один сотрудник не может работать на двух складах одновременно.`,
      });
      return;
    }

    schedules = schedules.filter(s => !(s.date === date && s.location === location && s.employeeId === employeeId));

    const newShift: PlannedShift = {
      id: `sch-${uuidv4()}`,
      date,
      location,
      employeeId,
      employeeName: employeeName || 'Сотрудник',
      shiftType: shiftType || 'day12',
      note: note ? String(note).trim() : '',
      createdAt: new Date().toISOString(),
    };

    schedules.push(newShift);
    await saveStoredSchedules(orgId, schedules);

    res.json({ success: true, schedules, item: newShift });
  } catch (err) {
    console.error('[Schedules] Post error:', err);
    res.status(500).json({ success: false, error: 'Ошибка сохранения плановой смены' });
  }
});

// POST /api/v1/schedules/slot
schedulesRouter.post('/slot', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { date, location, shifts } = req.body;
    if (!date || !location) {
      res.status(400).json({ success: false, error: 'Укажите дату и склад' });
      return;
    }

    const shiftList = Array.isArray(shifts) ? shifts : [];
    let schedules = await getStoredSchedules(orgId);

    for (const sh of shiftList) {
      if (!sh.employeeId) continue;
      const conflict = schedules.find(
        s => s.employeeId === sh.employeeId && s.date === date && s.location !== location
      );
      if (conflict) {
        res.status(400).json({
          success: false,
          error: `Сотрудник ${sh.employeeName || 'Сотрудник'} уже назначен на смену на складе "${conflict.location}" на ${date}. Один сотрудник не может работать на двух складах одновременно.`,
        });
        return;
      }
    }

    schedules = schedules.filter(s => !(s.date === date && s.location === location));

    for (const sh of shiftList) {
      if (!sh.employeeId) continue;
      schedules.push({
        id: sh.id || `sch-${uuidv4()}`,
        date,
        location,
        employeeId: sh.employeeId,
        employeeName: sh.employeeName || 'Сотрудник',
        shiftType: sh.shiftType || 'day12',
        note: sh.note ? String(sh.note).trim() : '',
        createdAt: new Date().toISOString(),
      });
    }

    await saveStoredSchedules(orgId, schedules);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('[Schedules] Slot save error:', err);
    res.status(500).json({ success: false, error: 'Ошибка сохранения смен слота' });
  }
});

// POST /api/v1/schedules/publish
schedulesRouter.post('/publish', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { month, location, count } = req.body;
    const publishedAt = new Date().toISOString();

    try {
      await db.query(
        `INSERT INTO notifications (id, organization_id, to_all, title, text, type, location, source)
         VALUES ($1, $2, TRUE, $3, $4, 'status_update', $5, 'manager')`,
        [
          `notif-${uuidv4()}`,
          orgId,
          `📅 Опубликован график смен ${month ? `на ${month}` : ''}`.trim(),
          `Руководитель утвердил и разослал график смен${location ? ` для склада ${location}` : ''}. Проверьте свои запланированные смены в календаре!`,
          location || null,
        ]
      );
    } catch (ne) {
      console.warn('[Schedules] Notification broadcast warning:', ne);
    }

    res.json({ success: true, publishedAt, count });
  } catch (err) {
    console.error('[Schedules] Publish error:', err);
    res.status(500).json({ success: false, error: 'Ошибка публикации графика' });
  }
});

// DELETE /api/v1/schedules/:id
schedulesRouter.delete('/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const scheduleId = req.params.id;
    let schedules = await getStoredSchedules(orgId);
    schedules = schedules.filter(s => s.id !== scheduleId);
    await saveStoredSchedules(orgId, schedules);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('[Schedules] Delete error:', err);
    res.status(500).json({ success: false, error: 'Ошибка удаления смены из графика' });
  }
});
