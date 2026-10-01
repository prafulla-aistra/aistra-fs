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

> **Demo data – not verified.** The sample trial balances, rates and charts of accounts in
> `./samples` and the demo seed were generated for development (`apps/api/prisma/sample-data.ts`)
> and are not the verified sample files. Nothing in them is tuned to hit an expected result
> (each TB balances through its bank account only). The expected-figure tests of pages 3–7
> are skipped ("waiting for verified sample files"); every logic test (TB balances, statements
> tie, notes tie to the face, translations net to zero) still runs. The dashboard shows the
> same banner while demo tasks exist.

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

| Aug-2026                | Expected                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| IN debits = credits     | 787,777,348.66 INR                                                                                 |
| IN accounts to map      | 1455 Advance to Suppliers Dr 400,000.00 → CUR_OTH; 6120 Staff Welfare Expenses Dr 350,000.00 → EMP |
| IN profit after mapping | 17,760,764.50 INR                                                                                  |
| IN INR→USD              | opening 0.0115740741 · closing 0.0115074799 · average 0.0115473441 · historical 0.0133333333       |
| UK                      | 6390 Bank Charges → OTH_EXP; profit 29,500.00 GBP after mapping                                    |

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

| Aug-2026 vs Jul-2026 | Expected                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| IN source            | Finalised (SFS-2026-07-001), 46 accounts, 769,056,584.16                   |
| IN roll-forward      | 165,000,000.00 Cr + 16,356,584.16 Cr = 181,356,584.16 Cr ✓                 |
| IN flags             | 1300 Prepaid Expenses −33.3%; 6400 Office Expenses −50.0%; New 1455, 6120  |
| UK                   | 95,000.00 Cr + 27,000.00 Cr = 122,000.00 Cr ✓; no flags; New 6390 (900.00) |

### Currency translation (page 6)

Step 4 of the SFS workspace (`/tasks/:id?step=TRANSLATION`), same entity tabs, one tab per
translated currency ("INR → USD").

- **Engine `translateTB`**: closing for assets and liabilities, average for P&L, historical for
  share capital and premium (opening + warning if missing), opening for other reserves,
  retained earnings rolled forward from the finalised prior-period translation when the
  roll-forward check passes (else opening + warning), account rate-basis overrides. Rates at
  full precision (40 significant digits); each line rounded to 2 dp half away from zero;
  PROFIT = translated P&L; FCTR = −(translated balance sheet + PROFIT), so the translated TB
  nets to exactly 0.00. A missing opening / closing / average rate, or an unmapped account,
  fails that currency.
- Page: rates card (with source months for quarters/years), method card and warnings,
  translated TB (basis filter, override badges, FCTR row, totals with ticks), summary in the
  target currency (assets = liabilities + equity ✓), FCTR movement against the finalised
  comparative ("Exchange differences on translation (OCI) – for information"), and a
  collapsible explanation of the rules. Recalculated each time it opens; a notice appears when
  rates changed since you last viewed. Continue needs every currency translated.
- Translations are stored as snapshots (`translation_snapshot`) when an entity is finalised
  (page 8). The demo Jul-2026 task is seeded with snapshots made by `translateTB` (Jul RE at
  the opening rate, as there is no finalised June), so Aug-2026 rolls forward from them.

The sample data was revised again for page 6 (India: 1010 Operating Bank, 4000 Sales,
securities premium 400,000,000, no contra-asset accounts; UK share capital 200,000; INR Jul
opening 85.80 / average 86.10; GBP Jul 0.7380 / 0.7420 / 0.7400 and Aug 0.7420 / 0.7470 /
0.7450). All page 4 and 5 results still hold.

