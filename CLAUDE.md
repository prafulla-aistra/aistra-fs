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
- Levels are derived from the parent tree (engine deriveConsolidationLevels; never hard-code
  them): every active parent with subsidiaries prepares a level, unless its
  entity.preparesConsolidation is off (Configuration → Group structure → "Not a level"); then its
  members are consolidated in the next level up. The ultimate parent always prepares one.
  Decision 2026-10-15 (user): no separate Unconstrained level, as in the Financials workbook:
  L1 India (IN+AE+UK+UC+Veracity, INR), L2 US (all, USD). (Was four levels incl. Veracity and
  Unconstrained; the client process doc v2 §5.1 also lists an Unconstrained level.)
- Veracity (provisional, Aug-2026): VS holds Veracity Group combined (VS+VM) in USD from the
  workbook; VM is inactive. Revert (SGD, reactivate VM) when Xero trial balances per entity exist.
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
- Email goes through one MailService (MAIL_DRIVER): outbox (./data/outbox + API log) locally,
  SMTP when configured. Password change from the user menu emails a one-time link (60 min,
  SHA-256 stored, single use, earlier links void, all sessions end).
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
- Aistra brand colours (logo: violet #6C48F2 on black). Colours are CSS tokens in
  apps/web/src/index.css (token names teal / mint kept for the existing classes): ink #14112B
  (sidebar #110F1F, headings), Aistra violet #6C48F2 (primary, active, links; hover #5935DB; light
  #A996FF on dark backgrounds), lavender #F0ECFE (selected/highlight), page #F7F6FB, cards #FFFFFF,
  borders #E3E0EE; status: done #0E7C66 on #E7F4EF (success-surface), in progress #D97706, not
  started #64748B, overdue/error #B42318. Use tokens, never ad-hoc colours. Keep WCAG AA.
- Font: Inter (bundled via @fontsource-variable, works offline); tabular numbers everywhere.
- Illustrations are original inline SVG; no stock images or external assets.

## Before going live
- DEMO_MODE=false (demo users and demo tasks not seeded, quick-login endpoints absent/404);
  run npm run demo:remove-tasks and deactivate demo users if they were ever seeded. No FIXED_TODAY.
- COOKIE_SECURE=true (HTTPS only); JWT_SECRET from a secrets manager.
- Change MASTER_EMAIL / MASTER_PASSWORD; remove or deactivate any demo users that exist.
- Replace illustrative historical rates and holidays with confirmed values.

## Decisions
- Consolidation levels: see Consolidation (2 levels since 2026-10-15; Unconstrained not a level).
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

- Decisions round 1 (seed marker decisions-round1, prisma/seed-decisions-round1.ts):
  1. No verified samples: keep the demo data; expected-figure tests stay skipped.
  2. Rates come from a FREE API (FBIL not mandatory for now): "Fetch from free API" on the task
     rates panel (the task period's months) and Configuration → Exchange rates (a month). ECB
     reference rates via Frankfurter (cross through EUR) for ECB currencies, currency-api
     (fawazahmed0) for the rest (AED, LKR); RateFeedService fetches, engine monthFromDaily computes:
     closing = last working day, average = mean of working-day rates, opening = previous month's
     closing, 10 dp. Preview first; only ended months; locked months skipped; audited with the
     source. Manual entry / upload stay.
  3. Acquisitions stay illustrative (TBC); the register has an Excel template download and a
     filled-template upload (engine parseAcquisitionTemplate; preview, then confirm; nothing saves
     with an error; matched on subsidiary + parent + date; rows not in the file are kept).
  4. One group calendar (India, holiday.calendar = GROUP) drives every due date. Optional
     per-entity country calendars (entity.holidayCalendar, setting PER_ENTITY_HOLIDAYS, off by
     default) only add an informational per-entity SFS due date. Historical rates stay TBC.
  5. Veracity SGD / LKR stay TBC and never block.
  6. Approval defaults: Monthly SFS 1, Quarterly / Annual SFS 2, CFS Levels 1–3 1, CFS Level 4
     (top parent) 2. approval_rule.periodType; resolution entity+period → entity → period →
     default (pickApprovalRule). EDIT_ACCESS_APPROVE separate, master only by default. Nobody
     decides their own edit-access request, nor one for an entity / level they submitted or
     last edited in that task (EditAccessService.decideConflict).
  7. CFS "IC difference above threshold" is BLOCKING while unexplained, WARNING once explained
     (20+ characters); the explanation shows in the review pack and the IC eliminations note.
  8. NCI measurement per acquisition: PROPORTIONATE or FAIR_VALUE (+ NCI fair value, subsidiary
     currency). Total goodwill = (cost + NCI FV) − 100% × net assets × acquisition rate; parent
     share = cost − parent % × net assets; NCI share added to NCI. Default (null): FAIR_VALUE when
     the level parent's GAAP is US GAAP, else PROPORTIONATE (TBC; nciMethod). P&L IC differences
     go to FSLI IC_DIFF_PL (P&L, expense, consolidation only, under Other expenses in every
     format); balance differences stay in IC_DIFF.
  9. Statutory details are their own record (statutory_details, statutory_officer with effective
     dates), not the entity master. Board approval date and place of signing are entered on the
     task (signing_details, key = entity or "L<n>", editable until the task is Done); exports sign
     with the officers effective at the board approval date (StatutoryService.signature).
  10. Upload profile plBasis PERIOD (default) / YTD: period P&L = YTD − previous month's YTD
      (that TB required, else the upload is an ERROR; April as is); BS lines are closing
      balances; earlier months' profit on line YTD-PRIOR (auto-mapped to RETAINED); tb_line
      .ytdAmount keeps the uploaded YTD figure (engine ytdToPeriod). Quarterly / annual SFS:
      PERIOD_MONTHS_FINALISED (warning) and PERIOD_TIES_TO_MONTHS (blocking, 0.50, unless
      task_entity.periodTieExplanation, 20+ characters; engine periodTiesToMonths). TBC: what a
      Zoho date-range TB export contains.

- Configuration C2: report formats are versioned (format_version / format_line); a task stores
  its format version; saving a version used by a finalised report creates the next version.
  Coverage check (engine checkFormatCoverage) must pass before a format saves. Global settings
  RATE_SOURCE, IC_DIFF_THRESHOLD (1.00), VARIANCE_PCT_THRESHOLD (0.20) live in app_setting.
  Config rate uploads preview first and skip locked months; config COA edits need a reason
  when an existing mapping changes (source CONFIGURATION).

- Client groupings (seed marker client-groupings, prisma/seed-client-groupings.ts): the client's
  "Grouping" column (entity TB sheets of the monthly Financials workbook) is the mapping basis.
  Groupings without a statutory FSLI got their own FSLIs (engine CLIENT_FSLIS, placed next to an
  anchor FSLI in Statutory / Investor); the Management format (v2) is the client's layout line for
  line. Engine client-groupings.ts: GROUPING_FSLI, readGroupingSheet, planGroupingImport; an
  account naming another group entity goes to the intercompany FSLI of its grouping (IC_REC /
  IC_PAY / INV_SUB / IC_REV / IC_EXP) with that counterparty, shown on the client's line. Import:
  Configuration → Chart of accounts → Import groupings (preview, reason when mappings change).
- Mapping freeze (entity.mappingFrozen): frozen after the Aug-2026 baseline import; tasks map new
  accounts only (MAPPING_FROZEN otherwise); changes in Configuration with a reason; freeze /
  unfreeze audited. TBC: SHARE_APP historical rate, SBC_RES opening rate.
- New FSLIs from Configuration → FSLI master → Add FSLI (ReferenceService.createFsli, engine
  placeNewFsli): every active format is checked with the FSLI placed next to an anchor FSLI (own
  line in the chosen formats, added to the anchor line's totals) before it is created; formats are
  then saved through FormatsService.save (versioned). Import groupings also matches a grouping to
  an FSLI by name, so a new client grouping needs no code change.

## Open questions (do not guess)
- Zoho: the trial balance report JSON is undocumented; confirm the first real fetch equals the
  Zoho UI TB for the same dates. OAuth state is in memory (sticky sessions or DB on AWS).
- Exchange-rate source: the round-1 default (FBIL / USD cross rates) is TBC; what a Zoho
  date-range TB export contains; NCI default by GAAP; illustrative acquisitions and NCI fair
  value; country holiday lists; signing details after a task is Done.
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

- Page 10: signature block (no statutory details); recomputed comparatives of demo levels; CFS
  check severities (TBC); basis of consolidation wording; FCTR memo sign.
- Page 9: illustrative acquisitions register; NCI presentation (PL_NCI, proportionate goodwill);
  P&L IC differences to IC_DIFF; level currency changes; computed translations' RE roll-forward.
- Page 8 / C3: control-check defaults and thresholds (TBC); approval levels and named people per
  entity; Reviewer template and EDIT_ACCESS_APPROVE; full downloads of earlier versions; mapping
  and comparatives screens of finalised entities show the live chart of accounts.

- Notes: whether stale-number checks should also compare figures in other currencies / units;
  whether related-party and exchange-rate notes should be generated automatically again (the
  Page 7 intercompany and rates notes are now ordinary template notes); Note 2 versus the new
  "Significant accounting policies" template (Page 7's Note 1 / Note 2 text was replaced).
- Statements (page 7): draft comparatives are translated with retained earnings at the opening
  rate; the demo UK Aug-2026 is finalised, so its 6390 is mapped by the demo seed (the rebuild from
  verified files asked for it unmapped: a finalised entity cannot have unmapped accounts); Excel exports actual amounts whatever units are shown.

## Zoho Books integration conventions
- One Zoho connection (erp_connection, provider ZOHO; refresh token AES-256-GCM encrypted with a
  key derived from JWT_SECRET; access tokens in memory only) holds every Zoho entity's
  organisation; erp_organisation_link maps entity → organization_id (Configuration →
  Integrations, CONFIG_MANAGE, audited). Xero (Veracity) is not connected yet.
- ZohoClient (src/integrations) is the only code that talks to Zoho (tests stub its http());
  ZohoService loads organisations, the chart of accounts and reports/trialbalance.
- Engine zoho-tb.ts: parseZohoTrialBalance (tolerant reader; net / closing amounts first),
  zohoTbCsv, zohoFetchRange (PERIOD = task period; YTD = from 1 April), suggestOrganisationLinks.
- "Fetch from Zoho" stores a CSV (uploaded_file.source ZOHO, sourceMeta with the raw response's
  storage key) and goes through the same preview → checks → confirm as an uploaded TB; it never
  changes the entity's column profile.

## Review and finalise (page 8) conventions
- Checks: engine runSfsChecks(data, register) over the control_check register (C3, editable);
  segregationOfDuties decides who may review/approve. ReviewService gathers the data; the web only
  displays.
- Submission (review_submission) per entity: ACTIVE / WITHDRAWN / RETURNED / APPROVED, with the
  checks and acknowledgements; levels snapshotted from approval_rule at submission. Any data
  change calls SubmissionGuard (withdraws the active submission, records lastEditedById).
- Finalise is one transaction: re-run checks, final_snapshot (FINAL, SHA-256 of the canonical
  JSON with pack.state.finalised = null), statement/translation snapshots source FINALISE, rate
  months locked, entity FINALISED. Reopen (approved edit access) adds a WORKING version; FINAL
  versions are never changed.
- Notifications are written in the same transaction as the change they report.

## Consolidation (page 9) conventions
- Engine consolidation.ts: generateEliminations (IC balances / P&L, investment with goodwill or
  capital reserve, NCI, brought-forward and manual entries), consolidatedAmounts,
  eliminationChecks, eliminationSummary, validateManualAdjustment. Every line 2 dp, every entry
  balances. The API (src/consolidation) only loads snapshots and configuration and saves.
- Members' figures come only from finalised SFS statement snapshots; a missing level currency is
  translated from the snapshot's functional accounts with translateTB.
- consolidation_run holds the generated entries per level (replaced on regenerate; stale when a
  fresh computation differs); consolidation_adjustment holds manual adjustments (level currency).
- Configuration: intercompany_pair (matrix with tolerance) and acquisition + acquisition_rate (a
  rate into the parent's currency and every level currency); seed runs once (marker
  SEED_APPLIED page9-consolidation).

## Consolidation levels (page 10) conventions
- A CFS level reuses the SFS tables with the key "L<n>" in entity_code: entity_note (notes),
  review_submission / sign_off / review_query (review), final_snapshot (level snapshot),
  edit_access_request (reopen). NotesService works on a NotesScope (SFS entity or level); the web
  notes and review components take their API base from ApiBaseContext.
- Statements, notes figures, review and finalise read ConsolidationService.levelData(): the level
  snapshot once finalised (immutable), else members' SFS snapshots + the generated run.
- Engine: profitAttribution, fctrSplit, fctrMovement, equityAttribution (consolidation.ts) and
  runCfsChecks (cfs-checks.ts) over the CFS register (control_check, statementType CFS).
- note_template.applies_to: SFS, CFS or ALL; GENERATED note blocks are filled from the level
  (SUBSIDIARIES, GOODWILL, NCI, IC_SUMMARY, FCTR).

## Demo data
- India Aug-2026 is seeded In progress (step Notes), ready to submit (page 8 click-through).
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
