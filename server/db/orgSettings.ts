import { db } from './index';

export const DEFAULT_LEGACY_ORG_ID = 'org-default';

/**
 * Reads an organization-scoped JSON setting from `org_settings`.
 * Falls back cleanly to legacy `settings` ONLY for DEFAULT_LEGACY_ORG_ID if not yet mirrored.
 */
export async function getOrgSetting<T>(organizationId: string, key: string, fallback: T): Promise<T> {
  try {
    const res = await db.query<{ value: string }>(
      'SELECT value FROM org_settings WHERE organization_id = $1 AND key = $2',
      [organizationId, key]
    );
    if (res.rows.length > 0 && res.rows[0].value) {
      return JSON.parse(res.rows[0].value) as T;
    }

    if (organizationId === DEFAULT_LEGACY_ORG_ID) {
      const legacyRes = await db.query<{ value: string }>(
        'SELECT value FROM settings WHERE key = $1',
        [key]
      );
      if (legacyRes.rows.length > 0 && legacyRes.rows[0].value) {
        return JSON.parse(legacyRes.rows[0].value) as T;
      }
    }
  } catch (err) {
    console.warn(`[OrgSettings] Failed reading (${organizationId}, ${key}):`, err);
  }
  return fallback;
}

/**
 * Persists an organization-scoped setting in `org_settings`.
 */
export async function setOrgSetting(organizationId: string, key: string, value: unknown): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await db.query(
    `INSERT INTO org_settings (organization_id, key, value, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (organization_id, key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = CURRENT_TIMESTAMP`,
    [organizationId, key, serialized]
  );
}
