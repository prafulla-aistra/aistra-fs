# Finance Close

Internal finance application for the Aistra group (7 entities). It prepares monthly
Standalone Financial Statements (SFS) and multi-level Consolidated Financial Statements
(CFS).

- Project rules (accuracy, sign convention, translation, consolidation): [CLAUDE.md](CLAUDE.md)
- As-Is process: [docs/Finance_Automation_Process_Flow_v1.docx](docs/Finance_Automation_Process_Flow_v1.docx)

> **Status: step 2A — new design and reliable startup; step 2 — configuration** (currencies, entities, group structure, financial-year
> calendar, due dates) on top of step 1 (sign-in, users, permissions). Formats, chart of
> accounts and exchange rates come next; statements and consolidation after that.

---

## Quick start

You only need **Node.js** (22 LTS; minimum 20.19). You don't need Docker, a PostgreSQL
install or admin rights.

```bash
npm install
npm run dev
```

Then open **<http://localhost:5173>** and sign in as the master admin:

| Email                       | Password            |
| --------------------------- | ------------------- |
| `master@financeclose.local` | `FinanceClose-2026` |

### Demo accounts (demo mode only)

With `DEMO_MODE=true` (the local default), the sign-in page shows **Demo accounts**. Click one
to sign in instantly. The same accounts also work with their passwords:

| Account            | Email                       | Password            | Permissions                            |
| ------------------ | --------------------------- | ------------------- | -------------------------------------- |
| Master admin       | `master@financeclose.local` | `FinanceClose-2026` | everything                             |
| Priya – Preparer   | `priya@financeclose.local`  | `Priya-Demo-2026`   | SFS_PREPARE, CFS_PREPARE, REPORTS_VIEW |
| Rahul – Reviewer   | `rahul@financeclose.local`  | `Rahul-Demo-2026`   | SFS_REVIEW, CFS_REVIEW, REPORTS_VIEW   |
| Viewer – read only | `viewer@financeclose.local` | `Viewer-Demo-2026`  | REPORTS_VIEW                           |

Demo users skip the forced first-login password change. With `DEMO_MODE=false` the demo users
are not seeded and the quick-login endpoints do not exist (404). **Production must use
`DEMO_MODE=false`.**

The master's email and password come from `MASTER_EMAIL` / `MASTER_PASSWORD` in `apps/api/.env`. **Change them before
real use.** The seed creates the master only once. To reset the master's password to the
value in `.env` (for example after forgetting it), run `npm run master:reset-password`.

The first `npm run dev` does some one-off setup:

1. It creates `apps/api/.env` from `apps/api/.env.example`, generating a random `JWT_SECRET`.
   Later runs add any new settings from the example without touching your values.
2. It creates an embedded PostgreSQL 16 database in `./data/db`. This takes up to a minute
   the first time.
3. It starts the database server, applies migrations and runs the seed.
4. It starts the API (port 3000) and web app (port 5173) with live reload.

Wait for the line **"Finance Close is ready … Open http://localhost:5173"** in the terminal. The
API takes up to ~30 s to start after the web page is already available. If you sign in during
that time, or while the API restarts after a code change, the page waits for it automatically.
It shows **"Can't reach the server. Check the app is running."** only if the server stays
unreachable for 20 s.

`npm run dev` refuses to start a second copy when one is already running, and says so. After a
laptop restart or crash it removes a stale database lock file before starting the database.

Stop the app with **Ctrl+C**. The database server keeps running in the background, so the
next `npm run dev` starts quickly. Stop it with `npm run db:stop` if you want to; a reboot
also stops it. `npm run dev` restarts it when needed.

### Verify the health check

```bash
curl http://localhost:3000/api/health
# {"status":"ok","db":"ok"}
```

On Windows PowerShell, use `curl.exe` (plain `curl` is an alias for `Invoke-WebRequest`),
or run `Invoke-RestMethod http://localhost:3000/api/health`.

If the database is unreachable, the endpoint returns **HTTP 503** with
`{"status":"error","db":"error"}`.

---

## Repository layout

