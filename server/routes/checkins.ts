import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index';
import { DEFAULT_LEGACY_ORG_ID } from '../db/orgSettings';
import { requireAuth, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { telegramService } from '../services/telegram';
import { logAudit } from '../services/audit';

export const checkinsRouter = Router();

// POST /api/v1/checkin-alerts or /api/v1/checkins/checkin-alerts
checkinsRouter.post(['/alerts', '/checkin-alerts'], requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const today = getTodayMoscowDate();

    const locRes = await db.query<{ code: string; name: string }>(
      'SELECT code, name FROM locations WHERE organization_id = $1 AND active = TRUE AND is_archived = FALSE',
      [orgId]
    );

    const activeLocs = locRes.rows;

    const checkinsRes = await db.query<{ location_code: string }>(
      'SELECT DISTINCT location_code FROM checkins WHERE organization_id = $1 AND date = $2',
      [orgId, today]
    );

    const checkedLocations = new Set(checkinsRes.rows.map(c => c.location_code));
    const missing = activeLocs
      .filter(loc => !checkedLocations.has(loc.code))
      .map(loc => loc.code);

    res.json({
      success: true,
      missing,
      checkedCount: checkedLocations.size,
      totalCount: activeLocs.length,
    });
  } catch (err) {
    console.error('[Checkins Alert Error]:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка проверки открытий смен' } });
  }
});

