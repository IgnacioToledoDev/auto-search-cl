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
- [ ] T1 Scaffold: package.json, tsconfig, vitest, CLAUDE.md, profile template, .claude/settings.json, README
- [ ] T2 Shared lib: Vehicle schema (zod), htmlFetch (timeout/retry/backoff), stripInvisible/visibleHtml, CLI flag guard, dedupe key; tests
- [ ] T3 Portal CLI: chileautos (search + detail); tests
- [ ] T4 Portal CLIs: mercadolibre, yapo; tests
- [ ] T5 Portal CLIs: salazarisrael, brunofritsch (dealers, new + used); tests
- [ ] T6 Store + matching: seen_vehicles.json, hard filters, weighted scoring rubric, verdict bands; tests
- [ ] T7 Excel exporter (exceljs): all candidates, scores, strengths/gaps, hyperlinks; tests
- [ ] T8 Commands/agents/skills: /setup /scrape /rank /export, vehicle-fetcher, vehicle-scorer, matching rubric doc

## Acceptance
- `npx vitest run` green; `npx tsc --noEmit` clean.
- Each portal CLI outputs the common JSON shape; unknown flags exit 1 with `{error, code}`.
- `export` produces a valid .xlsx with every candidate.

## Route declaration
(updated per task: inline | delegated + trigger)

## Progress / Evidence
- 2026-10-28: repo initialized at /home/nocti/workspace/auto-search-cl.

## Next step
T1 scaffold.

## Engram mirror
Pending (ambiguous_project at workspace root; retry from this repo).
