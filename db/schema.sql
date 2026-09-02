-- PostgreSQL schema generated from docs/database-schema.md

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code   TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    start_date  DATE,
    published   BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_plans_plan_code UNIQUE (plan_code)
);

CREATE TABLE blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     UUID NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    block_code  TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    start_date  DATE,
    published   BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_blocks_plan_id_block_code UNIQUE (plan_id, block_code)
);

CREATE TABLE workouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id        UUID NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
    workout_code    TEXT NOT NULL,
    week_commencing DATE,
    description     TEXT,
    sort_order      INTEGER,
    level           TEXT,
    CONSTRAINT uq_workouts_block_id_workout_code UNIQUE (block_id, workout_code)
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
    target_value    REAL,
    CONSTRAINT uq_intervals_workout_id_interval_code UNIQUE (workout_id, interval_code),
    CONSTRAINT uq_intervals_workout_id_interval_order UNIQUE (workout_id, interval_order)
);

CREATE INDEX idx_blocks_plan_id ON blocks (plan_id);
CREATE INDEX idx_workouts_block_id ON workouts (block_id);
CREATE INDEX idx_intervals_workout_id ON intervals (workout_id);

CREATE TABLE concept2_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id         UUID NOT NULL,
    concept2_user_id  TEXT NOT NULL,
    concept2_user_name TEXT,
    access_token      TEXT NOT NULL,
    refresh_token     TEXT NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_concept2_tokens_device_id UNIQUE (device_id)
);