| Aug-2026     | RE               | Profit          | FCTR            | Total assets  | FCTR movement |
| ------------ | ---------------- | --------------- | --------------- | ------------- | ------------- |
| IN INR → USD | 2,113,048.88 Cr  | 205,089.66 Cr   | 939,726.38 Dr   | 8,576,724.39  | 46,082.42     |
| UK GBP → USD | 165,212.77 Cr    | 39,597.32 Cr    | 11,738.76 Cr    | 652,610.43    | 3,010.74      |
| UK GBP → INR | 14,186,201.93 Cr | 3,429,127.52 Cr | 3,275,366.67 Cr | 56,711,847.39 | 32,771.03     |

### Statements and notes (page 7)

Step 5 of the SFS workspace (`/tasks/:id?step=STATEMENTS`), same entity tabs.

- **Engine** (`packages/engine/src/statements.ts`): `buildStatement` (line = sum of FSLIs x
  display sign: assets and expenses +1; liabilities, equity and income -1; totals + / - of the
  lines above; the marked total-assets, total-equity-and-liabilities and profit lines),
  `fsliAmounts` (PROFIT = P&L total, plus FCTR), `noteNumbers` (1 corporate information,
  2 policies, then one per line with a value, balance sheet first), `lineNote`,
  `intercompanyNote`, `scaleAmount` (units, each figure rounded on its own) and
  `statementTitle`.
- **Controls**: format (task format by default; others show "Preview – not the task format"),
  currency (functional and each translated currency), tabs Balance sheet / Profit and loss /
  Notes to accounts, units (Actual, Thousands, Lakhs, Crores, Millions; Lakhs and Crores use
  Indian digit grouping; "Figures may not add due to rounding"), "Show nil lines", Export to
  Excel (this currency or all currencies), Print / PDF (A4, statement pages, page numbers).
- **Statements**: title block, Particulars | Note | current | comparative (page 5's source, in
  the same currency, translated with its own period's rates or read from its finalised stored
  figures), headings bold, subtotals with a rule above, totals with a double rule below,
  negatives in brackets, ticks on total equity and liabilities (= total assets) and on profit
  (= profit carried to the balance sheet); a failed tie shows the difference. A line opens its
  note; a note figure shows the TB account (functional amount, rate, translated amount).
- **Notes**: Note 1 auto-drafted from the entity master (editable, audited); Note 2 accounting
  policies (editable, "Draft – to be reviewed", carried forward from the entity's previous
  task); one note per line with its accounts (counterparty for intercompany), computed items
  (profit, FCTR) listed separately and a total ticked against the face; the intercompany note
  ("Related party balances – intercompany (full related party disclosure to follow)"); the
  exchange-rates note for translated currencies.
- **Excel** (exceljs): Cover, BS, P&L, Notes (per currency for "all currencies"), TB (functional
  with the FSLI mapping), Translation <ccy>, Checks. Real numbers with number formats;
  subtotals, totals and note totals are SUM formulas over the lines above; frozen panes;
  column widths. Amounts are exact 2 dp values that become Excel numbers only there.