const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isValidCalendarDate(dateStr: string): boolean {
  if (!dateRegex.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

function getTodayMoscowDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

const checkinSchema = z.object({
  employeeId: z.string().optional(),
  location: z.string().min(1, 'Локация обязательна'),
  shiftType: z.string().min(1, 'Тип смены обязателен'),
  date: z
    .string()
    .refine((val: string) => !val || isValidCalendarDate(val), { message: 'Некорректная дата (требуется ГГГГ-ММ-ДД)' })
    .optional(),
  qrVerified: z.boolean().optional(),
  geoVerified: z.boolean().optional(),
  zone: z.string().optional(),
  notes: z.string().optional(),
});

const CHECKIN_SHIFT_LABELS: Record<string, string> = {
  day12: 'Дневная смена (12ч)',
  night12: 'Ночная смена (12ч)',
  standard8: 'Стандартная (8ч)',
  part4: 'Подработка (4ч)',
  part6: 'Подработка (6ч)',
  daily24: 'Суточная (24ч)',
  standard: 'Дневная смена (12ч)',
  '400+': 'Дневная (усиленная)',
  '500+': 'Смена (пиковая)',
  '8h': '8 часов',
  '4h': '4 часа',
};

function getDefaultHoursForShift(shiftType: string): number {
  if (shiftType === 'standard8' || shiftType === '8h') return 8;
  if (shiftType === 'part4' || shiftType === '4h') return 4;
  if (shiftType === 'part6') return 6;
  if (shiftType === 'daily24') return 22;
  return 11;
}

async function getActiveShiftRate(userId: string, shiftType: string, organizationId: string, client: any): Promise<number> {
  try {
    const userRes = await client.query(
      'SELECT is_part_time, is_senior, pay_type, hourly_rate, shift_rate FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) return 3500;
    const user = userRes.rows[0];
    const isPartTime = Boolean(user.is_part_time || user.is_part_time === 1 || user.is_part_time === '1' || user.is_part_time === true);

    if (user.pay_type === 'shift' && Number(user.shift_rate) > 0) {
      return Number(user.shift_rate);
    }
    if (user.pay_type === 'hourly' && Number(user.hourly_rate) > 0) {
      return Math.round(getDefaultHoursForShift(shiftType) * Number(user.hourly_rate));
    }

    let ratesRes = await client.query(
      "SELECT value FROM org_settings WHERE organization_id = $1 AND key = 'rates'",
      [organizationId]
    );
    if (ratesRes.rows.length === 0 && organizationId === DEFAULT_LEGACY_ORG_ID) {
      ratesRes = await client.query("SELECT value FROM settings WHERE key = 'rates'");
    }

    let rates: any = {
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
    };
    if (ratesRes.rows.length > 0) {
      try {
        rates = { ...rates, ...JSON.parse(ratesRes.rows[0].value) };
      } catch {}
    }

    const shiftTypes = rates.shiftTypes || [];
    const foundType = shiftTypes.find((t: any) => t.code === shiftType);

    let baseRate = 3500;
    if (foundType) {
      baseRate = Number(foundType.baseRate);
    } else {
      baseRate = Number(rates[shiftType]) || 3500;
    }

    if (isPartTime && (shiftType === 'standard' || shiftType === 'day12')) {
      baseRate = Number(rates.partTimeShiftRate) || baseRate;
    }

    return baseRate;
  } catch (err) {
    console.error('[Rates History Helper] Error getting active rate:', err);
    return 3500;
  }
}

// GET /api/v1/checkins
checkinsRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { date } = req.query;
    const isManager = req.user!.role === 'manager';

    let query = `
      SELECT 
        c.id,
        c.user_id,
        u.name as employee_name,
        c.location_code as location,
        c.shift_type,
        c.date,
        c.checked_in_at,
        c.check_out_at,
        c.worked_hours,
        c.break_minutes,
        c.qr_verified,
        c.geo_verified,
        c.zone,
        c.notes,
        c.edit_count,
        c.base_rate,
        (SELECT COUNT(*) FROM checkin_cancellations cc WHERE cc.user_id = c.user_id AND cc.date = c.date) as cancel_count,
        s.id as sales_id,
        s.photo_cash,
        s.photo_card,
        s.print_cash,
        s.print_card,
        s.lamination_cash,
        s.lamination_card,
        s.total as sales_total,
        s.bonus as sales_bonus,
        s.submitted_at as sales_submitted_at
      FROM checkins c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN sales s ON s.checkin_id = c.id
    `;
    const params: any[] = [orgId];
    const whereClauses: string[] = ['c.organization_id = $1'];

    if (!isManager) {
      params.push(req.user!.id);
      whereClauses.push(`c.user_id = $${params.length}`);
    }

    if (date && typeof date === 'string') {
      if (!isValidCalendarDate(date)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Некорректный формат даты' } });
        return;
      }
      params.push(date);
      whereClauses.push(`c.date = $${params.length}`);
    }

    query += ' WHERE ' + whereClauses.join(' AND ') + ' ORDER BY c.date DESC, c.checked_in_at DESC';

    const result = await db.query(query, params);

    const records = result.rows.map(r => ({
      id: r.id,
      employeeId: r.user_id,
      employeeName: r.employee_name,
      location: r.location,
      shiftType: r.shift_type,
      date: r.date,
      checkedInAt: r.checked_in_at,
      checkOutAt: r.check_out_at || undefined,
      workedHours: r.worked_hours !== null && r.worked_hours !== undefined ? Number(r.worked_hours) : undefined,
      breakMinutes: r.break_minutes !== null && r.break_minutes !== undefined ? Number(r.break_minutes) : undefined,
      qrVerified: Boolean(r.qr_verified === true || r.qr_verified === 1 || r.qr_verified === '1'),
      geoVerified: Boolean(r.geo_verified === true || r.geo_verified === 1 || r.geo_verified === '1'),
      zone: r.zone || undefined,
      notes: r.notes || undefined,
      editCount: Number(r.edit_count || 0),
      cancelCount: Number(r.cancel_count || 0),
      baseRate: r.base_rate !== null && r.base_rate !== undefined ? Number(r.base_rate) : undefined,
      sales: r.sales_id
        ? {
            cash: Number(r.photo_cash || 0) + Number(r.print_cash || 0) + Number(r.lamination_cash || 0),
            card: Number(r.photo_card || 0) + Number(r.print_card || 0) + Number(r.lamination_card || 0),
            photo: { cash: Number(r.photo_cash || 0), card: Number(r.photo_card || 0) },
            print: { cash: Number(r.print_cash || 0), card: Number(r.print_card || 0) },
            lamination: { cash: Number(r.lamination_cash || 0), card: Number(r.lamination_card || 0) },
            total: Number(r.sales_total || 0),
            bonus: Number(r.sales_bonus || 0),
          }
        : null,
      salesSubmittedAt: r.sales_submitted_at,
    }));

    let cancelledDates: string[] = [];
    if (!isManager) {
      const cancelRes = await db.query<{ date: string }>(
        'SELECT date FROM checkin_cancellations WHERE user_id = $1 AND organization_id = $2',
        [req.user!.id, orgId]
      );
      cancelledDates = cancelRes.rows.map(row => row.date);
    }

    res.json({ success: true, records, cancelledDates });
  } catch (err) {
    console.error('[Checkins] Get checkins error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения записей смен' } });
  }
});

