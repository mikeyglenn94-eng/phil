# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**MG Coaching / Phil** — a voice-first training platform for athletes and coaches. Coaches build and manage programmes; athletes log sessions (strength, WOD, run, cycle, swim) via a client portal; an AI coach ("Phil", GPT-5.2 via Replit AI Integrations) parses natural-language session descriptions into structured data and answers in-context chat.

Full product overview lives in `replit.md` — read it for the domain model (roles, team/programme publishing, athlete workout logger UX, rest timer, brain modules). Notable user preference from that file: **UI copy must not use em-dashes (—), only periods and commas.**

## Workspace layout

pnpm monorepo (`pnpm-workspace.yaml`), Node 24, TypeScript 5.9. Packages are under:

- `artifacts/api-server` — Express 5 API (`@workspace/api-server`). Entrypoint `src/index.ts`, mounted at `/api`, routes aggregated in `src/routes/index.ts`.
- `artifacts/coach-app` — Vite + React 19 PWA (`@workspace/coach-app`). Single app serves all roles; routing in `src/App.tsx` dispatches by JWT role.
- `artifacts/mockup-sandbox` — sibling sandbox (deployed as separate artifact).
- `lib/db` — Drizzle ORM schema + pg client (`@workspace/db`). Schema files per domain under `src/schema/`.
- `lib/api-spec` — source-of-truth `openapi.yaml` + Orval config. **Do not hand-edit `lib/api-client-react/src/generated` or `lib/api-zod/src/generated`** — they are regenerated from `openapi.yaml`.
- `lib/api-client-react` — generated React Query hooks + `customFetch` mutator.
- `lib/api-zod` — generated Zod request/response schemas (consumed by the server for validation).
- `lib/integrations-openai-ai-{server,react}` + `lib/integrations/openai_ai_integrations` — Replit AI SDK wrappers.
- `scripts` — workspace tsx scripts.

Pinned versions for shared frontend deps (react, tailwind, vite, drizzle, zod, framer-motion, etc.) are declared in the workspace `catalog:` — consumers reference them via `"catalog:"`, so bump them in `pnpm-workspace.yaml`, not individual package.jsons.

## Commands

All pnpm, run from repo root unless noted. `preinstall` enforces pnpm (rejects npm/yarn).

- `pnpm install` — install deps. Postmerge hook (`scripts/post-merge.sh`, wired via `.replit`) additionally runs `pnpm --filter db push` after a merge.
- `pnpm build` — root: runs `typecheck` then `pnpm -r --if-present run build` across the workspace.
- `pnpm typecheck` — typechecks lib project references (`tsc --build`) then each artifact + scripts package.
- `pnpm typecheck:libs` — just the `lib/*` TS project references.

Per-package:

- API server: `pnpm --filter @workspace/api-server dev` (builds via `build.mjs` esbuild, then `node dist/index.mjs`). Requires `PORT` and `DATABASE_URL` env vars — `src/index.ts` throws without `PORT`. Uses pino logging and source maps.
- Coach app: `pnpm --filter @workspace/coach-app dev` (Vite, `--host 0.0.0.0`). `pnpm --filter @workspace/coach-app build` / `serve`.
- DB schema push: `pnpm --filter @workspace/db push` (drizzle-kit, reads `DATABASE_URL`). Use `push-force` only when you understand the destructive implications.
- API codegen: `pnpm --filter @workspace/api-spec codegen` — regenerates `lib/api-client-react/src/generated` and `lib/api-zod/src/generated` from `lib/api-spec/openapi.yaml`. **Run this after any OpenAPI edit** and commit the regenerated output.

No test runner is configured in this repo — don't invent a `pnpm test`. Type-safety is the primary static check.

## Architecture notes that span files

