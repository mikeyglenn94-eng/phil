import { Router, type IRouter } from "express";
import { db, programmesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { randomUUID } from "crypto";
import { addDays, addWeeks, startOfWeek, format, parseISO } from "date-fns";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BlockExercise {
  name: string;
  sets: number;
  reps: string;
  percentage: string;
  notes?: string;
}

interface BlockSession {
  dayOfWeek: number; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  name: string;
  exercises: BlockExercise[];
}

interface BlockWeek {
  week: number;
  label: string;
  sessions: BlockSession[];
}

interface StrengthBlockTemplate {
  id: string;
  name: string;
  liftFocus: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  level: "beginner" | "intermediate" | "advanced";
  tags: string[];
  description: string;
  notes: string;
  weeks: BlockWeek[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Data
// ─────────────────────────────────────────────────────────────────────────────

const templates: StrengthBlockTemplate[] = [

  // ── 1. Smolov Jr ────────────────────────────────────────────────────────────
  {
    id: "smolov_jr",
    name: "Smolov Jr",
    liftFocus: "squat",
    durationWeeks: 3,
    sessionsPerWeek: 4,
    level: "intermediate",
    tags: ["squat", "intensity", "peaking", "volume", "4-day"],
    description: "A 3-week high-frequency squat intensification block. Four sessions per week with progressively increasing percentages. Excellent for breaking through squat plateaus.",
    notes: "Requires a solid base of squat strength. Run after a deload. Avoid other heavy lower body work during this cycle. Percentages are based on your current 1RM.",
    weeks: [
      {
        week: 1, label: "Week 1 — Foundation",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×6 @ 70%", exercises: [{ name: "Back Squat", sets: 6, reps: "6", percentage: "70%" }] },
          { dayOfWeek: 3, name: "Squat — 7×5 @ 75%", exercises: [{ name: "Back Squat", sets: 7, reps: "5", percentage: "75%" }] },
          { dayOfWeek: 5, name: "Squat — 8×4 @ 80%", exercises: [{ name: "Back Squat", sets: 8, reps: "4", percentage: "80%" }] },
          { dayOfWeek: 6, name: "Squat — 10×3 @ 85%", exercises: [{ name: "Back Squat", sets: 10, reps: "3", percentage: "85%" }] },
        ],
      },
      {
        week: 2, label: "Week 2 — Build",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×6 @ 72%", exercises: [{ name: "Back Squat", sets: 6, reps: "6", percentage: "72%" }] },
          { dayOfWeek: 3, name: "Squat — 7×5 @ 77%", exercises: [{ name: "Back Squat", sets: 7, reps: "5", percentage: "77%" }] },
          { dayOfWeek: 5, name: "Squat — 8×4 @ 82%", exercises: [{ name: "Back Squat", sets: 8, reps: "4", percentage: "82%" }] },
          { dayOfWeek: 6, name: "Squat — 10×3 @ 87%", exercises: [{ name: "Back Squat", sets: 10, reps: "3", percentage: "87%" }] },
        ],
      },
      {
        week: 3, label: "Week 3 — Peak",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×6 @ 74%", exercises: [{ name: "Back Squat", sets: 6, reps: "6", percentage: "74%" }] },
          { dayOfWeek: 3, name: "Squat — 7×5 @ 79%", exercises: [{ name: "Back Squat", sets: 7, reps: "5", percentage: "79%" }] },
          { dayOfWeek: 5, name: "Squat — 8×4 @ 84%", exercises: [{ name: "Back Squat", sets: 8, reps: "4", percentage: "84%" }] },
          { dayOfWeek: 6, name: "Squat — 10×3 @ 89%", exercises: [{ name: "Back Squat", sets: 10, reps: "3", percentage: "89%" }] },
        ],
      },
    ],
  },

  // ── 2. Russian Squat Routine ─────────────────────────────────────────────────
  {
    id: "russian_squat",
    name: "Russian Squat Routine",
    liftFocus: "squat",
    durationWeeks: 7,
    sessionsPerWeek: 3,
    level: "intermediate",
    tags: ["squat", "volume", "3-day", "strength", "classic"],
    description: "A classic 6-week Soviet-style squat cycle followed by a max test day. Trains exclusively at 80% of 1RM but systematically increases reps each week. Builds both strength and work capacity.",
    notes: "All work stays at 80% of 1RM throughout — only the reps increase. Rest 3-5 minutes between sets. Week 7 is a PR test day. Pair with minimal accessory work.",
    weeks: [
      {
        week: 1, label: "Week 1 — 6×2 @ 80%",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×2 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "2", percentage: "80%" }] },
          { dayOfWeek: 3, name: "Squat — 6×2 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "2", percentage: "80%" }] },
          { dayOfWeek: 5, name: "Squat — 6×2 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "2", percentage: "80%" }] },
        ],
      },
      {
        week: 2, label: "Week 2 — 6×3 / 6×2 / 6×3 @ 80%",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×3 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "3", percentage: "80%" }] },
          { dayOfWeek: 3, name: "Squat — 6×2 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "2", percentage: "80%" }] },
          { dayOfWeek: 5, name: "Squat — 6×3 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "3", percentage: "80%" }] },
        ],
      },
      {
        week: 3, label: "Week 3 — 6×3 @ 80%",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×3 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "3", percentage: "80%" }] },
          { dayOfWeek: 3, name: "Squat — 6×3 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "3", percentage: "80%" }] },
          { dayOfWeek: 5, name: "Squat — 6×3 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "3", percentage: "80%" }] },
        ],
      },
      {
        week: 4, label: "Week 4 — 6×4 / 6×3 / 6×4 @ 80%",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×4 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "4", percentage: "80%" }] },
          { dayOfWeek: 3, name: "Squat — 6×3 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "3", percentage: "80%" }] },
          { dayOfWeek: 5, name: "Squat — 6×4 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "4", percentage: "80%" }] },
        ],
      },
      {
        week: 5, label: "Week 5 — 6×4 @ 80%",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×4 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "4", percentage: "80%" }] },
          { dayOfWeek: 3, name: "Squat — 6×4 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "4", percentage: "80%" }] },
          { dayOfWeek: 5, name: "Squat — 6×4 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "4", percentage: "80%" }] },
        ],
      },
      {
        week: 6, label: "Week 6 — 6×5 / 6×4 / 6×5 @ 80%",
        sessions: [
          { dayOfWeek: 1, name: "Squat — 6×5 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "5", percentage: "80%" }] },
          { dayOfWeek: 3, name: "Squat — 6×4 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "4", percentage: "80%" }] },
          { dayOfWeek: 5, name: "Squat — 6×5 @ 80%", exercises: [{ name: "Back Squat", sets: 6, reps: "5", percentage: "80%" }] },
        ],
      },
      {
        week: 7, label: "Week 7 — PR Test",
        sessions: [
          {
            dayOfWeek: 1, name: "Squat — 1RM Test",
            exercises: [
              { name: "Back Squat", sets: 1, reps: "1", percentage: "90%", notes: "Opener — build to near-max" },
              { name: "Back Squat", sets: 1, reps: "1", percentage: "95-98%", notes: "Second attempt" },
              { name: "Back Squat", sets: 1, reps: "1", percentage: "100%+", notes: "PR attempt" },
            ],
          },
        ],
      },
    ],
  },

  // ── 3. Full Smolov / Smolov Senior ──────────────────────────────────────────
  {
    id: "smolov_senior",
    name: "Full Smolov (Smolov Senior)",
    liftFocus: "squat",
    durationWeeks: 13,
    sessionsPerWeek: 4,
    level: "advanced",
    tags: ["squat", "advanced", "long-cycle", "peaking", "4-day", "volume", "intensity"],
    description: "The complete Smolov cycle — 13 weeks of structured squat training across four phases: intro microcycle, base mesocycle, switching phase, and intense mesocycle. Expect significant gains in squat strength.",
    notes: "This is an advanced, demanding programme. Prioritise sleep and nutrition. Avoid heavy pulls and leg work outside the programme. Percentages based on 1RM. The switching phase uses lighter work to recover before the intense block.",
    weeks: [
      // Phase 1: Intro Microcycle
      { week: 1, label: "Phase 1 — Intro (Week 1)", sessions: [
        { dayOfWeek: 1, name: "Squat — 3×8 @ 65%", exercises: [{ name: "Back Squat", sets: 3, reps: "8", percentage: "65%" }] },
        { dayOfWeek: 3, name: "Squat — 5×6 @ 70%", exercises: [{ name: "Back Squat", sets: 5, reps: "6", percentage: "70%" }] },
        { dayOfWeek: 5, name: "Squat — 5×5 @ 75%", exercises: [{ name: "Back Squat", sets: 5, reps: "5", percentage: "75%" }] },
      ]},
      { week: 2, label: "Phase 1 — Intro (Week 2)", sessions: [
        { dayOfWeek: 1, name: "Squat — 4×8 @ 65%", exercises: [{ name: "Back Squat", sets: 4, reps: "8", percentage: "65%" }] },
        { dayOfWeek: 3, name: "Squat — 5×6 @ 72%", exercises: [{ name: "Back Squat", sets: 5, reps: "6", percentage: "72%" }] },
        { dayOfWeek: 5, name: "Squat — 5×5 @ 77%", exercises: [{ name: "Back Squat", sets: 5, reps: "5", percentage: "77%" }] },
      ]},
      // Phase 2: Base Mesocycle
      { week: 3, label: "Phase 2 — Base (Week 1)", sessions: [
        { dayOfWeek: 1, name: "Squat — 4×9 @ 70%", exercises: [{ name: "Back Squat", sets: 4, reps: "9", percentage: "70%" }] },
        { dayOfWeek: 3, name: "Squat — 5×7 @ 75%", exercises: [{ name: "Back Squat", sets: 5, reps: "7", percentage: "75%" }] },
        { dayOfWeek: 5, name: "Squat — 7×5 @ 80%", exercises: [{ name: "Back Squat", sets: 7, reps: "5", percentage: "80%" }] },
        { dayOfWeek: 6, name: "Squat — 10×3 @ 85%", exercises: [{ name: "Back Squat", sets: 10, reps: "3", percentage: "85%" }] },
      ]},
      { week: 4, label: "Phase 2 — Base (Week 2)", sessions: [
        { dayOfWeek: 1, name: "Squat — 4×9 @ 72%", exercises: [{ name: "Back Squat", sets: 4, reps: "9", percentage: "72%" }] },
        { dayOfWeek: 3, name: "Squat — 5×7 @ 77%", exercises: [{ name: "Back Squat", sets: 5, reps: "7", percentage: "77%" }] },
        { dayOfWeek: 5, name: "Squat — 7×5 @ 82%", exercises: [{ name: "Back Squat", sets: 7, reps: "5", percentage: "82%" }] },
        { dayOfWeek: 6, name: "Squat — 10×3 @ 87%", exercises: [{ name: "Back Squat", sets: 10, reps: "3", percentage: "87%" }] },
      ]},
      { week: 5, label: "Phase 2 — Base (Week 3)", sessions: [
        { dayOfWeek: 1, name: "Squat — 4×9 @ 74%", exercises: [{ name: "Back Squat", sets: 4, reps: "9", percentage: "74%" }] },
        { dayOfWeek: 3, name: "Squat — 5×7 @ 79%", exercises: [{ name: "Back Squat", sets: 5, reps: "7", percentage: "79%" }] },
        { dayOfWeek: 5, name: "Squat — 7×5 @ 84%", exercises: [{ name: "Back Squat", sets: 7, reps: "5", percentage: "84%" }] },
        { dayOfWeek: 6, name: "Squat — 10×3 @ 89%", exercises: [{ name: "Back Squat", sets: 10, reps: "3", percentage: "89%" }] },
      ]},
      { week: 6, label: "Phase 2 — Base (Week 4)", sessions: [
        { dayOfWeek: 1, name: "Squat — 4×9 @ 76%", exercises: [{ name: "Back Squat", sets: 4, reps: "9", percentage: "76%" }] },
        { dayOfWeek: 3, name: "Squat — 5×7 @ 81%", exercises: [{ name: "Back Squat", sets: 5, reps: "7", percentage: "81%" }] },
        { dayOfWeek: 5, name: "Squat — 7×5 @ 86%", exercises: [{ name: "Back Squat", sets: 7, reps: "5", percentage: "86%" }] },
        { dayOfWeek: 6, name: "Squat — 10×3 @ 91%", exercises: [{ name: "Back Squat", sets: 10, reps: "3", percentage: "91%" }] },
      ]},
      // Phase 3: Switching Phase (active recovery)
      { week: 7, label: "Phase 3 — Switching (Week 1)", sessions: [
        { dayOfWeek: 1, name: "Squat — Light (3×5 @ 60%)", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "60%", notes: "Active recovery — light and fast" }] },
        { dayOfWeek: 3, name: "Squat — Light (3×5 @ 60%)", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "60%", notes: "Keep it moving" }] },
        { dayOfWeek: 5, name: "Squat — Light (3×5 @ 62%)", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "62%" }] },
      ]},
      { week: 8, label: "Phase 3 — Switching (Week 2)", sessions: [
        { dayOfWeek: 1, name: "Squat — Light (4×4 @ 65%)", exercises: [{ name: "Back Squat", sets: 4, reps: "4", percentage: "65%" }] },
        { dayOfWeek: 3, name: "Squat — Light (3×4 @ 65%)", exercises: [{ name: "Back Squat", sets: 3, reps: "4", percentage: "65%" }] },
        { dayOfWeek: 5, name: "Squat — Light (4×4 @ 67%)", exercises: [{ name: "Back Squat", sets: 4, reps: "4", percentage: "67%" }] },
      ]},
      // Phase 4: Intense Mesocycle
      { week: 9, label: "Phase 4 — Intense (Week 1)", sessions: [
        { dayOfWeek: 1, name: "Squat — 3×3 @ 90%", exercises: [{ name: "Back Squat", sets: 3, reps: "3", percentage: "90%" }] },
        { dayOfWeek: 3, name: "Squat — 3×2 @ 95%", exercises: [{ name: "Back Squat", sets: 3, reps: "2", percentage: "95%" }] },
        { dayOfWeek: 5, name: "Squat — 5×5 @ 80%", exercises: [{ name: "Back Squat", sets: 5, reps: "5", percentage: "80%", notes: "Back-off volume" }] },
        { dayOfWeek: 6, name: "Squat — 2×2 @ 100%", exercises: [{ name: "Back Squat", sets: 2, reps: "2", percentage: "100%", notes: "Current max — handle with care" }] },
      ]},
      { week: 10, label: "Phase 4 — Intense (Week 2)", sessions: [
        { dayOfWeek: 1, name: "Squat — 3×3 @ 90%", exercises: [{ name: "Back Squat", sets: 3, reps: "3", percentage: "90%" }] },
        { dayOfWeek: 3, name: "Squat — 3×2 @ 97%", exercises: [{ name: "Back Squat", sets: 3, reps: "2", percentage: "97%" }] },
        { dayOfWeek: 5, name: "Squat — 5×5 @ 80%", exercises: [{ name: "Back Squat", sets: 5, reps: "5", percentage: "80%", notes: "Back-off volume" }] },
        { dayOfWeek: 6, name: "Squat — 2×1 @ 100-102%", exercises: [{ name: "Back Squat", sets: 2, reps: "1", percentage: "100-102%", notes: "Near-max singles" }] },
      ]},
      { week: 11, label: "Phase 4 — Intense (Week 3 / Peak)", sessions: [
        { dayOfWeek: 1, name: "Squat — 3×3 @ 88%", exercises: [{ name: "Back Squat", sets: 3, reps: "3", percentage: "88%" }] },
        { dayOfWeek: 3, name: "Squat — 2×2 @ 93%", exercises: [{ name: "Back Squat", sets: 2, reps: "2", percentage: "93%" }] },
        { dayOfWeek: 5, name: "Squat — 2×2 @ 97%", exercises: [{ name: "Back Squat", sets: 2, reps: "2", percentage: "97%" }] },
      ]},
      // Test Week
      { week: 12, label: "Week 12 — Deload", sessions: [
        { dayOfWeek: 1, name: "Squat — Deload (3×3 @ 70%)", exercises: [{ name: "Back Squat", sets: 3, reps: "3", percentage: "70%", notes: "Easy — save yourself for the test" }] },
        { dayOfWeek: 3, name: "Squat — Deload (2×3 @ 70%)", exercises: [{ name: "Back Squat", sets: 2, reps: "3", percentage: "70%" }] },
      ]},
      { week: 13, label: "Week 13 — 1RM Test", sessions: [
        {
          dayOfWeek: 1, name: "Squat — 1RM Test",
          exercises: [
            { name: "Back Squat", sets: 1, reps: "1", percentage: "90%", notes: "Opener" },
            { name: "Back Squat", sets: 1, reps: "1", percentage: "95-98%", notes: "Second attempt" },
            { name: "Back Squat", sets: 1, reps: "1", percentage: "100%+", notes: "PR attempt" },
          ],
        },
      ]},
    ],
  },

  // ── 4. Beginner Squat Builder ──────────────────────────────────────────────
  {
    id: "beginner_squat",
    name: "Beginner Squat Builder",
    liftFocus: "squat",
    durationWeeks: 6,
    sessionsPerWeek: 3,
    level: "beginner",
    tags: ["squat", "beginner", "3-day", "volume", "strength"],
    description: "A beginner-friendly 6-week squat programme. Three sessions per week with gradual percentage increases. Builds a strong technical base and introduces structured loading.",
    notes: "Focus on technique above all else. Percentages are based on a conservative estimated max. Rest 2-3 minutes between sets. Accessory work should be minimal in the first 3 weeks.",
    weeks: [
      { week: 1, label: "Week 1 — Technique & Load", sessions: [
        { dayOfWeek: 1, name: "Squat — 3×5 @ 60%", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "60%", notes: "Focus on depth and bracing" }] },
        { dayOfWeek: 3, name: "Squat — 3×5 @ 60%", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "60%" }] },
        { dayOfWeek: 5, name: "Squat — 3×5 @ 62%", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "62%" }] },
      ]},
      { week: 2, label: "Week 2 — Building Confidence", sessions: [
        { dayOfWeek: 1, name: "Squat — 3×5 @ 65%", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "65%" }] },
        { dayOfWeek: 3, name: "Squat — 4×5 @ 65%", exercises: [{ name: "Back Squat", sets: 4, reps: "5", percentage: "65%" }] },
        { dayOfWeek: 5, name: "Squat — 3×5 @ 67%", exercises: [{ name: "Back Squat", sets: 3, reps: "5", percentage: "67%" }] },
      ]},
      { week: 3, label: "Week 3 — Volume", sessions: [
        { dayOfWeek: 1, name: "Squat — 4×5 @ 68%", exercises: [{ name: "Back Squat", sets: 4, reps: "5", percentage: "68%" }] },
        { dayOfWeek: 3, name: "Squat — 4×5 @ 70%", exercises: [{ name: "Back Squat", sets: 4, reps: "5", percentage: "70%" }] },
        { dayOfWeek: 5, name: "Squat — 4×5 @ 70%", exercises: [{ name: "Back Squat", sets: 4, reps: "5", percentage: "70%" }] },
      ]},
      { week: 4, label: "Week 4 — Intensity Lift", sessions: [
        { dayOfWeek: 1, name: "Squat — 4×4 @ 73%", exercises: [{ name: "Back Squat", sets: 4, reps: "4", percentage: "73%" }] },
        { dayOfWeek: 3, name: "Squat — 4×4 @ 75%", exercises: [{ name: "Back Squat", sets: 4, reps: "4", percentage: "75%" }] },
        { dayOfWeek: 5, name: "Squat — 4×4 @ 75%", exercises: [{ name: "Back Squat", sets: 4, reps: "4", percentage: "75%" }] },
      ]},
      { week: 5, label: "Week 5 — Peak Volume", sessions: [
        { dayOfWeek: 1, name: "Squat — 5×3 @ 78%", exercises: [{ name: "Back Squat", sets: 5, reps: "3", percentage: "78%" }] },
        { dayOfWeek: 3, name: "Squat — 5×3 @ 80%", exercises: [{ name: "Back Squat", sets: 5, reps: "3", percentage: "80%" }] },
        { dayOfWeek: 5, name: "Squat — 5×3 @ 80%", exercises: [{ name: "Back Squat", sets: 5, reps: "3", percentage: "80%" }] },
      ]},
      { week: 6, label: "Week 6 — Test Week", sessions: [
        { dayOfWeek: 1, name: "Squat — Deload (3×3 @ 70%)", exercises: [{ name: "Back Squat", sets: 3, reps: "3", percentage: "70%" }] },
        { dayOfWeek: 3, name: "Squat — 2×2 @ 85%", exercises: [{ name: "Back Squat", sets: 2, reps: "2", percentage: "85%", notes: "Near-max preparation" }] },
        {
          dayOfWeek: 5, name: "Squat — 1RM Test",
          exercises: [
            { name: "Back Squat", sets: 1, reps: "1", percentage: "90%", notes: "Opener" },
            { name: "Back Squat", sets: 1, reps: "1", percentage: "95%", notes: "Second attempt" },
            { name: "Back Squat", sets: 1, reps: "1", percentage: "100%+", notes: "PR attempt" },
          ],
        },
      ]},
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: score a template against a query string
// ─────────────────────────────────────────────────────────────────────────────

