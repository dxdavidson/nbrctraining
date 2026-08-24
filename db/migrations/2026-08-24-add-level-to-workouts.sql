-- Adds level column to workouts table
-- Run this in pgAdmin against the existing database

ALTER TABLE workouts
    ADD COLUMN IF NOT EXISTS level TEXT;

-- Column was already created as INTEGER in pgAdmin; convert it to TEXT
ALTER TABLE workouts
    ALTER COLUMN level TYPE TEXT USING level::TEXT;
