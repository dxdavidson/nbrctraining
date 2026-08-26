BEGIN;

ALTER TABLE plans
    ADD CONSTRAINT uq_plans_plan_code UNIQUE (plan_code);

ALTER TABLE blocks
    ADD CONSTRAINT uq_blocks_plan_id_block_code UNIQUE (plan_id, block_code);

ALTER TABLE workouts
    ADD CONSTRAINT uq_workouts_block_id_workout_code UNIQUE (block_id, workout_code);

ALTER TABLE intervals
    ADD CONSTRAINT uq_intervals_workout_id_interval_code UNIQUE (workout_id, interval_code),
    ADD CONSTRAINT uq_intervals_workout_id_interval_order UNIQUE (workout_id, interval_order);

COMMIT;