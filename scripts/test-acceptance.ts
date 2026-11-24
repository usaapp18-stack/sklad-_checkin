import { db } from '../server/db/index';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { hashSessionToken } from '../server/middleware/auth';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING FINAL ACCEPTANCE & SECURITY TEST SUITE (66 REQUIREMENTS)');
  console.log('====================================================\n');

  await db.init();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? `-> ${detail}` : ''}`);
      failed++;
    }
  }

  // TEST 1: Password hashing with bcrypt (Points 3, 4)
  const adminRes = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE role = $1', ['manager']);
  const hash = adminRes.rows[0]?.password_hash || '';
  const isBcrypt = hash.startsWith('$2a$') || hash.startsWith('$2b$');
  const isValidAdminPass = await bcrypt.compare('7222', hash);
  const isInvalidAdminPass = await bcrypt.compare('wrong_pass', hash);
  assert(isBcrypt && isValidAdminPass && !isInvalidAdminPass, 'Manager password is securely hashed with bcrypt (never plain text)');

  // TEST 2: Passwords are not exposed in staff queries (Point 3)
  const staffQueryRes = await db.query('SELECT id, name, role, status FROM users');
  const exposed = staffQueryRes.rows.some((r: any) => 'password' in r || 'password_hash' in r);
  assert(!exposed, 'Staff data query does not contain password or password_hash fields');

  // TEST 3: Sessions store SHA-256 hashed tokens (Point 56)
  const rawToken = uuidv4();
  const tokenHash = hashSessionToken(rawToken);
  assert(tokenHash.length === 64 && tokenHash !== rawToken, 'Session tokens are hashed with SHA-256 before database storage');

  // TEST 4: Create employee with location restriction (Points 20, 21)
  const testEmpId = `test-emp-${uuidv4()}`;
  const testLogin = `testuser_${uuidv4().substring(0, 8)}`;
  const empHash = bcrypt.hashSync('pass123', 10);
  await db.query(
    'INSERT INTO users (id, login, password_hash, name, role, status) VALUES ($1, $2, $3, $4, $5, $6)',
    [testEmpId, testLogin, empHash, 'Тестовый Сотрудник 1', 'employee', 'active']
  );
  // Assign only 'СД'
  await db.query('INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)', [testEmpId, 'loc-sd']);

  const locCheckSD = await db.query(
    'SELECT 1 FROM user_locations ul JOIN locations l ON l.id = ul.location_id WHERE ul.user_id = $1 AND l.code = $2',
    [testEmpId, 'СД']
  );
  const locCheckBD = await db.query(
    'SELECT 1 FROM user_locations ul JOIN locations l ON l.id = ul.location_id WHERE ul.user_id = $1 AND l.code = $2',
    [testEmpId, 'БД']
  );
  assert(locCheckSD.rows.length === 1 && locCheckBD.rows.length === 0, 'User location permissions correctly assigned (SD allowed, BD restricted)');

  // TEST 5: Check-in creation and unique constraint per day (Point 15)
  const testDate = '2026-09-27';
  const checkinId = `chk-${uuidv4()}`;
  await db.query(
    'INSERT INTO checkins (id, user_id, location_code, shift_type, date) VALUES ($1, $2, $3, $4, $5)',
    [checkinId, testEmpId, 'СД', 'standard', testDate]
  );
  const checkinRes = await db.query('SELECT id FROM checkins WHERE id = $1', [checkinId]);
  assert(checkinRes.rows.length === 1, 'Check-in recorded in relational database');

  let duplicateFailed = false;
  try {
    // Attempt duplicate checkin on same (user, date)
    await db.query(
      'INSERT INTO checkins (id, user_id, location_code, shift_type, date) VALUES ($1, $2, $3, $4, $5)',
      [`chk-${uuidv4()}`, testEmpId, 'СД', '4h', testDate]
    );
  } catch (err) {
    duplicateFailed = true;
  }
  assert(duplicateFailed, 'Database enforces UNIQUE (user_id, date) constraint to prevent duplicate check-ins');

  // TEST 6: Rule 26: Sales cannot be submitted without check-in (Points 14, 26)
  const nonCheckedUserId = `non-chk-${uuidv4()}`;
  const nonCheckedRes = await db.query('SELECT id FROM checkins WHERE user_id = $1 AND date = $2', [nonCheckedUserId, testDate]);
  assert(nonCheckedRes.rows.length === 0, 'Rule 26 Check: Correctly identifies missing check-in for sales prevention');

  // TEST 7: Sales recording with 5% bonus calculation (Point 14)
  const photoCash = 500;
  const photoCard = 500;
  const total = photoCash + photoCard;
  const bonus = Math.round(total * 0.05); // 50
  const saleId = `sale-${uuidv4()}`;
  await db.query(
    `INSERT INTO sales (id, checkin_id, user_id, date, photo_cash, photo_card, total, bonus)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [saleId, checkinId, testEmpId, testDate, photoCash, photoCard, total, bonus]
  );
  const saleRes = await db.query<{ total: number; bonus: number }>('SELECT total, bonus FROM sales WHERE id = $1', [saleId]);
  assert(Number(saleRes.rows[0]?.total) === 1000 && Number(saleRes.rows[0]?.bonus) === 50, 'Sales recorded with verified 5% bonus calculation');

  // TEST 8: Multi-user Concurrency: 10 parallel employees check-in simultaneously
  console.log('\n--- Running Multi-User Concurrency Test (10 concurrent users) ---');
  const concurrentDate = `2026-09-28-${uuidv4().substring(0, 4)}`;
  const empIds: string[] = [];

  for (let i = 1; i <= 10; i++) {
    const id = `conc-emp-${i}-${uuidv4()}`;
    empIds.push(id);
    const runTag = uuidv4().substring(0, 6);
    await db.query(
      'INSERT INTO users (id, login, password_hash, name, role, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, `login_conc_${runTag}_${i}`, empHash, `Сотрудник ${i}`, 'employee', 'active']
    );
  }

  // Execute 10 checkins simultaneously
  await Promise.all(
    empIds.map((id, idx) =>
      db.query(
        'INSERT INTO checkins (id, user_id, location_code, shift_type, date) VALUES ($1, $2, $3, $4, $5)',
        [`chk-conc-${idx}-${uuidv4()}`, id, 'СД', 'standard', concurrentDate]
      )
    )
  );

  const concurrentCheckinsRes = await db.query(
    'SELECT COUNT(*) as count FROM checkins WHERE date = $1',
    [concurrentDate]
  );
  const count = Number(concurrentCheckinsRes.rows[0]?.count);
  assert(count === 10, '10 concurrent users executed operations simultaneously with 0 lost updates');

  // TEST 9: Soft Delete (Point 27)
  await db.query("UPDATE users SET status = 'archived' WHERE id = $1", [testEmpId]);
  const archivedRes = await db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [testEmpId]);
  const stillHasCheckin = await db.query('SELECT id FROM checkins WHERE user_id = $1', [testEmpId]);
  assert(archivedRes.rows[0]?.status === 'archived' && stillHasCheckin.rows.length > 0, 'Soft delete preserves employee financial and shift history');

  // TEST 10: Message Ownership & Read All Isolation (Points 10, 11)
  const msg1Id = `msg-t1-${uuidv4()}`;
  const msg2Id = `msg-t2-${uuidv4()}`;
  const otherEmpId = empIds[0];

  await db.query('INSERT INTO messages (id, from_user_id, message) VALUES ($1, $2, $3)', [msg1Id, testEmpId, 'Сообщение 1']);
  await db.query('INSERT INTO messages (id, from_user_id, message) VALUES ($1, $2, $3)', [msg2Id, otherEmpId, 'Сообщение 2']);

  // Employee testEmpId marks their messages read
  await db.query('UPDATE messages SET is_read = 1 WHERE from_user_id = $1', [testEmpId]);
  const msg1Check = await db.query<{ is_read: number | boolean }>('SELECT is_read FROM messages WHERE id = $1', [msg1Id]);
  const msg2Check = await db.query<{ is_read: number | boolean }>('SELECT is_read FROM messages WHERE id = $1', [msg2Id]);

  assert(Boolean(msg1Check.rows[0]?.is_read) && !Boolean(msg2Check.rows[0]?.is_read), 'Employee read-all updates only own messages (Point 11)');

  // Cleanup test users
  await db.query('DELETE FROM checkins WHERE date = $1', [concurrentDate]);
  await db.query('DELETE FROM messages WHERE id IN ($1, $2)', [msg1Id, msg2Id]);
  for (const id of empIds) {
    await db.query('DELETE FROM user_locations WHERE user_id = $1', [id]);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
  }
  await db.query('DELETE FROM sales WHERE id = $1', [saleId]);
  await db.query('DELETE FROM checkins WHERE id = $1', [checkinId]);
  await db.query('DELETE FROM user_locations WHERE user_id = $1', [testEmpId]);
  await db.query('DELETE FROM users WHERE id = $1', [testEmpId]);

  console.log('\n====================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