```
apps/
  api/          NestJS + Prisma REST API            -> http://localhost:3000/api
  web/          React 18 + Vite + Tailwind + shadcn -> http://localhost:5173
packages/
  engine/       Pure TypeScript accounting calculations (decimal.js, Vitest). No DB, no HTTP.
  shared/       Types and enums shared by api and web
scripts/
  embedded-db.mjs   Starts/stops the local embedded PostgreSQL server
data/           Local data, git-ignored: db/ (database), db.log (server log), uploads/ (files)
docs/           Process documentation
docker-compose.yml   OPTIONAL: PostgreSQL + MinIO in Docker, for later AWS-oriented work
```

The web app never calculates accounting numbers. It calls the API, and the API calls
`packages/engine`.

---

## How local infrastructure works

### Database: embedded PostgreSQL 16

The npm package [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) ships
real PostgreSQL 16 server binaries for Windows, macOS and Linux inside `node_modules`.
`scripts/embedded-db.mjs` uses them to create a database in `./data/db` and run it on
`localhost:54329`, as a normal user.

The app connects through a standard `postgresql://` URL, **the same code path as AWS RDS**.
Moving to RDS means changing one setting, `DATABASE_URL` in `apps/api/.env`:

```bash
# local (default): embedded server started automatically by npm run dev
DATABASE_URL=postgresql://finance:finance_dev_password@localhost:54329/finance_close?schema=public
# AWS RDS: nothing is started locally; this server is used as-is
DATABASE_URL=postgresql://USER:PASSWORD@my-db.xxxx.ap-south-1.rds.amazonaws.com:5432/finance_close?sslmode=require
```

Money stays exact: amounts are `NUMERIC(20,4)` and rates are `NUMERIC(20,10)`, read as Prisma
`Decimal`, the same as on RDS.

> **Why not PGlite?** PGlite (PostgreSQL compiled to WebAssembly) was tried first, and with
> Prisma it was not reliable. Every `prisma migrate` command hung after finishing, because the
> adapter never closes PGlite. The adapter also ignores errors while applying migrations, so a
> failed migration could be recorded as applied. And on Windows the API's watch-mode restarts
> kill the process, which shut PGlite down uncleanly on every code change (slow recovery,
> corruption risk). `embedded-postgres` runs a real server process and has none of these problems.

### Sign-in, users and permissions (step 1)

- **Sign-in:** email + password (bcrypt, via `bcryptjs`). The API returns a 15-minute access
  token (JWT, kept only in browser memory) and sets a refresh token in an httpOnly cookie
  (`fc_refresh`, path `/api/auth`, SameSite=Strict; 12 hours, rotated on every use). Only a
  SHA-256 hash of the refresh token is stored.
- **Lockout:** 5 wrong passwords in a row lock the account for 15 minutes. An admin password
  reset unlocks it.
- **Temporary passwords:** users created or reset by an admin must choose their own password
  at the next sign-in; until then every other endpoint returns 403 `PASSWORD_CHANGE_REQUIRED`.
  Password rule: 10+ characters with at least one letter and one number.
- **Ending sessions:** a password change, admin reset or deactivation increases the user's
  session version, so older access tokens stop working immediately.
- **Permissions, not roles:** the `permission` table holds the codes (`USER_ADMIN`,
  `CONFIG_MANAGE`, `SFS_PREPARE`, `SFS_REVIEW`, `CFS_PREPARE`, `CFS_REVIEW`,
  `EDIT_ACCESS_APPROVE`, `REPORTS_VIEW`). The templates _Preparer_, _Reviewer_ and _Viewer_ are
  starting points that are copied onto a user and can then be adjusted per user. The master admin
  implicitly holds every permission, including ones added later.
- **Deny by default:** a global guard requires every endpoint to declare `@Public()`,
  `@Authenticated()` or `@RequirePermission('CODE')`. An endpoint without one is refused.
  Permissions are read from the database on every request, so changes apply at once.
- **AuthProvider interface** (`apps/api/src/auth/auth-provider.ts`): `LocalAuthProvider` today;
  a Cognito implementation can replace it in `auth.module.ts` without changing business code.
