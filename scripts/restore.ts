import fs from 'fs';
import path from 'path';
import { db } from '../server/db/index';

async function runRestore() {
  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    console.error('[Restore] No backups directory found at:', backupsDir);
    process.exit(1);
  }

  const files = fs.readdirSync(backupsDir).filter(f => f.startsWith('backup_') && f.endsWith('.json'));
  if (files.length === 0) {
    console.error('[Restore] No backup files found.');
    process.exit(1);
  }

  files.sort().reverse();
  const latestBackup = path.join(backupsDir, files[0]);
  console.log(`[Restore] Restoring from latest backup: ${latestBackup}...`);

  const raw = fs.readFileSync(latestBackup, 'utf8');
  const data = JSON.parse(raw);

  await db.init();

  // Restore in reverse FK order
  await db.transaction(async client => {
    await client.query('DELETE FROM sales');
    await client.query('DELETE FROM checkins');
    await client.query('DELETE FROM user_locations');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM messages');
    await client.query('DELETE FROM applications');
    await client.query('DELETE FROM bot_logs');
    await client.query('DELETE FROM audit_logs');
    await client.query('DELETE FROM settings');
    await client.query('DELETE FROM sessions'); // Clear all leftover sessions (Requirement 37)
    await client.query('DELETE FROM users');
    await client.query('DELETE FROM locations');

    // 1. Restore locations
    for (const loc of data.locations || []) {
      await client.query('INSERT INTO locations (id, code, name) VALUES ($1, $2, $3)', [loc.id, loc.code, loc.name]);
    }

    // 2. Restore users
    for (const u of data.users || []) {
      await client.query(
        `INSERT INTO users (id, login, password_hash, name, role, status, is_part_time, is_senior, telegram_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [u.id, u.login, u.password_hash, u.name, u.role, u.status, Boolean(u.is_part_time), Boolean(u.is_senior), u.telegram_username]
      );
    }

    // 3. Restore user_locations
    for (const ul of data.user_locations || []) {
      await client.query('INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)', [ul.user_id, ul.location_id]);
    }

    // 4. Restore checkins
    for (const c of data.checkins || []) {
      await client.query(
        'INSERT INTO checkins (id, user_id, location_code, shift_type, date, checked_in_at, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [c.id, c.user_id, c.location_code, c.shift_type, c.date, c.checked_in_at, c.notes || null]
      );
    }

    // 5. Restore sales
    for (const s of data.sales || []) {
      await client.query(
        `INSERT INTO sales (id, checkin_id, user_id, date, photo_cash, photo_card, print_cash, print_card, lamination_cash, lamination_card, total, bonus)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [s.id, s.checkin_id, s.user_id, s.date, s.photo_cash, s.photo_card, s.print_cash, s.print_card, s.lamination_cash, s.lamination_card, s.total, s.bonus]
      );
    }

    // 6. Restore messages
    for (const m of data.messages || []) {
      await client.query(
        'INSERT INTO messages (id, from_user_id, message, is_read, created_at) VALUES ($1, $2, $3, $4, $5)',
        [m.id, m.from_user_id, m.message, m.is_read ? 1 : 0, m.created_at]
      );
    }

    // 7. Restore notifications
    for (const n of data.notifications || []) {
      await client.query(
        'INSERT INTO notifications (id, user_id, to_all, title, text, type, location, source, is_read, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [n.id, n.user_id, n.to_all ? 1 : 0, n.title, n.text, n.type, n.location || null, n.source || null, n.is_read ? 1 : 0, n.created_at]
      );
    }

    // 8. Restore applications
    for (const a of data.applications || []) {
      await client.query(
        'INSERT INTO applications (id, name, telegram_username, status, note, assigned_login, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [a.id, a.name, a.telegram_username, a.status, a.note, a.assigned_login, a.created_at, a.updated_at]
      );
    }

    // 9. Restore bot_logs
    for (const b of data.bot_logs || []) {
      await client.query(
        'INSERT INTO bot_logs (id, action, initiated_by, status, details, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [b.id, b.action, b.initiated_by, b.status, b.details, b.created_at]
      );
    }

    // 10. Restore audit_logs
    for (const al of data.audit_logs || []) {
      await client.query(
        'INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip, user_agent, details, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [al.id, al.user_id, al.action, al.entity, al.entity_id, al.ip, al.user_agent, al.details, al.created_at]
      );
    }

    // 11. Restore settings
    for (const st of data.settings || []) {
      await client.query('INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)', [st.key, st.value, st.updated_at]);
    }
  });

  // Requirement 39: Automated post-restore count verification
  console.log('[Restore] Verifying restored table counts...');
  const tablesToVerify = ['users', 'checkins', 'sales', 'messages', 'notifications', 'applications'];

  for (const table of tablesToVerify) {
    const expected = (data[table] || []).length;
    const res = await db.query<{ count: string | number }>(`SELECT COUNT(*) as count FROM ${table}`);
    const actual = Number(res.rows[0]?.count || 0);

    if (expected !== actual) {
      console.error(`[Restore] RESTORE VERIFICATION FAILED on table '${table}': expected ${expected}, got ${actual}`);
      process.exit(1);
    }
    console.log(`[Restore] Verified table '${table}': ${actual} records (PASS)`);
  }

  console.log('[Restore] Restore completed successfully and fully verified!');
}

runRestore().catch(err => {
  console.error('[Restore] Restore failed:', err);
  process.exit(1);
});