// POST /api/v1/checkins (Strict single check-in per user/date, org-scoped, active subscription required)
checkinsRouter.post('/', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const parse = checkinSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные' },
      });
      return;
    }

    const { location, shiftType, date, qrVerified, geoVerified, zone, notes } = parse.data;
    const today = getTodayMoscowDate();
    const isManager = req.user!.role === 'manager';
    const targetUserId = isManager && parse.data.employeeId ? parse.data.employeeId : req.user!.id;

    let targetDate = today;
    if (date) {
      if (!isManager && date !== today) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_DATE', message: 'Сотрудники могут отмечать явку только за текущий день' },
        });
        return;
      }
      targetDate = date;
    }

    const userRes = await db.query<{ id: string; name: string; status: string; role: string }>(
      'SELECT id, name, status, role FROM users WHERE id = $1 AND active_organization_id = $2',
      [targetUserId, orgId]
    );

    if (userRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Сотрудник не найден в текущей организации' } });
      return;
    }

    const targetUser = userRes.rows[0];
    if (targetUser.status === 'blocked' || targetUser.status === 'archived') {
      res.status(403).json({
        success: false,
        error: { code: 'USER_INACTIVE', message: 'Сотрудник заблокирован или архивирован' },
      });
      return;
    }

    if (!isManager) {
      const locCheck = await db.query<{ id: string }>(
        `SELECT l.id FROM locations l
         JOIN user_locations ul ON ul.location_id = l.id
         WHERE ul.user_id = $1 AND l.organization_id = $2 AND l.code = $3`,
        [targetUserId, orgId, location]
      );

      if (locCheck.rows.length === 0) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN_LOCATION',
            message: `Сотрудник не имеет доступа к локации «${location}». Обратитесь к руководителю.`,
          },
        });
        return;
      }
    } else {
      const locRes = await db.query<{ id: string }>(
        'SELECT id FROM locations WHERE organization_id = $1 AND code = $2',
        [orgId, location]
      );
      let locId = locRes.rows[0]?.id;
      if (!locId) {
        locId = `loc-${uuidv4()}`;
        await db.query(
          'INSERT INTO locations (id, organization_id, code, name) VALUES ($1, $2, $3, $4)',
          [locId, orgId, location, `Склад ${location}`]
        );
      }
      await db.query(
        'INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [targetUserId, locId]
      );
    }

    let cleanShiftType = shiftType;
    if (shiftType === 'rate400') cleanShiftType = '400+';
    else if (shiftType === 'rate500') cleanShiftType = '500+';
    else if (shiftType === 'shift8h') cleanShiftType = '8h';
    else if (shiftType === 'shift4h') cleanShiftType = '4h';

    let checkinId = `rec-${uuidv4()}`;
    const nowIso = new Date().toISOString();
    const effectiveCheckinTime = isManager && targetDate !== today
      ? `${targetDate}T06:00:00.000Z`
      : nowIso;
    let finalEditCount = 0;
    let persistedQrVerified = Boolean(qrVerified);
    let persistedGeoVerified = Boolean(geoVerified);

    await db.transaction(async client => {
      let baseRate: number | null = null;
      try {
        baseRate = await getActiveShiftRate(targetUserId, cleanShiftType, orgId, client);
      } catch (rateErr) {
        console.error('Error fetching active shift rate inside transaction:', rateErr);
      }

      const existing = await client.query<{
        id: string;
        edit_count?: number;
        check_out_at?: string | null;
        zone?: string | null;
        qr_verified?: boolean | number | null;
        geo_verified?: boolean | number | null;
        notes?: string | null;
      }>(
        'SELECT id, edit_count, check_out_at, zone, qr_verified, geo_verified, notes FROM checkins WHERE user_id = $1 AND date = $2 ORDER BY checked_in_at DESC',
        [targetUserId, targetDate]
      );

      if (existing.rows.length > 0) {
        const primary = existing.rows[0];
        if (existing.rows.length > 1) {
          for (let i = 1; i < existing.rows.length; i++) {
            await client.query('DELETE FROM sales WHERE checkin_id = $1', [existing.rows[i].id]);
            await client.query('DELETE FROM checkins WHERE id = $1', [existing.rows[i].id]);
          }
        }

        checkinId = primary.id;
        const currentEditCount = Number(primary.edit_count || 0);

        if (!isManager && primary.check_out_at) {
          const closedErr = new Error('SHIFT_ALREADY_CLOSED');
          (closedErr as any).code = 'SHIFT_ALREADY_CLOSED';
          throw closedErr;
        }

        if (!isManager && currentEditCount >= 1) {
          const limitErr = new Error('EDIT_LIMIT_EXCEEDED');
          (limitErr as any).code = 'EDIT_LIMIT_EXCEEDED';
          throw limitErr;
        }

        finalEditCount = isManager ? currentEditCount : currentEditCount + 1;
        const nextZone = zone !== undefined ? zone : (primary.zone || null);
        const nextQr = Boolean(primary.qr_verified) || Boolean(qrVerified);
        const nextGeo = Boolean(primary.geo_verified) || Boolean(geoVerified);
        persistedQrVerified = nextQr;
        persistedGeoVerified = nextGeo;
        const nextNotes = notes !== undefined ? notes : (primary.notes || null);

        await client.query(
          `UPDATE checkins
           SET organization_id = $1,
               location_code = $2,
               shift_type = $3,
               edit_count = $4,
               base_rate = $5,
               zone = $6,
               qr_verified = $7,
               geo_verified = $8,
               notes = $9,
               checked_in_at = $10
           WHERE id = $11`,
          [orgId, location, cleanShiftType, finalEditCount, baseRate, nextZone, nextQr, nextGeo, nextNotes, effectiveCheckinTime, checkinId]
        );
      } else {
        finalEditCount = 0;
        try {
          await client.query(
            `INSERT INTO checkins (id, organization_id, user_id, location_code, shift_type, date, checked_in_at, edit_count, base_rate, zone, qr_verified, geo_verified, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              checkinId,
              orgId,
              targetUserId,
              location,
              cleanShiftType,
              targetDate,
              effectiveCheckinTime,
              0,
              baseRate,
              zone || null,
              Boolean(qrVerified),
              Boolean(geoVerified),
              notes || null,
            ]
          );
        } catch (insertErr: any) {
          const isUniqueViolation =
            insertErr?.code === '23505' ||
            String(insertErr?.message || '').toLowerCase().includes('unique');
          if (!isUniqueViolation) throw insertErr;

          const raced = await client.query<{ id: string; edit_count?: number; check_out_at?: string | null }>(
            'SELECT id, edit_count, check_out_at FROM checkins WHERE user_id = $1 AND date = $2',
            [targetUserId, targetDate]
          );
          if (raced.rows.length === 0) throw insertErr;

          const racedRow = raced.rows[0];
          checkinId = racedRow.id;
          const currentEditCount = Number(racedRow.edit_count || 0);
          if (!isManager && racedRow.check_out_at) {
            const closedErr = new Error('SHIFT_ALREADY_CLOSED');
            (closedErr as any).code = 'SHIFT_ALREADY_CLOSED';
            throw closedErr;
          }
          if (!isManager && currentEditCount >= 1) {
            const limitErr = new Error('EDIT_LIMIT_EXCEEDED');
            (limitErr as any).code = 'EDIT_LIMIT_EXCEEDED';
            throw limitErr;
          }
          finalEditCount = isManager ? currentEditCount : currentEditCount + 1;
          await client.query(
            `UPDATE checkins
             SET organization_id = $1, location_code = $2, shift_type = $3, edit_count = $4, base_rate = $5,
                 zone = $6, qr_verified = $7, geo_verified = $8, notes = $9, checked_in_at = $10
             WHERE id = $11`,
            [orgId, location, cleanShiftType, finalEditCount, baseRate, zone || null, Boolean(qrVerified), Boolean(geoVerified), notes || null, effectiveCheckinTime, checkinId]
          );
        }
      }
    });

    const shiftLabel = CHECKIN_SHIFT_LABELS[cleanShiftType] || cleanShiftType;
    if (orgId === DEFAULT_LEGACY_ORG_ID) {
      telegramService
        .sendMessage(
          `🟢 *Check-in зафиксирован!*\n` +
            `👤 Сотрудник: *${targetUser.name}*\n` +
            `📍 Склад: *${location}*${zone ? ` (${zone})` : ''}\n` +
            `⏱ Смена: *${shiftLabel}*\n` +
            `📅 Дата: *${targetDate}*\n` +
            `⏰ Время: *${new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)*`
        )
        .catch(() => {});
    }

    await logAudit(req, req.user!.id, 'CHECKIN', 'checkin', checkinId, {
      userId: targetUserId,
      location,
      shiftType: cleanShiftType,
      zone: zone || null,
      date: targetDate,
    });

    res.json({
      success: true,
      checkin: {
        id: checkinId,
        employeeId: targetUserId,
        employeeName: targetUser.name,
        location,
        shiftType: cleanShiftType,
        date: targetDate,
        checkedInAt: effectiveCheckinTime,
        editCount: finalEditCount,
        zone: zone || undefined,
        qrVerified: persistedQrVerified,
        geoVerified: persistedGeoVerified,
        sales: null,
      },
    });
  } catch (err: any) {
    if (err?.code === 'SHIFT_ALREADY_CLOSED' || err?.message === 'SHIFT_ALREADY_CLOSED') {
      res.status(403).json({
        success: false,
        error: {
          code: 'SHIFT_ALREADY_CLOSED',
          message: 'Смена за выбранную дату уже завершена (Check-out). Для изменений обратитесь к руководителю.',
        },
      });
      return;
    }
    if (err?.code === 'EDIT_LIMIT_EXCEEDED' || err?.message === 'EDIT_LIMIT_EXCEEDED') {
      res.status(403).json({
        success: false,
        error: {
          code: 'EDIT_LIMIT_EXCEEDED',
          message: 'Работник может изменять свою отмеченную смену только один раз. В случае необходимости обратитесь к руководителю, чтобы руководитель сам внёс изменение.',
        },
      });
      return;
    }
    console.error('[Checkins] Post checkin error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка при выполнении Check-in' } });
  }
});

// PATCH /api/v1/checkins/:id
checkinsRouter.patch('/:id', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const isManager = req.user!.role === 'manager';
    if (!isManager) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Только руководитель может изменять смены' } });
      return;
    }

    const { shiftType, location, date, zone } = req.body;
    if (date && !isValidCalendarDate(date)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Некорректный формат даты' } });
      return;
    }

    let found = true;
    await db.transaction(async client => {
      const curRes = await client.query<{ id: string; user_id: string; date: string; shift_type: string }>(
        'SELECT id, user_id, date, shift_type FROM checkins WHERE id = $1 AND organization_id = $2',
        [id, orgId]
      );
      if (curRes.rows.length === 0) {
        found = false;
        return;
      }
      const cur = curRes.rows[0];
      const updates: string[] = [];
      const params: any[] = [];

      if (shiftType) {
        let cleanShiftType = shiftType;
        if (shiftType === 'rate400') cleanShiftType = '400+';
        else if (shiftType === 'rate500') cleanShiftType = '500+';
        else if (shiftType === 'shift8h') cleanShiftType = '8h';
        else if (shiftType === 'shift4h') cleanShiftType = '4h';
        params.push(cleanShiftType);
        updates.push(`shift_type = $${params.length}`);

        const newRate = await getActiveShiftRate(cur.user_id, cleanShiftType, orgId, client);
        params.push(newRate);
        updates.push(`base_rate = $${params.length}`);
      }
      if (location) {
        params.push(location);
        updates.push(`location_code = $${params.length}`);
      }
      if (zone !== undefined) {
        params.push(zone || null);
        updates.push(`zone = $${params.length}`);
      }
      if (date) {
        if (date !== cur.date) {
          const conflictRes = await client.query<{ id: string }>(
            'SELECT id FROM checkins WHERE user_id = $1 AND date = $2 AND id <> $3',
            [cur.user_id, date, id]
          );
          for (const c of conflictRes.rows) {
            await client.query('DELETE FROM sales WHERE checkin_id = $1', [c.id]);
            await client.query('DELETE FROM checkins WHERE id = $1', [c.id]);
          }
        }
        params.push(date);
        updates.push(`date = $${params.length}`);
      }

      if (updates.length > 0) {
        params.push(id, orgId);
        await client.query(
          `UPDATE checkins SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND organization_id = $${params.length}`,
          params
        );
      }
    });

    if (!found) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Запись Check-in не найдена' } });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Checkins] Patch checkin error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка обновления смены' } });
  }
});

// DELETE /api/v1/checkins/:id
checkinsRouter.delete('/:id', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { id } = req.params;
    const isManager = req.user!.role === 'manager';
    const today = getTodayMoscowDate();

    const checkinRes = await db.query<{ id: string; user_id: string; date: string; edit_count?: number; check_out_at?: string | null }>(
      'SELECT id, user_id, date, edit_count, check_out_at FROM checkins WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (checkinRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Запись Check-in не найдена' } });
      return;
    }

    const checkin = checkinRes.rows[0];

    if (!isManager) {
      if (checkin.user_id !== req.user!.id) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Нельзя отменить чужую смену' } });
        return;
      }
      if (checkin.date !== today) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN_PAST_DATE',
            message: 'Сотрудник может отменить check-in только за сегодняшний день',
          },
        });
        return;
      }
      if (checkin.check_out_at) {
        res.status(403).json({
          success: false,
          error: {
            code: 'SHIFT_ALREADY_CLOSED',
            message: 'Нельзя отменить уже завершённую смену (Check-out). Обратитесь к руководителю.',
          },
        });
        return;
      }
      if (Number(checkin.edit_count || 0) >= 1) {
        res.status(403).json({
          success: false,
          error: {
            code: 'EDIT_LIMIT_EXCEEDED',
            message: 'Работник может изменять или отменять смену только один раз. Для дальнейших изменений обратитесь к руководителю.',
          },
        });
        return;
      }

      const cancelCheck = await db.query<{ count: string | number }>(
        'SELECT COUNT(*) as count FROM checkin_cancellations WHERE user_id = $1 AND date = $2',
        [req.user!.id, checkin.date]
      );
      if (Number(cancelCheck.rows[0]?.count || 0) >= 1) {
        res.status(403).json({
          success: false,
          error: {
            code: 'CANCEL_LIMIT_EXCEEDED',
            message: 'Работник может отменить Check-in только один раз. В случае необходимости обратитесь к руководителю, чтобы руководитель сам внёс изменение.',
          },
        });
        return;
      }
    }

    await db.transaction(async client => {
      if (!isManager) {
        await client.query(
          'INSERT INTO checkin_cancellations (id, organization_id, user_id, date) VALUES ($1, $2, $3, $4)',
          [`canc-${uuidv4()}`, orgId, req.user!.id, checkin.date]
        );
      } else {
        await client.query(
          'DELETE FROM checkin_cancellations WHERE user_id = $1 AND date = $2',
          [checkin.user_id, checkin.date]
        );
      }
      await client.query('DELETE FROM sales WHERE checkin_id = $1', [id]);
      await client.query('DELETE FROM checkins WHERE id = $1 AND organization_id = $2', [id, orgId]);
    });
    await logAudit(req, req.user!.id, 'CANCEL_CHECKIN', 'checkin', id);

    res.json({ success: true });
  } catch (err) {
    console.error('[Checkins] Delete checkin error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка отмены Check-in' } });
  }
});

// POST /api/v1/checkins/checkout
checkinsRouter.post('/checkout', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const isManager = req.user!.role === 'manager';
    const { checkinId, checkOutAt, breakMinutes, workedHours, notes } = req.body;

    let targetCheckin: any = null;
    if (checkinId) {
      const qRes = await db.query('SELECT * FROM checkins WHERE id = $1 AND organization_id = $2', [checkinId, orgId]);
      if (qRes.rows.length > 0) targetCheckin = qRes.rows[0];
    } else {
      const today = getTodayMoscowDate();
      const userId = req.user!.id;
      const qRes = await db.query(
        'SELECT * FROM checkins WHERE user_id = $1 AND date = $2 AND organization_id = $3',
        [userId, today, orgId]
      );
      if (qRes.rows.length > 0) targetCheckin = qRes.rows[0];
    }

    if (!targetCheckin) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Активная смена не найдена' } });
      return;
    }

    if (!isManager && targetCheckin.user_id !== req.user!.id) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Нет доступа к этой смене' } });
      return;
    }

    const finalCheckOut = checkOutAt || new Date().toISOString();
    const finalBreak = typeof breakMinutes === 'number' ? breakMinutes : 60;
    const finalHours = typeof workedHours === 'number' ? workedHours : null;
    const nextNotes = notes !== undefined ? notes || null : targetCheckin.notes || null;

    await db.query(
      `UPDATE checkins
       SET check_out_at = $1, break_minutes = $2, worked_hours = $3, notes = $4
       WHERE id = $5 AND organization_id = $6`,
      [finalCheckOut, finalBreak, finalHours, nextNotes, targetCheckin.id, orgId]
    );

    if (orgId === DEFAULT_LEGACY_ORG_ID) {
      try {
        const uRes = await db.query('SELECT name FROM users WHERE id = $1', [targetCheckin.user_id]);
        const empName = uRes.rows[0]?.name || 'Работник';
        telegramService
          .sendMessage(
            `🔴 *Смена завершена (Check-out)*\n` +
              `👤 Работник: *${empName}*\n` +
              `📍 Склад: *${targetCheckin.location_code}*\n` +
              `⏱ Отработано: *${finalHours !== null ? finalHours + ' ч' : 'зафиксировано'}*\n` +
              `⏰ Время: *${new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)*`
          )
          .catch(() => {});
      } catch {}
    }

    res.json({ success: true, checkinId: targetCheckin.id, checkOutAt: finalCheckOut, workedHours: finalHours });
  } catch (err: any) {
    console.error('[Checkins] Checkout error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка завершения смены' } });
  }
});