function scoreTemplate(template: StrengthBlockTemplate, query: string): number {
  const q = query.toLowerCase();
  let score = 0;

  // Programme name match
  if (q.includes("smolov jr") && template.id === "smolov_jr") score += 20;
  if ((q.includes("smolov senior") || q.includes("full smolov")) && template.id === "smolov_senior") score += 20;
  if ((q.includes("russian") || q.includes("rsr")) && template.id === "russian_squat") score += 20;
  if ((q.includes("beginner") || q.includes("starter") || q.includes("start")) && template.level === "beginner") score += 10;

  // Level
  if (q.includes("beginner") && template.level === "beginner") score += 8;
  if (q.includes("intermediate") && template.level === "intermediate") score += 8;
  if (q.includes("advanced") && template.level === "advanced") score += 8;

  // Frequency / days per week
  if ((q.includes("3 day") || q.includes("3x") || q.includes("3 session") || q.includes("three day")) && template.sessionsPerWeek === 3) score += 8;
  if ((q.includes("4 day") || q.includes("4x") || q.includes("4 session") || q.includes("four day")) && template.sessionsPerWeek === 4) score += 8;

  // Duration
  if ((q.includes("short") || q.includes("3 week")) && template.durationWeeks <= 3) score += 5;
  if ((q.includes("6 week") || q.includes("six week")) && template.durationWeeks === 6) score += 8;
  if ((q.includes("long") || q.includes("13 week") || q.includes("peaking cycle")) && template.durationWeeks >= 10) score += 5;

  // Rep range — low rep = intensity templates
  if ((q.includes("low rep") || q.includes("heavy") || q.includes("singles") || q.includes("1rm") || q.includes("max") || q.includes("peaking")) && template.tags.includes("intensity")) score += 8;
  if ((q.includes("low rep") || q.includes("heavy") || q.includes("peaking")) && template.tags.includes("peaking")) score += 5;

  // Volume
  if ((q.includes("volume") || q.includes("high rep") || q.includes("lots of") || q.includes("accumulation")) && template.tags.includes("volume")) score += 8;

  // Intensity
  if ((q.includes("intensity") || q.includes("intense") || q.includes("high intensity")) && template.tags.includes("intensity")) score += 6;

  // Strength keywords
  if ((q.includes("strength") || q.includes("squat") || q.includes("cycle") || q.includes("programme") || q.includes("program") || q.includes("block")) && template.liftFocus === "squat") score += 3;

  // Classic / Soviet / Russian style
  if ((q.includes("soviet") || q.includes("russian") || q.includes("classic")) && template.id === "russian_squat") score += 10;

  // Any match at all gets a baseline
  const nameMatch = template.name.toLowerCase().split(" ").some(w => w.length > 3 && q.includes(w));
  if (nameMatch) score += 6;
  const tagMatch = template.tags.some(t => q.includes(t.replace(/-/g, " ")));
  if (tagMatch) score += 4;

  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: generate sessions from template + start date
// ─────────────────────────────────────────────────────────────────────────────

function generateSessions(template: StrengthBlockTemplate, startDateStr: string) {
  // Snap to Monday of the provided start date week
  const startDate = startOfWeek(parseISO(startDateStr), { weekStartsOn: 1 });
  const sessions: any[] = [];

  for (const week of template.weeks) {
    const weekStart = addWeeks(startDate, week.week - 1);
    for (const session of week.sessions) {
      // dayOfWeek: 1=Mon (+0), 2=Tue (+1), ... 7=Sun (+6)
      const sessionDate = addDays(weekStart, session.dayOfWeek - 1);
      const exercises = session.exercises.map((ex) => ({
        id: `ex-${randomUUID().slice(0, 8)}`,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        notes: ex.notes ? `@ ${ex.percentage} — ${ex.notes}` : `@ ${ex.percentage}`,
        rawText: `${ex.sets}×${ex.reps} @ ${ex.percentage}`,
        rpe: null,
        rest: null,
        tempo: null,
        weekProgression: [],
      }));

      sessions.push({
        id: `session-${randomUUID().slice(0, 8)}`,
        date: format(sessionDate, "yyyy-MM-dd"),
        name: session.name,
        source: "strength_block" as any,
        structure: `${template.name} — ${week.label}`,
        exercises,
      });
    }
  }

  return sessions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

router.get("/strength-blocks/templates", (_req, res): void => {
  const summary = templates.map(({ weeks: _w, ...t }) => ({
    ...t,
    totalSessions: t.durationWeeks * t.sessionsPerWeek,
  }));
  res.json({ templates: summary });
});

router.get("/strength-blocks/templates/:id", (req, res): void => {
  const template = templates.find(t => t.id === req.params.id);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ template });
});