- **Audit log** (`audit_log`): who, what, when, old value, new value and IP for sign-ins
  (success and failure), lockouts, sign-outs, password changes and resets, user
  create/edit, permission changes, and deactivation/reactivation. Database triggers make it
  append-only, stop users being deleted, and stop the master from being deactivated.
  `AuditService.record()` is reusable by every later step, inside the same transaction as the
  change it records.
- **Entity scope:** a user can be restricted to specific entities (default: all). It is stored
  and shown now; data filtering by entity applies once entity data exists (later steps).

### Configuration (step 2)

Under **Configuration** in the left menu. Users with `CONFIG_MANAGE` can edit; users with
`REPORTS_VIEW` see the same screens read-only. Every change is written to the audit trail
with old and new values.

- **Currencies:** seeded USD, INR, AED, GBP, SGD, LKR. A currency used by any entity cannot be
  deleted (deactivate it instead). One used by an active entity cannot be deactivated.
- **Entities:** the 7 group entities with legal and short name, country, functional and
  reporting currency, translated currencies (never the functional currency), parent and
  % held, ERP, GAAP, active flag and a "to be confirmed" flag with a note. VS and VM are
  flagged: their currencies are to be confirmed.
- **Historical rates for equity:** one row per target currency (1 unit of functional
  currency = X target), used later to translate share capital and premium. The seeded values
  are illustrative and each carries a "to be confirmed" badge. An entity is warned when it is
  missing a rate for a translated currency, its parent's currency, or the currency of a
  consolidation level it belongs to.
- **Group rules** (checked on every save, in `packages/engine` `validateGroupStructure`):
  exactly one ultimate parent, no circular parent chains, % held from 0.01 to 100, no % for
  the ultimate parent, and no deactivating an entity that still has active subsidiaries.
- **Group structure tab:** tree view plus the consolidation levels from
  `deriveConsolidationLevels`. There is one level per entity with subsidiaries, deepest first.
  Members are that entity plus all its descendants. The level currency defaults to that
  entity's reporting currency. Nothing is hard-coded: changing a parent changes the levels.
- **Financial years:** choose FY 2024-25 to FY 2027-28 (FY 2025-26 and FY 2026-27 are seeded).
  Creating one generates 12 months, 4 quarters (Q1 Apr–Jun … Q4 Jan–Mar) and the annual period
  (`generatePeriods`). Periods can be closed and reopened; closed periods cannot have new
  tasks (enforced when tasks exist).
- **Due dates:** rules in working days after period end (monthly/quarterly/annual SFS 7/10/30,
  CFS 12/15/45). Working days are Monday–Friday excluding the holiday list
  (`calculateDueDate`). Each period shows the calculated SFS and CFS due dates. A due date can
  be overridden for one period with a mandatory reason, and cleared again with a reason. Both
  are audited.
- **Seed behaviour:** configuration is seeded once. After that the screens own the data, and
  re-running the seed (`npm run dev` does this) never overwrites your edits.

### File storage: local folder

Uploaded files go through one `StorageService` interface
(`apps/api/src/storage/storage.service.ts`). Today the implementation is
`LocalStorageService`, which writes to `./data/uploads`. An S3 implementation will be added for
AWS and selected with `STORAGE_DRIVER=s3`; business code does not change.

---

## Everyday commands (run from the repo root)

| Command                         | What it does                                                        |
| ------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                   | Start the database if needed, migrate + seed, run API and web       |
| `npm run db:start`              | Start the embedded PostgreSQL server (creates it on first run)      |
| `npm run db:stop`               | Stop the embedded PostgreSQL server                                 |
| `npm run db:status`             | Show whether it is running                                          |
| `npm run build`                 | Production build of all packages and apps                           |
| `npm test`                      | Run all tests: engine (Vitest), API unit and API integration (Jest) |
| `npm run typecheck`             | TypeScript check across all workspaces                              |
| `npm run lint`                  | ESLint                                                              |
| `npm run format`                | Prettier (write). `npm run format:check` only checks                |
| `npm run db:migrate`            | Create and apply migrations in development (`prisma migrate dev`)   |
| `npm run db:migrate:deploy`     | Apply existing migrations without creating new ones (CI / prod)     |
| `npm run db:setup`              | `migrate deploy` + seed (what `npm run dev` runs)                   |
| `npm run db:seed`               | Run the seed script (`apps/api/prisma/seed.ts`)                     |
| `npm run db:studio`             | Open Prisma Studio to browse the database                           |
| `npm run master:reset-password` | Reset the master password to `MASTER_PASSWORD` and unlock it        |

