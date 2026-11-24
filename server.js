// server.ts
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path2 from "path";
import fs2 from "fs";
import dotenv from "dotenv";

// server/db/index.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import bcrypt from "bcryptjs";
import { DatabaseSync } from "node:sqlite";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var DatabaseService = class {
  constructor() {
    this.pgPool = null;
    this.sqliteDb = null;
    this.isPostgres = false;
    this.initialized = false;
  }
  async init() {
    if (this.initialized) return;
    const isProd = process.env.NODE_ENV === "production";
    const explicitDriver = process.env.DB_DRIVER?.toLowerCase();
    const dbUrl = process.env.DATABASE_URL;
    const mustUsePostgres = explicitDriver === "postgres" || isProd && explicitDriver !== "sqlite";
    if (mustUsePostgres || dbUrl && (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://"))) {
      if (!dbUrl) {
        console.error("[DB] APPLICATION STARTUP FAILED: PostgreSQL is required (DB_DRIVER=postgres or production), but DATABASE_URL is not set.");
        console.error("[DB] HINT: If you are deploying on Beget or hosting without PostgreSQL, set DB_DRIVER=sqlite in your .env file or environment variables.");
        process.exit(1);
      }
      try {
        console.log("[DB] Connecting to PostgreSQL database...");
        this.pgPool = new pg.Pool({
          connectionString: dbUrl,
          max: 20,
          idleTimeoutMillis: 3e4,
          connectionTimeoutMillis: 5e3,
          ssl: isProd && !dbUrl.includes("localhost") ? { rejectUnauthorized: false } : void 0
        });
        const client = await this.pgPool.connect();
        client.release();
        this.isPostgres = true;
        this.initialized = true;
        console.log("[DB] Connected to PostgreSQL successfully.");
        await this.runPgMigrations();
        await this.seedInitialData();
        return;
      } catch (err) {
        console.error("[DB] APPLICATION STARTUP FAILED: PostgreSQL connection unavailable:", err.message);
        if (mustUsePostgres) {
          console.error("[DB] Fatal: Silent fallback to SQLite is prohibited in production or when DB_DRIVER=postgres.");
          process.exit(1);
        }
        console.warn("[DB] Development mode fallback: Starting local SQLite database...");
      }
    }
    if (isProd && explicitDriver !== "sqlite") {
      console.error("[DB] APPLICATION STARTUP FAILED: SQLite is not allowed in production without explicit DB_DRIVER=sqlite.");
      process.exit(1);
    }
    console.log("[DB] Initializing local relational database (SQLite 3.51 engine)...");
    const dataDir = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "pvz_relational.sqlite");
    this.sqliteDb = new DatabaseSync(dbPath);
    this.sqliteDb.exec("PRAGMA foreign_keys = ON;");
    this.sqliteDb.exec("PRAGMA journal_mode = WAL;");
    this.isPostgres = false;
    this.initialized = true;
    await this.runSqliteMigrations();
    await this.seedInitialData();
    console.log("[DB] Relational SQLite database initialized at:", dbPath);
  }
  // Versioned PostgreSQL migrations (Requirement 2 & 40)
  async runPgMigrations() {
    if (!this.pgPool) return;
    await this.pgPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const migrationsDir = path.resolve(process.cwd(), "migrations");
    if (!fs.existsSync(migrationsDir)) return;
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const checkRes = await this.pgPool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (checkRes.rows.length === 0) {
        console.log(`[DB Migration] Applying PostgreSQL migration: ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        const client = await this.pgPool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
          await client.query("COMMIT");
          console.log(`[DB Migration] Migration ${file} successfully applied.`);
        } catch (mErr) {
          await client.query("ROLLBACK");
          console.error(`[DB Migration] Failed applying migration ${file}:`, mErr);
          throw mErr;
        } finally {
          client.release();
        }
      }
    }
    try {
      await this.pgPool.query("ALTER TABLE users ADD COLUMN is_senior BOOLEAN DEFAULT FALSE;");
    } catch {
    }
    try {
      await this.pgPool.query("ALTER TABLE users ADD COLUMN password_plain TEXT;");
    } catch {
    }
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
      console.error("[DB] Error creating Postgres push/schedule tables:", dbErr);
    }
  }
  // Relational SQLite migrations matching PostgreSQL structure
  async runSqliteMigrations() {
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
    try {
      this.sqliteDb.exec("ALTER TABLE users ADD COLUMN is_senior INTEGER DEFAULT 0;");
    } catch {
    }
    try {
      this.sqliteDb.exec("ALTER TABLE users ADD COLUMN password_plain TEXT;");
    } catch {
    }
    try {
      this.sqliteDb.exec("ALTER TABLE checkins ADD COLUMN edit_count INTEGER DEFAULT 0;");
    } catch {
    }
    try {
      this.sqliteDb.exec("ALTER TABLE checkins ADD COLUMN base_rate REAL;");
    } catch {
    }
    try {
      const existingCols = /* @__PURE__ */ new Set();
      const rows = this.sqliteDb.prepare("PRAGMA table_info(locations)").all();
      rows.forEach((r) => existingCols.add(r.name));
      const locColsToAdd = [
        { name: "address", type: "TEXT" },
        { name: "active", type: "INTEGER DEFAULT 1" },
        { name: "is_archived", type: "INTEGER DEFAULT 0" },
        { name: "archived_at", type: "TEXT" },
        { name: "contact_phone", type: "TEXT" },
        { name: "notes", type: "TEXT" },
        { name: "assigned_staff_ids", type: "TEXT" },
        { name: "created_at", type: "TEXT" },
        { name: "updated_at", type: "TEXT" }
      ];
      for (const col of locColsToAdd) {
        if (!existingCols.has(col.name)) {
          this.sqliteDb.exec(`ALTER TABLE locations ADD COLUMN ${col.name} ${col.type};`);
        }
      }
    } catch (colErr) {
      console.warn("[DB] Notice ensuring locations columns:", colErr);
    }
  }
  // Seed default data if tables are empty
  async seedInitialData() {
    const adminRows = await this.query("SELECT id FROM users WHERE role = $1", ["manager"]);
    if (adminRows.rows.length === 0) {
      console.log("[DB] Seeding default manager with secure bcrypt password hash...");
      const adminId = "usr-admin-manager";
      const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || "7222";
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(initialPassword, salt);
      await this.query(
        `INSERT INTO users (id, login, password_hash, name, role, status, is_part_time, telegram_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [adminId, "+79266137222", passwordHash, "\u0420\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u041F\u0412\u0417 (Admin)", "manager", "active", false, "David_Sha"]
      );
    }
  }
  async query(sql, params = []) {
    if (!this.initialized) {
      await this.init();
    }
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(sql, params);
      return { rows: res.rows };
    }
    if (this.sqliteDb) {
      let sqliteSql = sql;
      if (params.length > 0) {
        sqliteSql = sql.replace(/\$(\d+)/g, (match, num) => {
          const idx = parseInt(num, 10);
          return idx >= 1 && idx <= params.length ? "?" : match;
        });
      }
      const cleanParams = params.map((p) => typeof p === "boolean" ? p ? 1 : 0 : p);
      const trimmed = sqliteSql.trim().toUpperCase();
      const isSelect = trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA");
      if (isSelect) {
        const stmt = this.sqliteDb.prepare(sqliteSql);
        const rows = stmt.all(...cleanParams);
        return { rows };
      } else {
        const stmt = this.sqliteDb.prepare(sqliteSql);
        stmt.run(...cleanParams);
        return { rows: [] };
      }
    }
    throw new Error("[DB] No database engine available");
  }
  async transaction(callback) {
    if (!this.initialized) {
      await this.init();
    }
    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query("BEGIN");
        const res = await callback({
          query: async (sql, params = []) => {
            const result = await client.query(sql, params);
            return { rows: result.rows };
          }
        });
        await client.query("COMMIT");
        return res;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    if (this.sqliteDb) {
      this.sqliteDb.exec("BEGIN IMMEDIATE");
      try {
        const res = await callback({
          query: async (sql, params = []) => {
            return this.query(sql, params);
          }
        });
        this.sqliteDb.exec("COMMIT");
        return res;
      } catch (err) {
        this.sqliteDb.exec("ROLLBACK");
        throw err;
      }
    }
    throw new Error("[DB] No database engine available for transaction");
  }
  isUsingPostgres() {
    return this.isPostgres;
  }
};
var db = new DatabaseService();

// server/middleware/auth.ts
import crypto from "crypto";
function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function setCsrfCookie(res, req) {
  const token = crypto.randomBytes(32).toString("hex");
  const isHttps = Boolean(req?.secure) || req?.headers?.["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  res.cookie("pvz_csrf", token, {
    httpOnly: false,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1e3,
    ...isHttps ? { partitioned: true } : {}
  });
  return token;
}
var authenticate = async (req, _res, next) => {
  try {
    let token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : req.cookies?.pvz_session;
    if (!token) {
      req.user = void 0;
      return next();
    }
    req.sessionToken = token;
    const tokenHash = hashSessionToken(token);
    const sessionRes = await db.query(
      `SELECT s.user_id, s.expires_at, u.login, u.name, u.role, u.status, u.is_part_time, u.is_senior, u.telegram_username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [tokenHash]
    );
    if (sessionRes.rows.length === 0) {
      req.user = void 0;
      return next();
    }
    const session = sessionRes.rows[0];
    if (new Date(session.expires_at) < /* @__PURE__ */ new Date()) {
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
      req.user = void 0;
      return next();
    }
    if (session.status === "blocked" || session.status === "archived") {
      req.user = void 0;
      return next();
    }
    const locRes = await db.query(
      `SELECT l.code FROM locations l
       JOIN user_locations ul ON ul.location_id = l.id
       WHERE ul.user_id = $1`,
      [session.user_id]
    );
    req.user = {
      id: session.user_id,
      login: session.login,
      name: session.name,
      role: session.role,
      status: session.status,
      isPartTime: Boolean(session.is_part_time),
      isSenior: Boolean(session.is_senior),
      telegramUsername: session.telegram_username,
      locations: locRes.rows.map((r) => r.code)
    };
    next();
  } catch (err) {
    console.error("[Auth Middleware] Authentication error:", err);
    req.user = void 0;
    next();
  }
};
var requireAuth = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435" }
    });
    return;
  }
  next();
};
var requireManager = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435" }
    });
    return;
  }
  if (req.user.role !== "manager") {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "\u0414\u043E\u0441\u0442\u0443\u043F \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044E" }
    });
    return;
  }
  next();
};
var ipRateLimits = /* @__PURE__ */ new Map();
var loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 15 * 60 * 1e3;
  const maxAttempts = 15;
  const current = ipRateLimits.get(ip);
  if (!current || now > current.resetAt) {
    ipRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (current.count >= maxAttempts) {
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1e3);
    res.setHeader("Retry-After", retryAfterSec);
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A \u0432\u0445\u043E\u0434\u0430. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 ${Math.ceil(retryAfterSec / 60)} \u043C\u0438\u043D.`
      }
    });
    return;
  }
  current.count++;
  next();
};
var appRateLimits = /* @__PURE__ */ new Map();
var applicationRateLimiter = (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 10 * 60 * 1e3;
  const maxAttempts = 5;
  const current = appRateLimits.get(ip);
  if (!current || now > current.resetAt) {
    appRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (current.count >= maxAttempts) {
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1e3);
    res.setHeader("Retry-After", retryAfterSec);
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0437\u0430\u044F\u0432\u043E\u043A. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 ${Math.ceil(retryAfterSec / 60)} \u043C\u0438\u043D.`
      }
    });
    return;
  }
  current.count++;
  next();
};
var csrfProtection = (req, res, next) => {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method)) {
    return next();
  }
  const originalUrl = req.originalUrl || req.url;
  if (originalUrl.startsWith("/api/v1/auth/login") || originalUrl.startsWith("/api/auth/login") || originalUrl === "/api/v1/applications" || originalUrl === "/api/applications" || originalUrl.startsWith("/api/v1/auth/csrf-token") || originalUrl.startsWith("/api/auth/csrf-token")) {
    return next();
  }
  if (req.headers.authorization?.startsWith("Bearer ")) {
    return next();
  }
  const cookieToken = req.cookies?.pvz_csrf;
  const headerToken = req.headers["x-csrf-token"];
  if (cookieToken && headerToken && cookieToken === headerToken) {
    return next();
  }
  if (req.user) {
    if (headerToken && cookieToken && headerToken !== cookieToken) {
      res.status(403).json({
        success: false,
        error: {
          code: "CSRF_INVALID",
          message: "\u041E\u0448\u0438\u0431\u043A\u0430 CSRF-\u0432\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u0438 \u0437\u0430\u043F\u0440\u043E\u0441\u0430"
        }
      });
      return;
    }
    return next();
  }
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({
      success: false,
      error: {
        code: "CSRF_INVALID",
        message: "\u041E\u0448\u0438\u0431\u043A\u0430 CSRF-\u0432\u0430\u043B\u0438\u0434\u0430\u0446\u0438\u0438 \u0437\u0430\u043F\u0440\u043E\u0441\u0430"
      }
    });
    return;
  }
  next();
};

// server/routes/auth.ts
import { Router } from "express";
import bcrypt2 from "bcryptjs";
import { v4 as uuidv42 } from "uuid";
import { z } from "zod";

// server/services/audit.ts
import { v4 as uuidv4 } from "uuid";
async function logAudit(req, userId, action, entity, entityId, details) {
  try {
    const id = `aud-${uuidv4()}`;
    const ip = req ? req.ip || req.socket.remoteAddress || null : null;
    const userAgent = req ? req.headers["user-agent"] || null : null;
    const detailsStr = details ? JSON.stringify(details) : null;
    await db.query(
      `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, action, entity, entityId, ip, userAgent, detailsStr]
    );
  } catch (err) {
    console.error("[AuditLog] Error recording audit log:", err);
  }
}

// server/routes/auth.ts
var authRouter = Router();
var loginSchema = z.object({
  login: z.string().min(1, "\u041B\u043E\u0433\u0438\u043D \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u0443\u0441\u0442\u044B\u043C"),
  password: z.string().min(1, "\u041F\u0430\u0440\u043E\u043B\u044C \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u0443\u0441\u0442\u044B\u043C")
});
function normalizePhone(input) {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return "+7" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "+7" + digits;
  }
  return input.trim();
}
authRouter.get("/csrf-token", (req, res) => {
  const csrfToken = setCsrfCookie(res, req);
  res.json({ success: true, csrfToken });
});
authRouter.post("/login", loginRateLimiter, async (req, res) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parseResult.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const { login, password } = parseResult.data;
    const cleanLogin = login.trim();
    const normalizedPhone = normalizePhone(cleanLogin);
    const userRes = await db.query(
      "SELECT id, login, password_hash, name, role, status, is_part_time, is_senior, telegram_username FROM users WHERE LOWER(login) = LOWER($1) OR login = $2",
      [cleanLogin, normalizedPhone]
    );
    if (userRes.rows.length === 0) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043B\u043E\u0433\u0438\u043D \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C" }
      });
      return;
    }
    const user = userRes.rows[0];
    const isPasswordValid = await bcrypt2.compare(password, user.password_hash);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043B\u043E\u0433\u0438\u043D \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C" }
      });
      return;
    }
    if (user.status === "blocked" || user.status === "archived") {
      res.status(403).json({
        success: false,
        error: { code: "ACCOUNT_BLOCKED", message: "\u0423\u0447\u0435\u0442\u043D\u0430\u044F \u0437\u0430\u043F\u0438\u0441\u044C \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u0430 \u0438\u043B\u0438 \u0430\u0440\u0445\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u0430" }
      });
      return;
    }
    const sessionToken = uuidv42();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString();
    await db.query(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [`sess-${uuidv42()}`, user.id, tokenHash, expiresAt]
    );
    const locRes = await db.query(
      `SELECT l.code FROM locations l
       JOIN user_locations ul ON ul.location_id = l.id
       WHERE ul.user_id = $1`,
      [user.id]
    );
    const locations = locRes.rows.map((r) => r.code);
    const isHttps = Boolean(req.secure) || req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
    res.cookie("pvz_session", sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1e3,
      ...isHttps ? { partitioned: true } : {}
    });
    const csrfToken = setCsrfCookie(res, req);
    await logAudit(req, user.id, "LOGIN", "user", user.id, { role: user.role, login: user.login });
    res.json({
      success: true,
      token: sessionToken,
      csrfToken,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role,
        status: user.status,
        is_part_time: Boolean(user.is_part_time),
        is_senior: Boolean(user.is_senior),
        telegram_username: user.telegram_username,
        locations
      }
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u044F\u044F \u043E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043F\u0440\u0438 \u0432\u0445\u043E\u0434\u0435" }
    });
  }
});
authRouter.post("/logout", requireAuth, async (req, res) => {
  try {
    let token = req.cookies?.pvz_session;
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (token) {
      const tokenHash = hashSessionToken(token);
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    }
    res.clearCookie("pvz_session");
    res.clearCookie("pvz_csrf");
    if (req.user) {
      await logAudit(req, req.user.id, "LOGOUT", "user", req.user.id);
    }
    res.json({ success: true, message: "\u0423\u0441\u043F\u0435\u0448\u043D\u044B\u0439 \u0432\u044B\u0445\u043E\u0434 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u044B" });
  } catch (err) {
    console.error("[Auth] Logout error:", err);
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0432\u044B\u0445\u043E\u0434\u0435 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u044B" }
    });
  }
});
authRouter.get("/me", requireAuth, (req, res) => {
  const csrfToken = req.cookies?.pvz_csrf || setCsrfCookie(res, req);
  res.json({
    success: true,
    csrfToken,
    user: {
      id: req.user.id,
      login: req.user.login,
      name: req.user.name,
      role: req.user.role,
      status: req.user.status,
      is_part_time: req.user.isPartTime,
      is_senior: req.user.isSenior,
      telegram_username: req.user.telegramUsername,
      locations: req.user.locations
    }
  });
});