router.post("/strength-blocks/preview", (req, res): void => {
  const { templateId, startDate } = req.body as { templateId: string; startDate: string };
  const template = templates.find(t => t.id === templateId);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!startDate) { res.status(400).json({ error: "startDate is required" }); return; }
  const sessions = generateSessions(template, startDate);
  res.json({ sessions, template: { id: template.id, name: template.name, durationWeeks: template.durationWeeks } });
});

router.post("/strength-blocks/insert", async (req, res): Promise<void> => {
  const { templateId, clientId, startDate } = req.body as {
    templateId: string;
    clientId: number;
    startDate: string;
  };

  const template = templates.find(t => t.id === templateId);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!clientId || !startDate) { res.status(400).json({ error: "clientId and startDate are required" }); return; }

  const sessions = generateSessions(template, startDate);

  const [programme] = await db
    .insert(programmesTable)
    .values({
      title: `${template.name} — ${format(startOfWeek(parseISO(startDate), { weekStartsOn: 1 }), "d MMM yyyy")}`,
      clientId,
      sessions,
    })
    .returning();

  res.status(201).json({ programme, sessionCount: sessions.length });
});

router.post("/strength-blocks/search", (req, res): void => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }

  const results = templates
    .map(t => ({ ...t, score: scoreTemplate(t, query), weeks: undefined }))
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // If nothing scored above 0, return all sorted by level
  const final = results.length > 0 ? results : templates.slice(0, 3).map(t => ({ ...t, score: 1, weeks: undefined }));

  res.json({ results: final });
});