**API integration tests** run against a separate database, `finance_close_test`, on the same
embedded server. They never touch your data. The test database is never dropped: each run
applies new migrations and reseeds, and tests use unique emails.

**Reset all local data:** `npm run db:stop`, then delete the `data` folder. The next
`npm run dev` recreates everything.

### Local services

| Service    | URL                                   | Credentials (dev defaults)         |
| ---------- | ------------------------------------- | ---------------------------------- |
| Web app    | <http://localhost:5173>               | –                                  |
| API        | <http://localhost:3000/api>           | –                                  |
| PostgreSQL | `localhost:54329`, db `finance_close` | `finance` / `finance_dev_password` |
| Uploads    | folder `./data/uploads`               | –                                  |

### Optional: Docker

`docker-compose.yml` is kept for later AWS-oriented work (a PostgreSQL server like RDS, and
MinIO for S3). Local development does not need it. To use its PostgreSQL, run
`docker compose up -d` and set
`DATABASE_URL=postgresql://finance:finance_dev_password@localhost:5432/finance_close?schema=public`.

---

## Troubleshooting

- **Sign-in says "Can't reach the server".** The API is not running. Run `npm run dev` and wait
  for "Finance Close is ready". If it says Finance Close is already running, use that window.
- **`npm run db:stop` is slow after the laptop slept.** PostgreSQL can stop answering shutdown
  requests after sleep. `db:stop` then forces an immediate stop after 30 s, which is safe:
  PostgreSQL replays its log on the next start.
- **Health shows `db: error`.** Run `npm run db:status`. If the server is not running, run
  `npm run db:start` and read its message. The server log is `data/db.log`.
- **Port 54329 already in use.** Change the port in `DATABASE_URL` in `apps/api/.env`. The
  embedded server uses whatever port that URL names.
- **Web shows "Could not reach the API".** The API is not running on port 3000. Check the
  `api` output in the `npm run dev` terminal.
- **Changes in `packages/*` not picked up by the API.** `npm run dev` rebuilds packages on
  save, but the API only restarts when its own files change. Save any file in `apps/api/src`
  or restart `npm run dev`.
- **OneDrive / Dropbox.** Avoid keeping the project in a synced folder. Syncing
  `node_modules` makes `npm install` slow, and the sync client can briefly lock database files
  in `data/db`, which PostgreSQL reports as "permission denied" errors. Use a local folder such
  as `C:\dev\finance-close`.

---

## Technical notes

- **Money and rates** never use JS `number`. The engine uses `decimal.js` (`toDecimal` rejects
  numbers), the database uses `NUMERIC(20,4)` for amounts and `NUMERIC(20,10)` for rates, and
  ESLint blocks `parseFloat` / `Math.round` in engine and API code.
- **Rounding** is _round half away from zero_ (Excel `ROUND`): 1.005 → 1.01, −1.005 → −1.01.
  No banker's rounding.
- **Workspace packages** are compiled to CommonJS in `dist/` for the API. The web app resolves
  them from TypeScript source through the `@finance-close/source` export condition, so no
  build step is needed for the browser.
- **Pinned majors**: TypeScript 5.9, NestJS 11, Prisma 6, Vite 7, Vitest 3, React Router 7,
  ESLint 9, Tailwind 4, React 18 (as specified), PostgreSQL 16 (embedded, matching the RDS
  target). Newer majors exist; upgrade deliberately, one at a time.

---

## Decisions

