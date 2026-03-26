// ─────────────────────────────────────────────────────────────────────────────
// Fixed vocabulary for structured run sessions
// Reference pace: P5K = athlete's average pace per km for a current 5km effort
// ─────────────────────────────────────────────────────────────────────────────

export const PACE_LEXICON = {
  easy:     { label: "Easy",     definition: "Conversational aerobic running",                relToPace: "P5K + 60–90 sec/km" },
  steady:   { label: "Steady",   definition: "Controlled aerobic running",                   relToPace: "P5K + 30–45 sec/km" },
  tempo:    { label: "Tempo",    definition: "Threshold style running",                      relToPace: "P5K + 10–20 sec/km" },
  p5k:      { label: "5K Pace", definition: "Current 5km race pace",                        relToPace: "P5K exactly" },
  interval: { label: "Interval", definition: "Hard repeatable work faster than 5km pace",   relToPace: "P5K − 10–25 sec/km" },
  sprint:   { label: "Sprint",   definition: "Very short maximal or near maximal effort",   relToPace: "N/A — maximal" },
} as const;

export type PaceType = keyof typeof PACE_LEXICON;

export const EFFORT_LEXICON = {
  easy_effort:   { label: "Easy Effort",   definition: "Low effort, conversational" },
  steady_effort: { label: "Steady Effort", definition: "Moderate controlled effort" },
  hard_effort:   { label: "Hard Effort",   definition: "High but repeatable effort" },
  max_effort:    { label: "Max Effort",    definition: "Maximal or near maximal effort" },
} as const;

export type EffortType = keyof typeof EFFORT_LEXICON;

export const RUN_SESSION_TYPES = [
  "easy_run",
  "steady_run",
  "tempo_run",
  "tempo_intervals",
  "intervals",
  "time_trial",
  "strides",
  "hill_sprints",
  "hill_repeats",
  "long_hill_intervals",
  "hilly_run",
] as const;

export type RunSessionType = typeof RUN_SESSION_TYPES[number];

export const RECOVERY_TYPES = [
  "jog",
  "walk",
  "walk_back",
  "walk_down",
  "easy_jog",
  "standing",
] as const;

export type RecoveryType = typeof RECOVERY_TYPES[number];

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript types for structured run blocks and sessions
// ─────────────────────────────────────────────────────────────────────────────

export interface RunBlock {
  sessionType: RunSessionType;

  // Pace / effort
  paceType?: PaceType;
  effortType?: EffortType;

  // Continuous volume
  durationMinutes?: number;
  distanceMetres?: number;

  // Interval / rep structure
  reps?: number;
  sets?: number;
  workDurationMinutes?: number;
  workDurationSeconds?: number;
  workDistanceMetres?: number;
  restSeconds?: number;
  restMinutes?: number;

  // Optional modifiers
  terrain?: string;
  incline?: boolean;
  recoveryType?: RecoveryType;
  notes?: string;
}

export interface RunSessionRecord {
  id: number;
  name: string;
  sessionType: RunSessionType;
  notes?: string | null;
  blocks: RunBlock[];
  warmUp?: RunBlock | null;
  coolDown?: RunBlock | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EnduranceRunTemplateSession {
  week: number;
  day?: number;
  runSessionId: number;
  notes?: string;
}

export interface EnduranceRunTemplateRecord {
  id: number;
  name: string;
  description?: string | null;
  sessions: EnduranceRunTemplateSession[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display rendering — converts structured blocks to readable text
// ─────────────────────────────────────────────────────────────────────────────

function formatVolume(metres?: number, minutes?: number, seconds?: number): string {
  if (metres !== undefined) {
    return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
  }
  if (minutes !== undefined) return `${minutes} min`;
  if (seconds !== undefined) return `${seconds}s`;
  return "";
}

function formatEffort(block: RunBlock): string {
  if (block.paceType && PACE_LEXICON[block.paceType]) {
    const label = PACE_LEXICON[block.paceType].label.toLowerCase();
    // Avoid "5k pace pace" — if label already ends with "pace", don't append it again
    return label.endsWith("pace") ? label : `${label} pace`;
  }
  if (block.effortType) {
    // Effort types that also exist in the pace lexicon (e.g. "sprint") are rendered as pace labels
    const asPace = PACE_LEXICON[block.effortType as PaceType];
    if (asPace) return `${asPace.label.toLowerCase()} effort`;
    const asEffort = EFFORT_LEXICON[block.effortType];
    if (asEffort) return asEffort.label.toLowerCase();
    return block.effortType.replace(/_/g, " ");
  }
  return "";
}

function formatRecovery(block: RunBlock): string {
  if (block.restSeconds) return `${block.restSeconds}s rest`;
  if (block.restMinutes) return `${block.restMinutes} min rest`;
  if (block.recoveryType) return `${block.recoveryType.replace(/_/g, " ")} recovery`;
  return "";
}

export function formatRunBlock(block: RunBlock): string {
  const isRepBased = block.reps && block.reps > 0;

  if (isRepBased) {
    const repCount = block.reps!;
    const setPrefix = block.sets && block.sets > 1 ? `${block.sets} × ` : "";
    const workVol = formatVolume(block.workDistanceMetres, block.workDurationMinutes, block.workDurationSeconds);
    const terrain = block.incline ? " uphill" : block.terrain ? ` (${block.terrain})` : "";
    const effort = formatEffort(block);
    const recovery = formatRecovery(block);

    const parts = [`${setPrefix}${repCount} × ${workVol}${terrain}`];
    if (effort) parts.push(`@ ${effort}`);
    if (recovery) parts.push(recovery);
    return parts.join(", ");
  }

  // Continuous
  const vol = formatVolume(block.distanceMetres, block.durationMinutes);
  const sessionLabel = block.sessionType.replace(/_/g, " ");

  // Only show effort label if it adds information the session type doesn't already convey
  // e.g. "easy_run" with "easy_effort" → just show "30 min easy run"
  // but "hilly_run" with "easy_effort" → show "45 min hilly run @ easy effort"
  const effort = formatEffort(block);
  const sessionImpliesEffort =
    (block.sessionType === "easy_run" && (block.paceType === "easy" || block.effortType === "easy_effort")) ||
    (block.sessionType === "steady_run" && (block.paceType === "steady" || block.effortType === "steady_effort")) ||
    (block.sessionType === "tempo_run" && block.paceType === "tempo") ||
    (block.sessionType === "time_trial" && block.effortType === "max_effort") ||
    (block.sessionType === "hill_sprints" && (block.effortType === "hard_effort" || block.effortType === "max_effort")) ||
    (block.sessionType === "strides" && block.effortType === "sprint");

  if (sessionImpliesEffort) return [vol, sessionLabel].filter(Boolean).join(" ");
  return [vol, effort ? `${sessionLabel} @ ${effort}` : sessionLabel].filter(Boolean).join(" ");
}

export function formatRunSession(session: Pick<RunSessionRecord, "blocks" | "warmUp" | "coolDown" | "notes">): string {
  const lines: string[] = [];
  if (session.warmUp) lines.push(`Warm-up: ${formatRunBlock(session.warmUp)}`);
  (session.blocks ?? []).forEach(b => lines.push(formatRunBlock(b)));
  if (session.coolDown) lines.push(`Cool-down: ${formatRunBlock(session.coolDown)}`);
  if (session.notes) lines.push(`Notes: ${session.notes}`);
  return lines.join("\n");
}
