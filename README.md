# NBRC Training

NBRC Training is a React and TypeScript application for browsing rowing training plans and sending workouts to a PM5 ergometer. The frontend is served by Vite and reads plan data from the Express API backed by PostgreSQL.

## Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL, either locally or through a hosted instance

## Installation

From the repository root, install the frontend dependencies:

```powershell
npm install
```

Install the API dependencies separately:

```powershell
cd server
npm install
cd ..
```

Create a `.env` file in the repository root. It must contain a PostgreSQL connection string:

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/nbrctraining
IMPORT_TOKEN=replace-with-a-long-random-value
```

The included schema can be applied to an empty database with `psql` (replace the connection string with the value used in `.env`):

```powershell
psql "postgresql://user:password@localhost:5432/nbrctraining" -f db/schema.sql
```

The API currently expects the database tables to contain plan, block, workout, and interval data. The schema creates the tables but does not add seed data.

## Navigation

The default **Rowing Plans** page is available at `/`. The main navigation also includes placeholders for `/ramp-test` and `/round-robin-ergos`, ready for their respective features. The **Admin** menu contains the workout importer.

## CSV workout import

The importer is available from **Admin → Import Workouts** at `/admin/import`. Configure a long random `IMPORT_TOKEN` in the server environment before using it; the import API rejects requests without that token.

The importer accepts the flat CSV format stored in `data/imports/workouts/`, with one row per interval and repeated workout columns. Plans and blocks must already exist, identified by `plan_code` and `block_code`. The server creates each workout and then its intervals in one PostgreSQL transaction.

Successful imports are shown in the **Imported workouts** section of the admin page. This log is held in browser memory only; it is cleared when the page is refreshed or closed. Dry runs are not recorded.

Use **Analyse CSV** first. This performs the complete import inside a transaction and rolls it back. If **Delete existing workouts for CSV blocks before import** is checked, analysis reports how many existing workouts in the CSV-referenced blocks would be deleted. Uncheck **Analyse only (dry run)** only after analysis succeeds. Deletion is limited to the referenced `(plan_code, block_code)` pairs; other blocks are not affected. The endpoint is `POST /api/admin/import/workouts?dry_run=true` and expects the CSV as `text/csv` with the token in the `X-Import-Token` header. Add `delete_existing_blocks=true` to enable the scoped deletion option.

## Run Locally

Start the API in one terminal from the repository root:

```powershell
cd server
npm run dev
```

Start the frontend in a second terminal from the repository root:

```powershell
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The API listens on `http://localhost:4000` by default.

To use a different API URL, add this optional variable to the root `.env` before starting Vite:

```dotenv
VITE_API_BASE_URL=http://localhost:4000
```

The API port can be changed with `PORT`. For a deployed frontend, set `CLIENT_ORIGIN` on the API to the allowed frontend origin or comma-separated origins.

For a production-style local run, build the frontend and serve the generated files with Vite preview:

```powershell
npm run build
npm run preview
```

The API can be started without file watching with:

```powershell
cd server
npm start
```

## Deploying to https://nbrowingclub.com/training

This application has three separate parts:

- **Frontend:** the static files deployed to `https://nbrowingclub.com/training`.
- **API:** the Express application in `server/`, deployed as a Railway service. It provides `/api/plans`, `/api/blocks`, `/api/workouts`, and `/api/intervals`.
- **Database:** the PostgreSQL Railway service used by the API. Its `DATABASE_URL` is a private server-side setting and is never used by the browser.

`vite.config.ts` reads a `BASE_PATH` environment variable at build time (defaulting to `/`) to control the frontend's asset URLs, routing, and PWA manifest.

### Configure the Railway API

In Railway, open the service that runs the Express app, rather than the PostgreSQL service. Under **Settings > Networking > Public Networking**, copy its public domain, for example `https://your-server-production.up.railway.app`.

Set these variables on the Railway Express service:

```dotenv
DATABASE_URL=<the Railway PostgreSQL connection URL>
IMPORT_TOKEN=<a long random secret>
CLIENT_ORIGIN=https://nbrowingclub.com
```

### Configure Concept2 Logbook OAuth

To enable Logbook uploads, add these variables to the Railway Express service. The client ID and secret are from the Concept2 developer key configuration.

```dotenv
CONCEPT2_CLIENT_ID=<Concept2 API key>
CONCEPT2_CLIENT_SECRET=<Concept2 API secret>
CONCEPT2_LOGBOOK_ENVIRONMENT=development
CONCEPT2_REDIRECT_URI=https://your-server-production.up.railway.app/auth/concept2/callback
CONCEPT2_FRONTEND_URL=https://nbrowingclub.com/training
```

