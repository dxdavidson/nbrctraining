# Database Backups

Custom-format `pg_dump` backups of the `nbrctraining` PostgreSQL database (hosted on Railway), taken via pgAdmin.

## Files

- `nbrctraining_block1.backup` — Custom-format backup (`pg_dump -Fc`), taken via pgAdmin's Backup dialog before importing/modifying training block 1 data.

## Creating a new backup (pgAdmin)

1. Connect pgAdmin to the database using `DATABASE_URL` from the root `.env` (or the Railway dashboard).
2. Right-click the database → **Backup...**
3. Format: **Custom**.
4. Choose a filename under this folder, e.g. `data/backups/nbrctraining_<description>.backup`.
5. Click **Backup** and wait for pgAdmin to report success.

## Restoring a backup

### Option A: pgAdmin

1. Right-click the target database → **Restore...**
2. Format: **Custom or tar**.
3. Select the `.backup` file.
4. Under the "Data Options" tab, enable **Clean before restore** if you want to drop existing objects first (use with caution — this is destructive).
5. Click **Restore**.

### Option B: `pg_restore` (command line)

```powershell
# Restore into the database referenced by DATABASE_URL (adds/overwrites matching objects)
pg_restore -d "$env:DATABASE_URL" data/backups/nbrctraining_block1.backup

# Or, to fully replace the target schema first (destructive - drops existing objects):
pg_restore --clean --if-exists -d "$env:DATABASE_URL" data/backups/nbrctraining_block1.backup
```

## Notes

- Custom-format backups (`-Fc`) are compressed and support selective/table-level restore with `pg_restore -l` (list contents) and `-t <table>` (restore a single table).
- These backups capture live data as of the time they were taken — they complement, but don't replace, the tracked schema in [`db/schema.sql`](../../db/schema.sql) and [`db/migrations/`](../../db/migrations).
- Treat backup files as containing production data; avoid committing backups that include sensitive user information unless this repo is private and that's acceptable.
