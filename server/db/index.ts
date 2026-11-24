import fs from 'fs';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseSync } from 'node:sqlite';
import { TARIFF_PLANS } from '../../src/config/tariffs';
import { DEFAULT_LEGACY_ORG_ID } from './orgSettings';

export class DatabaseService {
  private pgPool: pg.Pool | null = null;
  private sqliteDb: DatabaseSync | null = null;
  private isPostgres = false;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    const isProd = process.env.NODE_ENV === 'production';
    const explicitDriver = process.env.DB_DRIVER?.toLowerCase();
    const dbUrl = process.env.DATABASE_URL;

    // Requirement 1: In production or when DB_DRIVER=postgres, PostgreSQL is MANDATORY.
    // If PostgreSQL fails, the application MUST exit and NEVER silently fall back to SQLite.
    const mustUsePostgres = explicitDriver === 'postgres' || (isProd && explicitDriver !== 'sqlite');

    if (mustUsePostgres || (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')))) {
      if (!dbUrl) {
        console.error('[DB] APPLICATION STARTUP FAILED: PostgreSQL is required (DB_DRIVER=postgres or production), but DATABASE_URL is not set.');
        console.error('[DB] HINT: If you are deploying on Beget or hosting without PostgreSQL, set DB_DRIVER=sqlite in your .env file or environment variables.');
        process.exit(1);
      }

      try {
        console.log('[DB] Connecting to PostgreSQL database...');
        this.pgPool = new pg.Pool({
          connectionString: dbUrl,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
          ssl: isProd && !dbUrl.includes('localhost') ? { rejectUnauthorized: false } : undefined,
        });

        // Test connection
        const client = await this.pgPool.connect();
        client.release();
        this.isPostgres = true;
        this.initialized = true;
        console.log('[DB] Connected to PostgreSQL successfully.');

        await this.runPgMigrations();
        await this.seedTariffs();
        await this.seedInitialData();
        await this.runSaasMigrationBackfill();
        return;
      } catch (err) {
        console.error('[DB] APPLICATION STARTUP FAILED: PostgreSQL connection unavailable:', (err as Error).message);
        if (mustUsePostgres) {
          console.error('[DB] Fatal: Silent fallback to SQLite is prohibited in production or when DB_DRIVER=postgres.');
          process.exit(1);
        }
        console.warn('[DB] Development mode fallback: Starting local SQLite database...');
      }
    }

    // SQLite engine: ONLY allowed when explicitly requested (DB_DRIVER=sqlite) or in non-production local dev
    if (isProd && explicitDriver !== 'sqlite') {
      console.error('[DB] APPLICATION STARTUP FAILED: SQLite is not allowed in production without explicit DB_DRIVER=sqlite.');
      process.exit(1);
    }

    console.log('[DB] Initializing local relational database (SQLite 3.51 engine)...');
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'pvz_relational.sqlite');
    this.openSqliteWithRecovery(dbPath);
    this.isPostgres = false;
    this.initialized = true;

