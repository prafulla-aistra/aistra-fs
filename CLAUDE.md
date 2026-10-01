# Finance Close – project rules

## Non-negotiable accuracy rules
- Never use JavaScript floating-point numbers for money or rates. Use decimal.js in
  the engine and Prisma Decimal (Postgres NUMERIC(20,4) for amounts, NUMERIC(20,10)
  for rates) in the database.
- Sign convention everywhere: debit = positive, credit = negative. A trial balance
  must net to zero.
- Round only at presentation, or at defined points (translated line amounts to 2 dp).
  Balancing figures (FCTR, IC differences) are computed from rounded values so every
  statement ties to the cent.
- All accounting logic lives in packages/engine as pure functions with unit tests.
  The API calls the engine; the web app never calculates accounting numbers.
- Finalised (locked) data is immutable. Changes need an approved edit-access request,
  and every change is written to the audit log (who, what, when, old value, new value).

## Group structure (seed data; editable in configuration)
| Code | Entity | Functional ccy | Parent | Held by parent | ERP | GAAP |
|---|---|---|---|---|---|---|
| US | Aistra Labs Inc (US) | USD | none (ultimate parent) | – | Zoho | US GAAP |
| IN | Aistra GenAI India Pvt Ltd | INR | US | 58.49% | Zoho | Ind AS |
| AE | Aistra Labs AI Software LLC (UAE) | AED | IN | 100% | Zoho | IFRS |
| UK | Aistra Labs UK Ltd | GBP | IN | 100% | Zoho | UK GAAP |
| UC | Unconstrained INC | USD | IN | 100% | Zoho | US GAAP |
| VS | Veracity Services Pte (Singapore) | SGD (to be confirmed, editable) | UC | 100% | Xero | IFRS |
| VM | Veracity Managed Services (Sri Lanka) | LKR (to be confirmed, editable) | VS | 100% | Xero | IFRS |

## Periods
- Indian financial year April–March, labelled "FY 2024-25".
- Period types: Annual (Apr–Mar), Quarterly (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec,
  Q4 Jan–Mar), Monthly.

## Exchange rates
- Stored per month as units of currency per 1 USD: opening, closing, average.
  Cross rates are derived (A→B = rate_B / rate_A).
- Quarter/year: opening = first month's opening, closing = last month's closing,
  average = simple mean of monthly averages (flag this in the UI as an assumption).
- A month's rates lock once any report using that month is finalised.

## Translation (Ind AS 21 / IAS 21)
- Assets and liabilities: closing rate. Income and expenses: average rate.
- Share capital and securities premium: historical rate (from entity master).
- Opening retained earnings: roll forward prior finalised translated RE + translated
  profit; if unavailable, use opening rate and show a warning.
- Other reserves: opening rate (flag).
- FCTR = balancing figure so the translated TB nets to zero; shown in equity.

## Consolidation
- Four levels, run bottom-up: L1 Veracity Services (VS+VM, in SGD), L2 Unconstrained
  (UC+VS+VM), L3 India (IN+AE+UK+UC+VS+VM), L4 US (all). This is a deliberate business
  requirement; it adds one level compared with As-Is document §5.1. Derive levels from
  the parent tree, never hard-code them.
- A level can start only when every level below it is finalised.
- Each entity is translated directly from functional currency into the level currency.
- Eliminations: intercompany receivable/payable and revenue/expense by counterparty
  pair; investment in subsidiary vs share capital + premium with goodwill (capital
  reserve if negative); NCI for partly owned subsidiaries (India 41.51%).
- IC differences above a configurable threshold go to an "IC difference – unreconciled"
  suspense line and are flagged; smaller ones are rounding to FCTR.

## Engineering conventions
- Every step ends with: migrations applied, seed updated, tests passing, app running,
  and a short summary of what was built and how to test it manually.
- Do not build features outside the current step. List open questions instead of
  guessing on accounting treatment.
