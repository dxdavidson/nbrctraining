CREATE TABLE IF NOT EXISTS strava_tokens (
    device_id UUID PRIMARY KEY,
    athlete_id TEXT NOT NULL,
    athlete_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strava_uploads (
    athlete_id TEXT NOT NULL,
    session_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sending', 'processing', 'uploaded', 'failed', 'uncertain')),
    upload_id TEXT,
    activity_id TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (athlete_id, session_id)
);