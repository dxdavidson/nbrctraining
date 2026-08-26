-- Adds long descrtipion column to plans table
-- Run this in pgAdmin against the existing database

ALTER TABLE PLANS
    ADD COLUMN IF NOT EXISTS description TEXT;
