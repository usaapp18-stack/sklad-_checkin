-- SKLADIN PostgreSQL Schema
-- Production Ready Multi-Organization SaaS Relational Database Definition

CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(120) UNIQUE,
    inn VARCHAR(20),
    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    owner_user_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tariffs (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    max_locations INTEGER NOT NULL,
    max_staff INTEGER NOT NULL,
    monthly_price_rub INTEGER NOT NULL,
    features_config TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    radius_meters INTEGER DEFAULT 300,
    qr_secret TEXT,
    zones TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMP WITH TIME ZONE,
    contact_phone VARCHAR(50),
    notes TEXT,
    assigned_staff_ids TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    login VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_plain TEXT,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(180),
    phone VARCHAR(40),
    role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (role IN ('manager', 'employee')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
    active_organization_id VARCHAR(64),
    is_part_time BOOLEAN NOT NULL DEFAULT FALSE,
    is_senior BOOLEAN NOT NULL DEFAULT FALSE,
    telegram_username VARCHAR(100),
    position TEXT,
    pay_type VARCHAR(20) DEFAULT 'hourly',
    hourly_rate REAL DEFAULT 350,
    shift_rate REAL DEFAULT 3500,
    night_rate REAL DEFAULT 0,
    consent_privacy_at TIMESTAMP WITH TIME ZONE,
    consent_terms_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_members (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_role VARCHAR(30) NOT NULL DEFAULT 'employee' CHECK (org_role IN ('owner', 'manager', 'employee')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tariff_id VARCHAR(32) NOT NULL REFERENCES tariffs(id),
    status VARCHAR(32) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'expired_readonly')),
    billing_period_months INTEGER NOT NULL DEFAULT 1,
    trial_started_at TIMESTAMP WITH TIME ZONE,
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    trial_day4_notified_at TIMESTAMP WITH TIME ZONE,
    expired_notified_at TIMESTAMP WITH TIME ZONE,
    selected_tariff_id VARCHAR(32),
    selected_period_months INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_history (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id VARCHAR(64) NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    previous_status VARCHAR(32),
    new_status VARCHAR(32) NOT NULL,
    tariff_id VARCHAR(32) NOT NULL,
    billing_period_months INTEGER NOT NULL DEFAULT 1,
    reason VARCHAR(120) NOT NULL,
    actor_user_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    tariff_id VARCHAR(32) NOT NULL REFERENCES tariffs(id),
    period_months INTEGER NOT NULL DEFAULT 1,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    amount_rub NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(32) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_payment_id VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    confirmation_url TEXT,
    invoice_number VARCHAR(64),
    company_requisites TEXT,
    metadata TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_events (
    id VARCHAR(64) PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    external_event_id VARCHAR(160) UNIQUE NOT NULL,
    payment_id VARCHAR(64) REFERENCES payments(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    payload_json TEXT NOT NULL,
    signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS org_settings (
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, key)
);

CREATE TABLE IF NOT EXISTS contact_leads (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    contact VARCHAR(150) NOT NULL,
    topic VARCHAR(120) NOT NULL,
    message TEXT NOT NULL,
    consent_accepted BOOLEAN NOT NULL DEFAULT TRUE,
    ip VARCHAR(45),
    status VARCHAR(32) NOT NULL DEFAULT 'new',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_locations (
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_id VARCHAR(64) NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, location_id)
);

CREATE TABLE IF NOT EXISTS checkins (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_code VARCHAR(50) NOT NULL,
    shift_type VARCHAR(50) NOT NULL,
    date VARCHAR(10) NOT NULL,
    checked_in_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    check_out_at TEXT,
    worked_hours REAL,
    break_minutes INTEGER DEFAULT 60,
    qr_verified BOOLEAN DEFAULT FALSE,
    geo_verified BOOLEAN DEFAULT FALSE,
    zone TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edit_count INTEGER NOT NULL DEFAULT 0,
    base_rate REAL,
    CONSTRAINT uq_user_date UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS checkin_cancellations (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date VARCHAR(10) NOT NULL,
    cancelled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    checkin_id VARCHAR(64) NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date VARCHAR(10) NOT NULL,
    photo_cash NUMERIC(10,2) NOT NULL DEFAULT 0,
    photo_card NUMERIC(10,2) NOT NULL DEFAULT 0,
    print_cash NUMERIC(10,2) NOT NULL DEFAULT 0,
    print_card NUMERIC(10,2) NOT NULL DEFAULT 0,
    lamination_cash NUMERIC(10,2) NOT NULL DEFAULT 0,
    lamination_card NUMERIC(10,2) NOT NULL DEFAULT 0,
    total NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonus NUMERIC(10,2) NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_checkin_sales UNIQUE (checkin_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    from_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    to_all BOOLEAN NOT NULL DEFAULT FALSE,
    title VARCHAR(255) NOT NULL,
    text TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'system',
    location TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    source VARCHAR(50) DEFAULT 'system',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    name VARCHAR(150) NOT NULL,
    telegram_username VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    note TEXT,
    assigned_login VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_logs (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    action VARCHAR(100) NOT NULL,
    initiated_by VARCHAR(150) NOT NULL,
    status VARCHAR(50) NOT NULL,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
    user_id VARCHAR(64),
    action VARCHAR(100) NOT NULL,
    entity VARCHAR(50) NOT NULL,
    entity_id VARCHAR(64),
    ip VARCHAR(45),
    user_agent TEXT,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shift_swaps (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64),
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for high-performance multi-user & multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
CREATE INDEX IF NOT EXISTS idx_checkins_org_date ON checkins(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_org_date ON sales(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_date ON shift_swaps(date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_org_date ON shift_swaps(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON shift_swaps(requester_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swaps(status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_active_org ON users(active_organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON payments(provider_payment_id);
