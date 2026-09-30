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

### Dashboard (page 1)

The landing page after sign-in. All counts come from one endpoint, `GET /api/dashboard?period=`,
and the task table from `GET /api/tasks`. Both respect the user's entity scope.

- **Period in close:** defaults to the latest month whose end date has passed (29-Sep-2026 →
  Aug-2026); the switcher changes every card. Shows SFS/CFS due dates and working days left, or
  "overdue by N days" (the SFS deadline until every standalone statement is finalised, then CFS).
- **Task status is derived** (engine `deriveTaskStatus`), in this order: Done = every entity
  (SFS) or level (CFS) finalised, and the task is then locked; Not started = all not started;
  In progress = any not started or in progress, even if others are in review or finalised
  (work remains); In review = nothing left to prepare and at least one in review. Overdue = not
  Done and today after the due date ("overdue by N days" counts calendar days).
- **Cards:** standalone "X of Y entities finalised" (Y = active entities in scope; no task =
  not started); consolidation "X of N levels" (levels containing an entity in scope) with the
  next level; last period Done / N items open; needs your attention: entities to prepare
  (SFS_PREPARE) and entities awaiting review (SFS_REVIEW) in the selected period and scope,
  edit-access requests, and overdue tasks.
  Each card filters the task table.
- **Table actions:** Continue when the user may prepare and an entity/level in their scope is
  not started or in progress; otherwise View (read-only). The task workspace and edit-access pages are placeholders until the next pages.
- **Demo tasks** (demo mode only, flagged `is_demo`): Jul-2026 SFS and CFS Done, Aug-2026 SFS in
  review. Remove them with `npm run demo:remove-tasks`.

### New task wizard (page 2)

`/tasks/new`, from the dashboard's New task button or the menu. Seven steps appear one below
another: task type (only types the user may prepare; MIS shown as coming later), financial
year (open years; default = the one containing today), period type, period, format (default =
the user's last choice), entities (SFS) or consolidation levels (CFS), and review. A summary
panel follows the choices; changing an earlier answer clears the period with a note.

- **Period tiles** are tagged by the API: Available · Task exists (with a link) · Not ended yet ·
  Closed. A period can be prepared only after its end date. Periods where a task exists stay
  selectable so step 6 can show what is left (or "Open task").
- **Task numbers:** `SFS-2026-08-001` (monthly), `SFS-FY27-Q1-001` (quarterly), `SFS-FY27-001`
  (annual); CFS likewise. New tasks start at step 1 "Upload data", every entity/level Not
  started, and are audited (`TASK_CREATE`).
- **Server-side rules** (`POST /api/tasks`): permission for the type; entities within the user's
  scope (CFS needs every level member in scope); period and financial year open; period ended;
  format active; at least one entity; no entity in two SFS tasks for the same period (409 with
  the existing task number); one CFS task per period. A second SFS task for the remaining
  entities of a period is allowed.
- **Formats:** "Statutory FS" and "Management FS" are seeded; the Formats configuration screen
  comes later. Financial years now have an open/closed status (no screen to close one yet).

### Upload data (page 3)

Task workspace `/tasks/:id` (SFS), step 1 of the stepper. The API computes every status and
total; the web app only shows them.

- **Exchange rates panel:** every functional and translated currency of the task's entities
  (not USD) × each month of the period, Opening / Closing / Average, each Present or Missing.
  "Upload rate file" (columns Month, Currency, Opening, Closing, Average; month as `Aug-26` or
  `2026-08`) or "Enter manually". Warnings: opening ≠ prior month's closing, and a move of more
  than 10% from the prior month. A month is **locked** once any report whose period includes it
  is finalised (the Aug-2026 demo task has finalised entities, so Aug-2026 is locked); locked
  values can be re-sent unchanged but never changed (409). Rates are group-level.
- **Entity cards:** Trial balance (mandatory), Chart of accounts (optional), Other documents
  (optional, several files). Drop a file or choose one; Replace; View versions; file names
  download the original.
- **TB upload:** .xlsx / .xls / .csv up to 10 MB, stored with a SHA-256 hash (warning if the same
  file was used for another entity or period). Header row found by "Account Code" in the first
  40 rows; column confirmation dialog with sign convention and a 10-line preview; settings are
  remembered per entity. Exact decimals (thousands separators, `(1,234.00)`, Dr/Cr suffixes;
  spreadsheet numbers are rounded to 2 dp via text). **Debits must equal credits (±0.01)** —
  otherwise the version is saved as Error and the entity cannot continue. Period or
  organisation mismatches must be acknowledged. Accounts not in the chart of accounts are listed
  for the next step. Every version is kept.
- **COA upload:** new codes get the default FSLI for their account type (marked suggested);
  existing codes get name/type/parent updates only — FSLI and counterparty are never touched.
- **Continue to review and map** moves entities with a validated TB to step 2; the rest stay.
- **Master data:** 54 FSLIs, Zoho account-type defaults, each entity's chart of accounts (from
  its Jul-26 sample TB, FSLI inferred by name/type, intercompany counterparties resolved), and
  rates Apr-26 to Aug-26. The demo tasks come with their TBs already uploaded (Jul: all 7;
  Aug: US, IN, AE, UK, UC), so Aug-2026 shows "5 of 7 entities validated".
