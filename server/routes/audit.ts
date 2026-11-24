import { Router, Request, Response } from 'express';
import { db } from '../db/index';
import { requireManager, requireOrganization } from '../middleware/auth';

export const auditRouter = Router();

// GET /api/v1/audit-logs (Manager only, org-scoped)
auditRouter.get('/', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const result = await db.query(
      `SELECT a.id, a.user_id, u.name as user_name, a.action, a.entity, a.entity_id, a.ip, a.details, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.organization_id = $1
       ORDER BY a.created_at DESC LIMIT 100`,
      [orgId]
    );

    const logs = result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name || 'Система',
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      ip: r.ip,
      details: r.details ? JSON.parse(r.details) : null,
      timestamp: r.created_at,
    }));

    res.json({ success: true, logs });
  } catch (err) {
    console.error('[Audit] Get logs error:', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Ошибка получения журнала аудита' } });
  }
});
