-- Adds target stroke rate (spm) column to intervals table
-- Run this in pgAdmin against the existing database

ALTER TABLE intervals
    ADD COLUMN IF NOT EXISTS spm INTEGER;
