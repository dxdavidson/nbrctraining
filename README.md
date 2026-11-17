# NBRC Training

NBRC Training is a React and TypeScript application for browsing rowing training plans and sending workouts to a PM5 ergometer. The frontend is served by Vite and reads plan data from the Express API backed by PostgreSQL.

## Table of contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Navigation](#navigation)
- [On-the-Water rowing](#on-the-water-rowing)
  - [Simulate GPS locally](#simulate-gps-locally)
- [CSV workout import](#csv-workout-import)
- [Run Locally](#run-locally)
  - [Open the local app on a phone](#open-the-local-app-on-a-phone)
- [Deploying to https://nbrowingclub.com/training](#deploying-to-httpsnbrowingclubcomtraining)
  - [Configure the Railway API](#configure-the-railway-api)
  - [Configure Concept2 Logbook OAuth](#configure-concept2-logbook-oauth)
  - [Staging build](#staging-build)
- [Test and Validate](#test-and-validate)
- [Versioning](#versioning)
- [Concept2 rankings scraper](#concept2-rankings-scraper)
- [Concept2 Logbook export CLI](#concept2-logbook-export-cli)
- [PM5 time-interval protocol](#pm5-time-interval-protocol)
- [PM5 regression tests](#pm5-regression-tests)
- [PM5 command buffering](#pm5-command-buffering)
- [PM5 troubleshooting signs](#pm5-troubleshooting-signs)
- [PM5 diagnostic output](#pm5-diagnostic-output)

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

The default **Rowing Plans** page is available at `/`. **On the Water** at `/otw.html` is a dedicated coxswain display for St Ayles skiff sessions. **Ramp Test** at `/ramp-test` generates and sends a configurable one-minute watt ramp, then estimates 2K pace from the final complete and partial stages. **Round Robin Ergos** remains a placeholder. The **Admin** menu contains the workout importer.

## On-the-Water rowing

Open **On the Water** from the main navigation or directly at `/otw.html`. It is a second Vite entry and is included in the PWA precache for direct offline launch. GPS and screen-wake features require a secure context (HTTPS, or localhost) and location permission.

### Simulate GPS locally

You can test the OTW display in Chrome or Edge without moving outdoors:

1. Run the app locally and open `http://localhost:5173/otw.html`.
2. Open DevTools → **Console** and run this before pressing **Start**. Before pasting, set `multiplier` to 2 or 3 to simulate movement at 6 or 9 m/s instead of 3 m/s. This changes movement speed, not the workout timer. The app rejects GPS speeds above 12 m/s.

   ```js
   (() => {
     const multiplier = 1 // Set to 2 or 3 for faster simulated movement.
     const speedMps = 3 * multiplier
     const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
     const timers = new Map()
     let nextId = 1

     Object.defineProperty(navigator, 'geolocation', {
       configurable: true,
       value: {
         watchPosition(success) {
           const id = nextId++
           const startedAt = Date.now()
           const update = () => {
             const seconds = (Date.now() - startedAt) / 1000
             success({
               coords: {
                 latitude: 51.5074 + (speedMps * seconds) / 111320,
                 longitude: -0.1278,
                 accuracy: 5,
                 speed: speedMps,
                 heading: 0,
                 altitude: null,
                 altitudeAccuracy: null,
               },
               timestamp: Date.now(),
             })
           }
           update()
           timers.set(id, setInterval(update, 1000))
           return id
         },
         clearWatch(id) {
           clearInterval(timers.get(id))
           timers.delete(id)
         },
       },
     })

     window.stopOtwGpsSimulation = () => {
       for (const timer of timers.values()) clearInterval(timer)
       if (originalDescriptor) {
         Object.defineProperty(navigator, 'geolocation', originalDescriptor)
       } else {
         delete navigator.geolocation
       }
       delete window.stopOtwGpsSimulation
     }

     console.log(`OTW GPS simulation active: moving north at about ${speedMps} m/s.`)
   })()
   ```

3. Press **Start**; the simulation updates location once per second. Tap **Stroke Rate** twice, about two seconds apart, to see a rate.
4. To test distance-based workout intervals, choose a workout using the **Intervals** button before starting. Time-based intervals advance without GPS.

Press **Pause** and **Finish** before running `stopOtwGpsSimulation()` in the Console. Refresh the page before pasting the simulation again with a different multiplier. Refreshing also restores the browser's normal geolocation. If the database has no OTW workouts, Just Row can still be tested, but the workout list will be empty.

The phone-first OTW display keeps six large data fields in a two-column, three-row grid in portrait and a three-column, two-row grid in landscape. Landscape field text and padding scale to the available screen size. Metric labels sit at the top-left of each field and include their units. A combined Start/Pause/Resume button and a Finish button stay at the bottom; Start is green, Pause amber, and Resume blue. Distance and elapsed time show session totals in Just Row and current-interval values in Intervals mode; average pace follows the same scope. Pace is shown per 500 m. Current pace updates with GPS readings; average pace refreshes every five seconds and at interval or session transitions. Time-based workout intervals show their remaining time as `mm:ss`. Tap the Stroke Rate field at each catch to record a stroke. On supported phones, install the app and launch it from the home screen to use standalone mode without the usual browser controls; a regular browser tab cannot hide them. The OTW page is a separately installable app ("NBRC On the Water", its own manifest `otw.webmanifest`) that launches `otw.html`; installing from the home page gives the main app instead, and both can be installed side by side.

The highlighted **Just Row**, **Race**, or **Intervals** button shows the current mode; mode changes are disabled during a running or paused session. Switching modes clears the displayed session data without deleting saved sessions; Intervals mode starts when a workout is loaded, not when the picker is opened. In **Race**, enter a positive distance in meters in the Remaining field before starting. Valid distances are saved on this device as they are entered; returning to Race restores the last saved value. Remaining counts down using GPS distance, turns red when the displayed distance reaches zero, and continues into negative values until the session is finished. In Just Row, Remaining is zero.

The **Intervals** button lists all `OTW` workouts, including those in unpublished plans and blocks. Filter the list by the work interval types: Distance, Time, Mixed, or None. An Invalid category appears if a workout has an unrecognized work interval type. Workouts with no intervals or invalid intervals cannot be started. Select a workout's description and press **Load Workout** to enter Intervals mode and preview the first interval in Remaining. The top-left status shows the current work interval number, or the number of completed intervals during recovery. During recovery the Remaining field turns amber and shows **Next interval starts in**. The workout ends after the final work interval, without a final recovery. When a workout finishes, a summary shows time, GPS distance, and pace for completed work intervals only, with totals excluding recovery and unfinished intervals. Opening the page online downloads the workout catalogue and intervals into IndexedDB so they remain selectable offline. Interval changes advance automatically and trigger a beep/vibration when supported.

Use the top-right menu to browse session history and export any saved session as FIT, or access stroke and remote settings. Positions with accuracy worse than 25 m and implausible jumps are filtered; small movements accumulate until they exceed the GPS noise threshold, and speed is smoothed over recent valid samples. Session records are saved to IndexedDB while rowing. Pause freezes elapsed time, distance, remaining distance and intervals; movement while paused is not recorded. Resume continues the same session. Finish is enabled only while paused and saves the session to History without downloading a file; completed intervals finish automatically. Open **History** to export a session as FIT, delete one session with the trash button, or use **Delete all history**. History lives only on the phone (IndexedDB) and is never sent to the database. The FIT file includes active-time records, pause/resume timer events, and a lap for each completed workout interval.

The display uses Screen Wake Lock when available and a muted-video fallback otherwise. For a Bluetooth remote that sends keyboard events to the browser, use **Learn** in Remote controls to map both buttons and each D-pad direction. A short press of either button starts, pauses or resumes on release; holding for 3 seconds or longer does nothing. Finish is only available on screen. Each D-pad direction records a stroke. Existing remote mappings migrate Start and Stop to A and B and Stroke to Up; check and learn the remaining directions as needed. Controllers that send gamepad or mouse events rather than keyboard events are not supported by these mappings. Stroke-rate timeout defaults to 3 seconds (configurable from 2–10), the averaging window can be set to 4, 5, or 6 catch intervals, and the expected slowest rate (used for a timeout warning) can be adjusted from 16–22 spm.

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

### Open the local app on a phone

You can use a phone on the same Wi-Fi network to test the app running on your computer:

1. On the computer, run `ipconfig` and note the IPv4 address for its Wi-Fi adapter (for example, `192.168.1.23`). Do not use `localhost` or `127.0.0.1` on the phone; those addresses refer to the phone itself.
2. In the repository root `.env`, set `VITE_API_BASE_URL` to the computer's address and API port:

   ```dotenv
   VITE_API_BASE_URL=http://192.168.1.23:4000
   ```

   Replace the example address with the computer's actual IPv4 address. Restart Vite after changing `.env`.
3. Keep the API running in one terminal (`cd server`, then `npm run dev`). In a second terminal, start Vite so it accepts connections from the network:

   ```powershell
   npm run dev -- --host 0.0.0.0
   ```

4. On the phone, open `http://192.168.1.23:5173` (or `http://192.168.1.23:5173/otw.html` for On the Water), using the same computer address.
5. If prompted by Windows Firewall, allow Node.js on private networks. If `CLIENT_ORIGIN` is configured for the API, include the phone's frontend origin, such as `http://192.168.1.23:5173`.

The On-the-Water GPS and screen-wake features require a secure context. A plain HTTP LAN address is not considered secure by most phone browsers, so those features require HTTPS when testing from a phone.

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

### Staging build

To test a branch against a staging API, build for a separate sub-path (`/trainingdev/`, uploaded to `public_html/trainingdev`). From the repo root:

```powershell
.\scripts\build-staging.ps1
```

The script builds into `dist-staging\` (leaving `dist\` untouched), rewrites `RewriteBase` in its `.htaccess`, and creates `dist-staging.zip`. Upload the zip to `public_html/trainingdev` and extract it there. The production `dist\` build is unaffected, and the script restores your environment variables when it finishes.

It sets these for the build:

- `BASE_PATH=/trainingdev/`
- `VITE_API_BASE_URL=https://nbrctraining-staging.up.railway.app`
- `VITE_ENV_LABEL=STAGING`, which adds an orange banner and a `[STAGING]` tab title, and renames the installed PWAs "NBRC Training (STAGING)" and "NBRC On the Water (STAGING)" with an orange theme colour.

Override any of them with `-BasePath`, `-ApiUrl` and `-Label`, for example `.\scripts\build-staging.ps1 -ApiUrl https://other-api.example.com`. Set `CLIENT_ORIGIN` on the staging API to the frontend origin (for example `https://nbrowingclub.com`, without a path).

After the first upload, uninstall any old copy of the app from your phone and clear the site data before reinstalling, so the new manifest is used.

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

## Versioning

The About box displays the version from `package.json`, injected at build time by `vite.config.ts`, so bumping the version only requires updating that one field.

Use `npm version` to bump it (this also creates a git commit and tag):

```powershell
npm version patch   # bug fixes and data updates, e.g. 1.2.3 -> 1.2.4
npm version minor   # new features, e.g. 1.2.3 -> 1.3.0
npm version major   # breaking changes, e.g. 1.2.3 -> 2.0.0
```

Or set an exact version directly:

```powershell
npm version 1.4.0
```

Then push the commit and tag together:

```powershell
git push --follow-tags
```

Bump once per release rather than on every commit; the commit hash and build timestamp shown in the About box identify intermediate deploys.

## Concept2 rankings scraper

`scripts/scrapeRankings.mjs` fetches the public Concept2 Logbook rankings pages (`https://log.concept2.com/rankings/<year>/rower/<distance>?rower=rower&gender=<M|F>&status=race`) across a range of years and aggregates every row into a single CSV file. It walks all paginated result pages for each year and gender, retries failed page fetches, and streams rows to disk as it goes.

Run it with Node from the repository root:

```powershell
node scripts/scrapeRankings.mjs --start 2002 --end 2027
```

Options:

- `--start <year>` (required): first year to fetch, inclusive.
- `--end <year>` (required): last year to fetch, inclusive.
- `--out <path>`: output CSV path (default `data/imports/rankings.csv`).
- `--delay <ms>`: delay between page/year requests (default `400`).
- `--distance <meters>`: rankings distance to query (default `2000`).
- `--gender both|M|F`: gender to query (default `both`, which fetches each year once per gender). The rankings pages don't expose gender as a data column, so this value is written into the row instead of parsed from the page.

The output CSV includes one row per ranked result, with columns `year, gender, rank, name, age, location, country, affiliation, distance, time, verified, status`.

## Concept2 Logbook export CLI

`server/concept2Query.js` exports Logbook workouts for one or more Log IDs (Concept2 user IDs) to a CSV file. It does not use the database. Requests are authorised with a Concept2 OAuth access token that has the `results:read` scope, supplied with `--token` or the `CONCEPT2_ACCESS_TOKEN` environment variable (the root `.env` is loaded). Concept2 only returns results the token's owner is permitted to see. The app's OAuth login now requests `results:read`, so accounts connected earlier must reconnect to obtain such a token.

```powershell
cd server
node concept2Query.js --logids 123456,234567 --fromdate 2026-01-01 --todate 2026-03-31 --out results.csv
```

Options: `--logids` (required, comma-delimited), `--fromdate` and `--todate` (optional, `YYYY-MM-DD`, inclusive), `--token`, `--out` (default `concept2-results.csv`), `--env development|production` (default `CONCEPT2_LOGBOOK_ENVIRONMENT`, else `development`) and `--type` (e.g. `rower`). The CSV has a `log_id` column plus every field returned by the API; nested objects are flattened to dotted column names (for example `heart_rate.average`) and arrays such as splits are stored as JSON text. A Log ID that fails is reported on stderr and the exit code is 1; the others are still exported.

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
- **Ramp-test intervals use `setTargetAverageWatt`** for their target power. Select Watts and PaceBoat manually on the PM5; ErgometerJS does not expose commands to set either display option.
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
- `GET /api/otw/workouts` — all OTW workouts with their intervals, regardless of plan or block publication

All routes require the API server to be running and, for successful database-backed responses, a valid `DATABASE_URL`.