- Auth is implemented behind an AuthProvider interface so AWS Cognito can replace
  local auth later without changing business code.
- Access control is permission-based (permission table), never hard-coded roles. Every API
  endpoint declares @Public(), @Authenticated() or @RequirePermission('CODE'); the global
  guard denies anything else. The web hides nav items/routes the user lacks and shows
  "You don't have access" on direct URLs, but the API is the real enforcement.
- Audit every state change with AuditService.record(entry, tx), inside the same
  transaction as the change. audit_log is append-only (DB trigger); users are never
  hard-deleted (DB trigger); the master admin cannot be deactivated (DB trigger).
- API errors always have the shape { statusCode, code, message } with a user-readable
  message (ApiError / AllExceptionsFilter).
- File uploads go through one StorageService: a local folder (./data/uploads) today,
  S3 on AWS later. Business code never touches the file system or S3 directly.

## Local infrastructure (no Docker)
- Runs with only "npm install" and "npm run dev"; no Docker, no installs, no admin rights.
- Database: embedded PostgreSQL 16 (npm package embedded-postgres) in ./data/db on
  localhost:54329, started by scripts/embedded-db.mjs. The app uses a normal postgresql://
  DATABASE_URL, so moving to AWS RDS means changing only DATABASE_URL.
  (PGlite was tried first and rejected: Prisma CLI hangs, migration errors swallowed,
  unclean shutdowns on every watch-mode restart.)
- data/ and .env files are git-ignored. docker-compose.yml is optional, kept for AWS work.

## Close tasks and dashboard
- Task status is derived from its entities (SFS) / levels (CFS) via engine deriveTaskStatus;
  never store it. Done tasks are locked. CFS tasks snapshot their levels at creation.
- "Today" comes from ClockService (APP_TIMEZONE, default Asia/Kolkata; FIXED_TODAY for tests).
- Dashboard numbers come only from GET /api/dashboard; visibility follows entity scope.
- Task creation (POST /api/tasks) re-checks every wizard rule server-side; creations for a
  period are serialised with a Postgres advisory lock. Tests delete only non-demo tasks, and
  only in a *_test database.

## UI theme
- Colours are CSS tokens in apps/web/src/index.css: ink navy #0F2A3D (sidebar, headings),
  ledger teal #0E7C66 (primary, active, links), mint #E8F3EF (selected/highlight), page
  #F6F8F7, cards #FFFFFF, borders #D9E2DE; status: done #0E7C66, in progress #D97706,
  not started #64748B, overdue/error #B42318. Use tokens, never ad-hoc colours. Keep WCAG AA.
- Font: Inter (bundled via @fontsource-variable, works offline); tabular numbers everywhere.
- Illustrations are original inline SVG; no stock images or external assets.

## Before going live
- DEMO_MODE=false (demo users and demo tasks not seeded, quick-login endpoints absent/404);
  run npm run demo:remove-tasks and deactivate demo users if they were ever seeded. No FIXED_TODAY.
- COOKIE_SECURE=true (HTTPS only); JWT_SECRET from a secrets manager.
- Change MASTER_EMAIL / MASTER_PASSWORD; remove or deactivate any demo users that exist.
- Replace illustrative historical rates and holidays with confirmed values.

## Decisions
- Consolidation: 4 levels as above (deliberate; one more than As-Is §5.1).
- Veracity currencies: SGD (VS) and LKR (VM), flagged "to be confirmed", editable.
- Rounding: round half away from zero (matches Excel ROUND). No banker's rounding.

- Permission templates: Preparer = SFS_PREPARE, CFS_PREPARE, REPORTS_VIEW; Reviewer =
  SFS_REVIEW, CFS_REVIEW, REPORTS_VIEW; Viewer = REPORTS_VIEW (to be confirmed).