// server/routes/staff.ts
import { Router as Router2 } from "express";
import bcrypt3 from "bcryptjs";
import { v4 as uuidv43 } from "uuid";
import { z as z2 } from "zod";
var staffRouter = Router2();
staffRouter.get("/", async (req, res) => {
  try {
    const isManager = req.user?.role === "manager";
    const usersQuery = isManager ? "SELECT id, login, password_plain, name, role, status, is_part_time, is_senior, telegram_username, created_at, updated_at FROM users WHERE role = 'employee' ORDER BY name ASC" : "SELECT id, name, role, status, is_part_time, is_senior, telegram_username FROM users WHERE role = 'employee' AND status = 'active' ORDER BY name ASC";
    const usersRes = await db.query(usersQuery);
    const userLocsRes = await db.query(
      `SELECT ul.user_id, l.code
       FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id`
    );
    const locMap = /* @__PURE__ */ new Map();
    for (const row of userLocsRes.rows) {
      if (!locMap.has(row.user_id)) {
        locMap.set(row.user_id, []);
      }
      locMap.get(row.user_id).push(row.code);
    }
    const staffList = usersRes.rows.map((u) => ({
      id: u.id,
      name: u.name,
      login: isManager ? u.login : void 0,
      password: isManager ? u.password_plain || void 0 : void 0,
      role: u.role,
      status: u.status,
      isPartTime: Boolean(u.is_part_time),
      isSenior: Boolean(u.is_senior),
      hasAccess: u.status === "active",
      telegramUsername: u.telegram_username,
      locations: locMap.get(u.id) || [],
      registeredAt: u.created_at
    }));
    res.json({ success: true, staff: staffList });
  } catch (err) {
    console.error("[Staff] Get staff error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432" } });
  }
});
var staffCreateSchema = z2.object({
  name: z2.string().min(1, "\u0418\u043C\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E"),
  login: z2.string().min(1, "\u041B\u043E\u0433\u0438\u043D \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D"),
  password: z2.string().min(1, "\u041F\u0430\u0440\u043E\u043B\u044C \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D"),
  locations: z2.array(z2.string()).min(1, "\u041D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u043E \u043C\u0435\u0441\u0442\u043E \u0440\u0430\u0431\u043E\u0442\u044B"),
  isPartTime: z2.boolean().default(false),
  isSenior: z2.boolean().default(false),
  telegramUsername: z2.string().optional()
});
staffRouter.post("/", requireManager, async (req, res) => {
  try {
    const parse = staffCreateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const { name, login, password, locations, isPartTime, isSenior, telegramUsername } = parse.data;
    const cleanLogin = login.trim();
    if (!locations || locations.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "\u041D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0443\u043A\u0430\u0437\u0430\u0442\u044C \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u043B\u043E\u043A\u0430\u0446\u0438\u044E" }
      });
      return;
    }
    const countRes = await db.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'employee' AND status != 'deleted'"
    );
    const currentCount = Number(countRes.rows[0]?.count || 0);
    if (currentCount >= 150) {
      res.status(400).json({
        success: false,
        error: { code: "LIMIT_EXCEEDED", message: "\u0414\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442 \u043B\u0438\u043C\u0438\u0442: \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u043E \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u043E 150 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432." }
      });
      return;
    }
    const existing = await db.query("SELECT id FROM users WHERE LOWER(login) = LOWER($1)", [cleanLogin]);
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        error: { code: "LOGIN_EXISTS", message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u0441 \u0442\u0430\u043A\u0438\u043C \u043B\u043E\u0433\u0438\u043D\u043E\u043C \u0443\u0436\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D" }
      });
      return;
    }
    const userId = `emp-${uuidv43()}`;
    const salt = bcrypt3.genSaltSync(10);
    const cleanPassword = password.trim();
    const passwordHash = bcrypt3.hashSync(cleanPassword, salt);
    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, login, password_hash, password_plain, name, role, status, is_part_time, is_senior, telegram_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [userId, cleanLogin, passwordHash, cleanPassword, name.trim(), "employee", "active", isPartTime, isSenior, telegramUsername?.trim() || null]
      );
      for (const locCode of locations) {
        let locRes = await client.query("SELECT id FROM locations WHERE code = $1", [locCode]);
        let locId = locRes.rows[0]?.id;
        if (!locId) {
          locId = `loc-${uuidv43()}`;
          await client.query("INSERT INTO locations (id, code, name) VALUES ($1, $2, $3)", [locId, locCode, `\u041F\u0412\u0417 ${locCode}`]);
        }
        await client.query("INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)", [userId, locId]);
      }
      await client.query(
        `INSERT INTO notifications (id, user_id, title, text, type, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          `notif-${uuidv43()}`,
          userId,
          "\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 \u043A\u043E\u043C\u0430\u043D\u0434\u0443!",
          `\u0412\u0430\u0448\u0430 \u0443\u0447\u0435\u0442\u043D\u0430\u044F \u0437\u0430\u043F\u0438\u0441\u044C \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u0430. \u041B\u043E\u0433\u0438\u043D: "${cleanLogin}". \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u043B\u043E\u043A\u0430\u0446\u0438\u0438: ${locations.join(", ")}.`,
          "system",
          "manager"
        ]
      );
    });
    await logAudit(req, req.user.id, "CREATE_STAFF", "user", userId, { name, login: cleanLogin, locations, isSenior });
    res.status(201).json({
      success: true,
      staff: {
        id: userId,
        name: name.trim(),
        login: cleanLogin,
        password: cleanPassword,
        role: "employee",
        status: "active",
        isPartTime,
        isSenior,
        hasAccess: true,
        locations
      }
    });
  } catch (err) {
    console.error("[Staff] Create staff error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430" } });
  }
});
var staffUpdateSchema = z2.object({
  name: z2.string().optional(),
  login: z2.string().optional(),
  password: z2.string().optional(),
  locations: z2.array(z2.string()).optional(),
  isPartTime: z2.boolean().optional(),
  isSenior: z2.boolean().optional(),
  status: z2.enum(["active", "blocked", "archived", "deactivated"]).optional(),
  telegramUsername: z2.string().optional()
});
staffRouter.patch("/:id", requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const parse = staffUpdateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const { name, login, password, locations, isPartTime, isSenior, status, telegramUsername } = parse.data;
    if (locations) {
      if (locations.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "\u041D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0443\u043A\u0430\u0437\u0430\u0442\u044C \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u043B\u043E\u043A\u0430\u0446\u0438\u044E" }
        });
        return;
      }
    }
    const userRes = await db.query("SELECT id FROM users WHERE id = $1", [id]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" } });
      return;
    }
    if (login) {
      const conflictRes = await db.query("SELECT id FROM users WHERE LOWER(login) = LOWER($1) AND id != $2", [
        login.trim(),
        id
      ]);
      if (conflictRes.rows.length > 0) {
        res.status(409).json({ success: false, error: { code: "LOGIN_EXISTS", message: "\u0422\u0430\u043A\u043E\u0439 \u043B\u043E\u0433\u0438\u043D \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442" } });
        return;
      }
    }
    await db.transaction(async (client) => {
      const updates = ["updated_at = CURRENT_TIMESTAMP"];
      const params = [];
      if (name) {
        params.push(name.trim());
        updates.push(`name = $${params.length}`);
      }
      if (login) {
        params.push(login.trim());
        updates.push(`login = $${params.length}`);
      }
      if (password && password.trim().length > 0) {
        const cleanPassword = password.trim();
        const salt = bcrypt3.genSaltSync(10);
        const hash = bcrypt3.hashSync(cleanPassword, salt);
        params.push(hash);
        updates.push(`password_hash = $${params.length}`);
        params.push(cleanPassword);
        updates.push(`password_plain = $${params.length}`);
      }
      if (isPartTime !== void 0) {
        params.push(isPartTime);
        updates.push(`is_part_time = $${params.length}`);
      }
      if (isSenior !== void 0) {
        params.push(isSenior);
        updates.push(`is_senior = $${params.length}`);
      }
      if (status) {
        const canonicalStatus = status === "deactivated" ? "blocked" : status;
        params.push(canonicalStatus);
        updates.push(`status = $${params.length}`);
        if (canonicalStatus === "blocked" || canonicalStatus === "archived") {
          await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
        }
      }
      if (telegramUsername !== void 0) {
        params.push(telegramUsername.trim() || null);
        updates.push(`telegram_username = $${params.length}`);
      }
      params.push(id);
      await client.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      if (locations) {
        await client.query("DELETE FROM user_locations WHERE user_id = $1", [id]);
        for (const locCode of locations) {
          let locRes = await client.query("SELECT id FROM locations WHERE code = $1", [locCode]);
          let locId = locRes.rows[0]?.id;
          if (!locId) {
            locId = `loc-${uuidv43()}`;
            await client.query("INSERT INTO locations (id, code, name) VALUES ($1, $2, $3)", [locId, locCode, `\u041F\u0412\u0417 ${locCode}`]);
          }
          await client.query("INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)", [id, locId]);
        }
      }
    });
    await logAudit(req, req.user.id, "UPDATE_STAFF", "user", id, { name, login, status, locations });
    res.json({ success: true });
  } catch (err) {
    console.error("[Staff] Update staff error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430" } });
  }
});
staffRouter.delete("/:id", requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const isHardDelete = req.query.hard === "true";
    const userRes = await db.query("SELECT id, name FROM users WHERE id = $1", [id]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" } });
      return;
    }
    if (isHardDelete) {
      const { confirmation } = req.body || {};
      if (confirmation !== "DELETE USER") {
        res.status(400).json({
          success: false,
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: '\u0414\u043B\u044F \u0431\u0435\u0437\u0432\u043E\u0437\u0432\u0440\u0430\u0442\u043D\u043E\u0433\u043E \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u044F\u0432\u043D\u043E\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435: confirmation="DELETE USER"'
          }
        });
        return;
      }
      await db.transaction(async (client) => {
        await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
        await client.query("DELETE FROM user_locations WHERE user_id = $1", [id]);
        await client.query("DELETE FROM messages WHERE from_user_id = $1", [id]);
        await client.query("DELETE FROM notifications WHERE user_id = $1", [id]);
        await client.query("DELETE FROM sales WHERE user_id = $1", [id]);
        await client.query("DELETE FROM checkins WHERE user_id = $1", [id]);
        await client.query("DELETE FROM users WHERE id = $1", [id]);
      });
      await logAudit(req, req.user.id, "HARD_DELETE_STAFF", "user", id, { name: userRes.rows[0].name });
    } else {
      await db.query("UPDATE users SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
      await db.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      await logAudit(req, req.user.id, "ARCHIVE_STAFF", "user", id, { name: userRes.rows[0].name });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Staff] Delete staff error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0438 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430" } });
  }
});

// server/routes/checkins.ts
import { Router as Router3 } from "express";
import { v4 as uuidv44 } from "uuid";
import { z as z3 } from "zod";

// server/services/telegram.ts
var SHIFT_LABELS = {
  standard: "\u041E\u0431\u044B\u0447\u043D\u0430\u044F \u0441\u043C\u0435\u043D\u0430",
  "400+": "400+",
  "500+": "500+",
  "8h": "8 \u0447\u0430\u0441\u043E\u0432",
  "4h": "4 \u0447\u0430\u0441\u0430"
};
function escapeMarkdown(text) {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
var DEFAULT_TELEGRAM_TEMPLATES = {
  checkin: {
    id: "checkin",
    name: "\u041E\u0442\u043C\u0435\u0442\u043A\u0430 Check-in",
    description: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044E \u043E \u043D\u0430\u0447\u0430\u043B\u0435 \u0441\u043C\u0435\u043D\u044B \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u043C",
    variables: ["{employeeName}", "{location}", "{shiftType}", "{date}"],
    template: "\u{1F514} *\u041D\u043E\u0432\u0430\u044F \u043E\u0442\u043C\u0435\u0442\u043A\u0430 Check-in!*\n\n\u{1F464} *\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A:* {employeeName}\n\u{1F4CD} *\u041F\u0443\u043D\u043A\u0442:* {location}\n\u{1F552} *\u0421\u043C\u0435\u043D\u0430:* {shiftType}\n\u{1F4C5} *\u0414\u0430\u0442\u0430:* {date}"
  },
  daily_report: {
    id: "daily_report",
    name: "\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u0441\u0432\u043E\u0434\u043D\u044B\u0439 \u043E\u0442\u0447\u0435\u0442 (21:15)",
    description: "\u0412\u0435\u0447\u0435\u0440\u043D\u044F\u044F \u0441\u0432\u043E\u0434\u043A\u0430 \u043F\u043E \u043F\u0440\u043E\u0434\u0430\u0436\u0430\u043C, \u0432\u044B\u0440\u0443\u0447\u043A\u0435 \u0438 \u043F\u0440\u0435\u043C\u0438\u044F\u043C",
    variables: ["{date}", "{staffList}", "{totalRevenue}", "{totalBonus}", "{totalCash}", "{totalCard}"],
    template: "\u{1F4B0} *\u041E\u0442\u0447\u0451\u0442 \u043F\u043E \u043F\u0440\u043E\u0434\u0430\u0436\u0430\u043C \u043D\u0430 {date}*\n\n{staffList}\n\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u{1F4B5} \u0418\u0442\u043E\u0433 \u0434\u043D\u044F: *{totalRevenue} \u20BD*\n\u{1F381} \u041F\u0440\u0435\u043C\u0438\u044F: *{totalBonus} \u20BD*\n\u{1F4B5} \u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435: *{totalCash} \u20BD*\n\u{1F4B3} \u0411\u0435\u0437\u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435: *{totalCard} \u20BD*"
  },
  swap_status: {
    id: "swap_status",
    name: "\u0420\u0435\u0448\u0435\u043D\u0438\u0435 \u043F\u043E \u0437\u0430\u043C\u0435\u043D\u0435 \u0441\u043C\u0435\u043D\u044B",
    description: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u043F\u0440\u0438 \u0441\u043E\u0433\u043B\u0430\u0441\u043E\u0432\u0430\u043D\u0438\u0438 \u0438\u043B\u0438 \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0438\u0438 \u0437\u0430\u044F\u0432\u043A\u0438 \u0431\u0438\u0440\u0436\u0438",
    variables: ["{status}", "{date}", "{location}", "{requesterName}", "{candidateName}"],
    template: "\u{1F4CB} *\u0420\u0435\u0448\u0435\u043D\u0438\u0435 \u043F\u043E \u0437\u0430\u043C\u0435\u043D\u0435 \u0441\u043C\u0435\u043D\u044B: {status}*\n\u{1F4C5} \u0414\u0430\u0442\u0430: *{date}* ({location})\n\u{1F464} \u041F\u0435\u0440\u0435\u0434\u0430\u043B: *{requesterName}*\n\u{1F464} \u041F\u0440\u0438\u043D\u044F\u043B: *{candidateName}*"
  },
  thank_you: {
    id: "thank_you",
    name: "\u0411\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u044C \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0443",
    description: "\u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430 \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u0438 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0443 \u0441\u043C\u0435\u043D\u044B \u043E\u0442 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F",
    variables: ["{location}"],
    template: "\u2764\uFE0F *\u0411\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u044C \u043E\u0442 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F*\n\u0420\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0432\u044B\u0440\u0430\u0436\u0430\u0435\u0442 \u043E\u0433\u0440\u043E\u043C\u043D\u0443\u044E \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u044C \u0437\u0430 \u043E\u0442\u043B\u0438\u0447\u043D\u0443\u044E \u0440\u0430\u0431\u043E\u0442\u0443 \u043D\u0430 \u043F\u0443\u043D\u043A\u0442\u0435 {location}! \u0422\u0430\u043A \u0434\u0435\u0440\u0436\u0430\u0442\u044C!"
  }
};
var customTelegramSettings = null;
var TelegramService = class {
  constructor() {
    this.customTemplates = { ...DEFAULT_TELEGRAM_TEMPLATES };
    this.knownUserChats = /* @__PURE__ */ new Map();
  }
  setSettings(settings) {
    customTelegramSettings = {
      botToken: settings.botToken,
      managerChatId: settings.managerChatId,
      botUsername: settings.botUsername || "",
      updatedAt: settings.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  getSettings() {
    return customTelegramSettings || {
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      managerChatId: process.env.MANAGER_TELEGRAM_ID || "",
      botUsername: "",
      updatedAt: void 0
    };
  }
  clearSettings() {
    customTelegramSettings = null;
  }
  isConfigured() {
    const s = this.getSettings();
    return Boolean(s.botToken && s.managerChatId);
  }
  getBotToken() {
    return customTelegramSettings?.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
  }
  getManagerChatId() {
    return customTelegramSettings?.managerChatId || process.env.MANAGER_TELEGRAM_ID || "";
  }
  async sendMessage(text, chatId) {
    const token = this.getBotToken();
    const targetChatId = chatId || this.getManagerChatId();
    if (!token) {
      console.log(`[Telegram Simulation] (Token not configured in .env)
Target Chat ID: ${targetChatId}
Message Content:
${text}`);
      return { success: true, simulated: true };
    }
    try {
      let response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: "Markdown"
        })
      });
      let resData = await response.json();
      if (!response.ok || !resData.ok) {
        response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text
          })
        });
        resData = await response.json();
      }
      if (!response.ok || !resData.ok) {
        console.error("[Telegram] Telegram API error:", resData);
        return { success: false, error: resData.description || "\u041E\u0448\u0438\u0431\u043A\u0430 Telegram API" };
      }
      return { success: true };
    } catch (err) {
      console.error("[Telegram] Network error sending message to Telegram:", err);
      return { success: false, error: err.message };
    }
  }
  async sendCheckInNotification(employeeName, location, shiftType, date) {
    const shiftLabel = SHIFT_LABELS[shiftType] || shiftType;
    const safeName = escapeMarkdown(employeeName);
    const msg = `\u{1F514} *\u041D\u043E\u0432\u0430\u044F \u043E\u0442\u043C\u0435\u0442\u043A\u0430 Check-in!*

\u{1F464} *\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A:* ${safeName}
\u{1F4CD} *\u041F\u0443\u043D\u043A\u0442:* ${location}
\u{1F552} *\u0421\u043C\u0435\u043D\u0430:* ${shiftLabel}
\u{1F4C5} *\u0414\u0430\u0442\u0430:* ${date}`;
    const res = await this.sendMessage(msg);
    return res.success;
  }
  async generateDailySalesReportText(targetDate) {
    const now = /* @__PURE__ */ new Date();
    const formatter = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = formatter.formatToParts(now);
    const day = parts.find((p) => p.type === "day")?.value || "01";
    const month = parts.find((p) => p.type === "month")?.value || "01";
    const year = parts.find((p) => p.type === "year")?.value || "2026";
    const dateFormatted = `${year}-${month}-${day}`;
    const displayDate = `${day}.${month}.${year}`;
    const dateToQuery = targetDate || dateFormatted;
    const staffRes = await db.query(
      "SELECT id, name FROM users WHERE role = 'employee' AND status = 'active' ORDER BY name ASC"
    );
    const checkinsRes = await db.query("SELECT user_id, location_code, shift_type FROM checkins WHERE date = $1", [dateToQuery]);
    const salesRes = await db.query("SELECT user_id, total, photo_cash, photo_card, print_cash, print_card, lamination_cash, lamination_card, bonus FROM sales WHERE date = $1", [dateToQuery]);
    const checkinMap = new Map(checkinsRes.rows.map((c) => [c.user_id, c]));
    const salesMap = new Map(salesRes.rows.map((s) => [s.user_id, s]));
    let totalRevenue = 0;
    let totalCash = 0;
    let totalCard = 0;
    let totalBonus = 0;
    const lines = [`\u{1F4B0} *\u041E\u0442\u0447\u0451\u0442 \u043F\u043E \u043F\u0440\u043E\u0434\u0430\u0436\u0430\u043C \u043D\u0430 ${displayDate}*
`];
    if (staffRes.rows.length === 0) {
      lines.push("_(\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432 \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435 \u043D\u0435\u0442)_");
    } else {
      for (const emp of staffRes.rows) {
        const safeName = escapeMarkdown(emp.name);
        const checkin = checkinMap.get(emp.id);
        if (!checkin) {
          lines.push(`\u{1F534} ${safeName} \u2014 \u043D\u0435\u0442 check-in`);
        } else {
          const shiftLabel = SHIFT_LABELS[checkin.shift_type] || checkin.shift_type;
          const sale = salesMap.get(emp.id);
          if (sale) {
            const empTotal = Number(sale.total || 0);
            const empCash = Number(sale.photo_cash || 0) + Number(sale.print_cash || 0) + Number(sale.lamination_cash || 0);
            const empCard = Number(sale.photo_card || 0) + Number(sale.print_card || 0) + Number(sale.lamination_card || 0);
            const empBonus = Number(sale.bonus || 0);
            totalRevenue += empTotal;
            totalCash += empCash;
            totalCard += empCard;
            totalBonus += empBonus;
            lines.push(
              `\u{1F7E2} ${safeName} (${shiftLabel}, ${checkin.location_code}): *${empTotal.toLocaleString("ru-RU")} \u20BD* (\u043D\u0430\u043B: ${empCash.toLocaleString("ru-RU")} / \u0431/\u043D\u0430\u043B: ${empCard.toLocaleString("ru-RU")})`
            );
          } else {
            lines.push(`\u{1F7E1} ${safeName} (${shiftLabel}, ${checkin.location_code}) \u2014 \u043D\u0435\u0442 \u043F\u0440\u043E\u0434\u0430\u0436`);
          }
        }
      }
    }
    lines.push("\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    lines.push(`\u{1F4B5} \u0418\u0442\u043E\u0433 \u0434\u043D\u044F: *${totalRevenue.toLocaleString("ru-RU")} \u20BD*`);
    lines.push(`\u{1F381} \u041F\u0440\u0435\u043C\u0438\u044F: *${totalBonus.toLocaleString("ru-RU")} \u20BD*`);
    lines.push(`\u{1F4B5} \u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435: *${totalCash.toLocaleString("ru-RU")} \u20BD*`);
    lines.push(`\u{1F4B3} \u0411\u0435\u0437\u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435: *${totalCard.toLocaleString("ru-RU")} \u20BD*`);
    return lines.join("\n");
  }
  async sendDailySalesReport(targetDate) {
    const text = await this.generateDailySalesReportText(targetDate);
    const sendResult = await this.sendMessage(text);
    return {
      success: sendResult.success,
      simulated: sendResult.simulated,
      text,
      error: sendResult.error
    };
  }
  getTemplates() {
    return this.customTemplates;
  }
  setTemplates(templates) {
    for (const [key, tpl] of Object.entries(templates)) {
      if (this.customTemplates[key]) {
        this.customTemplates[key] = {
          ...this.customTemplates[key],
          ...tpl
        };
      }
    }
  }
  async syncUpdates() {
    const token = this.getBotToken();
    if (!token) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=1`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          const msg = update.message || update.edited_message || update.channel_post;
          if (!msg) continue;
          const chatId = msg.chat?.id;
          if (!chatId) continue;
          if (msg.from?.username) {
            const clean = msg.from.username.trim().replace(/^@/, "").toLowerCase();
            this.knownUserChats.set(clean, String(chatId));
          }
          if (msg.chat?.username) {
            const clean = msg.chat.username.trim().replace(/^@/, "").toLowerCase();
            this.knownUserChats.set(clean, String(chatId));
          }
        }
      }
    } catch (e) {
      console.warn("[Telegram] syncUpdates error:", e);
    }
  }
  async resolveChatIdForUsername(usernameOrId) {
    const trimmed = (usernameOrId || "").trim();
    if (!trimmed) return "";
    if (/^-?\d+$/.test(trimmed)) {
      return trimmed;
    }
    const clean = trimmed.replace(/^@/, "").toLowerCase();
    if (this.knownUserChats.has(clean)) {
      return this.knownUserChats.get(clean);
    }
    await this.syncUpdates();
    if (this.knownUserChats.has(clean)) {
      return this.knownUserChats.get(clean);
    }
    return `@${clean}`;
  }
  async sendBroadcastToStaff(text, targetRole = "all") {
    const token = this.getBotToken();
    if (!token) {
      return { success: true, deliveredCount: 0, staffCount: 0 };
    }
    await this.syncUpdates();
    let query = `SELECT id, name, telegram_username FROM users WHERE role = 'employee' AND status = 'active' AND telegram_username IS NOT NULL AND TRIM(telegram_username) != ''`;
    if (targetRole === "standard") {
      query += " AND is_part_time = 0";
    } else if (targetRole === "part_time") {
      query += " AND is_part_time = 1";
    }
    let staffMembers = [];
    try {
      const res = await db.query(query);
      staffMembers = res.rows;
    } catch (err) {
      console.warn("[Telegram] Broadcast staff query warning:", err);
    }
    let deliveredCount = 0;
    const sentChatIds = /* @__PURE__ */ new Set();
    for (const emp of staffMembers) {
      const target = await this.resolveChatIdForUsername(emp.telegram_username);
      if (!target || sentChatIds.has(target)) continue;
      sentChatIds.add(target);
      const sendRes = await this.sendMessage(text, target);
      if (sendRes.success) {
        deliveredCount++;
      } else {
        console.warn(`[Telegram] Broadcast failed for ${emp.name} (${emp.telegram_username}): ${sendRes.error}`);
      }
    }
    const managerChat = this.getManagerChatId();
    if (managerChat && !sentChatIds.has(managerChat)) {
      await this.sendMessage(text, managerChat);
    }
    return {
      success: true,
      deliveredCount,
      staffCount: staffMembers.length
    };
  }
};
var telegramService = new TelegramService();

