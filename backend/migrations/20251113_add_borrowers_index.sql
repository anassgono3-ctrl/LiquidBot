-- Migration: Add borrowers_index table for Postgres-backed BorrowersIndexService
-- Date: 2025-11-13
-- Description: Creates a table to track borrowers per reserve for targeted health factor rechecks

-- Create borrowers_index table
CREATE TABLE IF NOT EXISTS borrowers_index (
  id SERIAL PRIMARY KEY,
  reserve_address VARCHAR(66) NOT NULL,
  debt_token_address VARCHAR(66) NOT NULL,
  user_address VARCHAR(66) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (reserve_address, user_address)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_borrowers_reserve 
  ON borrowers_index(reserve_address);

CREATE INDEX IF NOT EXISTS idx_borrowers_user 
  ON borrowers_index(user_address);

CREATE INDEX IF NOT EXISTS idx_borrowers_updated 
  ON borrowers_index(updated_at DESC);

-- Composite index for reserve-based queries with ordering
CREATE INDEX IF NOT EXISTS idx_borrowers_reserve_updated 
  ON borrowers_index(reserve_address, updated_at DESC);

-- Comments for documentation
COMMENT ON TABLE borrowers_index IS 'Tracks borrowers per reserve for targeted health factor rechecks';
COMMENT ON COLUMN borrowers_index.reserve_address IS 'Aave reserve (underlying asset) address';
COMMENT ON COLUMN borrowers_index.debt_token_address IS 'Variable debt token address for the reserve';
COMMENT ON COLUMN borrowers_index.user_address IS 'Borrower wallet address';
COMMENT ON COLUMN borrowers_index.updated_at IS 'Last time this borrower record was updated';
