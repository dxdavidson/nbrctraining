-- Run once in pgAdmin against the target database.
-- The plan and blocks are published so they appear in the app.
WITH new_plan AS (
    INSERT INTO plans (plan_code, title, description, start_date, published)
    VALUES ('OTW1', 'On The Water Workouts', 'On The Water Workouts', CURRENT_DATE, TRUE)
    RETURNING id
)
INSERT INTO blocks (plan_id, block_code, title, published)
SELECT new_plan.id, block.block_code, block.title, TRUE
FROM new_plan
CROSS JOIN (
    VALUES
        ('DISTANCE', 'Distance Intervals'),
        ('TIME', 'Time Intervals')
) AS block (block_code, title)
RETURNING id, plan_id, block_code, title, published;
