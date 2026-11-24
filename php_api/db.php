<?php
if (!defined('PVZ_APP')) {
    http_response_code(403);
    exit('Direct access prohibited.');
}

class AppDb {
    public PDO $pdo;
    public string $driver; // 'sqlite' | 'mysql'

    public function __construct(array $config) {
        $driver = strtolower((string)($config['db_driver'] ?? 'sqlite'));
        if ($driver === 'mysql') {
            $mysql = $config['mysql'] ?? [];
            $host = $mysql['host'] ?? 'localhost';
            $port = (int)($mysql['port'] ?? 3306);
            $dbname = $mysql['dbname'] ?? '';
            $user = $mysql['user'] ?? '';
            $pass = $mysql['password'] ?? '';
            $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4";
            $this->pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $this->driver = 'mysql';
        } else {
            $sqlitePath = (string)($config['sqlite_path'] ?? (__DIR__ . '/../data/skladin.sqlite'));
            $dir = dirname($sqlitePath);
            if (!is_dir($dir)) {
                mkdir($dir, 0750, true);
            }
            $htaccessFile = $dir . '/.htaccess';
            if (!file_exists($htaccessFile)) {
                @file_put_contents($htaccessFile, "Require all denied\nDeny from all\n");
            }
            $this->pdo = new PDO('sqlite:' . $sqlitePath, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            $this->driver = 'sqlite';
            $this->pdo->exec('PRAGMA busy_timeout = 5000;');
            $this->pdo->exec('PRAGMA foreign_keys = ON;');
            $this->pdo->exec('PRAGMA journal_mode = WAL;');
            $this->pdo->exec('PRAGMA synchronous = NORMAL;');
        }
    }

    public function qi(string $ident): string {
        return $this->driver === 'mysql' ? "`{$ident}`" : "\"{$ident}\"";
    }

    public function queryAll(string $sql, array $params = []): array {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($this->normalizeParams($params));
        return $stmt->fetchAll();
    }

    public function queryOne(string $sql, array $params = []): ?array {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($this->normalizeParams($params));
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function execute(string $sql, array $params = []): int {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($this->normalizeParams($params));
        return $stmt->rowCount();
    }

    public function transaction(callable $fn) {
        $this->pdo->beginTransaction();
        try {
            $res = $fn($this);
            $this->pdo->commit();
            return $res;
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    public function upsert(string $table, array $data, array $conflictCols, array $updateCols = []): void {
        $cols = array_keys($data);
        $quotedCols = array_map(fn($c) => $this->qi($c), $cols);
        $placeholders = implode(', ', array_fill(0, count($cols), '?'));
        $colList = implode(', ', $quotedCols);

        if (empty($updateCols)) {
            $updateCols = array_values(array_diff($cols, $conflictCols));
        }

        if ($this->driver === 'mysql') {
            if (empty($updateCols)) {
                $sql = "INSERT IGNORE INTO {$this->qi($table)} ({$colList}) VALUES ({$placeholders})";
            } else {
                $sets = array_map(fn($c) => "{$this->qi($c)} = VALUES({$this->qi($c)})", $updateCols);
                $sql = "INSERT INTO {$this->qi($table)} ({$colList}) VALUES ({$placeholders}) ON DUPLICATE KEY UPDATE " . implode(', ', $sets);
            }
        } else {
            $conflictList = implode(', ', array_map(fn($c) => $this->qi($c), $conflictCols));
            if (empty($updateCols)) {
                $sql = "INSERT INTO {$this->qi($table)} ({$colList}) VALUES ({$placeholders}) ON CONFLICT ({$conflictList}) DO NOTHING";
            } else {
                $sets = array_map(fn($c) => "{$this->qi($c)} = excluded.{$this->qi($c)}", $updateCols);
                $sql = "INSERT INTO {$this->qi($table)} ({$colList}) VALUES ({$placeholders}) ON CONFLICT ({$conflictList}) DO UPDATE SET " . implode(', ', $sets);
            }
        }

        $this->execute($sql, array_values($data));
    }

    private function normalizeParams(array $params): array {
        return array_map(function ($p) {
            if (is_bool($p)) return $p ? 1 : 0;
            return $p;
        }, $params);
    }

    public function initSchemaAndSeed(array $config): void {
        if ($this->driver === 'mysql') {
            $this->initMysqlSchema();
        } else {
            $this->initSqliteSchema();
        }
        $this->seedTariffs();
        $this->seedOptionalAdmin($config);
    }

    private function initSqliteSchema(): void {
        $this->pdo->exec("
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
            CREATE TABLE IF NOT EXISTS locations (
                id TEXT PRIMARY KEY,
                organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                address TEXT,
                latitude REAL,
                longitude REAL,
                radius_meters INTEGER DEFAULT 300,
                qr_secret TEXT,
                zones TEXT,
                active INTEGER DEFAULT 1,
                is_archived INTEGER DEFAULT 0,
                archived_at TEXT,
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
                password_plain TEXT,
                name TEXT NOT NULL,
                email TEXT,
                phone TEXT,
                role TEXT NOT NULL DEFAULT 'employee',
                status TEXT NOT NULL DEFAULT 'active',
                active_organization_id TEXT,
                is_part_time INTEGER DEFAULT 0,
                is_senior INTEGER DEFAULT 0,
                telegram_username TEXT,
                position TEXT,
                pay_type TEXT DEFAULT 'hourly',
                hourly_rate REAL DEFAULT 350,
                shift_rate REAL DEFAULT 3500,
                night_rate REAL DEFAULT 0,
                consent_privacy_at TEXT,
                consent_terms_at TEXT,
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
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
            CREATE TABLE IF NOT EXISTS user_locations (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, location_id)
            );
            CREATE TABLE IF NOT EXISTS checkins (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                location_code TEXT NOT NULL,
                shift_type TEXT NOT NULL DEFAULT 'day12',
                date TEXT NOT NULL,
                checked_in_at TEXT,
                check_out_at TEXT,
                worked_hours REAL,
                break_minutes INTEGER DEFAULT 60,
                qr_verified INTEGER DEFAULT 0,
                geo_verified INTEGER DEFAULT 0,
                zone TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                edit_count INTEGER DEFAULT 0,
                base_rate REAL,
                UNIQUE (user_id, date)
            );
            CREATE TABLE IF NOT EXISTS checkin_cancellations (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                cancelled_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sales (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                checkin_id TEXT UNIQUE NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                photo_cash REAL DEFAULT 0,
                photo_card REAL DEFAULT 0,
                print_cash REAL DEFAULT 0,
                print_card REAL DEFAULT 0,
                lamination_cash REAL DEFAULT 0,
                lamination_card REAL DEFAULT 0,
                total REAL NOT NULL DEFAULT 0,
                bonus REAL NOT NULL DEFAULT 0,
                submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                to_all INTEGER DEFAULT 0,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'system',
                location TEXT,
                source TEXT DEFAULT 'system',
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS applications (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
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
                organization_id TEXT,
                action TEXT NOT NULL,
                initiated_by TEXT NOT NULL,
                status TEXT NOT NULL,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                user_id TEXT,
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
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scheduled_notifications (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                schedule_type TEXT NOT NULL,
                time_of_day TEXT NOT NULL,
                target_role TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS shift_swaps (
                id TEXT PRIMARY KEY,
                organization_id TEXT,
                date TEXT NOT NULL,
                shift_type TEXT NOT NULL DEFAULT 'day12',
                location TEXT NOT NULL,
                requester_id TEXT NOT NULL,
                requester_name TEXT NOT NULL,
                candidate_id TEXT,
                candidate_name TEXT,
                reason TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                resolved_at TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS rate_limits (
                bucket_key TEXT PRIMARY KEY,
                count INTEGER NOT NULL DEFAULT 1,
                reset_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_checkins_org_date ON checkins(organization_id, date);
            CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
            CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organization_id);
            CREATE INDEX IF NOT EXISTS idx_shift_swaps_org_date ON shift_swaps(organization_id, date);
        ");
    }

    private function initMysqlSchema(): void {
        $statements = [
            "CREATE TABLE IF NOT EXISTS `organizations` (
                `id` VARCHAR(64) PRIMARY KEY,
                `name` VARCHAR(150) NOT NULL,
                `slug` VARCHAR(120) UNIQUE,
                `inn` VARCHAR(20),
                `timezone` VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
                `owner_user_id` VARCHAR(64),
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `tariffs` (
                `id` VARCHAR(32) PRIMARY KEY,
                `name` VARCHAR(80) NOT NULL,
                `max_locations` INT NOT NULL,
                `max_staff` INT NOT NULL,
                `monthly_price_rub` INT NOT NULL,
                `features_config` TEXT,
                `is_active` TINYINT(1) NOT NULL DEFAULT 1,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `locations` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `code` VARCHAR(50) NOT NULL,
                `name` VARCHAR(100) NOT NULL,
                `address` TEXT,
                `latitude` DOUBLE,
                `longitude` DOUBLE,
                `radius_meters` INT DEFAULT 300,
                `qr_secret` TEXT,
                `zones` TEXT,
                `active` TINYINT(1) DEFAULT 1,
                `is_archived` TINYINT(1) DEFAULT 0,
                `archived_at` VARCHAR(64),
                `contact_phone` VARCHAR(50),
                `notes` TEXT,
                `assigned_staff_ids` TEXT,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX `idx_loc_org` (`organization_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `users` (
                `id` VARCHAR(64) PRIMARY KEY,
                `login` VARCHAR(100) UNIQUE NOT NULL,
                `password_hash` VARCHAR(255) NOT NULL,
                `password_plain` TEXT,
                `name` VARCHAR(150) NOT NULL,
                `email` VARCHAR(180),
                `phone` VARCHAR(40),
                `role` VARCHAR(20) NOT NULL DEFAULT 'employee',
                `status` VARCHAR(20) NOT NULL DEFAULT 'active',
                `active_organization_id` VARCHAR(64),
                `is_part_time` TINYINT(1) DEFAULT 0,
                `is_senior` TINYINT(1) DEFAULT 0,
                `telegram_username` VARCHAR(100),
                `position` TEXT,
                `pay_type` VARCHAR(20) DEFAULT 'hourly',
                `hourly_rate` DOUBLE DEFAULT 350,
                `shift_rate` DOUBLE DEFAULT 3500,
                `night_rate` DOUBLE DEFAULT 0,
                `consent_privacy_at` VARCHAR(64),
                `consent_terms_at` VARCHAR(64),
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX `idx_users_org` (`active_organization_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `organization_members` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64) NOT NULL,
                `user_id` VARCHAR(64) NOT NULL,
                `org_role` VARCHAR(30) NOT NULL DEFAULT 'employee',
                `status` VARCHAR(20) NOT NULL DEFAULT 'active',
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY `uq_org_user` (`organization_id`, `user_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `subscriptions` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64) UNIQUE NOT NULL,
                `tariff_id` VARCHAR(32) NOT NULL,
                `status` VARCHAR(32) NOT NULL DEFAULT 'trial',
                `billing_period_months` INT NOT NULL DEFAULT 1,
                `trial_started_at` VARCHAR(64),
                `trial_ends_at` VARCHAR(64),
                `current_period_start` VARCHAR(64),
                `current_period_end` VARCHAR(64),
                `trial_day4_notified_at` VARCHAR(64),
                `expired_notified_at` VARCHAR(64),
                `selected_tariff_id` VARCHAR(32),
                `selected_period_months` INT DEFAULT 1,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `subscription_history` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64) NOT NULL,
                `subscription_id` VARCHAR(64) NOT NULL,
                `previous_status` VARCHAR(32),
                `new_status` VARCHAR(32) NOT NULL,
                `tariff_id` VARCHAR(32) NOT NULL,
                `billing_period_months` INT NOT NULL DEFAULT 1,
                `reason` VARCHAR(120) NOT NULL,
                `actor_user_id` VARCHAR(64),
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `payments` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64) NOT NULL,
                `user_id` VARCHAR(64),
                `tariff_id` VARCHAR(32) NOT NULL,
                `period_months` INT NOT NULL DEFAULT 1,
                `discount_percent` INT NOT NULL DEFAULT 0,
                `amount_rub` DECIMAL(12,2) NOT NULL,
                `payment_method` VARCHAR(32) NOT NULL,
                `provider` VARCHAR(32) NOT NULL,
                `provider_payment_id` VARCHAR(128),
                `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
                `confirmation_url` TEXT,
                `invoice_number` VARCHAR(64),
                `company_requisites` TEXT,
                `metadata` TEXT,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `paid_at` VARCHAR(64),
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `payment_events` (
                `id` VARCHAR(64) PRIMARY KEY,
                `provider` VARCHAR(32) NOT NULL,
                `external_event_id` VARCHAR(160) UNIQUE NOT NULL,
                `payment_id` VARCHAR(64),
                `event_type` VARCHAR(80) NOT NULL,
                `payload_json` LONGTEXT NOT NULL,
                `signature_valid` TINYINT(1) NOT NULL DEFAULT 0,
                `processed_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `org_settings` (
                `organization_id` VARCHAR(64) NOT NULL,
                `key` VARCHAR(100) NOT NULL,
                `value` LONGTEXT NOT NULL,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`organization_id`, `key`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `settings` (
                `key` VARCHAR(100) PRIMARY KEY,
                `value` LONGTEXT NOT NULL,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `contact_leads` (
                `id` VARCHAR(64) PRIMARY KEY,
                `name` VARCHAR(150) NOT NULL,
                `contact` VARCHAR(150) NOT NULL,
                `topic` VARCHAR(120) NOT NULL,
                `message` TEXT NOT NULL,
                `consent_accepted` TINYINT(1) NOT NULL DEFAULT 1,
                `ip` VARCHAR(45),
                `status` VARCHAR(32) NOT NULL DEFAULT 'new',
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `user_locations` (
                `user_id` VARCHAR(64) NOT NULL,
                `location_id` VARCHAR(64) NOT NULL,
                PRIMARY KEY (`user_id`, `location_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `checkins` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `user_id` VARCHAR(64) NOT NULL,
                `location_code` VARCHAR(50) NOT NULL,
                `shift_type` VARCHAR(50) NOT NULL DEFAULT 'day12',
                `date` VARCHAR(10) NOT NULL,
                `checked_in_at` VARCHAR(64),
                `check_out_at` VARCHAR(64),
                `worked_hours` DOUBLE,
                `break_minutes` INT DEFAULT 60,
                `qr_verified` TINYINT(1) DEFAULT 0,
                `geo_verified` TINYINT(1) DEFAULT 0,
                `zone` TEXT,
                `notes` TEXT,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `edit_count` INT DEFAULT 0,
                `base_rate` DOUBLE,
                UNIQUE KEY `uq_user_date` (`user_id`, `date`),
                INDEX `idx_chk_org_date` (`organization_id`, `date`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `checkin_cancellations` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `user_id` VARCHAR(64) NOT NULL,
                `date` VARCHAR(10) NOT NULL,
                `cancelled_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `sales` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `checkin_id` VARCHAR(64) UNIQUE NOT NULL,
                `user_id` VARCHAR(64) NOT NULL,
                `date` VARCHAR(10) NOT NULL,
                `photo_cash` DECIMAL(10,2) DEFAULT 0,
                `photo_card` DECIMAL(10,2) DEFAULT 0,
                `print_cash` DECIMAL(10,2) DEFAULT 0,
                `print_card` DECIMAL(10,2) DEFAULT 0,
                `lamination_cash` DECIMAL(10,2) DEFAULT 0,
                `lamination_card` DECIMAL(10,2) DEFAULT 0,
                `total` DECIMAL(10,2) NOT NULL DEFAULT 0,
                `bonus` DECIMAL(10,2) NOT NULL DEFAULT 0,
                `submitted_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `messages` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `from_user_id` VARCHAR(64) NOT NULL,
                `message` TEXT NOT NULL,
                `is_read` TINYINT(1) DEFAULT 0,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `notifications` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `user_id` VARCHAR(64),
                `to_all` TINYINT(1) DEFAULT 0,
                `title` VARCHAR(255) NOT NULL,
                `text` TEXT NOT NULL,
                `type` VARCHAR(50) NOT NULL DEFAULT 'system',
                `location` TEXT,
                `source` VARCHAR(50) DEFAULT 'system',
                `is_read` TINYINT(1) DEFAULT 0,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `applications` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `name` VARCHAR(150) NOT NULL,
                `telegram_username` VARCHAR(100),
                `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
                `note` TEXT,
                `assigned_login` VARCHAR(100),
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `bot_logs` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `action` VARCHAR(100) NOT NULL,
                `initiated_by` VARCHAR(150) NOT NULL,
                `status` VARCHAR(50) NOT NULL,
                `details` TEXT,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `audit_logs` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `user_id` VARCHAR(64),
                `action` VARCHAR(100) NOT NULL,
                `entity` VARCHAR(50) NOT NULL,
                `entity_id` VARCHAR(64),
                `ip` VARCHAR(45),
                `user_agent` TEXT,
                `details` TEXT,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `sessions` (
                `id` VARCHAR(64) PRIMARY KEY,
                `user_id` VARCHAR(64) NOT NULL,
                `token_hash` VARCHAR(191) UNIQUE NOT NULL,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `expires_at` VARCHAR(64) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `scheduled_notifications` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `title` VARCHAR(255) NOT NULL,
                `text` TEXT NOT NULL,
                `schedule_type` VARCHAR(20) NOT NULL,
                `time_of_day` VARCHAR(5) NOT NULL,
                `target_role` VARCHAR(50) NOT NULL,
                `is_active` TINYINT(1) NOT NULL DEFAULT 1,
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `shift_swaps` (
                `id` VARCHAR(64) PRIMARY KEY,
                `organization_id` VARCHAR(64),
                `date` VARCHAR(10) NOT NULL,
                `shift_type` VARCHAR(30) NOT NULL DEFAULT 'day12',
                `location` VARCHAR(30) NOT NULL,
                `requester_id` VARCHAR(64) NOT NULL,
                `requester_name` VARCHAR(100) NOT NULL,
                `candidate_id` VARCHAR(64),
                `candidate_name` VARCHAR(100),
                `reason` TEXT,
                `status` VARCHAR(30) NOT NULL DEFAULT 'open',
                `resolved_at` VARCHAR(64),
                `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS `rate_limits` (
                `bucket_key` VARCHAR(120) PRIMARY KEY,
                `count` INT NOT NULL DEFAULT 1,
                `reset_at` BIGINT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        ];
        foreach ($statements as $sql) {
            $this->pdo->exec($sql);
        }
    }

    private function seedTariffs(): void {
        foreach (getTariffPlans() as $plan) {
            $this->upsert('tariffs', [
                'id' => $plan['id'],
                'name' => $plan['name'],
                'max_locations' => $plan['maxLocations'],
                'max_staff' => $plan['maxStaff'],
                'monthly_price_rub' => $plan['monthlyPriceRub'],
                'features_config' => json_encode(['subtitle' => $plan['subtitle']], JSON_UNESCAPED_UNICODE),
                'is_active' => 1,
            ], ['id']);
        }
    }

    private function seedOptionalAdmin(array $config): void {
        $initialPw = trim((string)($config['initial_admin_password'] ?? ''));
        if ($initialPw === '') {
            return;
        }
        $existing = $this->queryOne('SELECT id FROM users WHERE role = ?', ['manager']);
        if (!$existing) {
            $adminId = 'usr-admin-manager';
            $hash = password_hash($initialPw, PASSWORD_BCRYPT, ['cost' => 10]);
            $this->execute(
                'INSERT INTO users (id, login, password_hash, name, role, status, is_part_time, telegram_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$adminId, '+79266137222', $hash, 'Начальник склада (Admin)', 'manager', 'active', 0, '']
            );
            $orgId = 'org-default';
            $orgExists = $this->queryOne('SELECT id FROM organizations WHERE id = ?', [$orgId]);
            if (!$orgExists) {
                $this->execute(
                    'INSERT INTO organizations (id, name, slug, timezone, owner_user_id) VALUES (?, ?, ?, ?, ?)',
                    [$orgId, 'SKLADIN Основная организация', 'default', 'Europe/Moscow', $adminId]
                );
                $this->execute(
                    'UPDATE users SET active_organization_id = ? WHERE id = ?',
                    [$orgId, $adminId]
                );
                $this->upsert('organization_members', [
                    'id' => 'mem-' . uuidv4(),
                    'organization_id' => $orgId,
                    'user_id' => $adminId,
                    'org_role' => 'owner',
                    'status' => 'active',
                ], ['organization_id', 'user_id']);
                $yearLater = (new DateTimeImmutable('+365 days', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.000\Z');
                $this->execute(
                    'INSERT INTO subscriptions (id, organization_id, tariff_id, status, billing_period_months, current_period_start, current_period_end, selected_tariff_id, selected_period_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    ['sub-' . uuidv4(), $orgId, 'maximum', 'active', 12, nowIso(), $yearLater, 'maximum', 12]
                );
            }
        }
    }
}
