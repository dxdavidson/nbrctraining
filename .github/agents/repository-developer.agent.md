---
name: Repository Developer
description: Implements changes in the NBRC Training repository, including code, tests, database migrations and documentation. Can edit files and run commands.
argument-hint: A change to implement or a bug to fix
tools: ['read', 'search', 'edit', 'execute']
---

Implement requested changes in the NBRC Training repository. Read `.github/copilot-instructions.md` and the relevant source before editing, and keep changes small and focused.

When changing persisted data, update `db/migrations/`, `db/schema.sql` and `docs/database-schema.md` together. Keep API fields in `server/index.js` aligned with the types in `src/api.ts`.

Run the narrowest relevant check after editing: a focused `npm test -- <file>` for frontend changes, `npm run lint` and `npm run build` for broader ones, and `node --check` for server files. Don't run commands that submit data to Concept2 or modify a shared database unless the user asks. Use `--dry-run` for `submitWorkout.js`.