- **Rules**: no journals or manual adjustments ("Corrections are made in the ERP and the trial
  balance re-uploaded, so the statements always agree to the books."). "Continue to review and
  finalise" is always enabled and saves the step. Finalised entities and done tasks read the
  stored figures (`statement_snapshot`), never recalculated; the demo seed stores them for the
  finalised demo entities.

The sample data was revised again for page 7 (India only): other income 250,000; employee
costs 33,310,000; other expenses 5,750,000 (cost of services 220,000); depreciation 1,400,000;
tax 1,900,000 (current 2,000,000, deferred -100,000); trade receivables 28,840,000 (the rest of
the former receivables is in the bank, now the balancing account). TB totals, profit, retained
earnings, the translation results and the page 4–6 expectations are unchanged (the page 6 bank
line is now 6,039,394.36 USD).

| India Aug-2026 (Jul-2026) | Monthly internal, INR           | USD                         |
| ------------------------- | ------------------------------- | --------------------------- |
| Revenue                   | 59,870,764.50 (57,506,584.16)   | 691,348.32 (667,904.58)     |
| EBITDA                    | 20,810,764.50 (19,406,584.16)   | 240,309.06 (225,395.88)     |
| Profit before tax         | 19,660,764.50 (18,256,584.16)   | 227,029.62 (212,039.32)     |
| Tax                       | 1,900,000.00 (1,900,000.00)     | 21,939.96 (22,067.36)       |
| Net profit                | 17,760,764.50 (16,356,584.16)   | 205,089.66 (189,971.96)     |
| Total assets              | 745,317,348.66 (727,556,584.16) | 8,576,724.39 (8,420,793.78) |
| Total equity              | 699,117,348.66 (681,356,584.16) | 8,045,078.81 (7,886,071.57) |
| Total liabilities         | 46,200,000.00 (46,200,000.00)   | 531,645.58 (534,722.21)     |

Statutory, INR: III Total income 60,120,764.50 · Employee benefits expense 33,310,000.00 ·
Other expenses 5,750,000.00 · Total expenses 40,460,000.00 · VII Profit 17,760,764.50 ·
(a) Equity share capital 100,000,000.00 · (b) Other equity 599,117,348.66 · (ii) Trade
receivables 85,618,978.63. Lakhs: total assets 7,453.17.

### Notes to accounts (step "Notes")

Its own workspace step after Statements (stepper: Upload · Map · Comparatives · Translation ·
Statements · Notes · Review · Finalised).

- **Templates per format** (Configuration → Report formats → Notes): title, type (line note,
  narrative note, custom table note), linked line, default text (placeholders such as
  {legalName}), mandatory, order. Statutory: corporate information, basis of preparation,
  significant accounting policies (seven policy blocks), one line note per statement line,
  related parties, contingent liabilities and commitments, events after the reporting period,
  other information. Internal and Investor: a shorter set. CONFIG_MANAGE adds, edits, reorders
  and removes them; removing is blocked while a finalised report uses the format.
- **Notes per entity and period**: list (number, title, status, stale-figure count) and editor;
  "18 of 22 notes reviewed". A note is ordered blocks: figures (the accounts on its line,
  current and comparative, grouped into sub-captions with subtotals; every account sits in one
  sub-caption or "Other", so the note still totals to the face, ticked), text (label and rich
  text: bold, italic, bullets, numbered lists) and custom tables (columns, numeric validation,
  memo or "must agree to line X" with a tick). Add, edit, reorder and delete blocks; add custom
  notes anywhere; line notes cannot be deleted while their line has a value. Nil notes without
  text are hidden (numbering skips them) unless mandatory. The statements' Note column uses
  the same numbers and links to the note.
- **Live figures**: "Insert figure" in a text block picks current / comparative / variance /
  variance % of a statement line, FSLI, account or sub-caption; the chip always shows the
  figure in the selected currency and units, and moves to the new period when rolled forward.
- **Roll forward**: the first time an entity reaches Notes, everything is copied from its last
  finalised SFS (titles, order, blocks, texts, sub-captions with their accounts, custom tables;
  a table's current column moves to the comparative column and the current one is left blank).
  Without a finalised prior period, the format's templates are used. Rolled notes start
  "Carried forward – not reviewed"; the side panel shows the note as last finalised and the
  words added / removed since.
- **Stale-number check** (engine `staleNumbers`): a typed number that equals a figure of the
  last finalised period (any line, FSLI, account or custom-table value) but no figure of this
  period is flagged ("This looks like last period's figure (30,000). Update it or replace it
  with a live figure."); live figures are never flagged.
- **Status**: Carried forward – not reviewed / Edited / Reviewed; editing a reviewed note sets
  it back to Edited. Edits auto-save, every version is kept (`entity_note_version`) and
  audited; finalised entities are read-only.
- **Exports**: Word (.docx) and PDF of the full set (cover, balance sheet, P&L, notes in order;
  entity and period in the header, page numbers in the footer). The Excel export's Notes sheet
  carries the note text, figures (SUM formulas for sub-captions and totals) and custom tables.
- **Demo**: the finalised Jul-2026 India note set is seeded (text blocks, cash sub-captions, a
  live figure, a custom table, and "Prepaid expenses of 1,200,000", which the Aug-2026 roll
  forward flags because prepaid expenses are 800,000 in Aug).

### Configuration: entities and group structure (C1)

- **Layout**: a grouped left menu (Organisation · Currencies · Calendar · Reporting · Access).
  Every page has a title, a one-line purpose, a count and its main action. Users without
  CONFIG_MANAGE see "View only – you can see configuration but not change it."; change buttons
  stay visible but disabled, with the tooltip "Needs configuration access – ask your
  administrator".
- **Entities**: list with effective group %, filters and search; "Add entity" wizard (basics,
  currencies, ownership with a live preview of the tree and levels, historical rates, review);
  entity page with Overview, Currencies and historical rates, Ownership history, Chart of
  accounts, Tasks and reports, Change history.
- **Rules (API)**: the code never changes (2–4 capital letters); the functional currency is
  fixed once the entity has a finalised report; currency changes need a reason; the parent and
  % held change only by adding an ownership row effective from a month (history kept, reason
  required, structure validated from that month on); deactivation needs a reason and is blocked
  by open tasks or active subsidiaries; no hard delete.
- **Group structure**: org chart (legal name, code, currency, % held, effective group % =
  engine `effectiveOwnership`), consolidation levels with "NCI arises for" (engine `nciPoints`)
  and a level-currency override (audited), shown "as at" any month (engine `ownershipAsAt`).
  New CFS tasks snapshot the levels in force for their period.

### Configuration: rates, formats, FSLI, chart of accounts (C2)

No configuration page is a placeholder any more. CONFIG_MANAGE edits; REPORTS_VIEW views; every
change is audited with old and new values.

- **Exchange rates**: grid of months (newest first, grouped by FY) × currencies, each cell
  opening / closing / average to 10 dp. Status per month: Complete, Missing rates, or Locked
  (with the finalised reports that lock it). Checks (engine `reviewRateMonth`): missing values,
  opening ≠ prior closing, a move over 10%. Click a month to edit it in a drawer (locked months
  are read-only); "Add next month" pre-fills opening from the prior closing. Upload shows a
  preview first (N new, N changed, N skipped because locked, N unchanged); saving skips locked
  rows. Excel template and export (rates written as text, so no floating point). Cross-rate
  viewer: month + two currencies → O/C/A with the formula (engine `crossRate`).
- **Settings** (table `app_setting`): rate source (shows "To be confirmed – Open question 2"
  until set, also on every task rate panel), IC difference threshold (default 1.00), variance
  threshold (default 20%, stored as 0.20).
- **Report formats**: three seeded formats — Monthly internal (management), Investor reporting,
  Statutory FS (Schedule III, Division II; MSME split and ageing schedules not included). Line
  types: heading, line (FSLIs), subtotal/total (+/− of lines above). Display sign: assets and
  expenses as they are; liabilities, equity and income reversed. Editor: tabs per format,
  P&L / balance sheet toggle, drag (or ↑/↓) to reorder, rename, add/delete, indent, formula
  parts, markers (profit; total assets; total equity and liabilities), FSLI placement table,
  live coverage check (engine `checkFormatCoverage`) that blocks saving, preview with a task
  entity's figures (engine `renderFormat`), versions list, duplicate.
- **Versioning**: tasks record the format version. Saving a version used by a finalised report
  creates the next version (the finalised reports keep theirs; tasks not yet finalised move to
  the new one); otherwise the current version is edited in place.
- **FSLI master**: names only (codes, classes and rates fixed); "used by N accounts".
- **Account-type defaults**: add, change and remove ERP type → FSLI (system FSLIs refused).
- **Chart of accounts**: entity selector; stats (accounts, mapped %, unmapped, intercompany
  without counterparty); filters; inline edit of type, FSLI, counterparty and rate-basis
  override (engine `validateMapping`; a reason is required when changing an existing mapping;
  type/class warnings must be confirmed; source "Edited in configuration"); Zoho COA upload
  with a preview (same merge rule as the task upload); export to Excel.

Check with India Jul-2026 (finalised): every format previews profit 16,356,584.16 and a
balance sheet of 727,556,584.16 = 727,556,584.16. Leaving "Other expenses" (OTH_EXP) off the
Statutory format gives "Other expenses (OTH_EXP) is not placed on any P&L line." and the save
is refused (400).

### Configuration: approvals, control checks, edit access (C3)

- **Control checks** (Configuration → Control checks): the register run before a standalone
  submission. Each check has a severity (Blocking stops the submission; Warning needs an
  acknowledgement of at least 10 characters; Information is shown only), a threshold where it
  applies, and an active flag. The seeded defaults are proposals, flagged "To be confirmed".
- **Approvals** (Configuration → Approvals): one default rule per statement type and optional
  entity overrides: 1 review level (a reviewer approves and finalises) or 2 (a reviewer, then a
  different approver), optionally limited to named people. Segregation of duties is always
  enforced: whoever prepared (submitted) or last edited an entity cannot review or approve it,
  and with two levels the reviewer and the approver are different people.
- **Edit access** (/edit-access, EDIT_ACCESS_APPROVE): a preparer asks to reopen a finalised
  entity with a reason; an approver (never the requester) approves or rejects (with a reason).
  Reopening is refused while a finalised consolidation level of the same period includes the
  entity ("Reopen the consolidation first: …").

### Review and finalise (page 8)

- **Review step** (per entity): the review pack in 10 collapsible sections — control checks
  (engine `runSfsChecks`, each with a "Go to" link), key figures, significant variances, notes
  review status, translation (rates, FCTR, retained-earnings method), intercompany balances,
  source files with SHA-256, changes since the last submission, review queries, sign-offs and
  acknowledgements.
- **Submit**: blocked by any failing blocking check; each failing warning needs an
  acknowledgement; the declaration "I confirm the trial balance agrees to <ERP> as at <period
  end>, and all accounts are mapped and reviewed." must be ticked. Any later change (TB, mapping,
  explanation, note, rates, chart of accounts) withdraws the submission automatically and tells
  the reviewers.
- **Queries**: a reviewer raises a query on a statement line, account, note, check or the
  entity; the preparer answers (optionally attaching a file); the reviewer closes or reopens it.
  Open or answered queries block approval. Markers show on statement lines, the notes list and
  the TB mapping table.
- **Return / approve**: returning needs a comment (10+ characters). Approving at the last level
  finalises in one transaction: checks re-run, an immutable snapshot (TB, mapping, translations,
  figures, notes, rates, checks, acknowledgements, queries, sign-offs) with a SHA-256 hash, the
  period's exchange-rate months locked, the entity Finalised (the task Done when all are).
- **Finalised step**: banner with the hash, downloads (Excel, Word, PDF, review record PDF),
  request edit access, and the versions (v1 kept when v2 is opened; compare key figures).
- **Bell** (top bar): notifications for submissions, withdrawals, queries, returns, finalising
  and edit-access decisions. Dashboard: "items awaiting your review" and "open queries".

### Browser tests

`npm run test:browser` runs Playwright journeys in Chromium against a separate instance
(API on 3001, web on 5174, the test database and ./data/uploads-test): the SFS journey (upload
→ map → comparatives → translation), the configuration journeys (add / view / deactivate an
entity as master; view-only buttons as Priya) and C2 (format coverage blocks saving when
"Other expenses" is unplaced; locked rate months and the cross-rate viewer; view-only pages).
The SFS journey continues to statements (formats, currencies, units, the Excel export's SUM
formulas) and notes (roll forward, a stale figure replaced by a live one, a sub-caption, a
custom table note, review, Word export). First time only: `npx playwright install chromium`.

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
| `npm run test:browser`          | Browser journeys (Playwright) on a separate test instance           |
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
    entity's _current_ chart of accounts. Storing each finalised report's own mapped lines
    comes with the finalise step; until then a later re-mapping also changes finalised
    comparatives. Confirm this is acceptable meanwhile.
19. **Variance explanations** are per account (Account view). Should FSLI-level flags also
    need an explanation?
20. **Materiality not set.** An entity without a materiality amount is flagged on the 20%
    rule alone. Confirm, or require materiality for every entity.
21. **Month-only trial balances (resolves question 12).** Page 5's roll-forward (Aug opening
    RE = Jul RE + Jul profit) implies monthly TBs carry only that month's P&L. The sample
    data now follows this. Confirm with the Zoho/Xero export settings.
22. **Roll-forward source on page 6.** Translation re-runs the retained-earnings check against
    the immediately preceding period itself (it does not rely on the result stored when step 3
    was completed), so it is always current. Confirm.
23. **FCTR movement comparative.** The movement uses the task's comparative basis (previous
    period, or same period last year). Confirm which the statements should show.
