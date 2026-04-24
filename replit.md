# MG Coaching - Voice Training Programme Builder

## Overview

MG Coaching is developing a voice-first training platform for athletes and coaches. The platform aims to revolutionize sports training by offering AI-assisted program generation, self-serve capabilities for athletes (calendar, session logging, WOD recording, run tracking), and robust analytics. It includes an AI coaching layer and comprehensive team program management features. The system supports role-based access for athletes, coaches, and administrators, each with tailored experiences. The long-term vision includes a B2C self-serve model, positioning coaches as guides rather than hands-on managers, expanding market reach through self-registration, multi-tenancy, and subscription-based access, with AI-driven onboarding and personalized program generation.

## User Preferences

- All Phil messages and UI copy must use periods/commas. No em-dashes (—) anywhere. This is enforced in the coaching.ts system prompt and swept from all client-area.tsx UI strings.

## System Architecture

The MG Coaching platform is a monorepo managed with pnpm workspaces, utilizing Node.js 24 and TypeScript 5.9. The backend is built with Express 5, connecting to a PostgreSQL database via Drizzle ORM. Zod is used for validation, and Orval handles API codegen from an OpenAPI specification. The frontend is a React application built with Vite, styled using Tailwind CSS v4 and shadcn/ui. AI capabilities are integrated through Replit AI Integrations, leveraging OpenAI GPT-5.2 for natural language parsing and the Web Speech API for in-browser speech-to-text.

**Key Architectural Components:**

-   **Authentication:** JWT-based authentication with 7-day tokens stored in `localStorage`. Supports `athlete`, `coach`, and `admin` roles, with role-based routing after login.
-   **Team Management:** Coaches can create teams, add members, build shared programs, and publish sessions. Published sessions create individual copies for each client, allowing for diff viewing of modifications.
-   **AI Coach (Phil):** A global AI coach accessible across all user tabs. It provides context-aware responses, welcome tours for new users, and maintains conversation history.
-   **Program and Session Management:** Core functionality revolves around a multi-week calendar interface for creating, editing, and managing training programs and sessions. Sessions are stored in PostgreSQL with a flexible JSONB schema to accommodate various exercise structures.
-   **Voice Input & AI Parsing:** Utilizes browser-based speech recognition to convert natural language commands into structured exercise data (sets, reps, RPE, rest, tempo, notes, week progression) via GPT-5.2.
-   **Workout Editor:** A unified `WorkoutPreviewEditorCard` component handles both session creation and editing, supporting various session types (strength, WOD, run, cycling, swimming) and range-based exercise prescriptions.
-   **Athlete Workout Logger:** Per-set RPE column (1–10), 400ms debounced autosave with offline IndexedDB queue (`autosaveSession` in `lib/autosave.ts`), and a Finish flow that marks the session `completed`, posts to `/clients/:clientId/session-summary` for an Epley-based PB tally + Phil commentary, then injects two bubbles into the chat thread (text + `feedback-prompt` chips: Smashed/Clean/Grim with a voice-note icon). Chip taps persist to the `session_feedback` table.
-   **Engine & Strength Builders:** Specialized modules for generating aerobic engine programs (e.g., Hinshaw-style) and strength blocks (e.g., Smolov routines), which can be inserted directly into client training calendars.
-   **Cycling & Swimming Session Types:** Full `cycle_brain` and `swim_brain` session source types. Cycle brain covers 20 workouts across endurance/tempo/intervals/recovery/race_sim. Swim brain covers 18 workouts across endurance/CSS/technique/sprint/open_water. Both are integrated into the AI parse prompt (with 3:1 build/recover rules, 10% volume cap, multi-sport scheduling rules) and the brain search endpoint. Colors: cycling = amber (#ea580c), swimming = sky (#0284c7).

**Frontend Pages & Routing:**

-   `/`: Calendar home for program overview and session management.
-   `/programmes/:programmeId/sessions/:sessionId`: Full-screen session editor with voice input, exercise list, and live preview.
-   `/clients/:clientId`: Client-specific area with calendar, scheduling, and AI program generation.
-   `/library`: Curated library of WODs, runs, and strength blocks with a program builder.
-   `/client`: Athlete portal for training and nutrition.
-   `/admin`: Admin console for user, content, billing, audit, and platform metrics. The **Platform Metrics** tab (admin-only) shows: API cost tracking per user/month, Phil chat interaction breakdown, session started vs completed vs abandoned, programmes generated/abandoned, days since last session, business KPIs (registered/active/new/churned users), and monthly active vs registered comparison. Refreshes every 30 seconds.

## External Dependencies

-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **AI Services:** Replit AI Integrations (OpenAI GPT-5.2 for parsing), Web Speech API (for STT)
-   **Frontend Libraries:** React, Vite, Tailwind CSS, shadcn/ui, @dnd-kit/core, @dnd-kit/sortable
-   **API Tools:** Orval (for API codegen), Zod (for validation)