- **Samples:** `./samples` (committed) holds `Trial_Balance_<code>_Jul-26.xlsx` / `_Aug-26.xlsx`
  for all 7 entities, `Chart_of_Accounts_IN_sample.xlsx` and
  `Exchange_Rates_per_USD_sample.xlsx`. They are illustrative figures generated from
  `apps/api/prisma/sample-data.ts`; `npm run samples:generate` rewrites them. The Aug-26 TBs
  contain IN 1455, IN 6120 and UK 6390, which are not in the seeded charts of accounts.
- **Rules:** uploads need SFS_PREPARE and the entity in scope (403); a Done task or finalised
  entity is read-only (409); rates need SFS_PREPARE, CFS_PREPARE or CONFIG_MANAGE. Every
  upload, rate change, acknowledgement and "continue" is audited.

### Review and map (page 4)

Step 2 of the SFS workspace (`/tasks/:id?step=MAPPING`). One entity at a time (tabs, or a
dropdown on small screens; the choice is remembered per task). An entity without a validated
TB shows "Upload a trial balance first".

- **Exchange rates:** "1 <functional> = X <target>" for each translated currency — opening,
  closing, average (10 decimals, cross rates from the USD master; the formula shows on hover)
  and the historical rate from the entity master. Missing rates are red with a link to fix them.
- **Accounts to map:** TB accounts not in the chart of accounts, without an FSLI, or without a
  needed counterparty. Suggested FSLI: the same account name in another entity's chart of
  accounts, then keywords in the name, then the account-type default (the source is shown).
  Saving validates (FSLI required; counterparty required for IC_REC / IC_PAY / IC_REV / IC_EXP /
  INV_SUB, not the entity itself, active; INV_SUB only a direct subsidiary; account type vs
  FSLI class conflict must be ticked) and writes to the chart of accounts as "Mapped in task …",
  audited. Partial saves are allowed.
- **Trial balance with mapping:** filters, search, debit/credit columns and a totals tick.
  Changing an existing mapping needs a reason.
- **FSLI summary** (profit for the period; FSLI total = TB total check) and **intercompany
  summary** per counterparty. Engine: `crossRate`, `suggestFsli`, `validateMapping`,
  `fsliTotals`, `intercompanySummary`.
- **Continue to comparatives** needs: TB balanced, 0 accounts to map, every IC/investment line
  with a counterparty. Missing rates only warn here. The entity's step is saved.
- **Configuration → Chart of accounts** lists each entity's accounts with FSLI and source
  (read-only for now).

The sample data was revised on page 4 so the expected results below hold exactly (the seed
updates seeded rates and demo TBs that nobody has changed):

| Aug-2026 | Expected |
|---|---|
| IN debits = credits | 787,777,348.66 INR |
| IN accounts to map | 1455 Advance to Suppliers Dr 400,000.00 → CUR_OTH; 6120 Staff Welfare Expenses Dr 350,000.00 → EMP |
| IN profit after mapping | 17,760,764.50 INR |
| IN INR→USD | opening 0.0115740741 · closing 0.0115074799 · average 0.0115473441 · historical 0.0133333333 |
| UK | 6390 Bank Charges → OTH_EXP; profit 29,500.00 GBP after mapping |

### Comparatives (page 5)

Step 3 of the SFS workspace (`/tasks/:id?step=COMPARATIVES`), same entity tabs as step 2.

- **Compare with** "Previous period" (month → previous month, April → March of the previous
  FY; Q1 → previous Q4; year → previous FY) or "Same period last year"; saved per task.
