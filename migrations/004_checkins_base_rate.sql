-- Migration 004: Add base_rate column to checkins table
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS base_rate NUMERIC(10, 2);
