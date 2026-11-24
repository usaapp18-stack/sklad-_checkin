import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index';
import { DEFAULT_LEGACY_ORG_ID, setOrgSetting } from '../db/orgSettings';
import { requireAuth, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { ShiftSwapRequest } from '../../src/types';
import { telegramService } from '../services/telegram';

export const swapsRouter = Router();

function formatDateDDMMYYYY(dateStr?: string | null): string {
  if (!dateStr) return '';
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

export function getThreeMonthsCutoffDate(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);

  const year = parseInt(parts.find(p => p.type === 'year')?.value || `${now.getFullYear()}`, 10);
  const month = parseInt(parts.find(p => p.type === 'month')?.value || `${now.getMonth() + 1}`, 10);

  let targetYear = year;
  let targetMonth = month - 3;
  if (targetMonth < 1) {
    targetMonth += 12;
    targetYear -= 1;
  }
  const padMonth = String(targetMonth).padStart(2, '0');
  return `${targetYear}-${padMonth}-01`;
}

function mapRowToSwap(row: any): ShiftSwapRequest {
  return {
    id: row.id,
    date: row.date,
    shiftType: row.shift_type || 'day12',
    location: row.location,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    candidateId: row.candidate_id || undefined,
    candidateName: row.candidate_name || undefined,
    reason: row.reason || '',
    status: row.status || 'open',
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

export async function getStoredSwaps(organizationId: string): Promise<ShiftSwapRequest[]> {
  const cutoffDate = getThreeMonthsCutoffDate();

  try {
    try {
      await db.query('DELETE FROM shift_swaps WHERE organization_id = $1 AND date < $2', [organizationId, cutoffDate]);
    } catch (pruneErr) {
      console.warn('[Swaps Retention] Prune warning:', pruneErr);
    }

    const res = await db.query(
      `SELECT id, date, shift_type, location, requester_id, requester_name, 
              candidate_id, candidate_name, reason, status, resolved_at, created_at
       FROM shift_swaps
       WHERE organization_id = $1 AND date >= $2
       ORDER BY date DESC, created_at DESC`,
      [organizationId, cutoffDate]
    );

    const swaps = res.rows.map(mapRowToSwap);
    try {
      await setOrgSetting(organizationId, 'shift_swaps', swaps);
    } catch {}
    return swaps;
  } catch (e) {
    console.error('[Swaps] Read error from database:', e);
    return [];
  }
}

export async function saveSingleSwap(swap: ShiftSwapRequest, organizationId: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO shift_swaps (id, organization_id, date, shift_type, location, requester_id, requester_name, candidate_id, candidate_name, reason, status, resolved_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         date = EXCLUDED.date,
         shift_type = EXCLUDED.shift_type,
         location = EXCLUDED.location,
         requester_id = EXCLUDED.requester_id,
         requester_name = EXCLUDED.requester_name,
         candidate_id = EXCLUDED.candidate_id,
         candidate_name = EXCLUDED.candidate_name,
         reason = EXCLUDED.reason,
         status = EXCLUDED.status,
         resolved_at = EXCLUDED.resolved_at,
         updated_at = CURRENT_TIMESTAMP`,
      [
        swap.id,
        organizationId,
        swap.date,
        swap.shiftType || 'day12',
        swap.location,
        swap.requesterId,
        swap.requesterName,
        swap.candidateId || null,
        swap.candidateName || null,
        swap.reason || null,
        swap.status || 'open',
        swap.resolvedAt || null,
        swap.createdAt || new Date().toISOString(),
      ]
    );
  } catch (err) {
    console.error('[Swaps DB Save] Error:', err);
  }
}

export async function deleteSingleSwap(swapId: string, organizationId: string): Promise<void> {
  try {
    await db.query('DELETE FROM shift_swaps WHERE id = $1 AND organization_id = $2', [swapId, organizationId]);
  } catch (err) {
    console.error('[Swaps DB Delete] Error:', err);
  }
}

// GET /api/v1/swaps
swapsRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const swaps = await getStoredSwaps(req.user!.organizationId!);
    res.json({ success: true, swaps });
  } catch (err) {
    console.error('[Swaps] Get error:', err);
    res.status(500).json({ success: false, error: 'Ошибка получения биржи смен' });
  }
});

// POST /api/v1/swaps
swapsRouter.post('/', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { action, swapId, date, shiftType, location, reason } = req.body;
    const user = req.user!;
    const swaps = await getStoredSwaps(orgId);

    if (action === 'claim' && swapId) {
      const idx = swaps.findIndex(s => s.id === swapId);
      if (idx === -1) {
        res.status(404).json({ success: false, error: 'Заявка на смену не найдена' });
        return;
      }
      if (swaps[idx].status !== 'open') {
        res.status(400).json({ success: false, error: 'Эта смена уже забрана другим сотрудником' });
        return;
      }

      swaps[idx].status = 'claimed';
      swaps[idx].candidateId = user.id;
      swaps[idx].candidateName = user.name;

      await saveSingleSwap(swaps[idx], orgId);
      const updatedList = await getStoredSwaps(orgId);
      const formattedDate = formatDateDDMMYYYY(swaps[idx].date);

      try {
        await db.query(
          `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            `notif-${uuidv4()}`,
            orgId,
            swaps[idx].requesterId,
            '🙋 Отклик на вашу смену!',
            `${user.name} откликнулся на вашу смену ${formattedDate} (${swaps[idx].location}). Зайдите на Биржу смен, чтобы подтвердить договоренность.`,
            'system',
            'system',
          ]
        );
      } catch (nErr) {
        console.error('[Swaps] In-app notification error:', nErr);
      }

      if (orgId === DEFAULT_LEGACY_ORG_ID) {
        telegramService
          .sendMessage(`🙋 Отклик на Бирже смен!\n\n${user.name} откликнулся на смену ${formattedDate} (${swaps[idx].location}).`)
          .catch(() => {});
      }

      res.json({ success: true, swap: swaps[idx], swaps: updatedList });
      return;
    }

    if (!date || !location) {
      res.status(400).json({ success: false, error: 'Укажите дату и склад смены' });
      return;
    }

    const existingActive = swaps.find(
      s => s.requesterId === user.id && s.date === date && s.status !== 'rejected' && s.status !== 'cancelled'
    );
    if (existingActive) {
      const formattedDate = formatDateDDMMYYYY(date);
      res.status(400).json({
        success: false,
        error: `У вас уже есть активная заявка на бирже на дату ${formattedDate}. Можно выставлять не более одной смены на одну дату.`,
      });
      return;
    }

    const newSwap: ShiftSwapRequest = {
      id: `swp-${uuidv4()}`,
      date,
      shiftType: shiftType || 'day12',
      location,
      requesterId: user.id,
      requesterName: user.name,
      reason: reason ? String(reason).trim() : '',
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    await saveSingleSwap(newSwap, orgId);
    const updatedList = await getStoredSwaps(orgId);
    const formattedDate = formatDateDDMMYYYY(date);

    try {
      await db.query(
        `INSERT INTO notifications (id, organization_id, to_all, title, text, type, source)
         VALUES ($1, $2, TRUE, $3, $4, $5, $6)`,
        [
          `notif-${uuidv4()}`,
          orgId,
          '🔄 Новая открытая смена на Бирже!',
          `${user.name} ищет замену на ${formattedDate} (склад ${location}). Кто готов выйти — откройте Биржу смен!`,
          'system',
          'system',
        ]
      );
    } catch (nErr) {
      console.error('[Swaps] Broadcast notification error:', nErr);
    }

    if (orgId === DEFAULT_LEGACY_ORG_ID) {
      telegramService
        .sendMessage(`🔄 *Новая смена на Бирже смен!*\n\n${user.name} ищет замену на ${formattedDate} (${location}).`)
        .catch(() => {});
    }

    res.json({ success: true, swap: newSwap, swaps: updatedList });
  } catch (err) {
    console.error('[Swaps] Post error:', err);
    res.status(500).json({ success: false, error: 'Ошибка обработки биржи смен' });
  }
});