- Configuration (step 2): CONFIG_MANAGE edits, REPORTS_VIEW views; every change audited
  with old/new values. Group rules, consolidation levels, periods and due dates are engine
  functions (validateGroupStructure, deriveConsolidationLevels, generatePeriods,
  calculateDueDate, missingHistoricalRates). Dates are ISO calendar strings (no time zone).
- Configuration seed runs once (marker: audit_log SEED_APPLIED step2-configuration); after
  that the UI owns the data and the seed must never overwrite it.

- Configuration C2: report formats are versioned (format_version / format_line); a task stores
  its format version; saving a version used by a finalised report creates the next version.
  Coverage check (engine checkFormatCoverage) must pass before a format saves. Global settings
  RATE_SOURCE, IC_DIFF_THRESHOLD (1.00), VARIANCE_PCT_THRESHOLD (0.20) live in app_setting.
  Config rate uploads preview first and skip locked months; config COA edits need a reason
  when an existing mapping changes (source CONFIGURATION).

## Open questions (do not guess)
- Exchange-rate source (website and which rate).
- FCTR: confirm it is introduced as the translation balancing figure.
- Elimination method: which reports are extracted and how.
- Historical rates (seeded values are illustrative); which currencies require one;
  per-country holiday calendars; whether closing a quarter/year requires its months closed;
  per-level currency override.
- Template contents (should Reviewers get EDIT_ACCESS_APPROVE?), session length (12 h),
  password expiry/reuse rules, and whether the master is subject to lockout (currently yes).
- Upload data (page 3): month-only vs YTD monthly TBs (period check is exact today); whether
  re-uploading a TB In review resets it to In progress (today: no); Xero account-type
  defaults; whether rate locking should ignore finalised reports that use no rates.

- Review and map (page 4): mapping a finalised entity's accounts (only from another task
  today); keyword list/order for suggestions.

- Comparatives (page 5): finalised comparatives mapped with the current COA until the
  finalise step stores mapped lines; FSLI-level explanations; entities without materiality;
  confirm monthly TBs are month-only (the sample data assumes so).

- Translation (page 6): roll-forward re-checked live against the previous period; FCTR movement
  comparative (task basis); unmapped accounts fail the translation.

- Configuration C1: dated deactivation; ownership changes in finalised months; 2–4 letter codes.