// server/routes/checkins.ts
var checkinsRouter = Router3();
checkinsRouter.post(["/alerts", "/checkin-alerts"], requireAuth, async (_req, res) => {
  try {
    const today = getTodayMoscowDate();
    const locRes = await db.query(
      "SELECT code, name FROM locations WHERE active = TRUE AND is_archived = FALSE"
    );
    const activeLocs = locRes.rows;
    const checkinsRes = await db.query(
      "SELECT DISTINCT location_code FROM checkins WHERE date = $1",
      [today]
    );
    const checkedLocations = new Set(checkinsRes.rows.map((c) => c.location_code));
    const missing = activeLocs.filter((loc) => !checkedLocations.has(loc.code)).map((loc) => loc.code);
    res.json({
      success: true,
      missing,
      checkedCount: checkedLocations.size,
      totalCount: activeLocs.length
    });
  } catch (err) {
    console.error("[Checkins Alert Error]:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u0439 \u0441\u043C\u0435\u043D" } });
  }
});
var dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function isValidCalendarDate(dateStr) {
  if (!dateRegex.test(dateStr)) return false;
  const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}
function getTodayMoscowDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(/* @__PURE__ */ new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
var checkinSchema = z3.object({
  employeeId: z3.string().optional(),
  location: z3.string().min(1, "\u041B\u043E\u043A\u0430\u0446\u0438\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u0430"),
  shiftType: z3.string().min(1, "\u0422\u0438\u043F \u0441\u043C\u0435\u043D\u044B \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D"),
  date: z3.string().refine((val) => !val || isValidCalendarDate(val), { message: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u0434\u0430\u0442\u0430 (\u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0413\u0413\u0413\u0413-\u041C\u041C-\u0414\u0414)" }).optional()
});
async function getActiveShiftRate(userId, shiftType, client) {
  try {
    const userRes = await client.query("SELECT is_part_time, is_senior FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) return 2e3;
    const user = userRes.rows[0];
    const isPartTime = Boolean(user.is_part_time || user.is_part_time === 1 || user.is_part_time === "1" || user.is_part_time === true);
    const ratesRes = await client.query("SELECT value FROM settings WHERE key = 'rates'");
    let rates = {
      standard: 2e3,
      "400+": 2200,
      "500+": 2500,
      "8h": 1500,
      "4h": 800,
      partTimeShiftRate: 1800
    };
    if (ratesRes.rows.length > 0) {
      try {
        rates = { ...rates, ...JSON.parse(ratesRes.rows[0].value) };
      } catch {
      }
    }
    const shiftTypes = rates.shiftTypes || [];
    const foundType = shiftTypes.find((t) => t.code === shiftType);
    let baseRate = 2e3;
    if (foundType) {
      baseRate = Number(foundType.baseRate);
    } else {
      baseRate = Number(rates[shiftType]) || 2e3;
    }
    if (isPartTime && shiftType === "standard") {
      baseRate = Number(rates.partTimeShiftRate) || 1800;
    }
    return baseRate;
  } catch (err) {
    console.error("[Rates History Helper] Error getting active rate:", err);
    return 2e3;
  }
}
checkinsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const { date } = req.query;
    const isManager = req.user.role === "manager";
    let query = `
      SELECT 
        c.id,
        c.user_id,
        u.name as employee_name,
        c.location_code as location,
        c.shift_type,
        c.date,
        c.checked_in_at,
        c.edit_count,
        c.base_rate,
        (SELECT COUNT(*) FROM checkin_cancellations cc WHERE cc.user_id = c.user_id AND cc.date = c.date) as cancel_count,
        s.id as sales_id,
        s.photo_cash,
        s.photo_card,
        s.print_cash,
        s.print_card,
        s.lamination_cash,
        s.lamination_card,
        s.total as sales_total,
        s.bonus as sales_bonus,
        s.submitted_at as sales_submitted_at
      FROM checkins c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN sales s ON s.checkin_id = c.id
    `;
    const params = [];
    const whereClauses = [];
    if (!isManager) {
      params.push(req.user.id);
      whereClauses.push(`c.user_id = $${params.length}`);
    }
    if (date && typeof date === "string") {
      if (!isValidCalendarDate(date)) {
        res.status(400).json({ success: false, error: { code: "INVALID_DATE", message: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u0442\u044B" } });
        return;
      }
      params.push(date);
      whereClauses.push(`c.date = $${params.length}`);
    }
    if (whereClauses.length > 0) {
      query += " WHERE " + whereClauses.join(" AND ");
    }
    query += " ORDER BY c.date DESC, c.checked_in_at DESC";
    const result = await db.query(query, params);
    const records = result.rows.map((r) => ({
      id: r.id,
      employeeId: r.user_id,
      employeeName: r.employee_name,
      location: r.location,
      shiftType: r.shift_type,
      date: r.date,
      checkedInAt: r.checked_in_at,
      editCount: Number(r.edit_count || 0),
      cancelCount: Number(r.cancel_count || 0),
      baseRate: r.base_rate !== null && r.base_rate !== void 0 ? Number(r.base_rate) : void 0,
      sales: r.sales_id ? {
        cash: Number(r.photo_cash || 0) + Number(r.print_cash || 0) + Number(r.lamination_cash || 0),
        card: Number(r.photo_card || 0) + Number(r.print_card || 0) + Number(r.lamination_card || 0),
        photo: { cash: Number(r.photo_cash || 0), card: Number(r.photo_card || 0) },
        print: { cash: Number(r.print_cash || 0), card: Number(r.print_card || 0) },
        lamination: { cash: Number(r.lamination_cash || 0), card: Number(r.lamination_card || 0) },
        total: Number(r.sales_total || 0),
        bonus: Number(r.sales_bonus || 0)
      } : null,
      salesSubmittedAt: r.sales_submitted_at
    }));
    let cancelledDates = [];
    if (!isManager) {
      const cancelRes = await db.query(
        "SELECT date FROM checkin_cancellations WHERE user_id = $1",
        [req.user.id]
      );
      cancelledDates = cancelRes.rows.map((row) => row.date);
    }
    res.json({ success: true, records, cancelledDates });
  } catch (err) {
    console.error("[Checkins] Get checkins error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0437\u0430\u043F\u0438\u0441\u0435\u0439 \u0441\u043C\u0435\u043D" } });
  }
});
checkinsRouter.post("/", requireAuth, async (req, res) => {
  try {
    const parse = checkinSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const { location, shiftType, date } = parse.data;
    const today = getTodayMoscowDate();
    const isManager = req.user.role === "manager";
    const targetUserId = isManager && parse.data.employeeId ? parse.data.employeeId : req.user.id;
    let targetDate = today;
    if (date) {
      if (!isManager && date !== today) {
        res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN_DATE", message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438 \u043C\u043E\u0433\u0443\u0442 \u043E\u0442\u043C\u0435\u0447\u0430\u0442\u044C \u044F\u0432\u043A\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0434\u0435\u043D\u044C" }
        });
        return;
      }
      targetDate = date;
    }
    const userRes = await db.query(
      "SELECT id, name, status, role FROM users WHERE id = $1",
      [targetUserId]
    );
    if (userRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" } });
      return;
    }
    const targetUser = userRes.rows[0];
    if (targetUser.status === "blocked" || targetUser.status === "archived") {
      res.status(403).json({
        success: false,
        error: { code: "USER_INACTIVE", message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D \u0438\u043B\u0438 \u0430\u0440\u0445\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D" }
      });
      return;
    }
    if (!isManager) {
      const locCheck = await db.query(
        `SELECT l.id FROM locations l
         JOIN user_locations ul ON ul.location_id = l.id
         WHERE ul.user_id = $1 AND l.code = $2`,
        [targetUserId, location]
      );
      if (locCheck.rows.length === 0) {
        res.status(403).json({
          success: false,
          error: {
            code: "FORBIDDEN_LOCATION",
            message: `\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043D\u0435 \u0438\u043C\u0435\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u043A \u043B\u043E\u043A\u0430\u0446\u0438\u0438 \xAB${location}\xBB. \u041E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044E.`
          }
        });
        return;
      }
    } else {
      const locRes = await db.query("SELECT id FROM locations WHERE code = $1", [location]);
      let locId = locRes.rows[0]?.id;
      if (!locId) {
        locId = `loc-${uuidv44()}`;
        await db.query(
          "INSERT INTO locations (id, code, name) VALUES ($1, $2, $3)",
          [locId, location, `\u041F\u0412\u0417 ${location}`]
        );
      }
      await db.query(
        "INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [targetUserId, locId]
      );
    }
    let cleanShiftType = shiftType;
    if (shiftType === "rate400") cleanShiftType = "400+";
    else if (shiftType === "rate500") cleanShiftType = "500+";
    else if (shiftType === "shift8h") cleanShiftType = "8h";
    else if (shiftType === "shift4h") cleanShiftType = "4h";
    let checkinId = `rec-${uuidv44()}`;
    await db.transaction(async (client) => {
      let baseRate = null;
      try {
        baseRate = await getActiveShiftRate(targetUserId, cleanShiftType, client);
      } catch (rateErr) {
        console.error("Error fetching active shift rate inside transaction:", rateErr);
      }
      const existing = await client.query(
        "SELECT id, edit_count FROM checkins WHERE user_id = $1 AND date = $2",
        [targetUserId, targetDate]
      );
      if (existing.rows.length > 0) {
        checkinId = existing.rows[0].id;
        const currentEditCount = Number(existing.rows[0].edit_count || 0);
        if (!isManager && currentEditCount >= 1) {
          const limitErr = new Error("EDIT_LIMIT_EXCEEDED");
          limitErr.code = "EDIT_LIMIT_EXCEEDED";
          throw limitErr;
        }
        const newEditCount = isManager ? currentEditCount : currentEditCount + 1;
        await client.query(
          `UPDATE checkins
           SET location_code = $1, shift_type = $2, edit_count = $3, base_rate = $4
           WHERE id = $5`,
          [location, cleanShiftType, newEditCount, baseRate, checkinId]
        );
      } else {
        const checkinTime = isManager && targetDate !== today ? `${targetDate} 09:00:00` : (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
        await client.query(
          `INSERT INTO checkins (id, user_id, location_code, shift_type, date, checked_in_at, edit_count, base_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [checkinId, targetUserId, location, cleanShiftType, targetDate, checkinTime, 0, baseRate]
        );
      }
    });
    const isOnline = cleanShiftType !== "standard";
    const shiftLabel = cleanShiftType;
    telegramService.sendMessage(
      `\u{1F7E2} *Check-in \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D!*
\u{1F464} \u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A: *${targetUser.name}*
\u{1F4CD} \u041F\u0443\u043D\u043A\u0442: *${location}*
\u23F1 \u0421\u043C\u0435\u043D\u0430: *${shiftLabel}*
\u{1F4C5} \u0414\u0430\u0442\u0430: *${targetDate}*
\u23F0 \u0412\u0440\u0435\u043C\u044F: *${(/* @__PURE__ */ new Date()).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })} (\u041C\u0421\u041A)*`
    ).catch((err) => console.error("[Checkins] Telegram notification error:", err));
    await logAudit(req, req.user.id, "CHECKIN", "checkin", checkinId, {
      userId: targetUserId,
      location,
      shiftType: cleanShiftType,
      date: targetDate
    });
    res.json({
      success: true,
      checkin: {
        id: checkinId,
        employeeId: targetUserId,
        employeeName: targetUser.name,
        location,
        shiftType: cleanShiftType,
        date: targetDate,
        checkedInAt: (/* @__PURE__ */ new Date()).toISOString(),
        sales: null
      }
    });
  } catch (err) {
    if (err?.code === "EDIT_LIMIT_EXCEEDED" || err?.message === "EDIT_LIMIT_EXCEEDED") {
      res.status(403).json({
        success: false,
        error: {
          code: "EDIT_LIMIT_EXCEEDED",
          message: "\u0420\u0430\u0431\u043E\u0442\u043D\u0438\u043A \u043C\u043E\u0436\u0435\u0442 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u044C \u0441\u0432\u043E\u044E \u043E\u0442\u043C\u0435\u0447\u0435\u043D\u043D\u0443\u044E \u0441\u043C\u0435\u043D\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u0434\u0438\u043D \u0440\u0430\u0437. \u0412 \u0441\u043B\u0443\u0447\u0430\u0435 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E\u0441\u0442\u0438 \u043E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044E, \u0447\u0442\u043E\u0431\u044B \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0441\u0430\u043C \u0432\u043D\u0451\u0441 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435."
        }
      });
      return;
    }
    console.error("[Checkins] Post checkin error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0438 Check-in" } });
  }
});
checkinsRouter.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isManager = req.user.role === "manager";
    if (!isManager) {
      res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "\u0422\u043E\u043B\u044C\u043A\u043E \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u043C\u043E\u0436\u0435\u0442 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u044C \u0441\u043C\u0435\u043D\u044B" } });
      return;
    }
    const { shiftType, location, date } = req.body;
    const updates = [];
    const params = [];
    if (shiftType) {
      let cleanShiftType = shiftType;
      if (shiftType === "rate400") cleanShiftType = "400+";
      else if (shiftType === "rate500") cleanShiftType = "500+";
      else if (shiftType === "shift8h") cleanShiftType = "8h";
      else if (shiftType === "shift4h") cleanShiftType = "4h";
      params.push(cleanShiftType);
      updates.push(`shift_type = $${params.length}`);
    }
    if (location) {
      params.push(location);
      updates.push(`location_code = $${params.length}`);
    }
    if (date) {
      params.push(date);
      updates.push(`date = $${params.length}`);
    }
    if (updates.length > 0) {
      params.push(id);
      await db.query(`UPDATE checkins SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Checkins] Patch checkin error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u043C\u0435\u043D\u044B" } });
  }
});
checkinsRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isManager = req.user.role === "manager";
    const today = getTodayMoscowDate();
    const checkinRes = await db.query(
      "SELECT id, user_id, date, edit_count FROM checkins WHERE id = $1",
      [id]
    );
    if (checkinRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0417\u0430\u043F\u0438\u0441\u044C Check-in \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" } });
      return;
    }
    const checkin = checkinRes.rows[0];
    if (!isManager) {
      if (checkin.user_id !== req.user.id) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "\u041D\u0435\u043B\u044C\u0437\u044F \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0447\u0443\u0436\u0443\u044E \u0441\u043C\u0435\u043D\u0443" } });
        return;
      }
      if (checkin.date !== today) {
        res.status(403).json({
          success: false,
          error: {
            code: "FORBIDDEN_PAST_DATE",
            message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043C\u043E\u0436\u0435\u0442 \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C check-in \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F\u0448\u043D\u0438\u0439 \u0434\u0435\u043D\u044C"
          }
        });
        return;
      }
      if (Number(checkin.edit_count || 0) >= 1) {
        res.status(403).json({
          success: false,
          error: {
            code: "EDIT_LIMIT_EXCEEDED",
            message: "\u0420\u0430\u0431\u043E\u0442\u043D\u0438\u043A \u043C\u043E\u0436\u0435\u0442 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u044C \u0438\u043B\u0438 \u043E\u0442\u043C\u0435\u043D\u044F\u0442\u044C \u0441\u043C\u0435\u043D\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u0434\u0438\u043D \u0440\u0430\u0437. \u0414\u043B\u044F \u0434\u0430\u043B\u044C\u043D\u0435\u0439\u0448\u0438\u0445 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 \u043E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044E."
          }
        });
        return;
      }
      const cancelCheck = await db.query(
        "SELECT COUNT(*) as count FROM checkin_cancellations WHERE user_id = $1 AND date = $2",
        [req.user.id, checkin.date]
      );
      if (Number(cancelCheck.rows[0]?.count || 0) >= 1) {
        res.status(403).json({
          success: false,
          error: {
            code: "CANCEL_LIMIT_EXCEEDED",
            message: "\u0420\u0430\u0431\u043E\u0442\u043D\u0438\u043A \u043C\u043E\u0436\u0435\u0442 \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C Check-in \u0442\u043E\u043B\u044C\u043A\u043E \u043E\u0434\u0438\u043D \u0440\u0430\u0437. \u0412 \u0441\u043B\u0443\u0447\u0430\u0435 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E\u0441\u0442\u0438 \u043E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044E, \u0447\u0442\u043E\u0431\u044B \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0441\u0430\u043C \u0432\u043D\u0451\u0441 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435."
          }
        });
        return;
      }
    }
    await db.transaction(async (client) => {
      if (!isManager) {
        await client.query(
          "INSERT INTO checkin_cancellations (id, user_id, date) VALUES ($1, $2, $3)",
          [`canc-${uuidv44()}`, req.user.id, checkin.date]
        );
      } else {
        await client.query(
          "DELETE FROM checkin_cancellations WHERE user_id = $1 AND date = $2",
          [checkin.user_id, checkin.date]
        );
      }
      await client.query("DELETE FROM sales WHERE checkin_id = $1", [id]);
      await client.query("DELETE FROM checkins WHERE id = $1", [id]);
    });
    await logAudit(req, req.user.id, "CANCEL_CHECKIN", "checkin", id);
    res.json({ success: true });
  } catch (err) {
    console.error("[Checkins] Delete checkin error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u044B Check-in" } });
  }
});

// server/routes/sales.ts
import { Router as Router4 } from "express";
import { v4 as uuidv45 } from "uuid";
import { z as z4 } from "zod";
var salesRouter = Router4();
var dateRegex2 = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function isValidCalendarDate2(dateStr) {
  if (!dateRegex2.test(dateStr)) return false;
  const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}
