-- Adds published column to blocks table
-- Run this in pgAdmin against the existing database

ALTER TABLE BLOCKS
    ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;
