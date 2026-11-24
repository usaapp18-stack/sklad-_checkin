import fs from 'fs';
import path from 'path';
import { db } from '../server/db/index';

async function runBackup() {
  console.log('[Backup] Starting relational database backup...');
  await db.init();

  const tables = [
    'locations',
    'users',
    'user_locations',
    'checkins',
    'sales',
    'messages',
    'notifications',
    'applications',
    'bot_logs',
    'audit_logs',
    'settings',
  ];

  const backupData: Record<string, any[]> = {};

  for (const table of tables) {
    const res = await db.query(`SELECT * FROM ${table}`);
    backupData[table] = res.rows;
    console.log(`[Backup] Exported ${res.rows.length} rows from table '${table}'.`);
  }

  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupsDir, `backup_${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');

  console.log(`[Backup] Successfully written backup to: ${backupFile}`);
}

runBackup().catch(err => {
  console.error('[Backup] Backup failed:', err);
  process.exit(1);
});