function getTodayMoscowDate2() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(/* @__PURE__ */ new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
var salesCategorySchema = z4.object({
  cash: z4.number().min(0).default(0),
  card: z4.number().min(0).default(0)
});
var submitSalesSchema = z4.object({
  employeeId: z4.string().optional(),
  date: z4.string().refine((val) => !val || isValidCalendarDate2(val), { message: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u0434\u0430\u0442\u0430 (\u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0413\u0413\u0413\u0413-\u041C\u041C-\u0414\u0414)" }).optional(),
  sales: z4.object({
    cash: z4.number().min(0).optional(),
    card: z4.number().min(0).optional(),
    total: z4.number().min(0).optional(),
    photo: salesCategorySchema.optional(),
    print: salesCategorySchema.optional(),
    lamination: salesCategorySchema.optional()
  })
});
salesRouter.post("/", requireAuth, async (req, res) => {
  try {
    const parse = submitSalesSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0432\u044B\u0440\u0443\u0447\u043A\u0438" }
      });
      return;
    }
    const { sales, date } = parse.data;
    const isManager = req.user.role === "manager";
    const today = getTodayMoscowDate2();
    const targetUserId = isManager && parse.data.employeeId ? parse.data.employeeId : req.user.id;
    if (!isManager && req.user.isPartTime) {
      res.status(403).json({
        success: false,
        error: {
          code: "PART_TIME_SALES_PROHIBITED",
          message: "\u041F\u043E\u0434\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0430\u043C \u0437\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E \u0432\u043D\u043E\u0441\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u043E \u043F\u0440\u043E\u0434\u0430\u0436\u0430\u0445"
        }
      });
      return;
    }
    let targetDate = today;
    if (date) {
      if (!isManager && date !== today) {
        res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN_DATE", message: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438 \u043C\u043E\u0433\u0443\u0442 \u0432\u043D\u043E\u0441\u0438\u0442\u044C \u0432\u044B\u0440\u0443\u0447\u043A\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430 \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0441\u043C\u0435\u043D\u0443" }
        });
        return;
      }
      targetDate = date;
    }
    const checkinRes = await db.query(
      "SELECT id FROM checkins WHERE user_id = $1 AND date = $2",
      [targetUserId, targetDate]
    );
    if (checkinRes.rows.length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: "CHECKIN_REQUIRED",
          message: "\u0412\u0432\u043E\u0434 \u0432\u044B\u0440\u0443\u0447\u043A\u0438 \u043D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u0435\u043D \u0431\u0435\u0437 \u043F\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0439 \u043E\u0442\u043C\u0435\u0442\u043A\u0438 Check-in \u0437\u0430 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u0443\u044E \u0434\u0430\u0442\u0443!"
        }
      });
      return;
    }
    const checkinId = checkinRes.rows[0].id;
    const photoCash = sales.photo?.cash || 0;
    const photoCard = sales.photo?.card || 0;
    const printCash = sales.print?.cash || 0;
    const printCard = sales.print?.card || 0;
    const lamCash = sales.lamination?.cash || 0;
    const lamCard = sales.lamination?.card || 0;
    const totalCash = sales.cash !== void 0 ? sales.cash : photoCash + printCash + lamCash;
    const totalCard = sales.card !== void 0 ? sales.card : photoCard + printCard + lamCard;
    const totalSales = sales.total !== void 0 && sales.total > 0 && sales.cash === void 0 && sales.card === void 0 ? sales.total : totalCash + totalCard;
    const bonus = Math.round(totalSales * 0.05);
    let saleId = `sale-${uuidv45()}`;
    await db.transaction(async (client) => {
      const existing = await client.query("SELECT id FROM sales WHERE checkin_id = $1", [checkinId]);
      if (existing.rows.length > 0) {
        saleId = existing.rows[0].id;
        await client.query(
          `UPDATE sales
           SET photo_cash = $1, photo_card = $2, print_cash = $3, print_card = $4,
               lamination_cash = $5, lamination_card = $6, total = $7, bonus = $8,
               submitted_at = CURRENT_TIMESTAMP
           WHERE id = $9`,
          [
            totalCash,
            totalCard,
            0,
            0,
            0,
            0,
            totalSales,
            bonus,
            saleId
          ]
        );
      } else {
        await client.query(
          `INSERT INTO sales (id, checkin_id, user_id, date, photo_cash, photo_card, print_cash, print_card, lamination_cash, lamination_card, total, bonus)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            saleId,
            checkinId,
            targetUserId,
            targetDate,
            totalCash,
            totalCard,
            0,
            0,
            0,
            0,
            totalSales,
            bonus
          ]
        );
      }
    });
    await logAudit(req, req.user.id, "SUBMIT_SALES", "sales", saleId, {
      checkinId,
      userId: targetUserId,
      total: totalSales,
      bonus,
      date: targetDate
    });
    res.json({
      success: true,
      sales: {
        id: saleId,
        checkinId,
        total: totalSales,
        bonus,
        submittedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (err) {
    console.error("[Sales] Submit sales error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438 \u0432\u044B\u0440\u0443\u0447\u043A\u0438" } });
  }
});

// server/routes/messages.ts
import { Router as Router5 } from "express";
import { v4 as uuidv46 } from "uuid";
import { z as z5 } from "zod";
var messagesRouter = Router5();
messagesRouter.get("/", requireAuth, async (req, res) => {
  try {
    const isManager = req.user.role === "manager";
    const query = isManager ? `SELECT m.id, m.from_user_id, u.name as from_user_name, m.message, m.is_read, m.created_at
         FROM messages m
         JOIN users u ON u.id = m.from_user_id
         ORDER BY m.created_at DESC` : `SELECT m.id, m.from_user_id, u.name as from_user_name, m.message, m.is_read, m.created_at
         FROM messages m
         JOIN users u ON u.id = m.from_user_id
         WHERE m.from_user_id = $1
         ORDER BY m.created_at DESC`;
    const params = isManager ? [] : [req.user.id];
    const result = await db.query(query, params);
    const messages = result.rows.map((r) => ({
      id: r.id,
      fromEmployeeId: r.from_user_id,
      fromEmployeeName: r.from_user_name,
      message: r.message,
      read: Boolean(r.is_read),
      timestamp: r.created_at
    }));
    res.json({ success: true, messages });
  } catch (err) {
    console.error("[Messages] Get messages error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439" } });
  }
});
var createMessageSchema = z5.object({
  message: z5.string().min(1, "\u0422\u0435\u043A\u0441\u0442 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u0443\u0441\u0442\u044B\u043C")
});
messagesRouter.post("/", requireAuth, async (req, res) => {
  try {
    const parse = createMessageSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const fromUserId = req.user.id;
    const msgId = `msg-${uuidv46()}`;
    await db.query(
      "INSERT INTO messages (id, from_user_id, message) VALUES ($1, $2, $3)",
      [msgId, fromUserId, parse.data.message.trim()]
    );
    await logAudit(req, req.user.id, "SEND_MESSAGE", "message", msgId);
    res.status(201).json({
      success: true,
      message: {
        id: msgId,
        fromEmployeeId: fromUserId,
        fromEmployeeName: req.user.name,
        message: parse.data.message.trim(),
        read: false,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (err) {
    console.error("[Messages] Post message error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" } });
  }
});
messagesRouter.patch("/:id/read", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isManager = req.user.role === "manager";
    const checkRes = await db.query(
      "SELECT id, from_user_id FROM messages WHERE id = $1",
      [id]
    );
    if (checkRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" } });
      return;
    }
    const msg = checkRes.rows[0];
    if (!isManager && msg.from_user_id !== req.user.id) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "\u0414\u043E\u0441\u0442\u0443\u043F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D. \u0412\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442\u0435 \u043C\u0435\u043D\u044F\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441 \u0447\u0443\u0436\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" }
      });
      return;
    }
    await db.query("UPDATE messages SET is_read = 1 WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("[Messages] Mark read error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430" } });
  }
});
messagesRouter.post("/read-all", requireAuth, async (req, res) => {
  try {
    const isManager = req.user.role === "manager";
    if (isManager) {
      await db.query("UPDATE messages SET is_read = 1");
    } else {
      await db.query("UPDATE messages SET is_read = 1 WHERE from_user_id = $1", [req.user.id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Messages] Read all error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430" } });
  }
});
messagesRouter.post("/:id/reply", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "manager") {
      res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "\u0422\u043E\u043B\u044C\u043A\u043E \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u043C\u043E\u0436\u0435\u0442 \u043E\u0442\u0432\u0435\u0447\u0430\u0442\u044C \u043D\u0430 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" } });
      return;
    }
    const { id } = req.params;
    const { replyText } = req.body;
    if (!replyText || typeof replyText !== "string" || !replyText.trim()) {
      res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u043E\u0442\u0432\u0435\u0442\u0430" } });
      return;
    }
    const msgRes = await db.query(
      "SELECT id, from_user_id, message FROM messages WHERE id = $1",
      [id]
    );
    if (msgRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" } });
      return;
    }
    const origMsg = msgRes.rows[0];
    const notifId = `notif-${uuidv46()}`;
    await db.query(
      `INSERT INTO notifications (id, user_id, title, text, type, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        notifId,
        origMsg.from_user_id,
        "\u041E\u0442\u0432\u0435\u0442 \u043E\u0442 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F",
        replyText.trim(),
        "system",
        "manager"
      ]
    );
    await db.query("UPDATE messages SET is_read = 1 WHERE id = $1", [id]);
    await logAudit(req, req.user.id, "REPLY_MESSAGE", "message", id, { targetUserId: origMsg.from_user_id });
    res.json({ success: true, notificationId: notifId });
  } catch (err) {
    console.error("[Messages] Reply error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u043E\u0442\u0432\u0435\u0442\u0430" } });
  }
});

// server/routes/notifications.ts
import { Router as Router6 } from "express";
import { v4 as uuidv47 } from "uuid";
var notificationsRouter = Router6();
notificationsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const isManager = req.user.role === "manager";
    const query = isManager ? "SELECT id, user_id, to_all, title, text, type, is_read, source, created_at FROM notifications ORDER BY created_at DESC LIMIT 100" : "SELECT id, user_id, to_all, title, text, type, is_read, source, created_at FROM notifications WHERE user_id = $1 OR to_all = 1 ORDER BY created_at DESC LIMIT 100";
    const params = isManager ? [] : [req.user.id];
    const result = await db.query(query, params);
    const notifications = result.rows.map((r) => ({
      id: r.id,
      toEmployeeId: r.to_all ? "all" : r.user_id,
      title: r.title,
      text: r.text,
      type: r.type,
      read: Boolean(r.is_read),
      source: r.source,
      timestamp: r.created_at
    }));
    res.json({ success: true, notifications });
  } catch (err) {
    console.error("[Notifications] Get notifications error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0439" } });
  }
});
notificationsRouter.patch("/:id/read", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isManager = req.user.role === "manager";
    const notifRes = await db.query(
      "SELECT id, user_id, to_all FROM notifications WHERE id = $1",
      [id]
    );
    if (notifRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" } });
      return;
    }
    const notif = notifRes.rows[0];
    if (!isManager && notif.user_id !== req.user.id && !notif.to_all) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "\u0414\u043E\u0441\u0442\u0443\u043F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D. \u0412\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442\u0435 \u043C\u0435\u043D\u044F\u0442\u044C \u0447\u0443\u0436\u0438\u0435 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" }
      });
      return;
    }
    await db.query("UPDATE notifications SET is_read = 1 WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Mark read error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430" } });
  }
});
notificationsRouter.post("/read-all", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "manager") {
      await db.query("UPDATE notifications SET is_read = 1");
    } else {
      await db.query("UPDATE notifications SET is_read = 1 WHERE user_id = $1 OR to_all = 1", [req.user.id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Read all error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430" } });
  }
});
notificationsRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isManager = req.user.role === "manager";
    const notifRes = await db.query(
      "SELECT id, user_id FROM notifications WHERE id = $1",
      [id]
    );
    if (notifRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" } });
      return;
    }
    const notif = notifRes.rows[0];
    if (!isManager && notif.user_id !== req.user.id) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "\u0414\u043E\u0441\u0442\u0443\u043F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D. \u0412\u044B \u043D\u0435 \u043C\u043E\u0436\u0435\u0442\u0435 \u0443\u0434\u0430\u043B\u044F\u0442\u044C \u0447\u0443\u0436\u0438\u0435 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" }
      });
      return;
    }
    await db.query("DELETE FROM notifications WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Delete notification error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" } });
  }
});
notificationsRouter.post("/thank-you", requireManager, async (req, res) => {
  try {
    const { location } = req.body;
    if (!location || typeof location !== "string" || !location.trim()) {
      res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u043B\u043E\u043A\u0430\u0446\u0438\u044F" } });
      return;
    }
    const emps = await db.query(
      `SELECT u.id, u.name
       FROM users u
       JOIN user_locations ul ON ul.user_id = u.id
       JOIN locations l ON l.id = ul.location_id
       WHERE l.code = $1 AND u.role = 'employee' AND u.status = 'active'`,
      [location]
    );
    for (const emp of emps.rows) {
      await db.query(
        `INSERT INTO notifications (id, user_id, title, text, type, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          `notif-${uuidv47()}`,
          emp.id,
          "\u0411\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u044C \u043E\u0442 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F \u2764\uFE0F",
          `\u0420\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0432\u044B\u0440\u0430\u0436\u0430\u0435\u0442 \u043E\u0433\u0440\u043E\u043C\u043D\u0443\u044E \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u044C \u0437\u0430 \u043E\u0442\u043B\u0438\u0447\u043D\u0443\u044E \u0440\u0430\u0431\u043E\u0442\u0443 \u043D\u0430 \u043F\u0443\u043D\u043A\u0442\u0435 ${location}! \u0422\u0430\u043A \u0434\u0435\u0440\u0436\u0430\u0442\u044C!`,
          "bonus",
          "manager"
        ]
      );
    }
    await logAudit(req, req.user.id, "SEND_THANK_YOU", "notification", null, { location, count: emps.rows.length });
    res.json({ success: true, count: emps.rows.length });
  } catch (err) {
    console.error("[Notifications] Thank you error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u043D\u043E\u0441\u0442\u0438" } });
  }
});
notificationsRouter.get("/schedules", requireManager, async (req, res) => {
  try {
    const result = await db.query("SELECT id, title, text, schedule_type, time_of_day, target_role, is_active FROM scheduled_notifications ORDER BY created_at DESC");
    const schedules = result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      text: r.text,
      scheduleType: r.schedule_type,
      timeOfDay: r.time_of_day,
      targetRole: r.target_role,
      isActive: Boolean(r.is_active)
    }));
    res.json({ success: true, schedules });
  } catch (err) {
    console.error("[Notifications] Get schedules error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0439" } });
  }
});
notificationsRouter.post("/schedules", requireManager, async (req, res) => {
  try {
    const { title, text, scheduleType, timeOfDay, targetRole } = req.body;
    if (!title || !text || !scheduleType || !timeOfDay || !targetRole) {
      res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0432\u0441\u0435 \u043F\u043E\u043B\u044F" } });
      return;
    }
    const id = `sched-${uuidv47()}`;
    await db.query(
      `INSERT INTO scheduled_notifications (id, title, text, schedule_type, time_of_day, target_role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 1)`,
      [id, title, text, scheduleType, timeOfDay, targetRole]
    );
    await logAudit(req, req.user.id, "CREATE_SCHEDULED_NOTIFICATION", "notification", id, { title, scheduleType, timeOfDay });
    res.json({ success: true, schedule: { id, title, text, scheduleType, timeOfDay, targetRole, isActive: true } });
  } catch (err) {
    console.error("[Notifications] Create schedule error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F" } });
  }
});
notificationsRouter.delete("/schedules/:id", requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM scheduled_notifications WHERE id = $1", [id]);
    await logAudit(req, req.user.id, "DELETE_SCHEDULED_NOTIFICATION", "notification", id);
    res.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Delete schedule error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F" } });
  }
});
notificationsRouter.patch("/schedules/:id/toggle", requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    await db.query("UPDATE scheduled_notifications SET is_active = $1 WHERE id = $2", [isActive ? 1 : 0, id]);
    await logAudit(req, req.user.id, "TOGGLE_SCHEDULED_NOTIFICATION", "notification", id, { isActive });
    res.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Toggle schedule error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430" } });
  }
});
notificationsRouter.post("/schedules/:id/test", requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const ruleRes = await db.query("SELECT id, title, text, schedule_type, time_of_day, target_role FROM scheduled_notifications WHERE id = $1", [id]);
    if (ruleRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u041F\u0440\u0430\u0432\u0438\u043B\u043E \u0440\u0430\u0441\u0441\u044B\u043B\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" } });
      return;
    }
    const rule = ruleRes.rows[0];
    const targetLabel = rule.target_role === "all" ? "\u0412\u0441\u0435 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438" : rule.target_role === "standard" ? "\u0428\u0442\u0430\u0442\u043D\u044B\u0439 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B" : "\u041F\u043E\u0434\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0438";
    const tgMessage = `*${rule.title}*

${rule.text}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u041F\u043E\u043B\u0443\u0447\u0430\u0442\u0435\u043B\u0438: ${targetLabel}
\u0412\u0440\u0435\u043C\u044F: ${rule.time_of_day} \u041C\u0421\u041A`;
    const sendRes = await telegramService.sendBroadcastToStaff(tgMessage, rule.target_role);
    await logAudit(req, req.user.id, "TEST_SCHEDULED_NOTIFICATION", "notification", id, {
      title: rule.title,
      success: sendRes.success,
      deliveredCount: sendRes.deliveredCount
    });
    if (sendRes.success) {
      const extra = sendRes.deliveredCount > 0 ? ` (${sendRes.deliveredCount} \u0441\u043E\u0442\u0440\u0443\u0434\u043D. \u0441 Telegram)` : "";
      res.json({
        success: true,
        message: `\u0420\u0430\u0441\u0441\u044B\u043B\u043A\u0430 \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430 \u0432 Telegram${extra}`,
        deliveredCount: sendRes.deliveredCount
      });
    } else {
      res.status(400).json({ success: false, error: { code: "TELEGRAM_ERROR", message: sendRes.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0432 Telegram" } });
    }
  } catch (err) {
    console.error("[Notifications] Test schedule error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0442\u0435\u0441\u0442\u043E\u0432\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" } });
  }
});

// server/routes/applications.ts
import { Router as Router7 } from "express";
import bcrypt4 from "bcryptjs";
import { v4 as uuidv48 } from "uuid";
import { z as z6 } from "zod";
var applicationsRouter = Router7();
applicationsRouter.get("/", requireManager, async (_req, res) => {
  try {
    const result = await db.query(
      "SELECT id, name, telegram_username, status, note, assigned_login, created_at, updated_at FROM applications ORDER BY created_at DESC"
    );
    const applications = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      telegramUsername: r.telegram_username,
      status: r.status,
      note: r.note,
      generatedLogin: r.assigned_login,
      submittedAt: r.created_at ? new Date(r.created_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
      decidedAt: r.updated_at ? new Date(r.updated_at).toISOString() : void 0
    }));
    res.json({ success: true, applications });
  } catch (err) {
    console.error("[Applications] Get applications error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0437\u0430\u044F\u0432\u043E\u043A" } });
  }
});
var submitAppSchema = z6.object({
  name: z6.string().min(1, "\u0418\u043C\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E"),
  telegramUsername: z6.string().optional()
});
applicationsRouter.post("/", applicationRateLimiter, async (req, res) => {
  try {
    const parse = submitAppSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const { name, telegramUsername } = parse.data;
    const appId = `app-${uuidv48()}`;
    await db.query(
      "INSERT INTO applications (id, name, telegram_username, status) VALUES ($1, $2, $3, $4)",
      [appId, name.trim(), telegramUsername?.trim() || null, "pending"]
    );
    res.status(201).json({
      success: true,
      applicationId: appId,
      message: "\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430 \u043D\u0430 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u0438\u0435 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044E"
    });
  } catch (err) {
    console.error("[Applications] Submit application error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0435 \u0437\u0430\u044F\u0432\u043A\u0438" } });
  }
});
var handleAppSchema = z6.object({
  action: z6.enum(["accept", "reject"]),
  note: z6.string().optional(),
  generatedLogin: z6.string().optional(),
  generatedPassword: z6.string().optional(),
  assignedLocations: z6.array(z6.string()).default([]),
  isSenior: z6.boolean().default(false)
});
applicationsRouter.patch("/:id", requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const parse = handleAppSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const { action, note, generatedLogin, generatedPassword, assignedLocations, isSenior } = parse.data;
    const appRes = await db.query(
      "SELECT id, name, telegram_username, status FROM applications WHERE id = $1",
      [id]
    );
    if (appRes.rows.length === 0) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" } });
      return;
    }
    const app2 = appRes.rows[0];
    if (action === "accept") {
      if (!generatedLogin || !generatedPassword) {
        res.status(400).json({
          success: false,
          error: { code: "CREDENTIALS_REQUIRED", message: "\u0414\u043B\u044F \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043B\u043E\u0433\u0438\u043D \u0438 \u043F\u0430\u0440\u043E\u043B\u044C" }
        });
        return;
      }
      const cleanLogin = generatedLogin.trim();
      const existingUser = await db.query("SELECT id FROM users WHERE LOWER(login) = LOWER($1)", [cleanLogin]);
      if (existingUser.rows.length > 0) {
        res.status(409).json({
          success: false,
          error: { code: "LOGIN_EXISTS", message: `\u041B\u043E\u0433\u0438\u043D \xAB${cleanLogin}\xBB \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442` }
        });
        return;
      }
      const newUserId = `emp-${uuidv48()}`;
      const salt = bcrypt4.genSaltSync(10);
      const hash = bcrypt4.hashSync(generatedPassword.trim(), salt);
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO users (id, login, password_hash, name, role, status, is_part_time, is_senior, telegram_username)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [newUserId, cleanLogin, hash, app2.name, "employee", "active", false, isSenior, app2.telegram_username]
        );
        for (const locCode of assignedLocations) {
          const locRes = await client.query("SELECT id FROM locations WHERE code = $1", [locCode]);
          if (locRes.rows.length > 0) {
            await client.query("INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2)", [
              newUserId,
              locRes.rows[0].id
            ]);
          }
        }
        await client.query(
          "UPDATE applications SET status = 'approved', note = $1, assigned_login = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
          [note?.trim() || null, cleanLogin, id]
        );
        await client.query(
          `INSERT INTO notifications (id, user_id, title, text, type, source)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            `notif-${uuidv48()}`,
            newUserId,
            "\u0417\u0430\u044F\u0432\u043A\u0430 \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0430!",
            `\u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044E \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0430. \u0412\u0430\u0448 \u043B\u043E\u0433\u0438\u043D: "${cleanLogin}".`,
            "system",
            "manager"
          ]
        );
      });
      await logAudit(req, req.user.id, "APPROVE_APPLICATION", "application", id, { newUserId, login: cleanLogin });
    } else {
      await db.query(
        "UPDATE applications SET status = 'rejected', note = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [note?.trim() || null, id]
      );
      await logAudit(req, req.user.id, "REJECT_APPLICATION", "application", id, { note });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Applications] Handle application error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0437\u0430\u044F\u0432\u043A\u0438" } });
  }
});

