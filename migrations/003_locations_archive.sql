-- Migration 003: Pickup Points (ПВЗ) full archive and metadata columns
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS assigned_staff_ids TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_locations_is_archived ON locations(is_archived);
CREATE INDEX IF NOT EXISTS idx_locations_code ON locations(code);