Use `CONCEPT2_LOGBOOK_ENVIRONMENT=development` while testing result uploads. This is the default when unset and uses `https://log-dev.concept2.com` for authorization, tokens, and API calls. Use `production` only after Concept2 has approved live Logbook writes; it uses `https://log.concept2.com`.

Register the matching API key and callback endpoint on the selected Concept2 environment: `https://log-dev.concept2.com/developers/keys` for development or `https://log.concept2.com/developers/keys` for production. Set the Callback endpoint to the exact same URL as `CONCEPT2_REDIRECT_URI`:

```text
https://your-server-production.up.railway.app/auth/concept2/callback
```

The callback endpoint is the Railway API URL, not the training frontend URL. The values must match exactly, including the `https` scheme and path. After changing `CONCEPT2_LOGBOOK_ENVIRONMENT`, connect the Logbook account again so the app obtains a token for that environment.

Create `.env.production` in the repository root and set the public API domain. This is the domain the browser calls for plan data; do not use the Railway PostgreSQL hostname or add `/training` to it:

```dotenv
VITE_API_BASE_URL=https://your-server-production.up.railway.app
```

Build for the `/training` sub-path:

```powershell
$env:BASE_PATH='/training/'; npm run build
```

Upload the contents of `dist/` to the `/training` path on the host. The host must be configured to serve `index.html` for any unmatched path under `/training` (SPA fallback), since routes like `/training/plans/:id` are handled client-side.

After deployment, load `https://nbrowingclub.com/training` and confirm plan data loads. The browser should request it from `https://your-server-production.up.railway.app/api/...`.

The Netlify deployment is unaffected: its build runs `npm run build` without `BASE_PATH` set, so it keeps using `/` as the base and continues serving from the domain root.

## Test and Validate

Run the automated frontend tests once:

```powershell
npm test
```

Run Vitest in watch mode while developing:

```powershell
npm test -- --watch
```

Run the TypeScript production build:

```powershell
npm run build
```

Run ESLint across the frontend project:

```powershell
npm run lint
```

The test suite uses Vitest with a `jsdom` environment and Testing Library. Tests are located alongside the relevant source files in `src/`.

## PM5 time-interval protocol

For a standalone time-based workout such as 5:00 (300 seconds), the app follows ErgometerJS's fixed-time interval example. When a workout contains multiple intervals, the app uses ErgometerJS's variable-interval sequence instead, including time intervals as `intervalType=time` entries.

**Sequence for a 5-minute time interval with 2-minute rest:**

1. `setWorkoutType({ value: 6 })` (`fixedTimeInterval`)
2. `setWorkoutDuration({ value: 30000, durationType: 0x00 })`
3. `setRestDuration({ value: 120 })`
4. `setConfigureWorkout({ programmingMode: true })`
5. `setScreenState({ screenType: 1, value: 1 })`

**Critical PM5 protocol rules:**

- **For fixed time intervals, send duration first, then rest/configure/screen together.**
- **For multi-interval workouts, use `variableInterval` (`workoutType=8`) for every interval and send one final screen command.**
- **Use `durationType=0x00`** for time-based intervals, `0x80` for distance.
- Real PM5 validation confirmed both distance and time workouts work with these sequences.

## PM5 regression tests

The test suite includes regressions for both 5-minute time-based and distance-based intervals (`src/Pm5WorkoutSender.test.tsx`). These tests verify:
- setup, duration, and configure/pace commands are sent in **separate buffers** to match PM5 protocol
- time-based intervals skip target pace but still send configure
- distance-based intervals include both target pace and configure in the same buffer

Run with `npm test -- --run src/Pm5WorkoutSender.test.tsx` to validate the PM5 sender behavior.

## PM5 command buffering

The PM5 protocol requires commands to be sent in separate C-safe buffers. Distance intervals use the variable-interval sequence; time intervals use the fixed-time sequence from ErgometerJS.

**For distance-based intervals with target pace:**
1. Setup buffer: `setWorkoutIntervalCount`, `setWorkoutType`, `setIntervalType`
2. Duration buffer: `setWorkoutDuration(durationType=0x80, value=500)`, `setRestDuration`
3. Configure buffer: `setTargetPaceTime`, `setConfigureWorkout`
4. Screen buffer (final, once): `setScreenState`

**For time-based intervals:**
1. Duration buffer: `setWorkoutType(value=6)`, `setWorkoutDuration(durationType=0x00, value=30000)` (hundredths of a second)
2. Final buffer: `setRestDuration`, `setConfigureWorkout`, `setScreenState`

**For distance-based intervals without pace:**
1. Setup buffer: `setWorkoutIntervalCount`, `setWorkoutType`, `setIntervalType`
2. Duration buffer: `setWorkoutDuration(durationType=0x80)`, `setRestDuration`
3. Configure buffer: `setConfigureWorkout`
4. Screen buffer (final, once): `setScreenState`

