-- Stores the weight class (H or L) read from the athlete's Concept2 profile.
-- Nullable with no default, so existing rows are untouched and the API falls back to 'H'.
ALTER TABLE concept2_tokens
    ADD COLUMN IF NOT EXISTS weight_class TEXT;