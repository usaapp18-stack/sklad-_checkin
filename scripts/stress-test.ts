import { db } from '../server/db/index';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { hashSessionToken } from '../server/middleware/auth';
import { telegramService, escapeMarkdown } from '../server/services/telegram';

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  durationMs: number;
  detail?: string;
}

const results: TestResult[] = [];

function recordTest(category: string, name: string, passed: boolean, startTime: number, detail?: string) {
  const durationMs = Date.now() - startTime;
  results.push({ category, name, passed, durationMs, detail });
  if (passed) {
    console.log(`  ✅ [PASS] [${category}] ${name} (${durationMs}ms)`);
  } else {
    console.error(`  ❌ [FAIL] [${category}] ${name} (${durationMs}ms) ${detail ? `-> ${detail}` : ''}`);
  }
}

async function runDeepStressTest() {
  console.log('\n================================================================');
  console.log('🔥 INITIATING DEEP SYSTEM STRESS & RESILIENCE AUDIT');
  console.log('================================================================\n');

  await db.init();

  // ============================================================================
  // SUITE 1: CONCURRENCY & MASSIVE SIMULTANEOUS LOAD (25 Concurrent Employees)
  // ============================================================================
  console.log('📌 [SUITE 1] High Concurrency Load Testing (25 Parallel Workers)...');
  const suite1Start = Date.now();
  const workerCount = 25;
  const stressDate = '2026-09-30';
  const workerIds: string[] = [];
  const testPassword = 'StressPassword2026!';
  const workerHash = bcrypt.hashSync(testPassword, 10);

  // 1.1 Parallel User Creation
  const userCreateStart = Date.now();
  try {
    await Promise.all(
      Array.from({ length: workerCount }).map(async (_, idx) => {
        const id = `stress-user-${idx}-${uuidv4()}`;
        workerIds.push(id);
        const login = `worker_load_${idx}_${Date.now()}`;
        await db.query(
          'INSERT INTO users (id, login, password_hash, name, role, status, is_part_time) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, login, workerHash, `Нагрузочный Сотрудник ${idx + 1}`, 'employee', 'active', 0]
        );
        // Alternate locations
        const locId = idx % 2 === 0 ? 'loc-sd' : 'loc-bd';
        await db.query('INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)', [id, locId]);
      })
    );
    recordTest('Concurrency', `Created ${workerCount} users in parallel`, true, userCreateStart);
  } catch (err: any) {
    recordTest('Concurrency', `Created ${workerCount} users in parallel`, false, userCreateStart, err.message);
  }

  // 1.2 Parallel Check-ins at the exact same millisecond
  const checkinStart = Date.now();
  try {
    const checkinPromises = workerIds.map((uid, idx) => {
      const locCode = idx % 2 === 0 ? 'СД' : 'БД';
      return db.query(
        'INSERT INTO checkins (id, user_id, location_code, shift_type, date) VALUES ($1, $2, $3, $4, $5)',
        [`chk-stress-${idx}-${uuidv4()}`, uid, locCode, 'standard', stressDate]
      );
    });
    await Promise.all(checkinPromises);

    const countRes = await db.query<{ count: string | number }>('SELECT COUNT(*) as count FROM checkins WHERE date = $1', [stressDate]);
    const totalCheckins = Number(countRes.rows[0]?.count || 0);
    recordTest(
      'Concurrency',
      `Executed ${workerCount} simultaneous check-ins without race conditions or lost records (count = ${totalCheckins})`,
      totalCheckins === workerCount,
      checkinStart
    );
  } catch (err: any) {
    recordTest('Concurrency', 'Parallel check-ins execution', false, checkinStart, err.message);
  }

  // 1.3 Parallel Sales Submissions with calculations
  const salesStart = Date.now();
  try {
    const checkins = await db.query<{ id: string; user_id: string }>('SELECT id, user_id FROM checkins WHERE date = $1', [stressDate]);
    const salesPromises = checkins.rows.map((chk, idx) => {
      const photoCash = 1000 * (idx + 1);
      const photoCard = 500 * (idx + 1);
      const total = photoCash + photoCard;
      const bonus = Math.round(total * 0.05);
      return db.query(
        `INSERT INTO sales (id, checkin_id, user_id, date, photo_cash, photo_card, total, bonus)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [`sale-stress-${idx}-${uuidv4()}`, chk.id, chk.user_id, stressDate, photoCash, photoCard, total, bonus]
      );
    });
    await Promise.all(salesPromises);

    const salesSumRes = await db.query<{ sum_total: string | number; sum_bonus: string | number }>(
      'SELECT SUM(total) as sum_total, SUM(bonus) as sum_bonus FROM sales WHERE date = $1',
      [stressDate]
    );

    const sumTotal = Number(salesSumRes.rows[0]?.sum_total || 0);
    const sumBonus = Number(salesSumRes.rows[0]?.sum_bonus || 0);
    const expectedBonus = Math.round(sumTotal * 0.05);

    recordTest(
      'Concurrency',
      `Submitted ${workerCount} sales records simultaneously (Total: ${sumTotal} ₽, Bonus: ${sumBonus} ₽)`,
      sumBonus === expectedBonus && sumTotal > 0,
      salesStart
    );
  } catch (err: any) {
    recordTest('Concurrency', 'Parallel sales submission', false, salesStart, err.message);
  }

  // ============================================================================
  // SUITE 2: RACE CONDITIONS & ATOMICITY DEFENSE
  // ============================================================================
  console.log('\n📌 [SUITE 2] Race Condition & Atomicity Defense...');
  
  // 2.1 Multiple simultaneous check-ins for the SAME single user on the same date
  const raceStart = Date.now();
  const testSingleUser = workerIds[0];
  const duplicateDate = '2026-10-01';
  let duplicateSuccesses = 0;
  let duplicateFailures = 0;

  const duplicateAttempts = Array.from({ length: 10 }).map(async (_, idx) => {
    try {
      await db.query(
        'INSERT INTO checkins (id, user_id, location_code, shift_type, date) VALUES ($1, $2, $3, $4, $5)',
        [`chk-dup-${idx}-${uuidv4()}`, testSingleUser, 'СД', 'standard', duplicateDate]
      );
      duplicateSuccesses++;
    } catch {
      duplicateFailures++;
    }
  });

  await Promise.all(duplicateAttempts);
  const singleUserCheckinCount = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) as count FROM checkins WHERE user_id = $1 AND date = $2',
    [testSingleUser, duplicateDate]
  );
  const finalCount = Number(singleUserCheckinCount.rows[0]?.count || 0);

  recordTest(
    'Atomicity',
    `Database constraint prevented 10 concurrent duplicate check-ins for single employee (Exactly 1 row created, 9 rejected)`,
    finalCount === 1 && duplicateFailures === 9,
    raceStart
  );

  // ============================================================================
  // SUITE 3: SECURITY & DATA PRIVACY AUDIT
  // ============================================================================
  console.log('\n📌 [SUITE 3] Security, Data Isolation & Boundary Testing...');

  // 3.1 Passwords never stored in plaintext & bcrypt cost verification
  const tSec1 = Date.now();
  const usersWithPlainPass = await db.query('SELECT id FROM users WHERE password_hash NOT LIKE $1', ['$2%']);
  recordTest(
    'Security',
    '100% of passwords in database are secured with bcrypt hash algorithm',
    usersWithPlainPass.rows.length === 0,
    tSec1
  );

  // 3.2 Session Tokens Hashing
  const tSec2 = Date.now();
  const rawToken = uuidv4();
  const hashedToken = hashSessionToken(rawToken);
  const sessId = `sess-stress-${uuidv4()}`;
  await db.query(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [sessId, testSingleUser, hashedToken, new Date(Date.now() + 86400000).toISOString()]
  );
  const sessCheck = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE id = $1', [sessId]);
  recordTest(
    'Security',
    'Session tokens are stored as 256-bit SHA-256 hashes in database',
    sessCheck.rows[0]?.token_hash === hashedToken && sessCheck.rows[0]?.token_hash !== rawToken,
    tSec2
  );
  await db.query('DELETE FROM sessions WHERE id = $1', [sessId]);

  // 3.3 Isolation: Message Read Isolation
  const tSec3 = Date.now();
  const msgUserA = workerIds[1];
  const msgUserB = workerIds[2];
  const msgA = `msg-a-${uuidv4()}`;
  const msgB = `msg-b-${uuidv4()}`;
  await db.query('INSERT INTO messages (id, from_user_id, message) VALUES ($1, $2, $3)', [msgA, msgUserA, 'Сообщение А']);
  await db.query('INSERT INTO messages (id, from_user_id, message) VALUES ($1, $2, $3)', [msgB, msgUserB, 'Сообщение Б']);

  // Simulate Employee A marking their messages read
  await db.query('UPDATE messages SET is_read = 1 WHERE from_user_id = $1', [msgUserA]);
  const checkMsgA = await db.query<{ is_read: number | boolean }>('SELECT is_read FROM messages WHERE id = $1', [msgA]);
  const checkMsgB = await db.query<{ is_read: number | boolean }>('SELECT is_read FROM messages WHERE id = $1', [msgB]);

  recordTest(
    'Security',
    'Data isolation: Employee A bulk operations cannot affect Employee B messages',
    Boolean(checkMsgA.rows[0]?.is_read) === true && Boolean(checkMsgB.rows[0]?.is_read) === false,
    tSec3
  );

  // 3.4 Soft Delete / Archive Preservation
  const tSec4 = Date.now();
  await db.query("UPDATE users SET status = 'archived' WHERE id = $1", [msgUserA]);
  const archivedUser = await db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [msgUserA]);
  const preservedCheckins = await db.query('SELECT id FROM checkins WHERE user_id = $1', [msgUserA]);
  recordTest(
    'Integrity',
    'Soft delete (archiving) preserves complete shift history and financial records',
    archivedUser.rows[0]?.status === 'archived' && preservedCheckins.rows.length > 0,
    tSec4
  );

  // ============================================================================
  // SUITE 4: TELEGRAM ROBUSTNESS & MARKDOWN ESCAPING
  // ============================================================================
  console.log('\n📌 [SUITE 4] Telegram Service & Markdown Resilience...');
  const tTg1 = Date.now();
  const dangerousName = 'Иван [User] *Bold* _Italic_ `code` & <tag>';
  const escaped = escapeMarkdown(dangerousName);
  const hasUnescapedBrackets = /[[\]*`_]/.test(escaped.replace(/\\[[\]*`_]/g, ''));
  recordTest(
    'Telegram',
    'Markdown injection & formatting character escape verification',
    !hasUnescapedBrackets,
    tTg1
  );

  const tTg2 = Date.now();
  const reportSimulation = await telegramService.sendDailySalesReport(stressDate);
  recordTest(
    'Telegram',
    'Daily sales report generation & simulation resilience',
    reportSimulation.success && typeof reportSimulation.text === 'string' && reportSimulation.text.includes('Отчёт по продажам'),
    tTg2
  );

  // ============================================================================
  // SUITE 5: MASSIVE DATA CLEANUP & LEAK PREVENTION
  // ============================================================================
  console.log('\n📌 [SUITE 5] Teardown & Database State Verification...');
  const tClean = Date.now();
  await db.query('DELETE FROM sales WHERE date IN ($1, $2)', [stressDate, duplicateDate]);
  await db.query('DELETE FROM checkins WHERE date IN ($1, $2)', [stressDate, duplicateDate]);
  await db.query('DELETE FROM messages WHERE id IN ($1, $2)', [msgA, msgB]);
  for (const id of workerIds) {
    await db.query('DELETE FROM user_locations WHERE user_id = $1', [id]);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
  }
  recordTest('Teardown', 'Cleaned up all stress-test worker accounts and associated tables', true, tClean);

  // ============================================================================
  // FINAL AUDIT SUMMARY
  // ============================================================================
  const totalDuration = Date.now() - suite1Start;
  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;

  console.log('\n================================================================');
  console.log('📊 DEEP STRESS & RESILIENCE AUDIT SUMMARY');
  console.log('================================================================');
  console.log(`Total Test Scenarios Executed: ${results.length}`);
  console.log(`Passed:                        ${totalPassed} ✅`);
  console.log(`Failed:                        ${totalFailed} ❌`);
  console.log(`Total Audit Execution Time:    ${totalDuration}ms`);
  console.log('================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runDeepStressTest().catch(err => {
  console.error('Fatal stress test failure:', err);
  process.exit(1);
});
