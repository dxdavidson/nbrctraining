-- Stores per-device OAuth tokens for Concept2 Logbook uploads
-- Run this in pgAdmin against the existing database

CREATE TABLE IF NOT EXISTS concept2_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id         UUID NOT NULL,
    concept2_user_id  TEXT NOT NULL,
    access_token      TEXT NOT NULL,
    refresh_token     TEXT NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_concept2_tokens_device_id UNIQUE (device_id)
);