- Notes: whether stale-number checks should also compare figures in other currencies / units;
  whether related-party and exchange-rate notes should be generated automatically again (the
  Page 7 intercompany and rates notes are now ordinary template notes); Note 2 versus the new
  "Significant accounting policies" template (Page 7's Note 1 / Note 2 text was replaced).
- Statements (page 7): draft comparatives are translated with retained earnings at the opening
  rate; the demo UK Aug-2026 is finalised, so its 6390 is mapped by the demo seed (the rebuild from
  verified files asked for it unmapped: a finalised entity cannot have unmapped accounts); Excel exports actual amounts whatever units are shown.

## Demo data
- The demo data is NOT verified (generated by apps/api/prisma/sample-data.ts). Never invent or
  adjust data to make a test pass; report differences instead. Expected-figure tests of pages
  3–7 are skipped until the verified sample files arrive; logic tests always run.

## Notes (step "Notes") conventions
- Engine notes.ts: rollForwardBlocks, figureValue (live figures), groupAccounts (sub-captions),
  checkTable, staleNumbers, wordDiff, numberNotes. NotesService (API) builds the views; the web
  only displays and edits blocks.
- Templates per format (note_template); notes per task entity (entity_note, versions in
  entity_note_version, every change audited). First open rolls forward from the last finalised
  SFS, else templates. Statements' Note column numbers come from NotesService.lineNumbers.
- Sub-caption tokens reference "<noteId>:<subCaptionId>" and are remapped on roll forward.
- A finalised entity's translation and statements are read from snapshots, never recalculated.

## Statements and notes (page 7) conventions
- Statement faces, note numbers, line notes, the intercompany note, units and titles are engine
  functions (statements.ts: buildStatement, fsliAmounts, noteNumbers, lineNote,
  intercompanyNote, scaleAmount, statementTitle). The web only formats text (brackets, Indian
  grouping).
- StatementFiguresService builds account-level figures for every currency (current: the
  translation step's result; comparative: page 5's source, from its finalised stored figures
  where available). Finalised entities / done tasks read statement_snapshot.figures, never
  rebuild. FINALISE snapshots are create-only; SEED (demo) snapshots follow demo-data revisions.
- Note 1 / Note 2 text lives in statement_text (audited); Note 2 carries forward from the
  entity's previous task. No journals or manual adjustments in SFS.
- Excel via exceljs: real numbers, SUM formulas for subtotals, totals and note totals.

## Configuration (C1) conventions
- Ownership is history (entity_ownership rows, effective from a month); never overwrite it.
  Entity.parentCode / heldByParentPct mirror the row in force this month. Structures, levels
  and new CFS tasks use the rows in force for the month concerned (EntitiesService
  groupStructure(asAt)).
- Configuration pages use ConfigPage (title, purpose, count, action) and EditButton: change
  buttons are never hidden from view-only users, only disabled with the tooltip.
- Browser tests: npm run test:browser (Playwright; test database, ports 3001/5174).

## Currency translation (page 6) conventions
- translateTB (engine) is the only translation logic: rates at full precision, lines rounded
  to 2 dp half away from zero, FCTR = −(translated BS + PROFIT) so the translated TB nets to 0.
- apps/api/src/uploads/translation-inputs.ts loads its inputs; the API and the demo seed both
  use it. Snapshots (translation_snapshot) are the finalised translations used as the prior
  period (RE roll-forward) and the FCTR movement comparative.
- The sample data is tuned so pages 4–6 expected results hold to the cent; change it only with
  those tests (apps/api/prisma/sample-data.ts explains the tuning).

## Comparatives (page 5) conventions
- Monthly TBs carry that month's P&L only; opening retained earnings roll forward
  (prior RE + prior profit). Sample data follows this.
- comparativePeriod, rollForwardCheck, varianceFlag, compareAccounts / compareFslis are
  engine functions. The API resolves the source (Finalised → Draft → Uploaded here → None).
- TbVersion.purpose: CURRENT (the task period's TB) or COMPARATIVE (uploaded on step 3, this
  task only). Every "latest TB" query for a task must filter purpose CURRENT.
- The roll-forward result is stored on TaskEntity.rollForward when step 3 is completed.

## Review and map (page 4) conventions
- Accounts to map, FSLI suggestions, mapping validation, FSLI totals, intercompany summary
  and cross rates are engine functions (mapping.ts, rates.ts crossRate). The API only loads
  data and saves; the web app only displays.
- Mappings live in the entity chart of accounts (shared by all tasks); a save records
  source TASK_MAPPING and the task ("Mapped in task …"), audited old → new. Changing an
  existing mapping needs a reason.
- Sample data (apps/api/prisma/sample-data.ts) is tuned so the page 4 expected results hold
  exactly; tests assert them. Change it only together with those tests.

## Upload data (page 3) conventions
- TB parsing, checks, COA merge and rate-file parsing are engine functions (tb-parser,
  tb-checks, coa-parser, rates, fsli-inference). The API reads spreadsheets (SheetJS, in
  apps/api/src/uploads/sheets.ts) and stores originals through StorageService.
- TB versions are append-only; the latest decides the entity's upload status. Unbalanced
  (> 0.01) = status ERROR and the entity cannot continue.
- Page 3 seed (FSLIs, type defaults, charts of accounts, rates) is create-only; samples in
  ./samples are generated from apps/api/prisma/sample-data.ts.

## Dependencies
- Never run "npm audit fix --force". Known audit warnings (dev tools only) are listed in
  README for a later clean-up step.