// PATCH /api/v1/swaps/:id
swapsRouter.patch('/:id', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const swapId = req.params.id;
    const { action } = req.body;
    const user = req.user!;
    const isManager = user.role === 'manager';

    const swaps = await getStoredSwaps(orgId);
    const idx = swaps.findIndex(s => s.id === swapId);

    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Заявка не найдена' });
      return;
    }

    const swap = swaps[idx];
    const isInitiator = swap.requesterId === user.id;

    if (!isManager && !isInitiator) {
      res.status(403).json({ success: false, error: 'Только автор заявки или руководитель могут подтверждать замену' });
      return;
    }

    const formattedDate = formatDateDDMMYYYY(swap.date);

    if (action === 'approve' || action === 'confirm') {
      swap.status = 'approved';
      swap.resolvedAt = new Date().toISOString();

      if (swap.candidateId) {
        try {
          await db.query(
            `INSERT INTO notifications (id, organization_id, user_id, title, text, type, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              `notif-${uuidv4()}`,
              orgId,
              swap.candidateId,
              '✅ Замена утверждена! (Договорились)',
              `Подмена на смену ${formattedDate} (${swap.location}) подтверждена. Смена закреплена за вами.`,
              'system',
              'system',
            ]
          );
        } catch (nErr) {
          console.error('[Swaps] Candidate notification error:', nErr);
        }

        if (orgId === DEFAULT_LEGACY_ORG_ID) {
          telegramService
            .sendMessage(`✅ *Замена утверждена!*\n\nСмена на ${formattedDate} (${swap.location}) закреплена за сотрудником.`)
            .catch(() => {});
        }
      }
    } else if (action === 'reject') {
      const previousCandidateId = swap.candidateId;
      swap.candidateId = undefined;
      swap.candidateName = undefined;
      swap.status = 'open';

      if (previousCandidateId && orgId === DEFAULT_LEGACY_ORG_ID) {
        telegramService
          .sendMessage(`Замена на ${formattedDate} (${swap.location}) отклонена. Смена снова открыта на бирже.`)
          .catch(() => {});
      }
    }

    await saveSingleSwap(swap, orgId);
    const updatedList = await getStoredSwaps(orgId);
    res.json({ success: true, swap, swaps: updatedList });
  } catch (err) {
    console.error('[Swaps] Patch error:', err);
    res.status(500).json({ success: false, error: 'Ошибка обновления заявки' });
  }
});

// PUT /api/v1/swaps/:id
swapsRouter.put('/:id', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const swapId = req.params.id;
    const { date, shiftType, location, reason, status, candidateId, candidateName, requesterId, requesterName } = req.body;
    const user = req.user!;
    const isManager = user.role === 'manager';

    const swaps = await getStoredSwaps(orgId);
    const idx = swaps.findIndex(s => s.id === swapId);

    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Заявка не найдена' });
      return;
    }

    if (!isManager && swaps[idx].requesterId !== user.id) {
      res.status(403).json({ success: false, error: 'Редактировать заявку может только руководитель или её создатель' });
      return;
    }

    if (date !== undefined) swaps[idx].date = date;
    if (shiftType !== undefined) swaps[idx].shiftType = shiftType;
    if (location !== undefined) swaps[idx].location = location;
    if (reason !== undefined) swaps[idx].reason = String(reason).trim();

    if (isManager) {
      if (status !== undefined) swaps[idx].status = status;
      if (candidateId !== undefined) swaps[idx].candidateId = candidateId || undefined;
      if (candidateName !== undefined) swaps[idx].candidateName = candidateName || undefined;
      if (requesterId !== undefined) swaps[idx].requesterId = requesterId;
      if (requesterName !== undefined) swaps[idx].requesterName = requesterName;
    } else if (status === 'cancelled' || status === 'open') {
      swaps[idx].status = status;
    }

    if (req.body.clearCandidate || (status === 'open' && (isManager || swaps[idx].requesterId === user.id))) {
      swaps[idx].candidateId = undefined;
      swaps[idx].candidateName = undefined;
    }

    await saveSingleSwap(swaps[idx], orgId);
    const updatedList = await getStoredSwaps(orgId);
    res.json({ success: true, swap: swaps[idx], swaps: updatedList });
  } catch (err) {
    console.error('[Swaps] Put error:', err);
    res.status(500).json({ success: false, error: 'Ошибка редактирования заявки' });
  }
});

// DELETE /api/v1/swaps/:id
swapsRouter.delete('/:id', requireAuth, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const swapId = req.params.id;
    const user = req.user!;
    const isManager = user.role === 'manager';

    const swaps = await getStoredSwaps(orgId);
    const target = swaps.find(s => s.id === swapId);

    if (!target) {
      res.status(404).json({ success: false, error: 'Заявка не найдена' });
      return;
    }

    if (!isManager && target.requesterId !== user.id) {
      res.status(403).json({ success: false, error: 'Вы можете отменять только свои заявки' });
      return;
    }

    await deleteSingleSwap(swapId, orgId);
    const updatedList = await getStoredSwaps(orgId);
    res.json({ success: true, swaps: updatedList });
  } catch (err) {
    console.error('[Swaps] Delete error:', err);
    res.status(500).json({ success: false, error: 'Ошибка отмены заявки' });
  }
});
