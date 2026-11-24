-- Migration 002: Shift Swaps Archive with 3-Month Retention
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

CREATE INDEX IF NOT EXISTS idx_shift_swaps_date ON shift_swaps(date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON shift_swaps(requester_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_candidate ON shift_swaps(candidate_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swaps(status);