- **Source**, resolved by the API: Finalised (the entity's finalised SFS for that period) →
  Draft – not finalised (a validated TB in another task; with a warning) → Uploaded here (a
  comparative TB uploaded on this step: same column dialog and checks as step 1, stored for
  this task only) → None (blank columns; continue is still allowed). No upload when a
  finalised source exists.
- Comparative lines use the entity's current chart of accounts; unmapped comparative accounts
  show the step 2 "Accounts to map" panel, and the comparative stays blank until they are
  mapped.
- **Retained-earnings roll-forward** (engine `rollForwardCheck`): opening RE = prior RE + prior
  profit within 1.00, previous-period basis only. The result is stored on continue for the
  translation step.
- **Comparison table**, Account or FSLI view: current, comparative, variance, variance %,
  flags (≥ 20% of the comparative AND ≥ the entity's materiality; retained earnings never;
  a nil comparative is tagged New), tags New / Nil this period, filters, and explanations on
  flagged rows (audited). Materiality is a new entity-master field; the 20% is the global
  setting `VARIANCE_PCT_THRESHOLD` (table `app_setting`).
- **Continue to currency translation** is always enabled; unexplained flags are a warning.

The sample data was revised again for page 5: **monthly TBs now hold the month's P&L only**,
and each month's opening retained earnings = the previous month's retained earnings + profit.
India's accounts follow the page 5 list (1300 Prepaid Expenses, 6400 Office Expenses, 48
accounts in Aug, 46 in Jul). All page 4 results still hold.

| Aug-2026 vs Jul-2026 | Expected |
|---|---|
| IN source | Finalised (SFS-2026-07-001), 46 accounts, 769,056,584.16 |
| IN roll-forward | 165,000,000.00 Cr + 16,356,584.16 Cr = 181,356,584.16 Cr ✓ |
| IN flags | 1300 Prepaid Expenses −33.3%; 6400 Office Expenses −50.0%; New 1455, 6120 |
| UK | 95,000.00 Cr + 27,000.00 Cr = 122,000.00 Cr ✓; no flags; New 6390 (900.00) |

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
| `npm run demo:remove-tasks`     | Delete the demo close tasks (they return while DEMO_MODE=true)      |
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
12. **Monthly TB basis.** Are monthly trial balances exported for the month only
    ("From 01/08/2026 To 31/08/2026") or year to date ("From 01/04/2026 …")? Today only an
    exact match with the task period passes without a warning.
13. **Re-uploading in review.** Uploading a new TB for an entity that is In review is allowed
    and does not change its status. Should it send the entity back to In progress?
14. **Xero account types.** Only Zoho account-type defaults are defined; Veracity (Xero)
    accounts fall back to the Zoho list. What are the Xero defaults?
15. **Rate locking scope.** A month locks when any report for a period containing it is
    finalised — including a USD entity's SFS that uses no rates. Confirm, or lock only on
    reports that actually use the rates.
16. **Mapping finalised entities.** A chart-of-accounts mapping is shared by all tasks, but a
    finalised entity's task is read-only — so UK 6390 (UK is finalised in the Aug-2026 demo
    task) can only be mapped from another task, or after an edit-access request. Confirm.
17. **Keyword list for suggestions.** "fee" → Other expenses is checked after the
    professional-fees keywords, and "rent" matches the whole word only (so "current account"
    is not rent). Confirm the keyword list and order.
18. **Finalised comparatives.** A finalised comparative uses its TB lines mapped with the
    entity's *current* chart of accounts. Storing each finalised report's own mapped lines
    comes with the finalise step; until then a later re-mapping also changes finalised
    comparatives. Confirm this is acceptable meanwhile.
19. **Variance explanations** are per account (Account view). Should FSLI-level flags also
    need an explanation?
20. **Materiality not set.** An entity without a materiality amount is flagged on the 20%
    rule alone. Confirm, or require materiality for every entity.
21. **Month-only trial balances (resolves question 12).** Page 5's roll-forward (Aug opening
    RE = Jul RE + Jul profit) implies monthly TBs carry only that month's P&L. The sample
    data now follows this. Confirm with the Zoho/Xero export settings.

## Known dependency warnings (clean-up later)

`npm install` reports these `npm audit` findings. **Do not run `npm audit fix --force`.** It
would install breaking major versions (Vitest 5, and an older Prisma). All of them are in
development tools only; none ship in the API or web app.

| Package                       | Severity | Via                         | Notes                                      |
| ----------------------------- | -------- | --------------------------- | ------------------------------------------ |
| `deepmerge-ts` < 8            | high     | `prisma` → `@prisma/config` | Prisma CLI only; fixed by a Prisma upgrade |
| `@vitest/mocker` 2.1.0–4.1.10 | moderate | `vitest`                    | Test runner only; fixed in Vitest 5        |

Plan: address them in a dedicated upgrade step (Prisma 7, Vitest 5), with tests.