1. **Consolidation: 4 levels.** L1 Veracity Services (VS+VM, in SGD), L2 Unconstrained
   (UC+VS+VM), L3 India (IN+AE+UK+UC+VS+VM), L4 US (all). This is a deliberate business
   requirement. It adds one level compared with As-Is document §5.1, which has a single
   intermediate level at Unconstrained. Levels are **derived from the parent tree, never
   hard-coded**.
2. **Veracity currencies.** VS = SGD, VM = LKR. Both are flagged _to be confirmed_ and stay
   editable in configuration.
3. **Rounding.** Round half away from zero (matches Excel `ROUND`). No banker's rounding.
4. **Permission templates** (starting points, adjustable per user): Preparer = SFS_PREPARE,
   CFS_PREPARE, REPORTS_VIEW; Reviewer = SFS_REVIEW, CFS_REVIEW, REPORTS_VIEW; Viewer =
   REPORTS_VIEW. Preparing and reviewing are kept apart (segregation of duties). Neither
   includes EDIT_ACCESS_APPROVE, CONFIG_MANAGE or USER_ADMIN.
5. **Configuration defaults.** Reporting currency = functional currency for every seeded entity.
   Translated currencies = the currencies of the consolidation levels each entity belongs to.
   Holidays: one group-wide list, seeded with fixed-date Indian national holidays (Independence
   Day, Gandhi Jayanti, Christmas, Republic Day) for the seeded years.
6. **Local infrastructure.** Embedded PostgreSQL 16 (`embedded-postgres`) and a local
   uploads folder. No Docker. See [How local infrastructure works](#how-local-infrastructure-works).

## Open questions

These need confirmation from the process owners before the related features are built.

1. **Exchange-rate source.** Which website and which rate (As-Is Open Question 2)?
2. **FCTR.** The current workbooks show no FCTR account (As-Is Open Question 1). Confirm that
   FCTR is to be introduced as the translation balancing figure, as CLAUDE.md specifies.
3. **Eliminations.** Which reports are extracted and how (As-Is Open Question 3)?
4. **Veracity currencies** (see Decision 2) and their Xero extraction steps (As-Is §3–4) still
   need final confirmation.
5. **Permission templates.** Confirm the template contents in Decision 4, in particular
   whether Reviewers should also approve edit-access requests (EDIT_ACCESS_APPROVE).
6. **Password and session policy.** Confirm the 12-hour session length, whether passwords
   should expire or not be reused, and whether the master should also be locked out after
   5 failed attempts (currently: yes, like everyone).
7. **Historical rates.** The seeded historical rates are illustrative and flagged. Confirm the
   actual rates at which share capital and premium were issued, per entity and currency.
8. **Which historical rates are required.** Currently: every translated currency, the parent's
   functional currency, and every consolidation-level currency the entity belongs to. Confirm.
9. **Holiday calendars.** One group-wide list, or a list per country (India, UAE, UK, US,
   Singapore, Sri Lanka)? Should holidays affect CFS and SFS due dates in the same way?
10. **Closing periods.** Should closing a quarter or year require its months to be closed
    first? Should anyone other than CONFIG_MANAGE users be allowed to close periods?
11. **Level currency.** Levels default to the parent's reporting currency. Is a per-level
    override needed (e.g. present L3 India in USD)?

## Known dependency warnings (clean-up later)

`npm install` reports these `npm audit` findings. **Do not run `npm audit fix --force`.** It
would install breaking major versions (Vitest 5, and an older Prisma). All of them are in
development tools only; none ship in the API or web app.

| Package                       | Severity | Via                         | Notes                                      |
| ----------------------------- | -------- | --------------------------- | ------------------------------------------ |
| `deepmerge-ts` < 8            | high     | `prisma` → `@prisma/config` | Prisma CLI only; fixed by a Prisma upgrade |
| `@vitest/mocker` 2.1.0–4.1.10 | moderate | `vitest`                    | Test runner only; fixed in Vitest 5        |

Plan: address them in a dedicated upgrade step (Prisma 7, Vitest 5), with tests.