// server/routes/rates.ts
import { Router as Router8 } from "express";
var ratesRouter = Router8();
var DEFAULT_RATES = {
  standard: 2e3,
  "400+": 2200,
  "500+": 2500,
  "8h": 1500,
  "4h": 800,
  partTimeShiftRate: 1800,
  seniorBonus: 200,
  partTimeBonus: 0,
  shiftTypes: [
    { code: "standard", name: "\u041E\u0431\u044B\u0447\u043D\u0430\u044F \u0441\u043C\u0435\u043D\u0430", baseRate: 2e3, isArchived: false },
    { code: "400+", name: "\u0421\u043C\u0435\u043D\u0430 400+", baseRate: 2200, isArchived: false },
    { code: "500+", name: "\u0421\u043C\u0435\u043D\u0430 500+", baseRate: 2500, isArchived: false },
    { code: "8h", name: "\u0421\u043C\u0435\u043D\u0430 8 \u0447\u0430\u0441\u043E\u0432", baseRate: 1500, isArchived: false },
    { code: "4h", name: "\u0421\u043C\u0435\u043D\u0430 4 \u0447\u0430\u0441\u0430", baseRate: 800, isArchived: false }
  ],
  partTimeShiftTypes: [
    { code: "4h", name: "\u0421\u043C\u0435\u043D\u0430 4 \u0447\u0430\u0441\u0430", baseRate: 800, isArchived: false },
    { code: "pt_standard", name: "\u0421\u043C\u0435\u043D\u0430 \u043F\u043E\u0434\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0430 (\u043F\u043E\u043B\u043D\u0430\u044F)", baseRate: 1800, isArchived: false }
  ],
  bonuses: [
    { code: "seniorBonus", name: "\u0414\u043E\u043F\u043B\u0430\u0442\u0430 \u0421\u0442\u0430\u0440\u0448\u0435\u043C\u0443 (\u0421\u0442.\u0421.)", value: 200, isArchived: false, target: "senior" },
    { code: "partTimeBonus", name: "\u0414\u043E\u043F\u043B\u0430\u0442\u0430 \u041F\u043E\u0434\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0443", value: 0, isArchived: false, target: "part_time" }
  ]
};
ratesRouter.get("/", async (_req, res) => {
  try {
    const result = await db.query("SELECT value FROM settings WHERE key = $1", ["rates"]);
    if (result.rows.length === 0) {
      res.json({ success: true, rates: DEFAULT_RATES });
      return;
    }
    try {
      const parsed = JSON.parse(result.rows[0].value);
      res.json({ success: true, rates: { ...DEFAULT_RATES, ...parsed } });
    } catch {
      res.json({ success: true, rates: DEFAULT_RATES });
    }
  } catch (err) {
    console.error("[Rates] Get rates error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0432\u043E\u043A" } });
  }
});
ratesRouter.post("/", requireManager, async (req, res) => {
  try {
    const ratesString = JSON.stringify(req.body);
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      ["rates", ratesString]
    );
    res.json({ success: true, rates: req.body });
  } catch (err) {
    console.error("[Rates] Save rates error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0432\u043E\u043A" } });
  }
});

// server/routes/locations.ts
import { Router as Router9 } from "express";
var locationsRouter = Router9();
var DEFAULT_LOCATIONS = [];
function mapRowToLocation(row) {
  let assignedStaff = [];
  if (row.assigned_staff_ids) {
    try {
      assignedStaff = JSON.parse(row.assigned_staff_ids);
    } catch {
      assignedStaff = typeof row.assigned_staff_ids === "string" ? row.assigned_staff_ids.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address || "",
    active: Boolean(row.active ?? true),
    isArchived: Boolean(row.is_archived ?? false),
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : void 0,
    assignedStaffIds: Array.isArray(assignedStaff) ? assignedStaff : [],
    contactPhone: row.contact_phone || "",
    notes: row.notes || "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : void 0
  };
}
async function getStoredLocations() {
  try {
    const res = await db.query(
      `SELECT id, code, name, address, active, is_archived, archived_at, contact_phone, notes, assigned_staff_ids, created_at, updated_at
       FROM locations
       ORDER BY created_at ASC, name ASC`
    );
    const list = res.rows.map(mapRowToLocation);
    try {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        ["locations", JSON.stringify(list)]
      );
    } catch {
    }
    return list;
  } catch (err) {
    console.error("[Locations] Read error from DB:", err);
    try {
      const fallback = await db.query("SELECT value FROM settings WHERE key = $1", ["locations"]);
      if (fallback.rows.length > 0 && fallback.rows[0].value) {
        return JSON.parse(fallback.rows[0].value);
      }
    } catch {
    }
    return [];
  }
}
async function saveSingleLocationToDb(loc) {
  const assignedJson = JSON.stringify(loc.assignedStaffIds || []);
  await db.query(
    `INSERT INTO locations (id, code, name, address, active, is_archived, archived_at, contact_phone, notes, assigned_staff_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
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
       updated_at = CURRENT_TIMESTAMP`,
    [
      loc.id,
      loc.code,
      loc.name,
      loc.address || "",
      loc.active ? 1 : 0,
      loc.isArchived ? 1 : 0,
      loc.archivedAt || null,
      loc.contactPhone || "",
      loc.notes || "",
      assignedJson,
      loc.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    ]
  );
}
locationsRouter.get("/", async (_req, res) => {
  try {
    const locations = await getStoredLocations();
    res.json({ success: true, locations });
  } catch (err) {
    console.error("[Locations] Get error:", err);
    res.json({ success: true, locations: DEFAULT_LOCATIONS });
  }
});
locationsRouter.post("/", requireManager, async (req, res) => {
  try {
    const currentLocs = await getStoredLocations();
    if (currentLocs.length >= 30) {
      res.status(400).json({ success: false, error: "\u0414\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442 \u043B\u0438\u043C\u0438\u0442: \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u043E \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u043E 30 \u043F\u0443\u043D\u043A\u0442\u043E\u0432 \u0432\u044B\u0434\u0430\u0447\u0438 (\u041F\u0412\u0417)." });
      return;
    }
    const { name, code, address, active = true, assignedStaffIds = [], contactPhone = "", notes = "" } = req.body;
    const cleanName = typeof name === "string" ? name.trim().slice(0, 30) : "";
    if (!cleanName) {
      res.status(400).json({ success: false, error: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043F\u0443\u043D\u043A\u0442\u0430 \u0432\u044B\u0434\u0430\u0447\u0438." });
      return;
    }
    const duplicateName = currentLocs.find((l) => l.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (duplicateName) {
      res.status(400).json({ success: false, error: `\u041F\u0443\u043D\u043A\u0442 \u0432\u044B\u0434\u0430\u0447\u0438 \u0441 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435\u043C \xAB${cleanName}\xBB \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442. \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u044F \u041F\u0412\u0417 \u0434\u043E\u043B\u0436\u043D\u044B \u0431\u044B\u0442\u044C \u0443\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u044B\u043C\u0438.` });
      return;
    }
    const finalCode = (typeof code === "string" && code.trim().length > 0 ? code.trim().slice(0, 18) : `\u041F\u0412\u0417-${currentLocs.length + 1}`).toUpperCase();
    const newLoc = {
      id: `pvz-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      code: finalCode,
      name: cleanName,
      address: address ? String(address).trim() : "",
      active: Boolean(active),
      isArchived: false,
      assignedStaffIds: Array.isArray(assignedStaffIds) ? assignedStaffIds : [],
      contactPhone: contactPhone ? String(contactPhone).trim() : "",
      notes: notes ? String(notes).trim() : "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await saveSingleLocationToDb(newLoc);
    const updatedList = await getStoredLocations();
    await logAudit(req, req.user.id, "CREATE_LOCATION", "location", newLoc.id, {
      code: newLoc.code,
      name: newLoc.name
    });
    res.json({ success: true, location: newLoc, locations: updatedList });
  } catch (err) {
    console.error("[Locations] Create error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u043F\u0443\u043D\u043A\u0442\u0430 \u0432\u044B\u0434\u0430\u0447\u0438" } });
  }
});
locationsRouter.put("/:id", requireManager, async (req, res) => {
  try {
    const locId = req.params.id;
    const currentLocs = await getStoredLocations();
    const locIdDecoded = decodeURIComponent(locId);
    const idx = currentLocs.findIndex(
      (l) => l.id === locId || l.id === locIdDecoded || l.code === locId || l.code === locIdDecoded || l.code.toUpperCase() === locId.toUpperCase() || l.code.toUpperCase() === locIdDecoded.toUpperCase() || l.id.toLowerCase() === locId.toLowerCase()
    );
    if (idx === -1) {
      res.status(404).json({ success: false, error: "\u041F\u0443\u043D\u043A\u0442 \u0432\u044B\u0434\u0430\u0447\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D." });
      return;
    }
    const target = currentLocs[idx];
    const body = req.body;
    if (body.name !== void 0) {
      const cleanName = String(body.name).trim().slice(0, 30);
      if (!cleanName) {
        res.status(400).json({ success: false, error: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043F\u0443\u043D\u043A\u0442\u0430 \u0432\u044B\u0434\u0430\u0447\u0438." });
        return;
      }
      const duplicateName = currentLocs.find((l, i) => i !== idx && l.name.trim().toLowerCase() === cleanName.toLowerCase());
      if (duplicateName) {
        res.status(400).json({ success: false, error: `\u041F\u0443\u043D\u043A\u0442 \u0432\u044B\u0434\u0430\u0447\u0438 \u0441 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435\u043C \xAB${cleanName}\xBB \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442. \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u044F \u041F\u0412\u0417 \u0434\u043E\u043B\u0436\u043D\u044B \u0431\u044B\u0442\u044C \u0443\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u044B\u043C\u0438.` });
        return;
      }
      target.name = cleanName;
    }
    if (body.code !== void 0) {
      const cleanCode = String(body.code).trim().slice(0, 18).toUpperCase();
      if (cleanCode) {
        target.code = cleanCode;
      }
    }
    if (body.address !== void 0) target.address = String(body.address).trim();
    if (body.active !== void 0) target.active = Boolean(body.active);
    if (body.isArchived !== void 0) {
      target.isArchived = Boolean(body.isArchived);
      if (body.isArchived) {
        target.archivedAt = body.archivedAt || (/* @__PURE__ */ new Date()).toISOString();
        target.active = false;
      } else {
        target.archivedAt = void 0;
        target.active = true;
      }
    }
    if (Array.isArray(body.assignedStaffIds)) target.assignedStaffIds = body.assignedStaffIds;
    if (body.contactPhone !== void 0) target.contactPhone = String(body.contactPhone).trim();
    if (body.notes !== void 0) target.notes = String(body.notes).trim();
    await saveSingleLocationToDb(target);
    const updatedList = await getStoredLocations();
    await logAudit(req, req.user.id, target.isArchived ? "ARCHIVE_LOCATION" : "UPDATE_LOCATION", "location", target.id, {
      code: target.code,
      name: target.name,
      isArchived: target.isArchived
    });
    res.json({ success: true, locations: updatedList });
  } catch (err) {
    console.error("[Locations] Update error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u043F\u0443\u043D\u043A\u0442\u0430 \u0432\u044B\u0434\u0430\u0447\u0438" });
  }
});
locationsRouter.delete("/:id", requireManager, async (req, res) => {
  try {
    const locId = req.params.id;
    const currentLocs = await getStoredLocations();
    const locIdDecoded = decodeURIComponent(locId);
    const targetLoc = currentLocs.find(
      (l) => l.id === locId || l.id === locIdDecoded || l.code === locId || l.code === locIdDecoded || l.code.toUpperCase() === locId.toUpperCase() || l.code.toUpperCase() === locIdDecoded.toUpperCase() || l.id.toLowerCase() === locId.toLowerCase()
    );
    const targetCode = targetLoc?.code || locId;
    const targetId = targetLoc?.id || locId;
    try {
      await db.query("DELETE FROM locations WHERE id = $1 OR code = $2", [targetId, targetCode]);
    } catch (e) {
      console.warn("[Locations] Cleanup in locations table notice:", e);
    }
    const updatedList = await getStoredLocations();
    await logAudit(req, req.user.id, "DELETE_LOCATION", "location", targetId, {
      code: targetCode,
      name: targetLoc?.name
    });
    res.json({ success: true, locations: updatedList });
  } catch (err) {
    console.error("[Locations] Delete error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u043F\u0443\u043D\u043A\u0442\u0430 \u0432\u044B\u0434\u0430\u0447\u0438" });
  }
});

// server/routes/bot.ts
import { Router as Router10 } from "express";

// server/services/scheduler.ts
import { v4 as uuidv49 } from "uuid";
var SchedulerService = class {
  constructor() {
    this.timer = null;
    this.cleanupTimer = null;
    this.isRunning = false;
    this.startTime = Date.now();
    this.lastHeartbeat = (/* @__PURE__ */ new Date()).toISOString();
    // Requirement 35: Idempotency set to prevent duplicate execution upon restarts
    this.executedJobs = /* @__PURE__ */ new Set();
    this.jobs = {
      "20:00": { name: "\u041D\u0430\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0435 \u043E Check-in", time: "20:00", status: "idle" },
      "20:50": { name: "\u041D\u0430\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0435 \u043E \u0432\u0432\u043E\u0434\u0435 \u0432\u044B\u0440\u0443\u0447\u043A\u0438", time: "20:50", status: "idle" },
      "21:10": { name: "\u0421\u0440\u043E\u0447\u043D\u043E\u0435 \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435 (\u0432\u044B\u0440\u0443\u0447\u043A\u0430)", time: "21:10", status: "idle" },
      "21:15": { name: "\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u0441\u0432\u043E\u0434\u043D\u044B\u0439 \u043E\u0442\u0447\u0435\u0442 \u0432 Telegram", time: "21:15", status: "idle" }
    };
  }
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = Date.now();
    this.lastHeartbeat = (/* @__PURE__ */ new Date()).toISOString();
    console.log("[Scheduler] Authoritative Node.js scheduler started (Timezone: Europe/Moscow).");
    this.timer = setInterval(() => {
      this.lastHeartbeat = (/* @__PURE__ */ new Date()).toISOString();
      this.tick();
    }, 30 * 1e3);
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1e3);
    this.cleanupExpiredSessions();
    this.recordBotLog("start", "\u0421\u0438\u0441\u0442\u0435\u043C\u0430", "success", "\u041F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A \u0437\u0430\u043F\u0443\u0449\u0435\u043D \u0443\u0441\u043F\u0435\u0448\u043D\u043E.");
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.isRunning = false;
    console.log("[Scheduler] Node.js scheduler stopped.");
  }
  async restart(initiatedBy = "\u0420\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C") {
    this.stop();
    this.start();
    await this.recordBotLog(
      "restart",
      initiatedBy,
      "success",
      `\u041F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A \u0438 Telegram-\u0441\u0435\u0440\u0432\u0438\u0441 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0449\u0435\u043D\u044B \u0443\u0441\u043F\u0435\u0448\u043D\u043E (pid=${process.pid}).`
    );
  }
  // Requirement 34: Clear breakdown of Scheduler status vs Telegram configuration
  getStatus() {
    return {
      scheduler: {
        running: this.isRunning,
        pid: process.pid,
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1e3),
        timezone: "Europe/Moscow",
        lastHeartbeat: this.lastHeartbeat,
        jobs: Object.values(this.jobs)
      },
      telegram: {
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        managerId: telegramService.getManagerChatId()
      }
    };
  }
  // Requirement 50: Expired sessions and 3-month archive retention cleanup
  async cleanupExpiredSessions() {
    try {
      await db.query("DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP");
      const now = /* @__PURE__ */ new Date();
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "numeric"
      }).formatToParts(now);
      const year = parseInt(parts.find((p) => p.type === "year")?.value || `${now.getFullYear()}`, 10);
      const month = parseInt(parts.find((p) => p.type === "month")?.value || `${now.getMonth() + 1}`, 10);
      let targetYear = year;
      let targetMonth = month - 3;
      if (targetMonth < 1) {
        targetMonth += 12;
        targetYear -= 1;
      }
      const cutoffDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
      await db.query("DELETE FROM shift_swaps WHERE date < $1", [cutoffDate]);
    } catch (err) {
      console.warn("[Scheduler] Periodic retention cleanup warning:", err);
    }
  }
  async recordBotLog(action, initiatedBy, status, details) {
    try {
      const id = `rst-${uuidv49()}`;
      await db.query(
        "INSERT INTO bot_logs (id, action, initiated_by, status, details) VALUES ($1, $2, $3, $4, $5)",
        [id, action, initiatedBy, status, details]
      );
    } catch (err) {
      console.error("[Scheduler] Failed to write bot log:", err);
    }
  }
  getMoscowTime() {
    const now = /* @__PURE__ */ new Date();
    const formatter = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    const day = parts.find((p) => p.type === "day")?.value || "01";
    const month = parts.find((p) => p.type === "month")?.value || "01";
    const year = parts.find((p) => p.type === "year")?.value || "2026";
    const hourStr = String(hour).padStart(2, "0");
    const minuteStr = String(minute).padStart(2, "0");
    return {
      timeStr: `${hourStr}:${minuteStr}`,
      dateStr: `${year}-${month}-${day}`,
      hour,
      minute
    };
  }
  async tick() {
    const { timeStr, dateStr } = this.getMoscowTime();
    if (timeStr === "20:00") {
      const key = `checkin-reminder-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runCheckInReminder(dateStr);
      }
    } else if (timeStr === "20:50") {
      const key = `sales-reminder-normal-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runSalesReminder(dateStr, false);
      }
    } else if (timeStr === "21:10") {
      const key = `sales-reminder-urgent-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runSalesReminder(dateStr, true);
      }
    } else if (timeStr === "21:15") {
      const key = `daily-report-${dateStr}`;
      if (!this.executedJobs.has(key)) {
        this.executedJobs.add(key);
        await this.runDailyReport(dateStr);
      }
    }
    await this.processCustomScheduledNotifications(timeStr, dateStr);
  }
  // 20:00 In-app Check-in Reminder (Requirement 31)
  async runCheckInReminder(dateStr) {
    try {
      this.jobs["20:00"].status = "running";
      const staffRes = await db.query(
        "SELECT id, name FROM users WHERE role = 'employee' AND status = 'active'"
      );
      const checkinsRes = await db.query(
        "SELECT user_id FROM checkins WHERE date = $1",
        [dateStr]
      );
      const checkedIds = new Set(checkinsRes.rows.map((c) => c.user_id));
      const missingStaff = staffRes.rows.filter((s) => !checkedIds.has(s.id));
      if (missingStaff.length > 0) {
        for (const emp of missingStaff) {
          await db.query(
            `INSERT INTO notifications (id, user_id, title, text, type, source)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              `notif-${uuidv49()}`,
              emp.id,
              "\u041D\u0430\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0435 \u043E \u0441\u043C\u0435\u043D\u0435",
              "\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u043D\u0435 \u0437\u0430\u0431\u0443\u0434\u044C\u0442\u0435 \u043E\u0442\u043C\u0435\u0442\u0438\u0442\u044C\u0441\u044F (Check-in) \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435.",
              "system",
              "scheduler"
            ]
          );
        }
      }
      this.jobs["20:00"].lastRun = (/* @__PURE__ */ new Date()).toISOString();
      this.jobs["20:00"].status = "completed";
    } catch (err) {
      console.error("[Scheduler] Error in 20:00 job:", err);
      this.jobs["20:00"].status = "error";
    }
  }
  // 20:50 and 21:10 Reminders (Requirement 31)
  async runSalesReminder(dateStr, isUrgent) {
    const jobKey = isUrgent ? "21:10" : "20:50";
    try {
      this.jobs[jobKey].status = "running";
      const pendingRes = await db.query(
        `SELECT c.user_id, u.name
         FROM checkins c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN sales s ON s.checkin_id = c.id
         WHERE c.date = $1 AND s.id IS NULL AND u.status = 'active'`,
        [dateStr]
      );
      for (const row of pendingRes.rows) {
        const title = isUrgent ? "\u26A0\uFE0F \u0421\u0420\u041E\u0427\u041D\u041E: \u0412\u043D\u0435\u0441\u0438\u0442\u0435 \u0432\u044B\u0440\u0443\u0447\u043A\u0443!" : "\u{1F4CA} \u041D\u0430\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0435 \u043E \u0432\u044B\u0440\u0443\u0447\u043A\u0435";
        const text = isUrgent ? "\u0414\u043E 21:15 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u0441\u043C\u0435\u043D\u0443 \u0438 \u0432\u043D\u0435\u0441\u0442\u0438 \u0434\u0430\u043D\u043D\u044B\u0435 \u043F\u043E \u0444\u043E\u0442\u043E, \u043F\u0435\u0447\u0430\u0442\u0438 \u0438 \u043B\u0430\u043C\u0438\u043D\u0430\u0446\u0438\u0438!" : "\u0421\u043C\u0435\u043D\u0430 \u043F\u043E\u0434\u0445\u043E\u0434\u0438\u0442 \u043A \u043A\u043E\u043D\u0446\u0443. \u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0432\u043D\u0435\u0441\u0438\u0442\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043F\u043E \u043A\u0430\u0441\u0441\u0435 \u0432 \u0440\u0430\u0437\u0434\u0435\u043B \xAB\u0412\u044B\u0440\u0443\u0447\u043A\u0430\xBB.";
        await db.query(
          `INSERT INTO notifications (id, user_id, title, text, type, source)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [`notif-${uuidv49()}`, row.user_id, title, text, "system", "scheduler"]
        );
      }
      this.jobs[jobKey].lastRun = (/* @__PURE__ */ new Date()).toISOString();
      this.jobs[jobKey].status = "completed";
    } catch (err) {
      console.error(`[Scheduler] Error in ${jobKey} job:`, err);
      this.jobs[jobKey].status = "error";
    }
  }
  // 21:15 Daily Sales Report (Requirement 30 & 35)
  async runDailyReport(dateStr) {
    try {
      this.jobs["21:15"].status = "running";
      console.log(`[Scheduler] 21:15 MSK reached. Generating and dispatching daily sales report for ${dateStr}...`);
      const res = await telegramService.sendDailySalesReport(dateStr);
      if (res.success) {
        await this.recordBotLog("daily_report", "\u041F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A", "success", `\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u043E\u0442\u0447\u0435\u0442 \u0437\u0430 ${dateStr} \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u0432 Telegram.`);
        this.jobs["21:15"].status = "completed";
      } else {
        await this.recordBotLog("daily_report", "\u041F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A", "error", `\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u043E\u0442\u0447\u0435\u0442\u0430: ${res.error}`);
        this.jobs["21:15"].status = "error";
      }
      this.jobs["21:15"].lastRun = (/* @__PURE__ */ new Date()).toISOString();
    } catch (err) {
      console.error("[Scheduler] Error in 21:15 daily report job:", err);
      this.jobs["21:15"].status = "error";
    }
  }
  // Process custom manager-defined scheduled notifications and trigger system logs + Web Push notifications
  async processCustomScheduledNotifications(timeStr, dateStr) {
    try {
      const rules = await db.query(
        `SELECT id, title, text, schedule_type, time_of_day, target_role 
         FROM scheduled_notifications 
         WHERE time_of_day = $1 AND is_active = 1`,
        [timeStr]
      );
      for (const rule of rules.rows) {
        const idempotencyKey = `custom-notif-${rule.id}-${dateStr}`;
        if (this.executedJobs.has(idempotencyKey)) {
          continue;
        }
        this.executedJobs.add(idempotencyKey);
        console.log(`[Scheduler] Processing scheduled notification "${rule.title}" for ${timeStr} MSK.`);
        let usersQuery = "SELECT id FROM users WHERE role = 'employee' AND status = 'active'";
        let params = [];
        if (rule.target_role === "standard") {
          usersQuery = "SELECT id FROM users WHERE role = 'employee' AND status = 'active' AND is_part_time = FALSE";
        } else if (rule.target_role === "part_time") {
          usersQuery = "SELECT id FROM users WHERE role = 'employee' AND status = 'active' AND is_part_time = TRUE";
        }
        const employees = await db.query(usersQuery, params);
        for (const emp of employees.rows) {
          const notifId = `notif-${uuidv49()}`;
          await db.query(
            `INSERT INTO notifications (id, user_id, title, text, type, source)
             VALUES ($1, $2, $3, $4, 'system', 'scheduler')`,
            [notifId, emp.id, rule.title, rule.text]
          );
        }
        const targetLabel = rule.target_role === "all" ? "\u0412\u0441\u0435 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438" : rule.target_role === "standard" ? "\u0428\u0442\u0430\u0442\u043D\u044B\u0439 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B" : "\u041F\u043E\u0434\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0438";
        const telegramMessage = `*${rule.title}*

${rule.text}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u041F\u043E\u043B\u0443\u0447\u0430\u0442\u0435\u043B\u0438: ${targetLabel}
\u0412\u0440\u0435\u043C\u044F: ${rule.time_of_day} \u041C\u0421\u041A`;
        const broadcastRes = await telegramService.sendBroadcastToStaff(telegramMessage, rule.target_role);
        await this.recordBotLog(
          "scheduled_broadcast",
          "\u041F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A",
          broadcastRes.success ? "success" : "error",
          `\u0420\u0430\u0441\u0441\u044B\u043B\u043A\u0430 "${rule.title}" \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430 \u0432 Telegram (${targetLabel}, \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E: ${broadcastRes.deliveredCount} \u0441\u043E\u0442\u0440\u0443\u0434\u043D.).`
        );
        console.log(`[Scheduler] Dispatched "${rule.title}" to Telegram (delivered: ${broadcastRes.deliveredCount} staff).`);
      }
    } catch (err) {
      console.error("[Scheduler] Error processing custom scheduled notifications:", err);
    }
  }
};
var schedulerService = new SchedulerService();

// server/routes/bot.ts
var botRouter = Router10();
botRouter.get("/status", requireAuth, (_req, res) => {
  const status = schedulerService.getStatus();
  res.json({
    success: true,
    status: {
      ...status,
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN)
    }
  });
});
botRouter.get("/logs", requireAuth, async (_req, res) => {
  try {
    const result = await db.query(
      "SELECT id, action, initiated_by, status, details, created_at FROM bot_logs ORDER BY created_at DESC LIMIT 50"
    );
    const logs = result.rows.map((r) => ({
      id: r.id,
      timestamp: r.created_at,
      initiatedBy: r.initiated_by,
      status: r.status,
      outputLogs: [
        `[${new Date(r.created_at).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })}] \u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435: ${r.action}`,
        `[${new Date(r.created_at).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })}] \u0418\u043D\u0438\u0446\u0438\u0430\u0442\u043E\u0440: ${r.initiated_by}`,
        `[${new Date(r.created_at).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })}] \u0421\u0442\u0430\u0442\u0443\u0441: ${r.status}`,
        r.details ? `[${new Date(r.created_at).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })}] ${r.details}` : ""
      ].filter(Boolean)
    }));
    res.json({ success: true, logs });
  } catch (err) {
    console.error("[Bot] Get logs error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u043B\u043E\u0433\u043E\u0432" } });
  }
});
botRouter.post("/restart", requireManager, async (req, res) => {
  try {
    const initiatedBy = req.user?.name || "\u0420\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C";
    await schedulerService.restart(initiatedBy);
    await logAudit(req, req.user.id, "RESTART_BOT", "bot", null);
    res.json({
      success: true,
      message: "\u0421\u0435\u0440\u0432\u0438\u0441 Telegram \u0438 \u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0449\u0435\u043D\u044B",
      status: schedulerService.getStatus()
    });
  } catch (err) {
    console.error("[Bot] Restart error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u043A\u0430 \u0431\u043E\u0442\u0430" } });
  }
});

