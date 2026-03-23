# Coach - Voice Training Programme Builder

## Overview

A voice-first internal tool for fitness coaches to create structured training programmes by speaking naturally. The app converts speech into structured exercise data, allows manual editing, and renders polished programme output that can be exported.

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

## Key Features

1. **Voice Input** — Browser Speech Recognition API, continuous mode, interim transcript display
2. **AI Parsing** — GPT-5.2 converts natural language into structured exercise data (sets, reps, RPE, rest, tempo, notes, week progression)
3. **Manual Editing** — Inline editing of all exercise fields, drag-to-reorder, add/delete exercises
4. **Live Preview** — Right-panel preview updates in real-time, styled for professional output
5. **Programme Management** — Create, save, edit, duplicate, delete programmes (stored in PostgreSQL)
6. **Export** — Copy formatted text to clipboard, Print/PDF via browser print dialog

## Database Schema

- `programmes` table: `id`, `title`, `exercises` (JSONB), `createdAt`, `updatedAt`
- Exercises stored as JSONB with full Exercise type (name, sets, reps, RPE, rest, tempo, notes, weekProgression)

## API Endpoints

- `GET /api/programmes` — list all programmes
- `POST /api/programmes` — create programme
- `GET /api/programmes/:id` — get programme
- `PUT /api/programmes/:id` — update programme
- `DELETE /api/programmes/:id` — delete programme
- `POST /api/programmes/:id/duplicate` — duplicate programme
- `POST /api/parse` — parse transcript via AI
- `POST /api/transcribe` — transcribe audio (fallback, not used in browser since Web Speech API is used)

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit AI Integrations proxy URL
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Replit AI Integrations API key

## TypeScript & Composite Projects

- `lib/*` packages are composite and emit declarations via `tsc --build`
- `artifacts/*` are leaf workspace packages
- Root `tsconfig.json` lists all lib packages as project references

## Important Workflow

1. Write OpenAPI spec in `lib/api-spec/openapi.yaml`
2. Run codegen: `pnpm --filter @workspace/api-spec run codegen`
3. Build frontend with `pnpm --filter @workspace/coach-app run dev`
4. Push DB schema: `pnpm --filter @workspace/db run push`
5. Restart API server: `pnpm --filter @workspace/api-server run dev`
