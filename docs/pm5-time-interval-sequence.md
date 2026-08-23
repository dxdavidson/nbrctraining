# PM5 time-interval send sequence

This note captures the correct PM5 command sequence for a time-based interval such as 5:00.

## Correct sequence

For an interval with:
- work_kind = time
- work_value = 300
- recovery_kind = time
- recovery_value = 120
- target_mode = null or not used

The app sends:

1. `setWorkoutType({ value: 6 })` (`fixedTimeInterval`)
2. `setWorkoutDuration({ value: 30000, durationType: 0x00 })` (hundredths of a second)
3. `setRestDuration({ value: 120 })`
4. `setConfigureWorkout({ programmingMode: true })`
5. `setScreenState({ screenType: 1, value: 1 })`

## Validated result

- Never send `setTargetPaceTime(...)` for a fixed-time interval.
- Real PM5 testing confirmed both distance and time workouts work with their respective sequences.

## Why this matters

The `fixedTimeInterval` workout type tells the PM5 how to interpret the duration. The `target pace` command is used only for distance-based intervals.