The fixed-time sequence avoids `setIntervalType`, `setWorkoutIntervalCount`, and `setTargetPaceTime`; the workout type tells the PM5 how to interpret the duration. Multi-interval time entries use `setIntervalType(time)` and encode their duration in hundredths of a second.

## PM5 troubleshooting signs

Watch for these log patterns when a send fails:

- `wrong csafe frame ending` was a false diagnostic from the bundled parser for valid short Web Bluetooth notifications and is no longer reported.
- `command rejected by monitor: Reject` means the PM5 rejected a config command.
- `PM_SET_TARGETPACETIME` is used for distance intervals with a pace target, not fixed-time intervals.
- A time interval with no `PM_CONFIGURE_WORKOUT` can display `:00` even when the duration was set.
- `PM_SET_WORKOUTDURATION` with `durationType=0 value=300` is correct for a 5-minute time interval.
- `PM_SET_RESTDURATION ... value=30720s` is a decode artifact from the raw rest payload byte order and is not the real DB value.

## PM5 diagnostic output

When sending a workout fails, the log includes:

- **Device state**: manufacturer, serial, and command timeout (e.g., `PM5-TEST, timeout=5000ms`)
- **Interval computed values**: workKind, intervalType, durationType, workValue, recovery, targetMode, targetValue, targetPace
- **Buffer timing**: how long each buffer took to send (e.g., `Setup buffer sent in 125.3ms`)
- **Error details**: full exception message and stack trace if an error is thrown
- **Connection state**: PM5 connection state before disconnect

Example diagnostic output:

```
[diag] Device state: manufacturer=Concept2, serial=PM5-TEST, timeout=5000ms

Interval 1 computed values:
  workKind: time
  intervalType: 0 (time-based)
  durationType: 0x00 (time)
  workValue: 300s
  recoverySeconds: 120s
  targetMode: null
  targetValue: null
  targetPaceHundredths: null (skipped)

Interval 1: setup
  1. SETPMCFG_CMD -> PM_SET_WORKOUTINTERVALCOUNT (0x76 / 0x18) | intervalCount=0
  2. SETPMCFG_CMD -> PM_SET_WORKOUTTYPE (0x76 / 0x01) | value=8
  3. SETPMCFG_CMD -> PM_SET_INTERVALTYPE (0x76 / 0x17) | intervalType=0

[diag] Setup buffer sent in 125.3ms

Interval 1: rest + configure
  1. SETPMCFG_CMD -> PM_SET_RESTDURATION (0x76 / 0x04) | value=120s
  2. SETPMCFG_CMD -> PM_CONFIGURE_WORKOUT (0x76 / 0x14) | programmingMode=true

[diag] Time/configure buffer sent in 42.1ms
[error] Exception caught: Command rejected by monitor (Reject)
[diag] PM5 connection state before disconnect: 1
```

  ## PM5 command buffering

  The PM5 protocol requires commands to be sent in separate C-safe buffers. Time-based and distance-based intervals follow different patterns.

  **For distance-based intervals with target pace:**
  1. Setup buffer: `setWorkoutIntervalCount`, `setWorkoutType`, `setIntervalType(1)`
  2. Duration buffer: `setWorkoutDuration(durationType=0x80, value=500)`, `setRestDuration`
  3. Configure buffer: `setTargetPaceTime`, `setConfigureWorkout`
  4. Screen buffer (final, once): `setScreenState`

  **For time-based intervals:**
  1. Setup buffer: `setWorkoutIntervalCount`, `setWorkoutType`, `setIntervalType(0)`
  2. Duration buffer: `setWorkoutDuration(durationType=0x00, value=300)`, `setRestDuration` (duration in seconds)
  3. Configure buffer: `setConfigureWorkout` (NO pace for time intervals)
  4. Screen buffer (final, once): `setScreenState`

  **For distance-based intervals without pace:**
  1. Setup buffer: `setWorkoutIntervalCount`, `setWorkoutType`, `setIntervalType`
  2. Duration buffer: `setWorkoutDuration(durationType=0x80)`, `setRestDuration`
  3. Configure buffer: `setConfigureWorkout`
  4. Screen buffer (final, once): `setScreenState`

  **Key differences:** Time-based intervals use `durationType=0x00` (time) while distance-based use `durationType=0x80` (distance). Time-based intervals should send `setConfigureWorkout` ONLY, without `setTargetPaceTime`, because the interval type overrides any pace consideration.
- `GET /api/plans`
- `GET /api/blocks?plan_id=<uuid>`
- `GET /api/workouts?block_id=<uuid>`
- `GET /api/intervals?workout_id=<uuid>`

All routes require the API server to be running and, for successful database-backed responses, a valid `DATABASE_URL`.
