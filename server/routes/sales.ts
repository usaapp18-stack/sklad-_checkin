import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, requireActiveWriteAccess } from '../middleware/auth';
import { logAudit } from '../services/audit';

export const salesRouter = Router();

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

const salesCategorySchema = z.object({
  cash: z.number().min(0).default(0),
  card: z.number().min(0).default(0),
});

const submitSalesSchema = z.object({
  employeeId: z.string().optional(),
  date: z
    .string()
    .refine((val: string) => !val || isValidCalendarDate(val), { message: 'Некорректная дата (требуется ГГГГ-ММ-ДД)' })
    .optional(),
  sales: z.object({
    cash: z.number().min(0).optional(),
    card: z.number().min(0).optional(),
    total: z.number().min(0).optional(),
    photo: salesCategorySchema.optional(),
    print: salesCategorySchema.optional(),
    lamination: salesCategorySchema.optional(),
  }),
});

// POST /api/v1/sales
salesRouter.post('/', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const parse = submitSalesSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parse.error.issues?.[0]?.message || 'Неверные данные выручки' },
      });
      return;
    }

    const { sales, date } = parse.data;
    const isManager = req.user!.role === 'manager';
    const today = getTodayMoscowDate();
    const targetUserId = isManager && parse.data.employeeId ? parse.data.employeeId : req.user!.id;

    if (!isManager && req.user!.isPartTime) {
      res.status(403).json({
        success: false,
        error: {
          code: 'PART_TIME_SALES_PROHIBITED',
          message: 'Подработчикам запрещено вносить данные о продажах',
        },
      });
      return;
    }

    let targetDate = today;
    if (date) {
      if (!isManager && date !== today) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_DATE', message: 'Сотрудники могут вносить выручку только за текущую смену' },
        });
        return;
      }
      targetDate = date;
    }

    const checkinRes = await db.query<{ id: string }>(
      'SELECT id FROM checkins WHERE user_id = $1 AND date = $2 AND organization_id = $3',
      [targetUserId, targetDate, orgId]
    );

    if (checkinRes.rows.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CHECKIN_REQUIRED',
          message: 'Ввод выручки невозможен без предварительной отметки Check-in за выбранную дату!',
        },
      });
      return;
    }

    const checkinId = checkinRes.rows[0].id;

    const photoCash = sales.photo?.cash || 0;
    const photoCard = sales.photo?.card || 0;
    const printCash = sales.print?.cash || 0;
    const printCard = sales.print?.card || 0;
    const lamCash = sales.lamination?.cash || 0;
    const lamCard = sales.lamination?.card || 0;

    const totalCash = sales.cash !== undefined ? sales.cash : photoCash + printCash + lamCash;
    const totalCard = sales.card !== undefined ? sales.card : photoCard + printCard + lamCard;
    const totalSales =
      sales.total !== undefined && sales.total > 0 && sales.cash === undefined && sales.card === undefined
        ? sales.total
        : totalCash + totalCard;
    const bonus = Math.round(totalSales * 0.05);

    let saleId = `sale-${uuidv4()}`;

    await db.transaction(async client => {
      const existing = await client.query<{ id: string }>('SELECT id FROM sales WHERE checkin_id = $1', [checkinId]);

      if (existing.rows.length > 0) {
        saleId = existing.rows[0].id;
        await client.query(
          `UPDATE sales
           SET organization_id = $1, photo_cash = $2, photo_card = $3, print_cash = $4, print_card = $5,
               lamination_cash = $6, lamination_card = $7, total = $8, bonus = $9,
               submitted_at = CURRENT_TIMESTAMP
           WHERE id = $10`,
          [orgId, totalCash, totalCard, 0, 0, 0, 0, totalSales, bonus, saleId]
        );
      } else {
        await client.query(
          `INSERT INTO sales (id, organization_id, checkin_id, user_id, date, photo_cash, photo_card, print_cash, print_card, lamination_cash, lamination_card, total, bonus)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [saleId, orgId, checkinId, targetUserId, targetDate, totalCash, totalCard, 0, 0, 0, 0, totalSales, bonus]
        );
      }
    });

    await logAudit(req, req.user!.id, 'SUBMIT_SALES', 'sales', saleId, {
      checkinId,
      userId: targetUserId,
      total: totalSales,
      bonus,
      date: targetDate,
    });

    res.json({
      success: true,
      sales: {
        id: saleId,
        checkinId,
        total: totalSales,
        bonus,
        submittedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[Sales] Submit sales error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка при сохранении выручки' } });
  }
});