**Auth + routing.** JWT (7-day) in `localStorage`; `AuthProvider` (`coach-app/src/contexts/auth-context.tsx`) surfaces `user.roles` (`athlete | coach | admin`) and `user.clientId`. `App.tsx` gates every route with `RequireAuth` and role-redirects wrong roles to their home. The athlete portal (`/client`, `/chat`, `/client/nutrition`) is wrapped in `ClientPortalWrapper` which force-selects `user.clientId` to prevent stale-client leaks after a coach→athlete switch.

**Global providers.** Order in `App.tsx` matters: `QueryClientProvider → TooltipProvider → AuthProvider → ChatProvider → RestTimerProvider → WouterRouter`. `RestTimerProvider` is mounted *outside* the router on purpose (see `replit.md` rest-timer section) so the timer survives navigation.

**API surface.** Every server route module is a `Router` and composed in `api-server/src/routes/index.ts` — adding an endpoint means (1) editing `openapi.yaml`, (2) running codegen, (3) adding a route file and registering it in `routes/index.ts`, (4) validating the request with the generated Zod schema from `@workspace/api-zod`. "Brain" routes (`wod-brain`, `run-brain`, `swim-brain`, `cycle-brain`) are the AI-parse/search surfaces for each sport; new sports follow that same module shape.

**Sessions data model.** Sessions live in PostgreSQL with a flexible JSONB payload so the same row can represent strength/WOD/run/cycle/swim. Session source types (`cycle_brain`, `swim_brain`, etc.) drive which parse/search path and UI colour is used (cycling amber `#ea580c`, swimming sky `#0284c7`). The unified `WorkoutPreviewEditorCard` handles both create and edit across all session types.

**Athlete session-logging flow.** See `coach-app/src/pages/client-session.tsx`:
- Set commits trigger **autosave** (`lib/autosave.ts`, 400ms debounced, offline-queued in IndexedDB via `lib/idb-queue.ts`).
- Set commits also fire the **rest timer** — commit detection is intentionally outside the `setLogs` state updater for React StrictMode safety, with a per-`(exId,setIdx)` dedupe ref that resets when `sessionId` changes. Rest intervals are parsed by `lib/parse-rest.ts`.
- Finish flow: marks session `completed` → POST `/clients/:clientId/session-summary` (Epley PB tally + Phil commentary) → injects two chat bubbles (text + feedback-prompt chips). Feedback chip taps persist to `session_feedback`.

**Published team sessions.** Publishing a team session copies rows to each member so per-athlete edits diff against the original — keep that copy semantics in mind when changing session mutation code.

**Admin metrics.** `/admin` "Platform Metrics" tab hits `admin-metrics` routes and refreshes every 30s; API cost tracking comes from `api-server/src/lib/log-api-cost.ts`.

## Conventions

- UI copy: no em-dashes anywhere in user-facing strings (enforced in `coaching.ts` system prompt and swept from `client-area.tsx`).
- Generated code (`lib/api-client-react/src/generated`, `lib/api-zod/src/generated`) is rewritten by Orval — edit `openapi.yaml` instead.
- When adding/changing DB schema, edit `lib/db/src/schema/*.ts` and run `pnpm --filter @workspace/db push` against the target database.

## Product rules (voice + copy)

### Voice
- Phil's persona: gruff, direct, dry-humoured. No corporate language.
- Never use em-dashes (already noted in Conventions, reinforce here).
- Always write contractions in full subject-verb form: "I've been building" not "been building". Applies to all user-facing copy where first person is used.
- No weak CTAs like "worth a reply if you're interested". No salesy framing. No fake urgency.

### Copy rules for workout rendering
- Order: progression THEN clear results. Never the other way round.
- Never say "easy run". Use specific pace/effort language instead.
- Primary compounds: hard cap 5 sets, exact rep counts (decreasing across sets, e.g. 5/4/3/2/1).
- Accessories: hard cap 4 sets, always rep ranges (e.g. 8-12), never below 6 reps.

### Intent classification
- Copy/reschedule keywords must be checked BEFORE the AI planner runs, no
