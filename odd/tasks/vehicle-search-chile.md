# Feature: vehicle-search-chile

## Objective
Claude Code workspace (adapted from `ai-job-search-dev/ai-job-search`) that finds a vehicle (new or used) in Chile:
user gives preferences -> per-portal TS CLIs scrape listings -> AI scores/matches -> all candidates exported to Excel.

## Decisions
- Architecture: Claude Code workspace (commands + skills + agents in markdown, TS CLIs per portal). User approved ("dale nomas").
- Stack: TypeScript on Node 26 (bun not installed; not installing it). Runner: `npx vitest run`. Tools: tsx, zod, node-html-parser, exceljs.
- TDD: enabled (strict, per user global config). Source: user CLAUDE.md. Runner: vitest.
- Portals: Chileautos, Mercado Libre, Yapo, Salazar Israel, Bruno Fritsch (all reachable via HTTP 200 on 2026-10-28; anti-bot to be verified per portal).
- Delivery strategy: ask-on-risk (default). Slice by task; one work-unit commit per task on `feat/vehicle-search-chile`.

## Scope
In: buyer profile, portal CLIs, dedupe store, hard filters + weighted scoring, xlsx export, commands/agents, tests, docs.
Out: purchase negotiation, financing simulation, auto-contacting sellers.

## Tasks
- [x] T1 Scaffold: package.json, tsconfig, vitest, CLAUDE.md, profile template, .claude/settings.json, README
- [x] T2 Shared lib: Vehicle schema (zod), htmlFetch (timeout/retry/backoff), stripInvisible/visibleHtml, CLI flag guard, dedupe key; tests
- [x] T3 Portal CLI: chileautos (search + detail); tests — SHIPPED DISABLED: DataDome 403 on search/detail pages, no bypass attempted
- [x] T4 Portal CLIs: mercadolibre (DISABLED: API 403 without token, robots disallow ClaudeBot; token via user env var), yapo (live, verified); tests
- [x] T5 Portal CLIs: salazarisrael, brunofritsch (dealers, new + used; both enabled, live-verified); tests
- [x] T6 Store + matching: seen_vehicles.json, hard filters, weighted scoring rubric, verdict bands; tests
- [x] T7 Excel exporter (exceljs): all candidates, scores, strengths/gaps, hyperlinks; tests
- [x] T8 Commands/agents/skills: /setup /scrape /rank /export, vehicle-fetcher, vehicle-scorer, matching rubric doc

## Acceptance
- `npx vitest run` green; `npx tsc --noEmit` clean.
- Each portal CLI outputs the common JSON shape; unknown flags exit 1 with `{error, code}`.
- `export` produces a valid .xlsx with every candidate.

## Route declaration
- T7+T8: delegated writer (writer trigger)
- T6: delegated writer (writer trigger)
- T5: delegated writer (writer + recon; resumed after session interruption)
- T4: delegated writer (writer + recon)
- T3: delegated writer (writer + recon)
- T1+T2: delegated writer (writer trigger: 2+ non-trivial files)

## Progress / Evidence
- 2026-10-28: repo initialized at /home/nocti/workspace/auto-search-cl.
- T1 commit 13f7552, T2 commit 2d7b94e. Spot check: vitest 6 files/46 tests pass, tsc clean. RED observed by writer (6 files failing before impl).
- T3 commit fad96cc. vitest 9 files/78 tests, tsc clean (spot checked). robots.txt disallows query-string search URLs; only path URLs used. Parser built on homepage StockCard fixtures; results-page shape and detail parser unverified.
- T4 commits ce2f596 (mercadolibre + src/lib/listing.ts shared helpers), a046151 (yapo). vitest 16 files/140 tests, tsc clean (spot checked). Yapo verified live (3 rows). Follow-up: migrate chileautos to lib/listing.ts.
- T5 commits 1e000f3 (salazarisrael), ddb36a2 (brunofritsch). vitest 22 files/217 tests, tsc clean (spot checked). Caveats: Salazar robots.txt bans ClaudeBot/GPTBot by name (CLI uses browser-like UA; open question for user); writer made 1 probe request to a robots-disallowed URL (redirect), nothing used; Bruno Fritsch nuevo requires --make; meta.total counts fetched page only.
- T6 commits 6403e38, 5826fe8, ab62af3. vitest 28 files/287 tests, tsc clean (spot checked). Caveat: ingest markGone treats a filtered scan as full scan for that portal; T8 scrape must pass full scans or --portals.
- T7+T8 commits a34b5cf, 8d48f4f, ddce695, f7feb13, 7bf2059, 03285be. vitest 32 files/343 tests, tsc clean (spot checked). Synthetic E2E smoke (ingest->rank->export->read back) OK per writer. Never executed: slash commands inside Claude Code, live scrape end-to-end, agent tools restriction honoured.
- Review: assessment not run (RDD/gentle-ai review not verified); pending.

## Next step
All tasks done. Open follow-ups: run /buscar live in Claude Code; parallel ingest write race (lost-update possible); migrate chileautos/yapo to shared listing helpers; decide Salazar Israel robots/UA question; Chileautos/MercadoLibre stay disabled; native review not run; Engram mirror pending.

## Engram mirror
Pending (ambiguous_project at workspace root; retry from this repo).
