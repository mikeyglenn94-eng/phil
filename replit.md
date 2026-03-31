# Axis - Voice Training Programme Builder

## Overview

A voice-first internal tool for fitness coaches to create structured training programmes by speaking naturally. The app shows a calendar (TrainHeroic-style) as the home screen, with sessions scheduled per day. Clicking a day opens a session editor with voice input, AI parsing, and live preview.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)
- **Frontend**: React + Vite (Tailwind CSS v4, shadcn/ui)
- **AI**: Replit AI Integrations (OpenAI GPT-5.2 for parsing, Web Speech API for STT in browser)
- **DnD**: @dnd-kit/core, @dnd-kit/sortable for drag reordering

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── coach-app/          # React + Vite frontend (/)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── integrations-openai-ai-server/  # OpenAI server-side integration
│   └── integrations-openai-ai-react/   # OpenAI React hooks
├── scripts/
└── package.json
```

## Frontend Pages & Routing

- `/` — **Calendar home** — multi-week Mon-Sun grid, programme selector in header, sessions shown per day. Click empty day → new session editor. Click session → edit session.
- `/programmes/:programmeId/sessions/:sessionId` — **Session editor** — full-screen, voice input + exercise list (DnD reorder) + live preview panel. `sessionId=new` for new sessions (pass `?date=YYYY-MM-DD`).

## Key Features

1. **Calendar Home** — 4-week grid (Mon-Sun), today highlighted, session name badge + exercise list preview per day, add/navigate programmes
2. **Voice Input** — Browser Speech Recognition API, continuous mode, interim transcript display
3. **AI Parsing** — GPT-5.2 converts natural language into structured exercise data (sets, reps, RPE, rest, tempo, notes, week progression)
4. **Manual Editing** — Inline editing of all exercise fields, drag-to-reorder, add/delete exercises
5. **Live Preview** — Right-panel preview updates in real-time, styled for professional output
6. **Programme Management** — Create, save, edit, duplicate, delete programmes (stored in PostgreSQL)

## Database Schema

- `programmes` table: `id`, `title`, `sessions` (JSONB), `createdAt`, `updatedAt`
- Sessions stored as JSONB: `[{ id, date, name?, color?, exercises[] }]`
- Each exercise: `{ id, name, sets, reps, rpe, rest, tempo, notes, weekProgression[] }`

## Engine Builder Module

Multi-session aerobic engine programme in `artifacts/api-server/src/routes/engine-builder.ts`.
- Templates: Engine Builder 6 Week Block (Hinshaw-style: threshold / VO2 max / aerobic base)
- 3 sessions/week spread Mon / Wed / Fri per week; 18 sessions total over 6 weeks
- Session colours: Threshold = amber (#f59e0b), VO2 Max = red (#ef4444), Aerobic Base = green (#16a34a)
- Modality-agnostic: run / row / ski / assault bike / echo bike / bike erg (athlete chooses each session)
- Routes: `GET /api/engine-builder/templates`, `POST /api/engine-builder/insert`
- Brain search category: `"engine"` — triggered by keywords: engine, vo2, aerobic base, threshold, hinshaw

## Strength Blocks Module

Built-in strength programme engine stored in `artifacts/api-server/src/routes/strength-blocks.ts`.
- Templates: Smolov Jr, Russian Squat Routine, Full Smolov (Smolov Senior), Beginner Squat Builder
- Routes: `GET /api/strength-blocks/templates`, `GET /api/strength-blocks/templates/:id`, `POST /api/strength-blocks/preview`, `POST /api/strength-blocks/insert`, `POST /api/strength-blocks/nlp`
- Insertion creates a `programmesTable` row with `clientId` set, so sessions appear directly in the client's training calendar
- UI: `artifacts/coach-app/src/pages/strength-blocks.tsx` — library cards, week accordion detail, insert dialog with NLP + client picker + start date + session preview

## API Endpoints

- `GET /api/programmes` — list all programmes
- `POST /api/programmes` — create programme (`{ title, sessions? }`)
- `GET /api/programmes/:id` — get programme
- `PUT /api/programmes/:id` — update programme (`{ title?, sessions? }`)
- `DELETE /api/programmes/:id` — delete programme
- `POST /api/programmes/:id/duplicate` — duplicate programme
- `POST /api/parse` — parse transcript via AI → exercises[]
- `POST /api/transcribe` — transcribe audio (fallback)

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit AI Integrations proxy URL
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Replit AI Integrations API key

## TypeScript & Composite Projects

- `lib/*` packages are composite and emit declarations via `tsc --build`
- `artifacts/*` are leaf workspace packages
- Root `tsconfig.json` lists all lib packages as project references

## Future Roadmap — B2C Self-Serve

The intended next phase is B2C self-serve, with the coach acting as a guide/brand rather than hands-on with each client. Key things needed before launch:

1. **Self-registration** — Signup page where users create their own account (currently clients are created manually by the coach)
2. **Multi-tenancy** — Each user's data must be fully isolated; currently all clients are visible under one coach view
3. **Payments** — Stripe subscription to gate access before a user can use the app
4. **AI onboarding flow** — User answers a few intake questions → AI generates their first programme automatically (the `/api/generate-programme` endpoint is already built, just needs a frontend intake form)
5. **Coach-as-guide content** — A curated library of WODs, run sessions, and strength programmes in the Brain that all users draw from; plus optional weekly check-in or community touchpoint

The core product (calendar, sessions, nutrition diary, AI parsing, Brain search) is already user-ready. The gap is auth/payments/multi-tenancy — roughly a few weeks of build work.

## Important Workflow

1. Write OpenAPI spec in `lib/api-spec/openapi.yaml`
2. Run codegen: `pnpm --filter @workspace/api-spec run codegen`
3. Build frontend with `pnpm --filter @workspace/coach-app run dev`
4. Push DB schema: `pnpm --filter @workspace/db run push` (or push-force for column changes)
5. Restart API server after schema changes