// server/routes/telegram.ts
import { Router as Router11 } from "express";
import { z as z7 } from "zod";
var telegramRouter = Router11();
var sendSchema = z7.object({
  message: z7.string().min(1, "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u0443\u0441\u0442\u044B\u043C"),
  chatId: z7.string().optional()
});
telegramRouter.post("/send", requireAuth, async (req, res) => {
  try {
    const parse = sendSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parse.error.issues?.[0]?.message || "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" }
      });
      return;
    }
    const { message, chatId } = parse.data;
    const isManager = req.user.role === "manager";
    const managerChatId = telegramService.getManagerChatId();
    if (isManager && chatId && chatId !== managerChatId) {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN_CHAT_ID",
          message: "\u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0447\u0430\u0442 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F"
        }
      });
      return;
    }
    const result = await telegramService.sendMessage(message);
    if (!result.success) {
      res.status(502).json({
        success: false,
        error: { code: "TELEGRAM_ERROR", message: result.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0432 Telegram" }
      });
      return;
    }
    res.json({
      success: true,
      simulated: result.simulated,
      message: result.simulated ? "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E (\u0442\u043E\u043A\u0435\u043D Telegram \u043D\u0435 \u0437\u0430\u0434\u0430\u043D, \u0432\u044B\u0432\u043E\u0434 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u0432 \u0436\u0443\u0440\u043D\u0430\u043B)" : "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0432 Telegram"
    });
  } catch (err) {
    console.error("[Telegram] Send error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u044F\u044F \u043E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438" } });
  }
});
telegramRouter.post("/notify", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ success: false, error: { message: "\u0422\u0435\u043A\u0441\u0442 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D" } });
      return;
    }
    const result = await telegramService.sendMessage(message);
    res.json({
      success: result.success,
      simulated: result.simulated,
      message: result.simulated ? "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E (\u0442\u043E\u043A\u0435\u043D Telegram \u043D\u0435 \u0437\u0430\u0434\u0430\u043D)" : "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0432 Telegram"
    });
  } catch (err) {
    console.error("[Telegram] Notify error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" } });
  }
});
telegramRouter.get("/settings", requireManager, async (_req, res) => {
  try {
    const settings = telegramService.getSettings();
    const isConfigured = telegramService.isConfigured();
    res.json({
      success: true,
      settings: {
        isConfigured,
        botToken: settings.botToken,
        managerChatId: settings.managerChatId,
        botUsername: settings.botUsername,
        updatedAt: settings.updatedAt
      }
    });
  } catch (err) {
    console.error("[Telegram] Settings error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A Telegram" } });
  }
});
telegramRouter.post("/settings", requireManager, async (req, res) => {
  try {
    const { botToken, managerChatId } = req.body || {};
    const trimmedToken = (botToken || "").trim();
    const trimmedChat = (managerChatId || "").trim();
    if (!trimmedToken || !trimmedChat) {
      res.status(400).json({ success: false, error: { message: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D \u0431\u043E\u0442\u0430 \u0438 ID \u0447\u0430\u0442\u0430 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F" } });
      return;
    }
    let botUsername = "";
    try {
      const checkRes = await fetch(`https://api.telegram.org/bot${trimmedToken}/getMe`);
      const checkData = await checkRes.json();
      if (!checkData.ok) {
        res.status(400).json({ success: false, error: { message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0442\u043E\u043A\u0435\u043D \u0431\u043E\u0442\u0430. Telegram \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044E." } });
        return;
      }
      botUsername = checkData.result?.username || "";
    } catch (e) {
      res.status(400).json({ success: false, error: { message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0442\u043E\u043A\u0435\u043D \u0432 Telegram API: " + e.message } });
      return;
    }
    const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    telegramService.setSettings({
      botToken: trimmedToken,
      managerChatId: trimmedChat,
      botUsername,
      updatedAt
    });
    await logAudit(req, req.user.id, "UPDATE_TELEGRAM_SETTINGS", "system", null, { managerChatId: trimmedChat, botUsername });
    res.json({
      success: true,
      settings: {
        isConfigured: true,
        botToken: trimmedToken,
        managerChatId: trimmedChat,
        botUsername,
        updatedAt
      }
    });
  } catch (err) {
    console.error("[Telegram] Save settings error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A" } });
  }
});
telegramRouter.delete("/settings", requireManager, async (req, res) => {
  try {
    telegramService.clearSettings();
    await logAudit(req, req.user.id, "DISCONNECT_TELEGRAM", "system", null, {});
    res.json({ success: true });
  } catch (err) {
    console.error("[Telegram] Delete settings error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F Telegram" } });
  }
});
telegramRouter.post("/test", requireManager, async (req, res) => {
  try {
    const { botToken, managerChatId } = req.body || {};
    const settings = telegramService.getSettings();
    const token = (botToken || settings.botToken || "").trim();
    const chatId = (managerChatId || settings.managerChatId || "").trim();
    if (!token || !chatId) {
      res.status(400).json({ success: false, error: { message: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D \u0431\u043E\u0442\u0430 \u0438 ID \u0447\u0430\u0442\u0430 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F" } });
      return;
    }
    const nowStr = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(/* @__PURE__ */ new Date());
    const testMsg = `\u{1F7E2} *\u0422\u0435\u0441\u0442\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0438\u0437 \u043F\u0430\u043D\u0435\u043B\u0438 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u041F\u0412\u0417*

\u0418\u043D\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u044F \u0441 Telegram \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0430!
\u23F0 \u0412\u0440\u0435\u043C\u044F \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438: *${nowStr}* (\u041C\u0421\u041A)

\u0421\u044E\u0434\u0430 \u0431\u0443\u0434\u0443\u0442 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u043E \u0432\u044B\u0445\u043E\u0434\u0430\u0445 \u043D\u0430 \u0441\u043C\u0435\u043D\u0443, \u0432\u0435\u0447\u0435\u0440\u043D\u0435\u0439 \u043A\u0430\u0441\u0441\u0435, \u0437\u0430\u044F\u0432\u043A\u0430\u0445 \u0438 \u0431\u0438\u0440\u0436\u0435 \u0441\u043C\u0435\u043D.`;
    const resSend = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMsg,
        parse_mode: "Markdown"
      })
    });
    const dataSend = await resSend.json();
    if (dataSend && dataSend.ok) {
      res.json({ success: true, message: "\u0422\u0435\u0441\u0442\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0432 Telegram!" });
    } else {
      res.status(400).json({
        success: false,
        error: {
          message: dataSend?.description || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438. \u0423\u0431\u0435\u0434\u0438\u0442\u0435\u0441\u044C, \u0447\u0442\u043E \u0432\u044B \u043D\u0430\u0436\u0430\u043B\u0438 START \u0432 \u0434\u0438\u0430\u043B\u043E\u0433\u0435 \u0441 \u0431\u043E\u0442\u043E\u043C \u0438 \u0443\u043A\u0430\u0437\u0430\u043B\u0438 \u0432\u0435\u0440\u043D\u044B\u0439 Chat ID."
        }
      });
    }
  } catch (err) {
    console.error("[Telegram] Test error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438 \u043F\u0440\u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0435 \u0442\u0435\u0441\u0442\u043E\u0432\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" } });
  }
});
telegramRouter.get("/templates", requireManager, async (_req, res) => {
  try {
    const templates = telegramService.getTemplates();
    res.json({ success: true, templates });
  } catch (err) {
    console.error("[Telegram] Get templates error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0448\u0430\u0431\u043B\u043E\u043D\u043E\u0432 Telegram" } });
  }
});
telegramRouter.post("/templates", requireManager, async (req, res) => {
  try {
    const { templates } = req.body || {};
    if (!templates || typeof templates !== "object") {
      res.status(400).json({ success: false, error: { message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0448\u0430\u0431\u043B\u043E\u043D\u043E\u0432" } });
      return;
    }
    telegramService.setTemplates(templates);
    await logAudit(req, req.user.id, "UPDATE_TELEGRAM_TEMPLATES", "system", null, { templateKeys: Object.keys(templates) });
    res.json({ success: true, templates: telegramService.getTemplates() });
  } catch (err) {
    console.error("[Telegram] Save templates error:", err);
    res.status(500).json({ success: false, error: { message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0448\u0430\u0431\u043B\u043E\u043D\u043E\u0432" } });
  }
});

// server/routes/audit.ts
import { Router as Router12 } from "express";
var auditRouter = Router12();
auditRouter.get("/", requireManager, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.user_id, u.name as user_name, a.action, a.entity, a.entity_id, a.ip, a.details, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 100`
    );
    const logs = result.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name || "\u0421\u0438\u0441\u0442\u0435\u043C\u0430",
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      ip: r.ip,
      details: r.details ? JSON.parse(r.details) : null,
      timestamp: r.created_at
    }));
    res.json({ success: true, logs });
  } catch (err) {
    console.error("[Audit] Get logs error:", err);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0436\u0443\u0440\u043D\u0430\u043B\u0430 \u0430\u0443\u0434\u0438\u0442\u0430" } });
  }
});

// server/routes/health.ts
import { Router as Router13 } from "express";
var healthRouter = Router13();
healthRouter.get("/", async (_req, res) => {
  let dbStatus = "ok";
  try {
    await db.query("SELECT 1");
  } catch (err) {
    dbStatus = "error";
  }
  const schedulerStatus = schedulerService.getStatus();
  const telegramStatus = process.env.TELEGRAM_BOT_TOKEN ? "configured" : "not_configured";
  const isHealthy = dbStatus === "ok";
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    database: {
      status: dbStatus,
      engine: db.isUsingPostgres() ? "postgresql" : "sqlite3_relational"
    },
    telegram: {
      status: telegramStatus,
      managerId: process.env.MANAGER_TELEGRAM_ID ? "configured" : "default"
    },
    scheduler: {
      running: schedulerStatus.scheduler.running,
      pid: schedulerStatus.scheduler.pid,
      uptimeSeconds: schedulerStatus.scheduler.uptimeSeconds
    },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
healthRouter.get("/db", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", engine: db.isUsingPostgres() ? "postgresql" : "sqlite3_relational" });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});
healthRouter.get("/telegram", (_req, res) => {
  res.json({
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    managerId: process.env.MANAGER_TELEGRAM_ID || "320314713"
  });
});

// server/routes/swaps.ts
import { Router as Router14 } from "express";
import { v4 as uuidv410 } from "uuid";
var swapsRouter = Router14();
function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return "";
  const clean = dateStr.slice(0, 10);
  const parts = clean.split("-");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}
function getThreeMonthsCutoffDate() {
  const now = /* @__PURE__ */ new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || `${now.getFullYear()}`, 10);
  const month = parseInt(parts.find((p) => p.type === "month")?.value || `${now.getMonth() + 1}`, 10);
  let targetYear = year;
  let targetMonth = month - 3;
  if (targetMonth < 1) {
    targetMonth += 12;
    targetYear -= 1;
  }
  const padMonth = String(targetMonth).padStart(2, "0");
  return `${targetYear}-${padMonth}-01`;
}
function mapRowToSwap(row) {
  return {
    id: row.id,
    date: row.date,
    shiftType: row.shift_type || "standard",
    location: row.location,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    candidateId: row.candidate_id || void 0,
    candidateName: row.candidate_name || void 0,
    reason: row.reason || "",
    status: row.status || "open",
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : void 0,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function getStoredSwaps() {
  const cutoffDate = getThreeMonthsCutoffDate();
  try {
    const countCheck = await db.query("SELECT COUNT(*) as count FROM shift_swaps");
    const rowCount = Number(countCheck.rows[0]?.count || 0);
    if (rowCount === 0) {
      const legacyCheck = await db.query("SELECT value FROM settings WHERE key = $1", ["shift_swaps"]);
      if (legacyCheck.rows.length > 0 && legacyCheck.rows[0].value) {
        try {
          const legacyList = JSON.parse(legacyCheck.rows[0].value);
          if (Array.isArray(legacyList) && legacyList.length > 0) {
            for (const s of legacyList) {
              if (s && s.id && s.date && s.date >= cutoffDate) {
                await db.query(
                  `INSERT INTO shift_swaps (id, date, shift_type, location, requester_id, requester_name, candidate_id, candidate_name, reason, status, resolved_at, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                   ON CONFLICT (id) DO NOTHING`,
                  [
                    s.id,
                    s.date,
                    s.shiftType || "standard",
                    s.location,
                    s.requesterId,
                    s.requesterName,
                    s.candidateId || null,
                    s.candidateName || null,
                    s.reason || null,
                    s.status || "open",
                    s.resolvedAt || null,
                    s.createdAt || (/* @__PURE__ */ new Date()).toISOString()
                  ]
                );
              }
            }
          }
        } catch (mErr) {
          console.warn("[Swaps Migration] Legacy parse warning:", mErr);
        }
      }
    }
    try {
      await db.query("DELETE FROM shift_swaps WHERE date < $1", [cutoffDate]);
    } catch (pruneErr) {
      console.warn("[Swaps Retention] Prune warning:", pruneErr);
    }
    const res = await db.query(
      `SELECT id, date, shift_type, location, requester_id, requester_name, 
              candidate_id, candidate_name, reason, status, resolved_at, created_at
       FROM shift_swaps
       WHERE date >= $1
       ORDER BY date DESC, created_at DESC`,
      [cutoffDate]
    );
    const swaps = res.rows.map(mapRowToSwap);
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      ["shift_swaps", JSON.stringify(swaps)]
    );
    return swaps;
  } catch (e) {
    console.error("[Swaps] Read error from database, attempting fallback:", e);
    try {
      const fallback = await db.query("SELECT value FROM settings WHERE key = $1", ["shift_swaps"]);
      if (fallback.rows.length > 0 && fallback.rows[0].value) {
        const parsed = JSON.parse(fallback.rows[0].value);
        return parsed.filter((s) => s && s.date && s.date >= cutoffDate);
      }
    } catch {
    }
  }
  return [];
}
async function saveSingleSwap(swap) {
  try {
    await db.query(
      `INSERT INTO shift_swaps (id, date, shift_type, location, requester_id, requester_name, candidate_id, candidate_name, reason, status, resolved_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        swap.date,
        swap.shiftType || "standard",
        swap.location,
        swap.requesterId,
        swap.requesterName,
        swap.candidateId || null,
        swap.candidateName || null,
        swap.reason || null,
        swap.status || "open",
        swap.resolvedAt || null,
        swap.createdAt || (/* @__PURE__ */ new Date()).toISOString()
      ]
    );
  } catch (err) {
    console.error("[Swaps DB Save] Error:", err);
  }
}
async function deleteSingleSwap(swapId) {
  try {
    await db.query("DELETE FROM shift_swaps WHERE id = $1", [swapId]);
  } catch (err) {
    console.error("[Swaps DB Delete] Error:", err);
  }
}
swapsRouter.get("/", requireAuth, async (_req, res) => {
  try {
    const swaps = await getStoredSwaps();
    res.json({ success: true, swaps });
  } catch (err) {
    console.error("[Swaps] Get error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0431\u0438\u0440\u0436\u0438 \u0441\u043C\u0435\u043D" });
  }
});
swapsRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { action, swapId, date, shiftType, location, reason } = req.body;
    const user = req.user;
    const swaps = await getStoredSwaps();
    if (action === "claim" && swapId) {
      const idx = swaps.findIndex((s) => s.id === swapId);
      if (idx === -1) {
        res.status(404).json({ success: false, error: "\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u0441\u043C\u0435\u043D\u0443 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
        return;
      }
      if (swaps[idx].status !== "open") {
        res.status(400).json({ success: false, error: "\u042D\u0442\u0430 \u0441\u043C\u0435\u043D\u0430 \u0443\u0436\u0435 \u0437\u0430\u0431\u0440\u0430\u043D\u0430 \u0434\u0440\u0443\u0433\u0438\u043C \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u043C" });
        return;
      }
      swaps[idx].status = "claimed";
      swaps[idx].candidateId = user.id;
      swaps[idx].candidateName = user.name;
      await saveSingleSwap(swaps[idx]);
      const updatedList2 = await getStoredSwaps();
      const formattedDate2 = formatDateDDMMYYYY(swaps[idx].date);
      try {
        await db.query(
          `INSERT INTO notifications (id, user_id, title, text, type, source)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            `notif-${uuidv410()}`,
            swaps[idx].requesterId,
            "\u{1F64B} \u041E\u0442\u043A\u043B\u0438\u043A \u043D\u0430 \u0432\u0430\u0448\u0443 \u0441\u043C\u0435\u043D\u0443!",
            `${user.name} \u043E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F \u043D\u0430 \u0432\u0430\u0448\u0443 \u0441\u043C\u0435\u043D\u0443 ${formattedDate2} (${swaps[idx].location}). \u0417\u0430\u0439\u0434\u0438\u0442\u0435 \u043D\u0430 \u0411\u0438\u0440\u0436\u0443 \u0441\u043C\u0435\u043D, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0435\u043D\u043D\u043E\u0441\u0442\u044C.`,
            "system",
            "system"
          ]
        );
      } catch (nErr) {
        console.error("[Swaps] In-app notification error:", nErr);
      }
      telegramService.sendMessage(
        `\u{1F64B} \u041E\u0442\u043A\u043B\u0438\u043A \u043D\u0430 \u0411\u0438\u0440\u0436\u0435 \u0441\u043C\u0435\u043D!

${user.name} \u043E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F \u043D\u0430 \u0441\u043C\u0435\u043D\u0443 ${formattedDate2} (${swaps[idx].location}).`
      ).catch((err) => console.warn("[Swaps] Telegram notify error:", err));
      res.json({ success: true, swap: swaps[idx], swaps: updatedList2 });
      return;
    }
    if (!date || !location) {
      res.status(400).json({ success: false, error: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0434\u0430\u0442\u0443 \u0438 \u043F\u0443\u043D\u043A\u0442 \u0441\u043C\u0435\u043D\u044B" });
      return;
    }
    const existingActive = swaps.find(
      (s) => s.requesterId === user.id && s.date === date && s.status !== "rejected" && s.status !== "cancelled"
    );
    if (existingActive) {
      const formattedDate2 = formatDateDDMMYYYY(date);
      res.status(400).json({
        success: false,
        error: `\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \u0431\u0438\u0440\u0436\u0435 \u043D\u0430 \u0434\u0430\u0442\u0443 ${formattedDate2}. \u041C\u043E\u0436\u043D\u043E \u0432\u044B\u0441\u0442\u0430\u0432\u043B\u044F\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 \u043E\u0434\u043D\u043E\u0439 \u0441\u043C\u0435\u043D\u044B \u043D\u0430 \u043E\u0434\u043D\u0443 \u0434\u0430\u0442\u0443.`
      });
      return;
    }
    const newSwap = {
      id: `swp-${uuidv410()}`,
      date,
      shiftType: shiftType || "standard",
      location,
      requesterId: user.id,
      requesterName: user.name,
      reason: reason ? String(reason).trim() : "",
      status: "open",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await saveSingleSwap(newSwap);
    const updatedList = await getStoredSwaps();
    const formattedDate = formatDateDDMMYYYY(date);
    try {
      await db.query(
        `INSERT INTO notifications (id, to_all, title, text, type, source)
         VALUES ($1, 1, $2, $3, $4, $5)`,
        [
          `notif-${uuidv410()}`,
          "\u{1F504} \u041D\u043E\u0432\u0430\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u0430\u044F \u0441\u043C\u0435\u043D\u0430 \u043D\u0430 \u0411\u0438\u0440\u0436\u0435!",
          `${user.name} \u0438\u0449\u0435\u0442 \u0437\u0430\u043C\u0435\u043D\u0443 \u043D\u0430 ${formattedDate} (\u043F\u0443\u043D\u043A\u0442 ${location}). \u041A\u0442\u043E \u0433\u043E\u0442\u043E\u0432 \u0432\u044B\u0439\u0442\u0438 \u2014 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0411\u0438\u0440\u0436\u0443 \u0441\u043C\u0435\u043D!`,
          "system",
          "system"
        ]
      );
    } catch (nErr) {
      console.error("[Swaps] Broadcast notification error:", nErr);
    }
    telegramService.sendMessage(
      `\u{1F504} *\u041D\u043E\u0432\u0430\u044F \u0441\u043C\u0435\u043D\u0430 \u043D\u0430 \u0411\u0438\u0440\u0436\u0435 \u0441\u043C\u0435\u043D!*

${user.name} \u0438\u0449\u0435\u0442 \u0437\u0430\u043C\u0435\u043D\u0443 \u043D\u0430 ${formattedDate} (${location}).`
    ).catch((err) => console.warn("[Swaps] Telegram notify error:", err));
    res.json({ success: true, swap: newSwap, swaps: updatedList });
  } catch (err) {
    console.error("[Swaps] Post error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0431\u0438\u0440\u0436\u0438 \u0441\u043C\u0435\u043D" });
  }
});
swapsRouter.patch("/:id", requireAuth, async (req, res) => {
  try {
    const swapId = req.params.id;
    const { action } = req.body;
    const user = req.user;
    const isManager = user.role === "manager";
    const swaps = await getStoredSwaps();
    const idx = swaps.findIndex((s) => s.id === swapId);
    if (idx === -1) {
      res.status(404).json({ success: false, error: "\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
      return;
    }
    const swap = swaps[idx];
    const isInitiator = swap.requesterId === user.id;
    if (!isManager && !isInitiator) {
      res.status(403).json({ success: false, error: "\u0422\u043E\u043B\u044C\u043A\u043E \u0430\u0432\u0442\u043E\u0440 \u0437\u0430\u044F\u0432\u043A\u0438 \u0438\u043B\u0438 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u043C\u043E\u0433\u0443\u0442 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0442\u044C \u0437\u0430\u043C\u0435\u043D\u0443" });
      return;
    }
    const formattedDate = formatDateDDMMYYYY(swap.date);
    if (action === "approve" || action === "confirm") {
      swap.status = "approved";
      swap.resolvedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (swap.candidateId) {
        try {
          await db.query(
            `INSERT INTO notifications (id, user_id, title, text, type, source)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              `notif-${uuidv410()}`,
              swap.candidateId,
              "\u2705 \u0417\u0430\u043C\u0435\u043D\u0430 \u0443\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430! (\u0414\u043E\u0433\u043E\u0432\u043E\u0440\u0438\u043B\u0438\u0441\u044C)",
              `\u041F\u043E\u0434\u043C\u0435\u043D\u0430 \u043D\u0430 \u0441\u043C\u0435\u043D\u0443 ${formattedDate} (${swap.location}) \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430. \u0421\u043C\u0435\u043D\u0430 \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u0430 \u0437\u0430 \u0432\u0430\u043C\u0438.`,
              "system",
              "system"
            ]
          );
        } catch (nErr) {
          console.error("[Swaps] Candidate notification error:", nErr);
        }
        telegramService.sendMessage(
          `\u2705 *\u0417\u0430\u043C\u0435\u043D\u0430 \u0443\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430!*

\u0421\u043C\u0435\u043D\u0430 \u043D\u0430 ${formattedDate} (${swap.location}) \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u0430 \u0437\u0430 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u043C.`
        ).catch((err) => console.warn("[Swaps] Telegram notify error:", err));
      }
    } else if (action === "reject") {
      const previousCandidateId = swap.candidateId;
      swap.candidateId = void 0;
      swap.candidateName = void 0;
      swap.status = "open";
      if (previousCandidateId) {
        telegramService.sendMessage(
          `\u0417\u0430\u043C\u0435\u043D\u0430 \u043D\u0430 ${formattedDate} (${swap.location}) \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430. \u0421\u043C\u0435\u043D\u0430 \u0441\u043D\u043E\u0432\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0430 \u043D\u0430 \u0431\u0438\u0440\u0436\u0435.`
        ).catch((err) => console.warn("[Swaps] Telegram notify error:", err));
      }
    }
    await saveSingleSwap(swap);
    const updatedList = await getStoredSwaps();
    res.json({ success: true, swap, swaps: updatedList });
  } catch (err) {
    console.error("[Swaps] Patch error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0437\u0430\u044F\u0432\u043A\u0438" });
  }
});
swapsRouter.put("/:id", requireAuth, async (req, res) => {
  try {
    const swapId = req.params.id;
    const { date, shiftType, location, reason, status, candidateId, candidateName, requesterId, requesterName } = req.body;
    const user = req.user;
    const isManager = user.role === "manager";
    const swaps = await getStoredSwaps();
    const idx = swaps.findIndex((s) => s.id === swapId);
    if (idx === -1) {
      res.status(404).json({ success: false, error: "\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
      return;
    }
    if (!isManager && swaps[idx].requesterId !== user.id) {
      res.status(403).json({ success: false, error: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u043C\u043E\u0436\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0438\u043B\u0438 \u0435\u0451 \u0441\u043E\u0437\u0434\u0430\u0442\u0435\u043B\u044C" });
      return;
    }
    if (date !== void 0) swaps[idx].date = date;
    if (shiftType !== void 0) swaps[idx].shiftType = shiftType;
    if (location !== void 0) swaps[idx].location = location;
    if (reason !== void 0) swaps[idx].reason = String(reason).trim();
    if (status !== void 0) swaps[idx].status = status;
    if (candidateId !== void 0) swaps[idx].candidateId = candidateId || void 0;
    if (candidateName !== void 0) swaps[idx].candidateName = candidateName || void 0;
    if (requesterId !== void 0) swaps[idx].requesterId = requesterId;
    if (requesterName !== void 0) swaps[idx].requesterName = requesterName;
    if (req.body.clearCandidate || status === "open") {
      swaps[idx].candidateId = void 0;
      swaps[idx].candidateName = void 0;
    }
    await saveSingleSwap(swaps[idx]);
    const updatedList = await getStoredSwaps();
    res.json({ success: true, swap: swaps[idx], swaps: updatedList });
  } catch (err) {
    console.error("[Swaps] Put error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0437\u0430\u044F\u0432\u043A\u0438" });
  }
});
swapsRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    const swapId = req.params.id;
    const user = req.user;
    const isManager = user.role === "manager";
    const swaps = await getStoredSwaps();
    const target = swaps.find((s) => s.id === swapId);
    if (target && !isManager && target.requesterId !== user.id) {
      res.status(403).json({ success: false, error: "\u0412\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u043E\u0442\u043C\u0435\u043D\u044F\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0432\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438" });
      return;
    }
    await deleteSingleSwap(swapId);
    const updatedList = await getStoredSwaps();
    res.json({ success: true, swaps: updatedList });
  } catch (err) {
    console.error("[Swaps] Delete error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u044B \u0437\u0430\u044F\u0432\u043A\u0438" });
  }
});

