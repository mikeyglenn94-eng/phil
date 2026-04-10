/**
 * exercise-matching.ts
 *
 * Tiered exercise name matching for history lookup.
 * Tier 1 — exact normalized match
 * Tier 2 — base movement key match (strips positional / style modifiers)
 * Tier 3 — Jaccard word-set similarity fallback (conservative threshold)
 */

// ── Abbreviation expansion map ─────────────────────────────────────
const ABBR_MAP: [RegExp, string][] = [
  [/\bdbs\b/g,   "dumbbells"],
  [/\bdb\b/g,    "dumbbell"],
  [/\bbb\b/g,    "barbell"],
  [/\bohp\b/g,   "overhead press"],
  [/\brdls\b/g,  "romanian deadlift"],
  [/\brdl\b/g,   "romanian deadlift"],
  [/\bkbs\b/g,   "kettlebells"],
  [/\bkb\b/g,    "kettlebell"],
  [/\bbw\b/g,    "bodyweight"],
  [/\bez\b/g,    "ez bar"],
  [/\bgm\b/g,    "good morning"],
  [/\brfe\b/g,   "rear foot elevated"],
  [/\bbss\b/g,   "bulgarian split squat"],
  [/\bbgs\b/g,   "bulgarian split squat"],
  [/\bghr\b/g,   "glute ham raise"],
];

// Positional / style modifiers that do NOT define the base movement
// NOTE: equipment identifiers (dumbbell, barbell, cable, machine) are intentionally
// kept so "dumbbell row" never matches "barbell row".
const MODIFIER_WORDS = [
  "seated", "standing", "lying", "kneeling", "supine", "prone",
  "incline", "decline", "flat",
  "single arm", "singlearm", "single leg", "singleleg",
  "bilateral", "unilateral", "alternating",
  "paused", "tempo", "slow", "explosive", "banded", "weighted",
  "loaded", "partial", "assisted", "resisted",
  "wide grip", "narrow grip", "close grip", "neutral grip",
  "supinated", "pronated", "overhand", "underhand",
  "reverse", "overhead",
];

// Build a single regex for modifier stripping (longest first to avoid partial matches)
const MODIFIER_RE = new RegExp(
  `\\b(${MODIFIER_WORDS
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(w => w.replace(/ /g, "\\s+"))
    .join("|")})\\b`,
  "g",
);

// ── Normalize ──────────────────────────────────────────────────────
export function normalizeExerciseName(name: string): string {
  let s = (name || "").toLowerCase().trim();
  s = s.replace(/[^a-z0-9 ]/g, " ");
  for (const [pattern, replacement] of ABBR_MAP) {
    s = s.replace(pattern, replacement);
  }
  return s.replace(/\s+/g, " ").trim();
}

// ── Base movement key (normalized, modifiers stripped) ─────────────
export function baseMovementKey(normalized: string): string {
  return normalized.replace(MODIFIER_RE, " ").replace(/\s+/g, " ").trim();
}

// ── Canonical snake_case key (for storage / indexing) ─────────────
export function generateCanonicalKey(name: string): string {
  return baseMovementKey(normalizeExerciseName(name)).replace(/ /g, "_");
}

// ── Jaccard word-set similarity ────────────────────────────────────
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  let intersection = 0;
  for (const w of setA) { if (setB.has(w)) intersection++; }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface MatchResult {
  normalizedKey: string;
  originalName: string;
  tier: 1 | 2 | 3;
  matchedFrom?: string; // set when tier > 1 and name differs from query
}

/**
 * Find the best historical match for `queryName` within `candidates`.
 *
 * @param queryName   The exercise name we're looking up history for.
 * @param candidates  Map of { normalizedName → originalName } from history.
 */
export function findBestMatch(
  queryName: string,
  candidates: Record<string, string>,
): MatchResult | null {
  const qNorm = normalizeExerciseName(queryName);
  const qBase = baseMovementKey(qNorm);
  const entries = Object.entries(candidates);

  // Tier 1 — exact normalized match
  if (candidates[qNorm] !== undefined) {
    return { normalizedKey: qNorm, originalName: candidates[qNorm], tier: 1 };
  }

  // Tier 2 — base movement key match
  // Guard: base key must be at least 3 chars to avoid degenerate matches
  if (qBase.length >= 3) {
    for (const [key, origName] of entries) {
      const cBase = baseMovementKey(key);
      if (cBase === qBase) {
        return {
          normalizedKey: key,
          originalName: origName,
          tier: 2,
          matchedFrom: origName,
        };
      }
    }
  }

  // Tier 3 — Jaccard similarity fallback (conservative threshold 0.6)
  let bestKey = "";
  let bestOrig = "";
  let bestScore = 0;
  for (const [key, origName] of entries) {
    const score = jaccardSimilarity(qNorm, key);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
      bestOrig = origName;
    }
  }
  if (bestScore >= 0.6 && bestKey) {
    return {
      normalizedKey: bestKey,
      originalName: bestOrig,
      tier: 3,
      matchedFrom: bestOrig,
    };
  }

  return null;
}