// NLP endpoint: parse natural language → suggest which template + extract params
router.post("/strength-blocks/nlp", async (req, res): Promise<void> => {
  const { command, clients } = req.body as { command: string; clients?: { id: number; name: string }[] };

  const templateList = templates.map(t => `- id: "${t.id}", name: "${t.name}", level: ${t.level}, weeks: ${t.durationWeeks}, daysPerWeek: ${t.sessionsPerWeek}, tags: ${t.tags.join(", ")}`).join("\n");
  const clientList = (clients ?? []).map(c => `- id: ${c.id}, name: "${c.name}"`).join("\n") || "No clients provided";

  const systemPrompt = `You are a fitness programme assistant. A coach has typed a natural language command to insert a strength block into a client's calendar.

Available programme templates:
${templateList}

Known clients:
${clientList}

Today's date: ${format(new Date(), "yyyy-MM-dd")}

Your job is to extract:
1. templateId: which template to use (must match one of the ids above). Choose the best match based on the command.
2. clientId: which client (match by name, case-insensitive partial match). null if not specified.
3. clientName: the client name as mentioned in the command. null if not specified.
4. startDate: in yyyy-MM-dd format. Resolve relative dates ("next Monday", "March 30") using today as reference. null if not specified.
5. confidence: "high" | "medium" | "low" — how confident you are in your interpretation
6. summary: a one-sentence human-readable summary of what you're about to do (e.g. "Insert Smolov Jr into Keeley's calendar starting 30 March 2026")
7. missingInfo: array of strings for any missing required info (e.g. ["client not specified", "start date not specified"])

Return ONLY valid JSON:
{"templateId": "...", "clientId": ..., "clientName": "...", "startDate": "...", "confidence": "...", "summary": "...", "missingInfo": [...]}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    // Validate templateId
    const template = templates.find(t => t.id === parsed.templateId);
    if (!template) parsed.templateId = null;

    res.json({ ...parsed, template: template ? { id: template.id, name: template.name, durationWeeks: template.durationWeeks, sessionsPerWeek: template.sessionsPerWeek } : null });
  } catch (err) {
    res.status(500).json({ error: "Failed to parse command" });
  }
});

export default router;