// server/routes/availability.ts
import { Router as Router15 } from "express";
import { v4 as uuidv411 } from "uuid";
var availabilityRouter = Router15();
async function getStoredAvailability() {
  try {
    const res = await db.query("SELECT value FROM settings WHERE key = $1", ["staff_availability"]);
    if (res.rows.length > 0 && res.rows[0].value) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (e) {
    console.error("[Availability] Read error:", e);
  }
  return [];
}
async function saveStoredAvailability(list) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    ["staff_availability", JSON.stringify(list)]
  );
}
availabilityRouter.get("/", requireAuth, async (_req, res) => {
  try {
    const list = await getStoredAvailability();
    res.json({ success: true, availability: list });
  } catch (err) {
    console.error("[Availability] Get error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u043F\u043E\u0436\u0435\u043B\u0430\u043D\u0438\u0439" });
  }
});
availabilityRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { date, type, comment } = req.body;
    const user = req.user;
    if (!date || !type) {
      res.status(400).json({ success: false, error: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0434\u0430\u0442\u0443 \u0438 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044E \u043F\u043E\u0436\u0435\u043B\u0430\u043D\u0438\u044F" });
      return;
    }
    let list = await getStoredAvailability();
    list = list.filter((a) => !(a.employeeId === user.id && a.date === date));
    const newReq = {
      id: `avail-${uuidv411()}`,
      employeeId: user.id,
      employeeName: user.name,
      date,
      type,
      comment: comment ? String(comment).trim() : "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "pending"
    };
    list.push(newReq);
    await saveStoredAvailability(list);
    res.json({ success: true, availability: list, item: newReq });
  } catch (err) {
    console.error("[Availability] Post error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u043F\u043E\u0436\u0435\u043B\u0430\u043D\u0438\u044F" });
  }
});
availabilityRouter.patch("/:id", requireAuth, async (req, res) => {
  try {
    const availId = req.params.id;
    const { status } = req.body;
    let list = await getStoredAvailability();
    list = list.map((a) => a.id === availId ? { ...a, status: status || "approved" } : a);
    await saveStoredAvailability(list);
    res.json({ success: true, availability: list });
  } catch (err) {
    console.error("[Availability] Patch error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430 \u043F\u043E\u0436\u0435\u043B\u0430\u043D\u0438\u044F" });
  }
});
availabilityRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    const availId = req.params.id;
    let list = await getStoredAvailability();
    list = list.filter((a) => a.id !== availId);
    await saveStoredAvailability(list);
    res.json({ success: true, availability: list });
  } catch (err) {
    console.error("[Availability] Delete error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u043F\u043E\u0436\u0435\u043B\u0430\u043D\u0438\u044F" });
  }
});

