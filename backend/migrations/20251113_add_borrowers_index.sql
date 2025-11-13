-- Migration: Add borrowers_index table for Borrowers Index Service
-- Created: 2025-11-13
-- Description: Creates the borrowers_index table to store per-reserve borrower tracking

-- Create the borrowers_index table
CREATE TABLE IF NOT EXISTS borrowers_index (
    id SERIAL PRIMARY KEY,
    reserve_asset VARCHAR(42) NOT NULL,
    borrower_address VARCHAR(42) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_borrowers_index_reserve 
    ON borrowers_index(reserve_asset);

CREATE INDEX IF NOT EXISTS idx_borrowers_index_borrower 
    ON borrowers_index(borrower_address);

-- Create unique constraint to prevent duplicate entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_borrowers_index_unique 
    ON borrowers_index(reserve_asset, borrower_address);

-- Add comment to table
COMMENT ON TABLE borrowers_index IS 'Tracks borrowers per reserve for the Borrowers Index Service';
COMMENT ON COLUMN borrowers_index.reserve_asset IS 'Lowercase reserve asset address';
COMMENT ON COLUMN borrowers_index.borrower_address IS 'Lowercase borrower address';
