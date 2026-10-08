# Backups and restore

## What is backed up

| | |
|---|---|
| **What** | The whole production database (Neon): every employee, role, company, document record, approval step, audit event and session |
| **Not included** | The PDF files themselves, which live in the `docflow-files` B2 bucket (see "Known gaps") |
| **When** | Every night at 02:00 IST (20:30 UTC), by `.github/workflows/backup.yml`. Also on demand: GitHub → Actions → **Backup** → **Run workflow** |
| **Where** | The private backups bucket (its name is the `BACKUP_B2_BUCKET` secret): `daily/docflow-<UTC time>.dump.gpg`, and on Sundays also `weekly/…` |
| **Format** | `pg_dump` custom format from the Postgres 18 client, encrypted with GnuPG (AES-256) using the `BACKUP_PASSPHRASE` secret |
| **Kept** | 14 days for `daily/` and 56 days for `weekly/` (bucket lifecycle rules). Object Lock (compliance mode, 14 days) means nobody, including whoever holds the key or the account, can delete or overwrite a backup until then |

**The passphrase is not stored anywhere in the project.** It exists only as the GitHub secret and in the owner's password manager. Without it, no backup can be opened.

## Every backup is tested

Each run, after uploading, the job:
1. downloads that same file back from the bucket;
2. decrypts it with the passphrase;
3. restores it into an empty Postgres 18;
4. checks that every table has the same row count as production;
5. runs the migrations against the copy, which must find nothing to do;
6. boots the API on the copy and checks that sign-in queries it.

If any step fails, the run fails and GitHub emails whoever last changed the workflow's schedule (the repo owner). A count mismatch can happen when someone saves something during the dump; run the workflow again once. If it fails twice, investigate.

Logs are public because the repository is public. The job prints table names only, never row counts or data. Secrets are masked by GitHub.

**First run:** 8 Oct 2026, by hand before merge. All 12 tables matched, migrations had nothing pending, and the API answered sign-in on the restored copy.

## Restoring production

Use this when data was lost or damaged, e.g. by a bad migration, a mistaken reset, or the Neon project being suspended or deleted. It takes about 15 minutes, needs no help from Claude, and everything below works on Windows.

**You need:**
- Backblaze access to the backups bucket;
- the passphrase;
- [Gpg4win](https://gpg4win.org) (provides `gpg`);
- the PostgreSQL **18** command-line tools: the EDB installer's "Command Line Tools" component, or Docker (`postgres:18` image).

1. **Pick the backup.** Backblaze → Buckets → backups bucket → **Browse Files** → `daily/` (or `weekly/` for older ones). File names are UTC times, so pick the newest one from **before** the damage and **Download** it.
2. **Decrypt it.** It asks for the passphrase:
   ```sh
   gpg --output docflow.dump --decrypt docflow-2026-10-08T2030Z.dump.gpg
   ```
3. **Create an empty database.** Neon console → the project → **Databases** → **New database**, e.g. `docflow_restored`, owned by the same role as the current one. Copy its **direct** connection string (the host *without* `-pooler`).

   Restore into a new database, not over the damaged one. The damaged one stays as evidence until you're sure.
4. **Restore:**
   ```sh
   pg_restore --no-owner --no-privileges --exit-on-error --dbname "<direct connection string>" docflow.dump
   ```
   It prints nothing on success.
5. **Point the API at it.** Render → `docflow` service → **Environment**. In both `DATABASE_URL` (pooled host) and `DATABASE_URL_DIRECT` (direct host), change only the database name at the end to `docflow_restored`, then **Save, rebuild and deploy**. On start, the container runs migrations (nothing to do on a backup from the current version).
6. **Check:**
   - sign in;
   - the Admin dashboard counts and recent documents look right;
   - open one PDF.

   Documents submitted after the backup was taken are missing from the database, but their files still exist in B2. Tell the people affected to resubmit.
7. **Clean up:**
   - Delete `docflow.dump` and the downloaded `.gpg` from your computer; the decrypted file is unencrypted personal data.
   - After a few days, drop the old damaged database in Neon.

**Sessions:** everyone who was signed in when the backup was taken may still be signed in, and sessions created after it are gone, so those people sign in again. Password links created after the backup no longer work; send new ones from Employee Master.

## Checking backups are still running
GitHub → Actions → **Backup** should show a green run for each night. Things that stop it:
- **GitHub pauses scheduled workflows** in a public repository after 60 days with no commits, and emails a warning first. Re-enable it from the Actions tab, or push any commit.
- **A secret was changed or the B2 key deleted:** the run fails at "Sign in to Backblaze" or "Dump the database". Replace the secret in Settings → Secrets and variables → Actions. Rotating the Neon password means updating `BACKUP_DATABASE_URL` too.
- **Neon or Backblaze limits:** the backups are small (about 45 KB compressed in Oct 2026), so they use a tiny part of B2's free 10 GB.

## Known gaps
- **PDF files are not in these backups.** They stay in `docflow-files`. The app never deletes a submitted document's file; only the test-data reset (D21) does. Protecting them from a leaked key or an account mistake, for example by copying them into the backups bucket, is an open item for Phase 8.
- **Up to a day of data can be lost** (the time since the last backup). Neon's own short point-in-time history may get you closer; check it first if the damage just happened.