// server/routes/schedules.ts
import { Router as Router16 } from "express";
import { v4 as uuidv412 } from "uuid";
var schedulesRouter = Router16();
async function getStoredSchedules() {
  try {
    const res = await db.query("SELECT value FROM settings WHERE key = $1", ["planned_schedules"]);
    if (res.rows.length > 0 && res.rows[0].value) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (e) {
    console.error("[Schedules] Read error:", e);
  }
  return [];
}
async function saveStoredSchedules(schedules) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    ["planned_schedules", JSON.stringify(schedules)]
  );
}
async function getStoredTemplates() {
  try {
    const res = await db.query("SELECT value FROM settings WHERE key = $1", ["schedule_templates"]);
    if (res.rows.length > 0 && res.rows[0].value) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (e) {
    console.error("[Schedule Templates] Read error:", e);
  }
  return [];
}
async function saveStoredTemplates(templates) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    ["schedule_templates", JSON.stringify(templates)]
  );
}
schedulesRouter.get("/", requireAuth, async (_req, res) => {
  try {
    const schedules = await getStoredSchedules();
    res.json({ success: true, schedules });
  } catch (err) {
    console.error("[Schedules] Get error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0433\u0440\u0430\u0444\u0438\u043A\u0430 \u0441\u043C\u0435\u043D" });
  }
});
schedulesRouter.get("/templates", requireAuth, async (_req, res) => {
  try {
    const templates = await getStoredTemplates();
    res.json({ success: true, templates });
  } catch (err) {
    console.error("[Schedule Templates] Get error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0448\u0430\u0431\u043B\u043E\u043D\u043E\u0432" });
  }
});
schedulesRouter.post("/templates", requireAuth, async (req, res) => {
  try {
    const { id, name, location, scenarioType, mainStaffIds, partTimeStaffIds, defaultShiftType, notes } = req.body;
    if (!name || !location || !scenarioType) {
      res.status(400).json({ success: false, error: "\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043F\u043E\u043B\u044F \u0448\u0430\u0431\u043B\u043E\u043D\u0430" });
      return;
    }
    let templates = await getStoredTemplates();
    const templateId = id || `tpl-${uuidv412()}`;
    const newTemplate = {
      id: templateId,
      name: String(name).trim(),
      location: String(location).trim(),
      scenarioType,
      mainStaffIds: Array.isArray(mainStaffIds) ? mainStaffIds : [],
      partTimeStaffIds: Array.isArray(partTimeStaffIds) ? partTimeStaffIds : [],
      defaultShiftType: defaultShiftType || "standard",
      notes: notes ? String(notes).trim() : "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    templates = templates.filter((t) => t.id !== templateId);
    templates.push(newTemplate);
    await saveStoredTemplates(templates);
    res.json({ success: true, templates, template: newTemplate });
  } catch (err) {
    console.error("[Schedule Templates] Save error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0448\u0430\u0431\u043B\u043E\u043D\u0430" });
  }
});
schedulesRouter.delete("/templates/:id", requireAuth, async (req, res) => {
  try {
    const templateId = req.params.id;
    let templates = await getStoredTemplates();
    templates = templates.filter((t) => t.id !== templateId);
    await saveStoredTemplates(templates);
    res.json({ success: true, templates });
  } catch (err) {
    console.error("[Schedule Templates] Delete error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0448\u0430\u0431\u043B\u043E\u043D\u0430" });
  }
});
schedulesRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { batch, replaceMonth, replaceLocation, date, location, employeeId, employeeName, shiftType, note } = req.body;
    let schedules = await getStoredSchedules();
    if (Array.isArray(batch)) {
      if (replaceMonth) {
        schedules = schedules.filter((s) => {
          const matchMonth = s.date.startsWith(replaceMonth);
          const matchLoc = replaceLocation ? s.location === replaceLocation : true;
          return !(matchMonth && matchLoc);
        });
      } else {
        for (const item of batch) {
          schedules = schedules.filter((s) => !(s.date === item.date && s.location === item.location && s.employeeId === item.employeeId));
        }
      }
      for (const item of batch) {
        const conflict = schedules.find(
          (s) => s.employeeId === item.employeeId && s.date === item.date && s.location !== item.location
        );
        if (!conflict) {
          schedules.push({
            ...item,
            id: item.id || `sch-${uuidv412()}`,
            createdAt: item.createdAt || (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
      await saveStoredSchedules(schedules);
      res.json({ success: true, schedules });
      return;
    }
    if (!date || !location || !employeeId) {
      res.status(400).json({ success: false, error: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0434\u0430\u0442\u0443, \u043F\u0443\u043D\u043A\u0442 \u0438 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430" });
      return;
    }
    const conflictShift = schedules.find(
      (s) => s.employeeId === employeeId && s.date === date && s.location !== location
    );
    if (conflictShift) {
      res.status(400).json({
        success: false,
        error: `\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A ${employeeName || "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A"} \u0443\u0436\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D \u043D\u0430 \u0441\u043C\u0435\u043D\u0443 \u0432 \u041F\u0412\u0417 "${conflictShift.location}" \u043D\u0430 ${date}. \u041E\u0434\u0438\u043D \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0432 \u0434\u0432\u0443\u0445 \u041F\u0412\u0417 \u043E\u0434\u043D\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E.`
      });
      return;
    }
    schedules = schedules.filter((s) => !(s.date === date && s.location === location && s.employeeId === employeeId));
    const newShift = {
      id: `sch-${uuidv412()}`,
      date,
      location,
      employeeId,
      employeeName: employeeName || "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A",
      shiftType: shiftType || "standard",
      note: note ? String(note).trim() : "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    schedules.push(newShift);
    await saveStoredSchedules(schedules);
    res.json({ success: true, schedules, item: newShift });
  } catch (err) {
    console.error("[Schedules] Post error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u043F\u043B\u0430\u043D\u043E\u0432\u043E\u0439 \u0441\u043C\u0435\u043D\u044B" });
  }
});
schedulesRouter.post("/slot", requireAuth, async (req, res) => {
  try {
    const { date, location, shifts } = req.body;
    if (!date || !location) {
      res.status(400).json({ success: false, error: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0434\u0430\u0442\u0443 \u0438 \u043F\u0443\u043D\u043A\u0442" });
      return;
    }
    const shiftList = Array.isArray(shifts) ? shifts : [];
    let schedules = await getStoredSchedules();
    for (const sh of shiftList) {
      if (!sh.employeeId) continue;
      const conflict = schedules.find(
        (s) => s.employeeId === sh.employeeId && s.date === date && s.location !== location
      );
      if (conflict) {
        res.status(400).json({
          success: false,
          error: `\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A ${sh.employeeName || "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A"} \u0443\u0436\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D \u043D\u0430 \u0441\u043C\u0435\u043D\u0443 \u0432 \u041F\u0412\u0417 "${conflict.location}" \u043D\u0430 ${date}. \u041E\u0434\u0438\u043D \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0432 \u0434\u0432\u0443\u0445 \u041F\u0412\u0417 \u043E\u0434\u043D\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E.`
        });
        return;
      }
    }
    schedules = schedules.filter((s) => !(s.date === date && s.location === location));
    for (const sh of shiftList) {
      if (!sh.employeeId) continue;
      schedules.push({
        id: sh.id || `sch-${uuidv412()}`,
        date,
        location,
        employeeId: sh.employeeId,
        employeeName: sh.employeeName || "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A",
        shiftType: sh.shiftType || "standard",
        note: sh.note ? String(sh.note).trim() : "",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    await saveStoredSchedules(schedules);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error("[Schedules] Slot save error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0441\u043C\u0435\u043D \u0441\u043B\u043E\u0442\u0430" });
  }
});
schedulesRouter.post("/publish", requireAuth, async (req, res) => {
  try {
    const { month, location, count } = req.body;
    const publishedAt = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const notifRes = await db.query("SELECT value FROM settings WHERE key = $1", ["staff_notifications"]);
      let notifications = [];
      if (notifRes.rows.length > 0 && notifRes.rows[0].value) {
        notifications = JSON.parse(notifRes.rows[0].value);
      }
      const newNotif = {
        id: `notif-${uuidv412()}`,
        toEmployeeId: "all",
        title: `\u{1F4C5} \u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D \u0433\u0440\u0430\u0444\u0438\u043A \u0441\u043C\u0435\u043D ${month ? `\u043D\u0430 ${month}` : ""}`,
        text: `\u0420\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0443\u0442\u0432\u0435\u0440\u0434\u0438\u043B \u0438 \u0440\u0430\u0437\u043E\u0441\u043B\u0430\u043B \u0433\u0440\u0430\u0444\u0438\u043A \u0441\u043C\u0435\u043D${location ? ` \u0434\u043B\u044F \u043F\u0443\u043D\u043A\u0442\u0430 ${location}` : ""}. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0441\u0432\u043E\u0438 \u0437\u0430\u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0441\u043C\u0435\u043D\u044B \u0432 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u0435!`,
        type: "status_update",
        timestamp: publishedAt,
        read: false
      };
      notifications.unshift(newNotif);
      if (notifications.length > 200) notifications = notifications.slice(0, 200);
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        ["staff_notifications", JSON.stringify(notifications)]
      );
    } catch (ne) {
      console.warn("[Schedules] Notification broadcast warning:", ne);
    }
    res.json({ success: true, publishedAt, count });
  } catch (err) {
    console.error("[Schedules] Publish error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438 \u0433\u0440\u0430\u0444\u0438\u043A\u0430" });
  }
});
schedulesRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    const scheduleId = req.params.id;
    let schedules = await getStoredSchedules();
    schedules = schedules.filter((s) => s.id !== scheduleId);
    await saveStoredSchedules(schedules);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error("[Schedules] Delete error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0441\u043C\u0435\u043D\u044B \u0438\u0437 \u0433\u0440\u0430\u0444\u0438\u043A\u0430" });
  }
});

// server/routes/goals.ts
import { Router as Router17 } from "express";
var goalsRouter = Router17();
async function getStoredGoals() {
  try {
    const res = await db.query("SELECT value FROM settings WHERE key = $1", ["income_goals"]);
    if (res.rows.length > 0 && res.rows[0].value) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (e) {
    console.error("[Goals] Read error:", e);
  }
  return [];
}
async function saveStoredGoals(goals) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    ["income_goals", JSON.stringify(goals)]
  );
}
goalsRouter.get("/", requireAuth, async (_req, res) => {
  try {
    const goals = await getStoredGoals();
    res.json({ success: true, goals });
  } catch (err) {
    console.error("[Goals] Get error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0446\u0435\u043B\u0435\u0439 \u0437\u0430\u0440\u0430\u0431\u043E\u0442\u043A\u0430" });
  }
});
goalsRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { employeeId, month, targetAmount } = req.body;
    const user = req.user;
    const targetEmpId = employeeId || user.id;
    if (!month || typeof targetAmount !== "number") {
      res.status(400).json({ success: false, error: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043C\u0435\u0441\u044F\u0446 \u0438 \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u0443\u044E \u0446\u0435\u043B\u044C" });
      return;
    }
    let goals = await getStoredGoals();
    goals = goals.filter((g) => !(g.employeeId === targetEmpId && g.month === month));
    const newGoal = {
      employeeId: targetEmpId,
      month,
      targetAmount
    };
    goals.push(newGoal);
    await saveStoredGoals(goals);
    res.json({ success: true, goals, goal: newGoal });
  } catch (err) {
    console.error("[Goals] Post error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0446\u0435\u043B\u0438" });
  }
});

// server/routes/payback.ts
import { Router as Router18 } from "express";
var paybackRouter = Router18();
var DEFAULT_INCOME_NAMES = [
  "\u0410\u0433\u0435\u043D\u0442\u0441\u043A\u043E\u0435 \u0432\u043E\u0437\u043D\u0430\u0433\u0440\u0430\u0436\u0434\u0435\u043D\u0438\u0435",
  "\u041F\u0440\u043E\u0434\u0430\u0436\u0438 \u0437\u0430 \u0441\u043C\u0435\u043D\u0443 (\u0432\u044B\u0440\u0443\u0447\u043A\u0430)"
];
var DEFAULT_EXPENSE_NAMES = [
  "\u0410\u0440\u0435\u043D\u0434\u0430 \u043F\u043E\u043C\u0435\u0449\u0435\u043D\u0438\u044F",
  "\u0424\u043E\u043D\u0434 \u043E\u043F\u043B\u0430\u0442\u044B \u0442\u0440\u0443\u0434\u0430 (\u0424\u041E\u0422)",
  "\u041A\u043E\u043C\u043C\u0443\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u0438 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442",
  "\u042D\u043A\u0432\u0430\u0439\u0440\u0438\u043D\u0433 \u0438 \u0431\u0430\u043D\u043A\u043E\u0432\u0441\u043A\u043E\u0435 \u043E\u0431\u0441\u043B\u0443\u0436\u0438\u0432\u0430\u043D\u0438\u0435",
  "\u0420\u0430\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0438 (\u043B\u0435\u043D\u0442\u0430, \u0441\u043A\u043E\u0442\u0447, \u043F\u0430\u043A\u0435\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435)",
  "\u041D\u0430\u043B\u043E\u0433\u0438"
];
var DEFAULT_TEMPLATES = {
  incomeArticles: [...DEFAULT_INCOME_NAMES],
  expenseArticles: [...DEFAULT_EXPENSE_NAMES],
  customIncomeArticles: [],
  customExpenseArticles: []
};
async function getStoredRecords() {
  try {
    const res = await db.query("SELECT value FROM settings WHERE key = $1", ["payback_records"]);
    if (res.rows.length > 0 && res.rows[0].value) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (e) {
    console.error("[Payback] Read records error:", e);
  }
  return [];
}
async function saveStoredRecords(records) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    ["payback_records", JSON.stringify(records)]
  );
}
async function getStoredTemplates2() {
  try {
    const res = await db.query("SELECT value FROM settings WHERE key = $1", ["payback_article_templates"]);
    if (res.rows.length > 0 && res.rows[0].value) {
      const parsed = JSON.parse(res.rows[0].value);
      const inc = Array.isArray(parsed.incomeArticles) ? parsed.incomeArticles : Array.from(/* @__PURE__ */ new Set([...DEFAULT_INCOME_NAMES, ...parsed.customIncomeArticles || []]));
      const exp = Array.isArray(parsed.expenseArticles) ? parsed.expenseArticles : Array.from(/* @__PURE__ */ new Set([...DEFAULT_EXPENSE_NAMES, ...parsed.customExpenseArticles || []]));
      return {
        incomeArticles: inc,
        expenseArticles: exp,
        customIncomeArticles: parsed.customIncomeArticles || [],
        customExpenseArticles: parsed.customExpenseArticles || []
      };
    }
  } catch (e) {
    console.error("[Payback] Read templates error:", e);
  }
  return {
    incomeArticles: [...DEFAULT_INCOME_NAMES],
    expenseArticles: [...DEFAULT_EXPENSE_NAMES],
    customIncomeArticles: [],
    customExpenseArticles: []
  };
}
async function saveStoredTemplates2(templates) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    ["payback_article_templates", JSON.stringify(templates)]
  );
}
paybackRouter.get("/", requireAuth, async (_req, res) => {
  try {
    const [records, templates] = await Promise.all([
      getStoredRecords(),
      getStoredTemplates2()
    ]);
    res.json({ success: true, records, templates });
  } catch (err) {
    console.error("[Payback] Get error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0434\u0430\u043D\u043D\u044B\u0445 \u043E\u043A\u0443\u043F\u0430\u0435\u043C\u043E\u0441\u0442\u0438" });
  }
});
paybackRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { record } = req.body;
    if (!record || !record.pvzCode || !record.month) {
      res.status(400).json({ success: false, error: "\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D \u041F\u0412\u0417 \u0438\u043B\u0438 \u043C\u0435\u0441\u044F\u0446" });
      return;
    }
    const targetPvz = String(record.pvzCode).trim();
    const targetMonth = String(record.month).trim();
    const [recordsRaw, templates] = await Promise.all([
      getStoredRecords(),
      getStoredTemplates2()
    ]);
    const records = recordsRaw.filter((r) => !(r.pvzCode === targetPvz && r.month === targetMonth));
    const newRecord = {
      pvzCode: targetPvz,
      month: targetMonth,
      incomes: Array.isArray(record.incomes) ? record.incomes : [],
      expenses: Array.isArray(record.expenses) ? record.expenses : [],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    records.push(newRecord);
    const currentIncomeNames = (newRecord.incomes || []).map((i) => i.name.trim()).filter(Boolean);
    const currentExpenseNames = (newRecord.expenses || []).map((e) => e.name.trim()).filter(Boolean);
    if (currentIncomeNames.length > 0) {
      templates.incomeArticles = currentIncomeNames;
    }
    if (currentExpenseNames.length > 0) {
      templates.expenseArticles = currentExpenseNames;
    }
    await Promise.all([
      saveStoredRecords(records),
      saveStoredTemplates2(templates)
    ]);
    res.json({ success: true, records, templates });
  } catch (err) {
    console.error("[Payback] Save error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0434\u0430\u043D\u043D\u044B\u0445 \u043E\u043A\u0443\u043F\u0430\u0435\u043C\u043E\u0441\u0442\u0438" });
  }
});
paybackRouter.post("/article", requireAuth, async (req, res) => {
  try {
    const { type, action, name, oldName } = req.body;
    if (!type || !action || !name) {
      res.status(400).json({ success: false, error: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0435 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0441\u0442\u0430\u0442\u044C\u0438" });
      return;
    }
    const templates = await getStoredTemplates2();
    let records = await getStoredRecords();
    const isIncome = type === "income";
    let list = isIncome ? templates.incomeArticles || [] : templates.expenseArticles || [];
    if (action === "add") {
      const cleanName = name.trim();
      if (cleanName && !list.includes(cleanName)) {
        list.push(cleanName);
      }
    } else if (action === "edit" && oldName) {
      const cleanOld = oldName.trim();
      const cleanNew = name.trim();
      const idx = list.indexOf(cleanOld);
      if (idx !== -1) {
        list[idx] = cleanNew;
      } else if (!list.includes(cleanNew)) {
        list.push(cleanNew);
      }
      records = records.map((r) => {
        const arr = isIncome ? r.incomes : r.expenses;
        const updatedArr = (arr || []).map((item) => item.name === cleanOld ? { ...item, name: cleanNew } : item);
        return isIncome ? { ...r, incomes: updatedArr } : { ...r, expenses: updatedArr };
      });
      await saveStoredRecords(records);
    } else if (action === "delete") {
      const cleanName = name.trim();
      list = list.filter((n) => n !== cleanName);
      records = records.map((r) => {
        const arr = isIncome ? r.incomes : r.expenses;
        const filtered = (arr || []).filter((item) => item.name !== cleanName);
        return isIncome ? { ...r, incomes: filtered } : { ...r, expenses: filtered };
      });
      await saveStoredRecords(records);
    }
    if (isIncome) {
      templates.incomeArticles = list;
    } else {
      templates.expenseArticles = list;
    }
    await saveStoredTemplates2(templates);
    res.json({ success: true, templates, records });
  } catch (err) {
    console.error("[Payback] Article action error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u044C\u0438" });
  }
});
paybackRouter.delete("/:pvzCode/:month", requireAuth, async (req, res) => {
  try {
    const { pvzCode, month } = req.params;
    let records = await getStoredRecords();
    records = records.filter((r) => !(r.pvzCode === pvzCode && r.month === month));
    await saveStoredRecords(records);
    res.json({ success: true, records });
  } catch (err) {
    console.error("[Payback] Delete error:", err);
    res.status(500).json({ success: false, error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0434\u0430\u043D\u043D\u044B\u0445 \u043E\u043A\u0443\u043F\u0430\u0435\u043C\u043E\u0441\u0442\u0438" });
  }
});

// server.ts
dotenv.config();
var app = express();
var port = Number(process.env.PORT) || 3e3;
var isDev = process.env.NODE_ENV !== "production";
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors *;"
  );
  if (!isDev) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(authenticate);
app.use("/api", csrfProtection);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/staff", staffRouter);
app.use("/api/v1/checkins", checkinsRouter);
app.use(["/api/v1/checkin-alerts", "/api/checkin-alerts"], checkinsRouter);
app.use("/api/v1/sales", salesRouter);
app.use("/api/v1/messages", messagesRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/v1/applications", applicationsRouter);
app.use("/api/v1/rates", ratesRouter);
app.use("/api/v1/locations", locationsRouter);
app.use("/api/v1/swaps", swapsRouter);
app.use("/api/v1/availability", availabilityRouter);
app.use("/api/v1/schedules", schedulesRouter);
app.use(["/api/v1/income-goals", "/api/v1/goals"], goalsRouter);
app.use("/api/v1/payback", paybackRouter);
app.use("/api/v1/bot", botRouter);
app.use("/api/v1/telegram", telegramRouter);
app.use("/api/v1/audit-logs", auditRouter);
app.use("/api/v1/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/staff", staffRouter);
app.use("/api/checkins", checkinsRouter);
app.use("/api/sales", salesRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/rates", ratesRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/swaps", swapsRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/payback", paybackRouter);
app.use("/api/bot", botRouter);
app.use("/api/telegram", telegramRouter);
app.use("/api/audit-logs", auditRouter);
app.use("/api/health", healthRouter);
app.use("/health", healthRouter);
app.get(["/site_beget.zip", "/app_bundle.zip", "/download"], (_req, res) => {
  const zipPath = path2.resolve(process.cwd(), "site_beget.zip");
  if (fs2.existsSync(zipPath)) {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="site_beget.zip"');
    return res.download(zipPath, "site_beget.zip");
  }
  res.status(404).send("Archive file not found");
});
async function bootstrap() {
  try {
    await db.init();
    schedulerService.start();
    if (isDev) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
      app.use("*", async (req, res, next) => {
        if (req.originalUrl.startsWith("/api")) {
          return next();
        }
        try {
          const indexHtmlPath = path2.resolve(process.cwd(), "index.html");
          if (!fs2.existsSync(indexHtmlPath)) {
            return next();
          }
          let template = fs2.readFileSync(indexHtmlPath, "utf-8");
          template = await vite.transformIndexHtml(req.originalUrl, template);
          res.status(200).set({ "Content-Type": "text/html" }).end(template);
        } catch (e) {
          next(e);
        }
      });
    } else {
      const distDir = path2.resolve(process.cwd(), "dist");
      app.use(express.static(distDir));
      app.get("*", (req, res, next) => {
        if (req.originalUrl.startsWith("/api")) {
          return next();
        }
        res.sendFile(path2.join(distDir, "index.html"));
      });
    }
    app.use((err, _req, res, _next) => {
      console.error("[Global Error Handler]:", err);
      const status = err.status || 500;
      const message = isDev ? err.message || "Internal Server Error" : "\u0412\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u044F\u044F \u043E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430";
      res.status(status).json({
        success: false,
        error: {
          code: err.code || "INTERNAL_ERROR",
          message
        }
      });
    });
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`[Server] PVZ CheckBot Full-Stack server running on http://0.0.0.0:${port}`);
    });
    const shutdown = () => {
      console.log("[Server] Gracefully shutting down...");
      schedulerService.stop();
      server.close(() => {
        console.log("[Server] HTTP server closed.");
        process.exit(0);
      });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("[Bootstrap Error]:", err);
    process.exit(1);
  }
}
bootstrap();
