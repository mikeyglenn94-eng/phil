/**
 * Session subtitle helper for the agenda + grid session cards.
 *
 * - Strength: first 3 exercise names joined with " · ", "+N more" if there are more than 3.
 * - Run / Cycle / Swim: distance + intensity adjective. Falls back to duration if no distance.
 * - WOD / Conditioning: WOD name or first line of structure.
 *
 * Falls back gracefully — never returns undefined; returns "" only if no data at all.
 */

import type { Session } from "@workspace/api-client-react";

export function sessionSubtitle(session: Session): string {
  const source = (session as { source?: string }).source ?? null;

  if (source === "run_brain" || source === "cycle_brain" || source === "swim_brain") {
    return enduranceSubtitle(session);
  }
  if (source === "wod_brain") {
    return wodSubtitle(session);
  }
  return strengthSubtitle(session);
}

// ── Strength: top 3 exercise names ─────────────────────────────────────────

function strengthSubtitle(session: Session): string {
  const exs = (session.exercises ?? []).map((e) => e.name).filter((n): n is string => !!n);
  if (exs.length === 0) return "";
  const top = exs.slice(0, 3).join(" · ");
  const remaining = exs.length - 3;
  return remaining > 0 ? `${top} +${remaining} more` : top;
}

// ── Endurance: distance + intensity ────────────────────────────────────────

function enduranceSubtitle(session: Session): string {
  const s = session as Session & {
    distanceKm?: number | null;
    duration?: number | null;
    intensity?: string | null;
    structure?: string | null;
  };

  const parts: string[] = [];

  if (typeof s.distanceKm === "number" && s.distanceKm > 0) {
    parts.push(`${formatDistance(s.distanceKm)}`);
  } else if (typeof s.duration === "number" && s.duration > 0) {
    parts.push(`${s.duration} min`);
  }

  if (s.intensity) {
    const adj = intensityAdjective(s.intensity);
    if (adj) parts.push(adj);
  }

  if (parts.length > 0) return parts.join(" · ");

  // No distance / duration / intensity — fall back to exercise names if any.
  if ((session.exercises ?? []).length > 0) {
    return strengthSubtitle(session);
  }

  // Last fallback: a snippet of structure.
  if (s.structure) return firstLine(s.structure);
  return "";
}

function intensityAdjective(intensity: string): string {
  const lower = intensity.toLowerCase().trim();
  if (lower.includes("interval")) return "intervals";
  if (lower.includes("tempo")) return "tempo";
  if (lower.includes("threshold")) return "threshold";
  if (lower.includes("recovery")) return "recovery";
  if (lower.includes("steady")) return "steady";
  if (lower.includes("vo2")) return "VO2";
  if (lower.includes("long")) return "long";
  return lower;
}

function formatDistance(km: number): string {
  if (km >= 10) return `${Math.round(km)} km`;
  return `${km.toFixed(1).replace(/\.0$/, "")} km`;
}

// ── WOD: name or first line of structure ───────────────────────────────────

function wodSubtitle(session: Session): string {
  const s = session as Session & { structure?: string | null };
  if (s.structure) return firstLine(s.structure);
  if ((session.exercises ?? []).length > 0) {
    const movements = (session.exercises ?? [])
      .map((e) => e.name)
      .filter((n): n is string => !!n);
    if (movements.length > 0) {
      const first = movements[0];
      return movements.length > 1 ? `${first} +${movements.length - 1} more` : (first ?? "");
    }
  }
  return "";
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/)[0] ?? s;
  return line.trim();
}

// ── Source line helpers ────────────────────────────────────────────────────

export interface SourceLineInput {
  blockLength?: number | null;
  sessionDayNumber?: number | null;
  estimatedMinutes?: [number, number] | null;
}

/** Bottom line of the agenda card. e.g. "45 min · Week 3 of 6", "Week 3 of 6", or "". */
export function sourceLine(input: SourceLineInput): string {
  const parts: string[] = [];

  if (input.estimatedMinutes && input.estimatedMinutes.length === 2) {
    const [lo, hi] = input.estimatedMinutes;
    parts.push(lo === hi ? `${lo} min` : `${lo}-${hi} min`);
  }

  if (
    typeof input.blockLength === "number" &&
    input.blockLength > 0 &&
    typeof input.sessionDayNumber === "number" &&
    input.sessionDayNumber > 0
  ) {
    const week = Math.floor((input.sessionDayNumber - 1) / 7) + 1;
    if (week >= 1 && week <= input.blockLength) {
      parts.push(`Week ${week} of ${input.blockLength}`);
    }
  }

  return parts.join(" · ");
}
