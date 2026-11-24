-- Migration 005: SKLADIN Multi-Organization SaaS, Tariffs, Subscriptions & Payments (Non-Destructive)

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

CREATE TABLE IF NOT EXISTS organization_members (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_role VARCHAR(30) NOT NULL DEFAULT 'employee' CHECK (org_role IN ('owner', 'manager', 'employee')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, user_id)
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

-- Extend existing tables non-destructively with organization_id and profile metadata
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(180);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_organization_id VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_privacy_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_terms_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE locations ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE checkin_cancellations ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE bot_logs ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE shift_swaps ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS organization_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_active_org ON users(active_organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_checkins_org_date ON checkins(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_sales_org_date ON sales(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_messages_org ON messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_applications_org ON applications(organization_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_org_date ON shift_swaps(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON payments(provider_payment_id);