    await this.runSqliteMigrations();
    await this.seedTariffs();
    await this.seedInitialData();
    await this.runSaasMigrationBackfill();
    this.checkpointSqlite('TRUNCATE');
    console.log('[DB] Relational SQLite database initialized at:', dbPath);
  }

  private configureSqlitePragmas(conn: DatabaseSync): void {
    conn.exec('PRAGMA busy_timeout = 5000;');
    conn.exec('PRAGMA foreign_keys = ON;');
    conn.exec('PRAGMA journal_mode = WAL;');
    conn.exec('PRAGMA synchronous = NORMAL;');
  }

  private openSqliteWithRecovery(dbPath: string): void {
    let conn = new DatabaseSync(dbPath);
    try {
      this.configureSqlitePragmas(conn);
      const check = conn.prepare('PRAGMA quick_check;').get() as { quick_check?: string } | undefined;
      if (check?.quick_check !== 'ok') {
        throw new Error(`SQLite quick_check failed: ${check?.quick_check || 'unknown'}`);
      }
      // Verify integrity of indexes as well
      const integrity = conn.prepare('PRAGMA integrity_check(1);').get() as { integrity_check?: string } | undefined;
      if (integrity?.integrity_check !== 'ok') {
        throw new Error(`SQLite integrity_check failed: ${integrity?.integrity_check || 'unknown'}`);
      }
      this.sqliteDb = conn;
      return;
    } catch (err) {
      console.warn('[DB] SQLite integrity warning on startup, attempting automatic repair:', (err as Error).message);
      try {
        conn.close();
      } catch {}
    }

    // Attempt clean recovery: copy readable tables into a fresh SQLite file so corrupt indexes/WAL/SHM are discarded
    const backupDir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const suffix of ['', '-wal', '-shm']) {
      const src = `${dbPath}${suffix}`;
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, path.join(backupDir, `corrupt_${stamp}.sqlite${suffix}`));
        } catch {}
      }
    }

    const tempPath = `${dbPath}.repaired.${process.pid}`;
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    let salvagedTables: Array<{ name: string; sql: string; rows: any[] }> = [];
    try {
      const reader = new DatabaseSync(dbPath);
      const tables = reader
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL")
        .all() as Array<{ name: string; sql: string }>;
      for (const tbl of tables) {
        try {
          const rows = reader.prepare(`SELECT * FROM "${tbl.name}"`).all();
          salvagedTables.push({ name: tbl.name, sql: tbl.sql, rows });
        } catch (tErr) {
          console.warn(`[DB] Skipping unreadable table during recovery (${tbl.name}):`, (tErr as Error).message);
        }
      }
      reader.close();
    } catch (readErr) {
      console.warn('[DB] Unable to read existing tables during SQLite recovery, rebuilding fresh DB:', (readErr as Error).message);
    }

    const fresh = new DatabaseSync(tempPath);
    fresh.exec('PRAGMA busy_timeout = 5000;');
    fresh.exec('PRAGMA foreign_keys = OFF;');
    for (const tbl of salvagedTables) {
      try {
        fresh.exec(tbl.sql);
        if (tbl.rows.length > 0) {
          const cols = Object.keys(tbl.rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insert = fresh.prepare(`INSERT OR IGNORE INTO "${tbl.name}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`);
          fresh.exec('BEGIN');
          for (const row of tbl.rows) {
            insert.run(...cols.map(c => row[c]));
          }
          fresh.exec('COMMIT');
        }
      } catch (copyErr) {
        try { fresh.exec('ROLLBACK'); } catch {}
        console.warn(`[DB] Partial recovery warning for ${tbl.name}:`, (copyErr as Error).message);
      }
    }
    fresh.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fresh.close();

    for (const suffix of ['-wal', '-shm']) {
      const stale = `${dbPath}${suffix}`;
      if (fs.existsSync(stale)) {
        try { fs.unlinkSync(stale); } catch {}
      }
    }
    fs.renameSync(tempPath, dbPath);

    conn = new DatabaseSync(dbPath);
    this.configureSqlitePragmas(conn);
    this.sqliteDb = conn;
    console.log(`[DB] SQLite database repaired automatically (${salvagedTables.length} tables salvaged).`);
  }

  checkpointSqlite(mode: 'PASSIVE' | 'TRUNCATE' = 'PASSIVE'): void {
    if (!this.sqliteDb || this.isPostgres) return;
    try {
      this.sqliteDb.exec(`PRAGMA wal_checkpoint(${mode});`);
    } catch (err) {
      console.warn('[DB] SQLite WAL checkpoint notice:', (err as Error).message);
    }
  }

  // Versioned PostgreSQL migrations (Requirement 2 & 40)
  private async runPgMigrations(): Promise<void> {
    if (!this.pgPool) return;

    // 1. Ensure migrations tracking table exists
    await this.pgPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Discover migration files
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    if (!fs.existsSync(migrationsDir)) return;

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const checkRes = await this.pgPool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (checkRes.rows.length === 0) {
        console.log(`[DB Migration] Applying PostgreSQL migration: ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const client = await this.pgPool.connect();
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
          await client.query('COMMIT');
          console.log(`[DB Migration] Migration ${file} successfully applied.`);
        } catch (mErr) {
          await client.query('ROLLBACK');
          console.error(`[DB Migration] Failed applying migration ${file}:`, mErr);
          throw mErr;
        } finally {
          client.release();
        }
      }
    }

    // Ensure is_senior and password_plain columns exist if Postgres table was created earlier
    try {
      await this.pgPool.query('ALTER TABLE users ADD COLUMN is_senior BOOLEAN DEFAULT FALSE;');
    } catch {
      // Column already exists
    }
    try {
      await this.pgPool.query('ALTER TABLE users ADD COLUMN password_plain TEXT;');
    } catch {
      // Column already exists
    }

    // Ensure push_subscriptions and scheduled_notifications tables exist in Postgres
    try {
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT UNIQUE NOT NULL,
          keys_p256dh TEXT NOT NULL,
          keys_auth TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS scheduled_notifications (
          id VARCHAR(64) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          text TEXT NOT NULL,
          schedule_type VARCHAR(20) NOT NULL,
          time_of_day VARCHAR(5) NOT NULL,
          target_role VARCHAR(50) NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shift_swaps (
          id VARCHAR(64) PRIMARY KEY,
          date VARCHAR(10) NOT NULL,
          shift_type VARCHAR(30) NOT NULL DEFAULT 'standard',
          location VARCHAR(30) NOT NULL,
          requester_id VARCHAR(64) NOT NULL,
          requester_name VARCHAR(100) NOT NULL,
          candidate_id VARCHAR(64),
          candidate_name VARCHAR(100),
          reason TEXT,
          status VARCHAR(30) NOT NULL DEFAULT 'open',
          resolved_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (dbErr) {
      console.error('[DB] Error creating Postgres push/schedule tables:', dbErr);
    }

    // Ensure warehouse columns exist on checkins, locations, users, and notifications in Postgres
    const pgWarehouseCols = [
      'ALTER TABLE checkins ADD COLUMN IF NOT EXISTS check_out_at TEXT;',
      'ALTER TABLE checkins ADD COLUMN IF NOT EXISTS worked_hours REAL;',
      'ALTER TABLE checkins ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 60;',
      'ALTER TABLE checkins ADD COLUMN IF NOT EXISTS qr_verified BOOLEAN DEFAULT FALSE;',
      'ALTER TABLE checkins ADD COLUMN IF NOT EXISTS geo_verified BOOLEAN DEFAULT FALSE;',
      'ALTER TABLE checkins ADD COLUMN IF NOT EXISTS zone TEXT;',
      'ALTER TABLE checkins ADD COLUMN IF NOT EXISTS notes TEXT;',
      'ALTER TABLE locations ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;',
      'ALTER TABLE locations ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;',
      'ALTER TABLE locations ADD COLUMN IF NOT EXISTS radius_meters INTEGER DEFAULT 300;',
      'ALTER TABLE locations ADD COLUMN IF NOT EXISTS qr_secret TEXT;',
      'ALTER TABLE locations ADD COLUMN IF NOT EXISTS zones TEXT;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS position TEXT;',
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_type VARCHAR(20) DEFAULT 'hourly';",
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate REAL DEFAULT 350;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS shift_rate REAL DEFAULT 3500;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS night_rate REAL DEFAULT 0;',
      'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS to_all BOOLEAN DEFAULT FALSE;',
      'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS location TEXT;',
      'ALTER TABLE notifications ALTER COLUMN user_id DROP NOT NULL;',
      'ALTER TABLE notifications ALTER COLUMN location TYPE TEXT;',
      'ALTER TABLE locations ALTER COLUMN code TYPE VARCHAR(50);',
      'ALTER TABLE checkins ALTER COLUMN location_code TYPE VARCHAR(50);',
    ];
    for (const sql of pgWarehouseCols) {
      try {
        await this.pgPool.query(sql);
      } catch {}
    }

    try {
      await this.pgPool.query(`
        DELETE FROM checkins a
        USING checkins b
        WHERE a.user_id = b.user_id
          AND a.date = b.date
          AND (
            a.checked_in_at < b.checked_in_at
            OR (a.checked_in_at = b.checked_in_at AND a.ctid < b.ctid)
          );
      `);
      await this.pgPool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_date_unique ON checkins(user_id, date);'
      );
    } catch (uqErr) {
      console.warn('[DB] Notice ensuring Postgres checkins uniqueness:', uqErr);
    }
  }

  // Relational SQLite migrations matching PostgreSQL structure
  private async runSqliteMigrations(): Promise<void> {
    if (!this.sqliteDb) return;

    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT UNIQUE NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        active INTEGER DEFAULT 1,
        is_archived INTEGER DEFAULT 0,
        archived_at DATETIME,
        contact_phone TEXT,
        notes TEXT,
        assigned_staff_ids TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        login TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee',
        status TEXT NOT NULL DEFAULT 'active',
        is_part_time INTEGER DEFAULT 0,
        is_senior INTEGER DEFAULT 0,
        telegram_username TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_locations (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, location_id)
      );

      CREATE TABLE IF NOT EXISTS checkins (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        location_code TEXT NOT NULL,
        shift_type TEXT NOT NULL DEFAULT 'standard',
        date TEXT NOT NULL,
        checked_in_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        edit_count INTEGER DEFAULT 0,
        base_rate REAL,
        UNIQUE(user_id, date)
      );

      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        checkin_id TEXT UNIQUE NOT NULL REFERENCES checkins(id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        date TEXT NOT NULL,
        photo_cash REAL DEFAULT 0.00,
        photo_card REAL DEFAULT 0.00,
        print_cash REAL DEFAULT 0.00,
        print_card REAL DEFAULT 0.00,
        lamination_cash REAL DEFAULT 0.00,
        lamination_card REAL DEFAULT 0.00,
        total REAL NOT NULL DEFAULT 0.00,
        bonus REAL NOT NULL DEFAULT 0.00,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        to_all INTEGER DEFAULT 0,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'system',
        location TEXT,
        source TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        telegram_username TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        note TEXT,
        assigned_login TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bot_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        initiated_by TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        ip TEXT,
        user_agent TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        keys_p256dh TEXT NOT NULL,
        keys_auth TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS scheduled_notifications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        time_of_day TEXT NOT NULL,
        target_role TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS checkin_cancellations (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        date VARCHAR(10) NOT NULL,
        cancelled_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS shift_swaps (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        shift_type TEXT NOT NULL DEFAULT 'standard',
        location TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        requester_name TEXT NOT NULL,
        candidate_id TEXT,
        candidate_name TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
      CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
      CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id);
      CREATE INDEX IF NOT EXISTS idx_cancellations_user_date ON checkin_cancellations(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
      CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    // SKLADIN Schema Extensions (Warehouse coords, check-out times, positions)
    const checkinColumns = [
      'ALTER TABLE checkins ADD COLUMN check_out_at TEXT;',
      'ALTER TABLE checkins ADD COLUMN worked_hours REAL;',
      'ALTER TABLE checkins ADD COLUMN break_minutes INTEGER DEFAULT 60;',
      'ALTER TABLE checkins ADD COLUMN qr_verified INTEGER DEFAULT 0;',
      'ALTER TABLE checkins ADD COLUMN geo_verified INTEGER DEFAULT 0;',
      'ALTER TABLE checkins ADD COLUMN zone TEXT;',
      'ALTER TABLE checkins ADD COLUMN notes TEXT;',
    ];
    for (const sql of checkinColumns) {
      try {
        this.sqliteDb.exec(sql);
      } catch {}
    }

    const locationColumns = [
      'ALTER TABLE locations ADD COLUMN latitude REAL;',
      'ALTER TABLE locations ADD COLUMN longitude REAL;',
      'ALTER TABLE locations ADD COLUMN radius_meters INTEGER DEFAULT 300;',
      'ALTER TABLE locations ADD COLUMN qr_secret TEXT;',
      'ALTER TABLE locations ADD COLUMN zones TEXT;',
    ];
    for (const sql of locationColumns) {
      try {
        this.sqliteDb.exec(sql);
      } catch {}
    }

    const userColumns = [
      'ALTER TABLE users ADD COLUMN position TEXT;',
      'ALTER TABLE users ADD COLUMN pay_type TEXT DEFAULT "hourly";',
      'ALTER TABLE users ADD COLUMN hourly_rate REAL DEFAULT 350;',
      'ALTER TABLE users ADD COLUMN shift_rate REAL DEFAULT 3500;',
      'ALTER TABLE users ADD COLUMN night_rate REAL DEFAULT 0;',
    ];
    for (const sql of userColumns) {
      try {
        this.sqliteDb.exec(sql);
      } catch {}
    }

    // Ensure is_senior and password_plain columns exist if table was created earlier
    try {
      this.sqliteDb.exec('ALTER TABLE users ADD COLUMN is_senior INTEGER DEFAULT 0;');
    } catch {
      // column already exists
    }

    try {
      this.sqliteDb.exec('ALTER TABLE users ADD COLUMN password_plain TEXT;');
    } catch {
      // column already exists
    }

    // Ensure edit_count column exists on checkins
    try {
      this.sqliteDb.exec('ALTER TABLE checkins ADD COLUMN edit_count INTEGER DEFAULT 0;');
    } catch {
      // column already exists
    }

    // Ensure base_rate column exists on checkins
    try {
      this.sqliteDb.exec('ALTER TABLE checkins ADD COLUMN base_rate REAL;');
    } catch {
      // column already exists
    }

    // Deduplicate any legacy checkins and enforce strict UNIQUE(user_id, date) index
    try {
      this.sqliteDb.exec(`
        DELETE FROM sales
        WHERE checkin_id IN (
          SELECT c1.id FROM checkins c1
          JOIN checkins c2
            ON c1.user_id = c2.user_id
           AND c1.date = c2.date
           AND (
             COALESCE(c1.checked_in_at, '') < COALESCE(c2.checked_in_at, '')
             OR (COALESCE(c1.checked_in_at, '') = COALESCE(c2.checked_in_at, '') AND c1.rowid < c2.rowid)
           )
        );
        DELETE FROM checkins
        WHERE id IN (
          SELECT c1.id FROM checkins c1
          JOIN checkins c2
            ON c1.user_id = c2.user_id
           AND c1.date = c2.date
           AND (
             COALESCE(c1.checked_in_at, '') < COALESCE(c2.checked_in_at, '')
             OR (COALESCE(c1.checked_in_at, '') = COALESCE(c2.checked_in_at, '') AND c1.rowid < c2.rowid)
           )
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_date_unique ON checkins(user_id, date);
      `);
    } catch (uqErr) {
      console.warn('[DB] Notice ensuring SQLite checkins uniqueness:', uqErr);
    }

    // Ensure locations table has all archive and metadata columns in SQLite
    try {
      const existingCols = new Set<string>();
      const rows = this.sqliteDb.prepare("PRAGMA table_info(locations)").all() as any[];
      rows.forEach(r => existingCols.add(r.name));

      const locColsToAdd: { name: string; type: string }[] = [
        { name: 'address', type: 'TEXT' },
        { name: 'active', type: 'INTEGER DEFAULT 1' },
        { name: 'is_archived', type: 'INTEGER DEFAULT 0' },
        { name: 'archived_at', type: 'TEXT' },
        { name: 'contact_phone', type: 'TEXT' },
        { name: 'notes', type: 'TEXT' },
        { name: 'assigned_staff_ids', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' },
        { name: 'updated_at', type: 'TEXT' },
      ];

      for (const col of locColsToAdd) {
        if (!existingCols.has(col.name)) {
          this.sqliteDb.exec(`ALTER TABLE locations ADD COLUMN ${col.name} ${col.type};`);
        }
      }
    } catch (colErr) {
      console.warn('[DB] Notice ensuring locations columns:', colErr);
    }

    // SaaS Multi-Organization, Subscriptions, Payments & Leads tables for SQLite
    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        inn TEXT,
        timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
        owner_user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS organization_members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_role TEXT NOT NULL DEFAULT 'employee',
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS tariffs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        max_locations INTEGER NOT NULL,
        max_staff INTEGER NOT NULL,
        monthly_price_rub INTEGER NOT NULL,
        features_config TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        organization_id TEXT UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        tariff_id TEXT NOT NULL REFERENCES tariffs(id),
        status TEXT NOT NULL DEFAULT 'trial',
        billing_period_months INTEGER NOT NULL DEFAULT 1,
        trial_started_at TEXT,
        trial_ends_at TEXT,
        current_period_start TEXT,
        current_period_end TEXT,
        trial_day4_notified_at TEXT,
        expired_notified_at TEXT,
        selected_tariff_id TEXT,
        selected_period_months INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS subscription_history (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        previous_status TEXT,
        new_status TEXT NOT NULL,
        tariff_id TEXT NOT NULL,
        billing_period_months INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL,
        actor_user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        tariff_id TEXT NOT NULL REFERENCES tariffs(id),
        period_months INTEGER NOT NULL DEFAULT 1,
        discount_percent INTEGER NOT NULL DEFAULT 0,
        amount_rub REAL NOT NULL,
        payment_method TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_payment_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        confirmation_url TEXT,
        invoice_number TEXT,
        company_requisites TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payment_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        external_event_id TEXT UNIQUE NOT NULL,
        payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        signature_valid INTEGER NOT NULL DEFAULT 0,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS org_settings (
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (organization_id, key)
      );

      CREATE TABLE IF NOT EXISTS contact_leads (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        contact TEXT NOT NULL,
        topic TEXT NOT NULL,
        message TEXT NOT NULL,
        consent_accepted INTEGER NOT NULL DEFAULT 1,
        ip TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const saasAlterCols = [
      'ALTER TABLE users ADD COLUMN email TEXT;',
      'ALTER TABLE users ADD COLUMN phone TEXT;',
      'ALTER TABLE users ADD COLUMN active_organization_id TEXT;',
      'ALTER TABLE users ADD COLUMN consent_privacy_at TEXT;',
      'ALTER TABLE users ADD COLUMN consent_terms_at TEXT;',
      'ALTER TABLE locations ADD COLUMN organization_id TEXT;',
      'ALTER TABLE checkins ADD COLUMN organization_id TEXT;',
      'ALTER TABLE checkin_cancellations ADD COLUMN organization_id TEXT;',
      'ALTER TABLE sales ADD COLUMN organization_id TEXT;',
      'ALTER TABLE messages ADD COLUMN organization_id TEXT;',
      'ALTER TABLE notifications ADD COLUMN organization_id TEXT;',
      'ALTER TABLE applications ADD COLUMN organization_id TEXT;',
      'ALTER TABLE bot_logs ADD COLUMN organization_id TEXT;',
      'ALTER TABLE audit_logs ADD COLUMN organization_id TEXT;',
      'ALTER TABLE shift_swaps ADD COLUMN organization_id TEXT;',
      'ALTER TABLE scheduled_notifications ADD COLUMN organization_id TEXT;',
      'ALTER TABLE push_subscriptions ADD COLUMN organization_id TEXT;',
    ];
    for (const sql of saasAlterCols) {
      try {
        this.sqliteDb.exec(sql);
      } catch {}
    }

    this.sqliteDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_users_active_org ON users(active_organization_id);
      CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
      CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_org_date ON checkins(organization_id, date);
      CREATE INDEX IF NOT EXISTS idx_sales_org_date ON sales(organization_id, date);
      CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organization_id);
      CREATE INDEX IF NOT EXISTS idx_shift_swaps_org_date ON shift_swaps(organization_id, date);
      CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(organization_id);
    `);
  }

  private async seedTariffs(): Promise<void> {
    for (const plan of TARIFF_PLANS) {
      await this.query(
        `INSERT INTO tariffs (id, name, max_locations, max_staff, monthly_price_rub, features_config, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           max_locations = EXCLUDED.max_locations,
           max_staff = EXCLUDED.max_staff,
           monthly_price_rub = EXCLUDED.monthly_price_rub,
           features_config = EXCLUDED.features_config,
           is_active = TRUE`,
        [
          plan.id,
          plan.name,
          plan.maxLocations,
          plan.maxStaff,
          plan.monthlyPriceRub,
          JSON.stringify({ subtitle: plan.subtitle }),
        ]
      );
    }
  }

  // Seed default data if tables are empty
  private async seedInitialData(): Promise<void> {
    // 1. Do not seed any default locations (manager adds and manages their own custom warehouses)

    // 2. Seed Default Manager (Admin) with secure bcrypt password hash
    // Requirement 4: INITIAL_ADMIN_PASSWORD from env, never hardcoded in source without env option.
    const adminRows = await this.query<{ id: string }>('SELECT id FROM users WHERE role = $1', ['manager']);
    if (adminRows.rows.length === 0) {
      console.log('[DB] Seeding default manager with secure bcrypt password hash...');
      const adminId = 'usr-admin-manager';
      const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || '7222';
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(initialPassword, salt);

      await this.query(
        `INSERT INTO users (id, login, password_hash, name, role, status, is_part_time, telegram_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [adminId, '+79266137222', passwordHash, 'Начальник склада (Admin)', 'manager', 'active', false, 'David_Sha']
      );
    } else {
      // Ensure name is updated to warehouse supervisor
      await this.query("UPDATE users SET name = 'Начальник склада (Admin)' WHERE role = 'manager' AND name LIKE '%Руководитель ПВЗ%'");
    }
  }

  // Non-destructive backfill linking existing legacy single-tenant records to org-default
  private async runSaasMigrationBackfill(): Promise<void> {
    try {
      const legacyAdminRes = await this.query<{ id: string }>(
        "SELECT id FROM users WHERE id = 'usr-admin-manager'"
      );
      const unScopedLocs = await this.query<{ count: string | number }>(
        'SELECT COUNT(*) as count FROM locations WHERE organization_id IS NULL'
      );
      const hasLegacyData =
        legacyAdminRes.rows.length > 0 || Number(unScopedLocs.rows[0]?.count || 0) > 0;

      if (!hasLegacyData) {
        return;
      }

      const existingOrg = await this.query<{ id: string }>(
        'SELECT id FROM organizations WHERE id = $1',
        [DEFAULT_LEGACY_ORG_ID]
      );

      if (existingOrg.rows.length === 0) {
        await this.query(
          `INSERT INTO organizations (id, name, slug, timezone, owner_user_id)
           VALUES ($1, $2, $3, 'Europe/Moscow', $4)`,
          [DEFAULT_LEGACY_ORG_ID, 'SKLADIN Основная организация', 'default', legacyAdminRes.rows[0]?.id || null]
        );
      }

      // Ensure legacy admin & legacy employees (without consent_privacy_at / membership) are attached to org-default
      if (legacyAdminRes.rows.length > 0) {
        await this.query(
          `UPDATE users
           SET active_organization_id = COALESCE(active_organization_id, $1)
           WHERE id = 'usr-admin-manager'`,
          [DEFAULT_LEGACY_ORG_ID]
        );
        await this.query(
          `INSERT INTO organization_members (id, organization_id, user_id, org_role, status)
           VALUES ($1, $2, $3, 'owner', 'active')
           ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [`mem-${uuidv4()}`, DEFAULT_LEGACY_ORG_ID, 'usr-admin-manager']
        );
      }

      // Attach any legacy employees who don't yet have an organization
      const legacyEmployees = await this.query<{ id: string; status: string }>(
        "SELECT id, status FROM users WHERE role = 'employee' AND active_organization_id IS NULL"
      );
      for (const emp of legacyEmployees.rows) {
        await this.query(
          'UPDATE users SET active_organization_id = $1 WHERE id = $2',
          [DEFAULT_LEGACY_ORG_ID, emp.id]
        );
        await this.query(
          `INSERT INTO organization_members (id, organization_id, user_id, org_role, status)
           VALUES ($1, $2, $3, 'employee', $4)
           ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [`mem-${uuidv4()}`, DEFAULT_LEGACY_ORG_ID, emp.id, emp.status === 'active' ? 'active' : 'archived']
        );
      }

      // Attach legacy rows across all operational tables to org-default
      const orgScopedTables = [
        'locations',
        'checkins',
        'checkin_cancellations',
        'sales',
        'messages',
        'notifications',
        'applications',
        'bot_logs',
        'audit_logs',
        'shift_swaps',
        'scheduled_notifications',
        'push_subscriptions',
      ];
      for (const tbl of orgScopedTables) {
        await this.query(
          `UPDATE ${tbl} SET organization_id = $1 WHERE organization_id IS NULL`,
          [DEFAULT_LEGACY_ORG_ID]
        );
      }

      // Copy legacy global settings keys to org_settings for org-default if not yet present
      const legacySettings = await this.query<{ key: string; value: string }>(
        'SELECT key, value FROM settings'
      );
      for (const row of legacySettings.rows) {
        await this.query(
          `INSERT INTO org_settings (organization_id, key, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, key) DO NOTHING`,
          [DEFAULT_LEGACY_ORG_ID, row.key, row.value]
        );
      }

      // Ensure org-default has an active 'maximum' subscription so legacy admin continues working without lockouts
      const subRes = await this.query<{ id: string }>(
        'SELECT id FROM subscriptions WHERE organization_id = $1',
        [DEFAULT_LEGACY_ORG_ID]
      );
      if (subRes.rows.length === 0) {
        const now = new Date();
        const yearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        const subId = `sub-${uuidv4()}`;
        await this.query(
          `INSERT INTO subscriptions (
             id, organization_id, tariff_id, status, billing_period_months,
             current_period_start, current_period_end, selected_tariff_id, selected_period_months
           ) VALUES ($1, $2, 'maximum', 'active', 12, $3, $4, 'maximum', 12)`,
          [subId, DEFAULT_LEGACY_ORG_ID, now.toISOString(), yearLater.toISOString()]
        );
        await this.query(
          `INSERT INTO subscription_history (
             id, organization_id, subscription_id, previous_status, new_status,
             tariff_id, billing_period_months, reason
           ) VALUES ($1, $2, $3, NULL, 'active', 'maximum', 12, 'LEGACY_ORG_MIGRATION')`,
          [`subh-${uuidv4()}`, DEFAULT_LEGACY_ORG_ID, subId]
        );
      }
    } catch (err) {
      console.warn('[DB] SaaS migration backfill warning:', err);
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(sql, params);
      return { rows: res.rows as T[] };
    }

    if (this.sqliteDb) {
      let sqliteSql = sql;
      if (params.length > 0) {
        sqliteSql = sql.replace(/\$(\d+)/g, (match, num) => {
          const idx = parseInt(num, 10);
          return idx >= 1 && idx <= params.length ? '?' : match;
        });
      }
      const cleanParams = params.map(p => (typeof p === 'boolean' ? (p ? 1 : 0) : p));

      const trimmed = sqliteSql.trim().toUpperCase();
      const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA');

      if (isSelect) {
        const stmt = this.sqliteDb.prepare(sqliteSql);
        const rows = stmt.all(...cleanParams) as T[];
        return { rows };
      } else {
        const stmt = this.sqliteDb.prepare(sqliteSql);
        stmt.run(...cleanParams);
        return { rows: [] };
      }
    }

    throw new Error('[DB] No database engine available');
  }

  async transaction<T>(callback: (client: { query: <R = any>(sql: string, params?: any[]) => Promise<{ rows: R[] }> }) => Promise<T>): Promise<T> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const res = await callback({
          query: async <R = any>(sql: string, params: any[] = []): Promise<{ rows: R[] }> => {
            const result = await client.query(sql, params);
            return { rows: result.rows as unknown as R[] };
          },
        });
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (this.sqliteDb) {
      this.sqliteDb.exec('BEGIN IMMEDIATE');
      try {
        const res = await callback({
          query: async <R = any>(sql: string, params: any[] = []): Promise<{ rows: R[] }> => {
            return this.query<R>(sql, params);
          },
        });
        this.sqliteDb.exec('COMMIT');
        return res;
      } catch (err) {
        this.sqliteDb.exec('ROLLBACK');
        throw err;
      }
    }

    throw new Error('[DB] No database engine available for transaction');
  }

  isUsingPostgres(): boolean {
    return this.isPostgres;
  }

  async close(): Promise<void> {
    if (this.pgPool) {
      try {
        await this.pgPool.end();
      } catch {}
      this.pgPool = null;
    }
    if (this.sqliteDb) {
      try {
        this.sqliteDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {}
      try {
        this.sqliteDb.close();
      } catch {}
      this.sqliteDb = null;
    }
    this.initialized = false;
  }
}

export const db = new DatabaseService();
