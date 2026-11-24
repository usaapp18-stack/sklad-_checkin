import { Router, Request, Response } from 'express';
import { db } from '../db/index';
import { setOrgSetting } from '../db/orgSettings';
import { requireAuth, requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { checkLocationQuota } from '../services/subscription';
import { logAudit } from '../services/audit';

export const locationsRouter = Router();

export interface LocationItem {
  id: string;
  organizationId?: string;
  code: string;
  name: string;
  address?: string;
  active: boolean;
  isArchived?: boolean;
  archivedAt?: string;
  assignedStaffIds?: string[];
  contactPhone?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  qrSecret?: string;
  zones?: string[];
  createdAt?: string;
  updatedAt?: string;
}

function mapRowToLocation(row: any): LocationItem {
  let assignedStaff: string[] = [];
  if (row.assigned_staff_ids) {
    try {
      assignedStaff = JSON.parse(row.assigned_staff_ids);
    } catch {
      assignedStaff =
        typeof row.assigned_staff_ids === 'string'
          ? row.assigned_staff_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
    }
  }

  let zones: string[] = ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения'];
  if (row.zones) {
    try {
      zones = JSON.parse(row.zones);
    } catch {
      zones =
        typeof row.zones === 'string'
          ? row.zones.split(',').map((s: string) => s.trim()).filter(Boolean)
          : zones;
    }
  }

  return {
    id: row.id,
    organizationId: row.organization_id || undefined,
    code: row.code,
    name: row.name,
    address: row.address || '',
    active: Boolean(row.active ?? true),
    isArchived: Boolean(row.is_archived ?? false),
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : undefined,
    assignedStaffIds: Array.isArray(assignedStaff) ? assignedStaff : [],
    contactPhone: row.contact_phone || '',
    notes: row.notes || '',
    latitude: row.latitude != null ? Number(row.latitude) : undefined,
    longitude: row.longitude != null ? Number(row.longitude) : undefined,
    radiusMeters: row.radius_meters != null ? Number(row.radius_meters) : 300,
    qrSecret: row.qr_secret || `SKLAD-${row.code || row.id}`,
    zones,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

export async function getStoredLocations(organizationId: string): Promise<LocationItem[]> {
  try {
    const res = await db.query(
      `SELECT id, organization_id, code, name, address, active, is_archived, archived_at, contact_phone, notes,
              assigned_staff_ids, latitude, longitude, radius_meters, qr_secret, zones, created_at, updated_at
       FROM locations
       WHERE organization_id = $1
       ORDER BY created_at ASC, name ASC`,
      [organizationId]
    );

    const list = res.rows.map(mapRowToLocation);
    try {
      await setOrgSetting(organizationId, 'locations', list);
    } catch {}
    return list;
  } catch (err) {
    console.error('[Locations] Read error from DB:', err);
    return [];
  }
}

export async function saveSingleLocationToDb(loc: LocationItem, organizationId: string): Promise<void> {
  const assignedJson = JSON.stringify(loc.assignedStaffIds || []);
  const zonesJson = JSON.stringify(loc.zones || ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения']);
  const qrSecret = loc.qrSecret || `SKLAD-${loc.code || loc.id}`;

  await db.query(
    `INSERT INTO locations (
       id, organization_id, code, name, address, active, is_archived, archived_at,
       contact_phone, notes, assigned_staff_ids, latitude, longitude, radius_meters,
       qr_secret, zones, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       code = EXCLUDED.code,
       name = EXCLUDED.name,
       address = EXCLUDED.address,
       active = EXCLUDED.active,
       is_archived = EXCLUDED.is_archived,
       archived_at = EXCLUDED.archived_at,
       contact_phone = EXCLUDED.contact_phone,
       notes = EXCLUDED.notes,
       assigned_staff_ids = EXCLUDED.assigned_staff_ids,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       radius_meters = EXCLUDED.radius_meters,
       qr_secret = EXCLUDED.qr_secret,
       zones = EXCLUDED.zones,
       updated_at = CURRENT_TIMESTAMP`,
    [
      loc.id,
      organizationId,
      loc.code,
      loc.name,
      loc.address || '',
      Boolean(loc.active),
      Boolean(loc.isArchived),
      loc.archivedAt || null,
      loc.contactPhone || '',
      loc.notes || '',
      assignedJson,
      loc.latitude ?? null,
      loc.longitude ?? null,
      loc.radiusMeters ?? 300,
      qrSecret,
      zonesJson,
      loc.createdAt || new Date().toISOString(),
    ]
  );
}

// GET /api/v1/locations
locationsRouter.get('/', requireAuth, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const locations = await getStoredLocations(req.user!.organizationId!);
    res.json({ success: true, locations });
  } catch (err) {
    console.error('[Locations] Get error:', err);
    res.json({ success: true, locations: [] });
  }
});

// POST /api/v1/locations (Add new Warehouse - tariff-quota enforced)
locationsRouter.post('/', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const quota = await checkLocationQuota(orgId);
    if (!quota.allowed) {
      res.status(403).json({
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: quota.message || 'Достигнут лимит тарифа по количеству складов/ПВЗ',
        },
      });
      return;
    }

    const currentLocs = await getStoredLocations(orgId);
    const { name, code, address, active = true, assignedStaffIds = [], contactPhone = '', notes = '', latitude, longitude, radiusMeters, qrSecret, zones } = req.body;
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 30) : '';
    if (!cleanName) {
      res.status(400).json({ success: false, error: 'Укажите название склада.' });
      return;
    }

    const duplicateName = currentLocs.find(l => l.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (duplicateName) {
      res.status(400).json({
        success: false,
        error: `Склад с названием «${cleanName}» уже существует. Названия складов должны быть уникальными.`,
      });
      return;
    }

    const finalCode = (typeof code === 'string' && code.trim().length > 0 ? code.trim().slice(0, 18) : `СК-${currentLocs.length + 1}`).toUpperCase();

    const newLoc: LocationItem = {
      id: `sklad-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      organizationId: orgId,
      code: finalCode,
      name: cleanName,
      address: address ? String(address).trim() : '',
      active: Boolean(active),
      isArchived: false,
      assignedStaffIds: Array.isArray(assignedStaffIds) ? assignedStaffIds : [],
      contactPhone: contactPhone ? String(contactPhone).trim() : '',
      notes: notes ? String(notes).trim() : '',
      latitude: latitude !== undefined && latitude !== null && latitude !== '' ? Number(latitude) : undefined,
      longitude: longitude !== undefined && longitude !== null && longitude !== '' ? Number(longitude) : undefined,
      radiusMeters: radiusMeters ? Number(radiusMeters) : 300,
      qrSecret: qrSecret || `SKLAD-${finalCode}-${orgId.slice(-4)}`,
      zones: Array.isArray(zones) ? zones : ['Приёмка', 'Сборка', 'Упаковка', 'Отгрузка', 'Зона хранения'],
      createdAt: new Date().toISOString(),
    };

    await saveSingleLocationToDb(newLoc, orgId);
    const updatedList = await getStoredLocations(orgId);

    await logAudit(req, req.user!.id, 'CREATE_LOCATION', 'location', newLoc.id, {
      code: newLoc.code,
      name: newLoc.name,
    });

    res.json({ success: true, location: newLoc, locations: updatedList });
  } catch (err: any) {
    console.error('[Locations] Create error:', err);
    res.status(500).json({ success: false, error: { message: 'Ошибка сохранения склада' } });
  }
});

// PUT /api/v1/locations/:id
locationsRouter.put('/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const locId = req.params.id;
    const currentLocs = await getStoredLocations(orgId);

    const locIdDecoded = decodeURIComponent(locId);
    const idx = currentLocs.findIndex(
      l =>
        l.id === locId ||
        l.id === locIdDecoded ||
        l.code === locId ||
        l.code === locIdDecoded ||
        l.code.toUpperCase() === locId.toUpperCase() ||
        l.code.toUpperCase() === locIdDecoded.toUpperCase() ||
        l.id.toLowerCase() === locId.toLowerCase()
    );

    if (idx === -1) {
      res.status(404).json({ success: false, error: 'Склад не найден.' });
      return;
    }

    const target = currentLocs[idx];
    const body = req.body;

    // Enforce tariff quota if restoring an archived warehouse back into active pool
    if (target.isArchived && body.isArchived === false) {
      const quota = await checkLocationQuota(orgId);
      if (!quota.allowed) {
        res.status(403).json({
          success: false,
          error: {
            code: 'QUOTA_EXCEEDED',
            message: quota.message || 'Достигнут лимит тарифа по количеству активных складов/ПВЗ',
          },
        });
        return;
      }
    }

    if (body.name !== undefined) {
      const cleanName = String(body.name).trim().slice(0, 30);
      if (!cleanName) {
        res.status(400).json({ success: false, error: 'Укажите название склада.' });
        return;
      }
      const duplicateName = currentLocs.find((l, i) => i !== idx && l.name.trim().toLowerCase() === cleanName.toLowerCase());
      if (duplicateName) {
        res.status(400).json({ success: false, error: `Склад с названием «${cleanName}» уже существует. Названия складов должны быть уникальными.` });
        return;
      }
      target.name = cleanName;
    }
    if (body.code !== undefined) {
      const cleanCode = String(body.code).trim().slice(0, 18).toUpperCase();
      if (cleanCode) {
        target.code = cleanCode;
      }
    }
    if (body.address !== undefined) target.address = String(body.address).trim();
    if (body.active !== undefined) target.active = Boolean(body.active);

    if (body.isArchived !== undefined) {
      target.isArchived = Boolean(body.isArchived);
      if (body.isArchived) {
        target.archivedAt = body.archivedAt || new Date().toISOString();
        target.active = false;
      } else {
        target.archivedAt = undefined;
        target.active = true;
      }
    }

    if (Array.isArray(body.assignedStaffIds)) target.assignedStaffIds = body.assignedStaffIds;
    if (body.contactPhone !== undefined) target.contactPhone = String(body.contactPhone).trim();
    if (body.notes !== undefined) target.notes = String(body.notes).trim();
    if (body.latitude !== undefined) target.latitude = body.latitude !== null && body.latitude !== '' ? Number(body.latitude) : undefined;
    if (body.longitude !== undefined) target.longitude = body.longitude !== null && body.longitude !== '' ? Number(body.longitude) : undefined;
    if (body.radiusMeters !== undefined) target.radiusMeters = Number(body.radiusMeters);
    if (body.qrSecret !== undefined) target.qrSecret = String(body.qrSecret).trim();
    if (Array.isArray(body.zones)) target.zones = body.zones;

    await saveSingleLocationToDb(target, orgId);
    const updatedList = await getStoredLocations(orgId);

    await logAudit(req, req.user!.id, target.isArchived ? 'ARCHIVE_LOCATION' : 'UPDATE_LOCATION', 'location', target.id, {
      code: target.code,
      name: target.name,
      isArchived: target.isArchived,
    });

    res.json({ success: true, locations: updatedList });
  } catch (err) {
    console.error('[Locations] Update error:', err);
    res.status(500).json({ success: false, error: 'Ошибка обновления склада' });
  }
});

// DELETE /api/v1/locations/:id
locationsRouter.delete('/:id', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const locId = req.params.id;
    const currentLocs = await getStoredLocations(orgId);

    const locIdDecoded = decodeURIComponent(locId);
    const targetLoc = currentLocs.find(
      l =>
        l.id === locId ||
        l.id === locIdDecoded ||
        l.code === locId ||
        l.code === locIdDecoded ||
        l.code.toUpperCase() === locId.toUpperCase() ||
        l.code.toUpperCase() === locIdDecoded.toUpperCase() ||
        l.id.toLowerCase() === locId.toLowerCase()
    );

    if (!targetLoc) {
      res.status(404).json({ success: false, error: 'Склад не найден.' });
      return;
    }

    await db.query('DELETE FROM locations WHERE organization_id = $1 AND id = $2', [orgId, targetLoc.id]);
    const updatedList = await getStoredLocations(orgId);

    await logAudit(req, req.user!.id, 'DELETE_LOCATION', 'location', targetLoc.id, {
      code: targetLoc.code,
      name: targetLoc.name,
    });

    res.json({ success: true, locations: updatedList });
  } catch (err) {
    console.error('[Locations] Delete error:', err);
    res.status(500).json({ success: false, error: 'Ошибка удаления склада' });
  }
});
