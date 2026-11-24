import { Request } from 'express';
import { db } from '../db/index';
import { v4 as uuidv4 } from 'uuid';

export async function logAudit(
  req: Request | null,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details?: Record<string, any>,
  organizationId?: string | null
): Promise<void> {
  try {
    const id = `aud-${uuidv4()}`;
    const ip = req ? (req.ip || req.socket.remoteAddress || null) : null;
    const userAgent = req ? (req.headers['user-agent'] || null) : null;
    const detailsStr = details ? JSON.stringify(details) : null;
    const resolvedOrgId = organizationId ?? req?.user?.organizationId ?? null;

    await db.query(
      `INSERT INTO audit_logs (id, organization_id, user_id, action, entity, entity_id, ip, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, resolvedOrgId, userId, action, entity, entityId, ip, userAgent, detailsStr]
    );
  } catch (err) {
    console.error('[AuditLog] Error recording audit log:', err);
  }
}