24. **Unmapped accounts** stop the translation of that currency (a "fail"). Confirm, or should
    they be translated at closing / average by default?
25. **Deactivating in the middle of a period.** Deactivation has no "effective from" date: an
    inactive entity drops out of every structure, including earlier months (finalised
    consolidations keep their snapshot). Confirm, or should deactivation be dated like ownership?
26. **Ownership changes in finalised months.** An ownership change may be effective from a month
    whose consolidation is already finalised; the finalised snapshot is unaffected, but a new
    task for that month would use the new structure. Should such changes be blocked?
27. **Entity code length.** New codes are 2–4 capital letters (as requested); the seeded codes
    are 2 letters. Confirm that digits are never needed.
28. **Control-check defaults (C3).** The register's severities and thresholds (e.g. retained
    earnings roll-forward tolerance 1.00) are proposals flagged "To be confirmed".
29. **Approval levels.** Default is one review level for SFS and CFS. Confirm per entity whether
    two levels are needed, and who the named reviewers/approvers are.
30. **Reviewers and EDIT_ACCESS_APPROVE.** Should the Reviewer template include edit-access
    approval? Today only the master (and users given the permission) can approve.
31. **Downloads of earlier versions.** The Excel/Word/PDF downloads show the current finalised
    version; earlier versions offer the review record and key figures. Confirm whether full
    statements of earlier versions are needed.
32. **Mapping and comparatives screens for finalised entities** still show the live chart of
    accounts (statements, translation and notes read the snapshot). Confirm.

## Known dependency warnings (clean-up later)

`npm install` reports these `npm audit` findings. **Do not run `npm audit fix --force`.** It
would install breaking major versions (Vitest 5, an older Prisma, an older exceljs). All but
`uuid` are in development tools only; `uuid` ships in the API via exceljs (see its row).

| Package                       | Severity | Via                           | Notes                                                                                                                                                      |
| ----------------------------- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepmerge-ts` < 8            | high     | `prisma` → `@prisma/config`   | Prisma CLI only; fixed by a Prisma upgrade                                                                                                                 |
| `@vitest/mocker` 2.1.0–4.1.10 | moderate | `vitest`                      | Test runner only; fixed in Vitest 5                                                                                                                        |
| `uuid` < 11.1.1               | moderate | `exceljs` (statements export) | Affects v3/v5/v6 called with a buffer; exceljs only calls `v4()` without one. An npm override did not apply in this workspace; revisit in the upgrade step |

Plan: address them in a dedicated upgrade step (Prisma 7, Vitest 5), with tests.
