# Copilot instructions

## Commands

Install dependencies separately at the repository root and in `server/`:

```powershell
npm install
cd server
npm install
```

Frontend commands run from the repository root:

```powershell
npm run dev
npm run build
npm run lint
npm test
```

Run one test file or one named test with Vitest:

```powershell
npm test -- --run src/PlanBrowser.test.tsx
npm test -- --run src/PlanBrowser.test.tsx -t "shows Plans first"
```

Run the API from `server/` with `npm run dev` (watch mode) or `npm start`. The API needs `DATABASE_URL` in the root `.env` for local development. See `README.md` for database setup, OAuth configuration, and deployment environment variables.

## Architecture

- The browser app starts in `src/main.tsx`. `src/App.tsx` matches paths directly (including `/admin/import`, `/tools/pace-guidance`, and `/plans/:id`) rather than using a routing library. It removes Vite's configured base path before matching.
- The main plan browser in `src/PlanBrowser.tsx` drills down through plans, blocks, workouts, and intervals. `src/hooks/useUrlSelection.ts` keeps selections in the URL; `src/api.ts` defines the browser-facing data types and calls the Express API. `src/rowModels.ts` and pace-related modules turn database interval data and the athlete's estimated 2K time into display and target values.
- `server/index.js` provides the Express API. It reads PostgreSQL through `server/db.js`; the data hierarchy is plans → blocks → workouts → intervals. Public list routes expose published plans and blocks, then their associated workouts and intervals.
- CSV workout import is a separate admin route. `src/AdminImport.tsx` sends CSV text and an `X-Import-Token`; `server/csvImport.js` parses/groups it and the import route writes workouts and intervals in a transaction. Dry runs roll back; real imports commit. Keep deletion scoped to CSV-referenced blocks.
- Concept2 OAuth and logbook access are server-side: `server/concept2Auth.js` handles authorization, callback, and token storage; `server/logbook.js` shares workout submission logic with the simulator CLI. A long-lived, HTTP-only device cookie identifies the linked account; this app does not use a separate user login.
- PM5 workout programming is in `src/Pm5WorkoutSender.tsx` and uses the bundled ErgometerJS/Web Bluetooth integration. Commands must retain their protocol-required buffer boundaries and time/distance-specific behavior. Use `src/Pm5WorkoutSender.test.tsx` and `docs/pm5-time-interval-sequence.md` when changing this flow; the tests protect command ordering and payloads.
- Vite's `BASE_PATH` is a build-time frontend setting (default `/`); `VITE_API_BASE_URL` selects the API host. The PWA caches only the read-only plan API routes. For the `/training` deployment, preserve base-aware routing/assets and the host's SPA fallback; see `README.md`.

## Repository conventions

- Keep the database description in `docs/database-schema.md`, generated schema in `db/schema.sql`, and ordered SQL changes in `db/migrations/` consistent when changing persisted data.
- Keep API response fields aligned across SQL selections in `server/index.js` and the corresponding interfaces/fetch functions in `src/api.ts`.
- Use PostgreSQL parameter placeholders (`$1`, `$2`, …) for values. Preserve transactions for multi-row imports and other operations that must be atomic.
- Frontend tests live beside the code in `src/`, use Vitest with jsdom and Testing Library, and commonly mock API/browser behavior. Run the focused test file after changing a feature.
- The PM5 sender regression tests assert command buffers and their order, not only rendered UI. Update or extend those assertions when the protocol behavior intentionally changes.
- When building for the club subpath, set `BASE_PATH` before `npm run build` (for example, `$env:BASE_PATH='/training/'; npm run build`). Keep API secrets in server environment variables, never in frontend `VITE_` variables.
