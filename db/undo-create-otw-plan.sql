-- Run in pgAdmin against the same database as create-otw-plan.sql.
-- Refuse to delete the plan if other blocks or workouts have been added.
DO $rollback$
DECLARE
    target_plan_id UUID;
BEGIN
    SELECT id INTO target_plan_id
    FROM plans
    WHERE plan_code = 'OTW1' AND title = 'On The Water Workouts'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Plan OTW1 with the expected title was not found.';
    END IF;

    PERFORM 1 FROM blocks WHERE plan_id = target_plan_id FOR UPDATE;

    IF EXISTS (
        SELECT 1
        FROM blocks
        WHERE plan_id = target_plan_id
          AND NOT (
              (block_code = 'DISTANCE' AND title = 'Distance Intervals')
              OR (block_code = 'TIME' AND title = 'Time Intervals')
          )
    ) THEN
        RAISE EXCEPTION 'Plan OTW1 contains other or renamed blocks; nothing was deleted.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM workouts
        JOIN blocks ON blocks.id = workouts.block_id
        WHERE blocks.plan_id = target_plan_id
    ) THEN
        RAISE EXCEPTION 'Plan OTW1 contains workouts; nothing was deleted.';
    END IF;

    DELETE FROM blocks WHERE plan_id = target_plan_id;
    DELETE FROM plans WHERE id = target_plan_id;
    RAISE NOTICE 'Removed plan OTW1 and its blocks.';
END;
$rollback$;
