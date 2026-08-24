-- PostgreSQL schema generated from docs/database-schema.md

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code   TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    start_date  DATE,
    published   BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT
);

CREATE TABLE blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     UUID NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    block_code  TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    start_date  DATE
);

CREATE TABLE workouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id        UUID NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
    workout_code    TEXT NOT NULL,
    week_commencing DATE,
    description     TEXT,
    sort_order      INTEGER,
    level           TEXT
);

CREATE TABLE intervals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id      UUID NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
    interval_code   TEXT NOT NULL,
    interval_order  INTEGER NOT NULL,
    repeat_count    INTEGER NOT NULL,
    work_kind       TEXT,
    work_value      INTEGER,
    spm             INTEGER,
    recovery_kind   TEXT,
    recovery_value  REAL,
    target_mode     TEXT,
    target_value    REAL
);

CREATE INDEX idx_blocks_plan_id ON blocks (plan_id);
CREATE INDEX idx_workouts_block_id ON workouts (block_id);
CREATE INDEX idx_intervals_workout_id ON intervals (workout_id);
