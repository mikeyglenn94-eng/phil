/**
 * Best Efforts feed — top-5 widget for the dashboard.
 *
 * Hybrid Highlights (cross-sport records — biggest combined week, biggest day,
 * longest hybrid streak) appear above the standard list as the headline section.
 *
 * Full list lives at /best-efforts. This widget shows 5 most-recent records
 * with a "View all" link.
 */

import { Trophy, Dumbbell, Footprints, Bike, Waves } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import type { BestEffortPayload, AnalyticsData } from "@/pages/dashboard-tab";

interface BestEffortsFeedProps {
  topBestEfforts: BestEffortPayload[] | undefined;
  hybridHighlights?: AnalyticsData["hybridHighlights"] | null;
}

export function BestEffortsFeed({
  topBestEfforts,
  hybridHighlights,
}: BestEffortsFeedProps) {
  const list = topBestEfforts ?? [];
  const hasAny = list.length > 0;

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5" />
          Best Efforts
        </h2>
      </header>

      {hybridHighlights ? <HybridHighlights highlights={hybridHighlights} /> : null}

      {!hasAny ? (
        <div className="bg-card border rounded-2xl px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Log your first session to start building your records.
          </p>
        </div>
      ) : (
        <div className="bg-card border rounded-2xl overflow-hidden">
          {list.map((effort, i) => (
            <BestEffortRow key={i} effort={effort} />
          ))}
        </div>
      )}

      {hasAny ? (
        <div className="text-right">
          <Link
            href="/best-efforts"
            className="text-xs text-primary hover:underline"
          >
            View all best efforts →
          </Link>
        </div>
      ) : null}
    </section>
  );
}

// ── Hybrid Highlights ──────────────────────────────────────────────────────

function HybridHighlights({
  highlights,
}: {
  highlights: NonNullable<AnalyticsData["hybridHighlights"]>;
}) {
  const { biggestCombinedWeek, biggestSingleDay, longestHybridStreak } = highlights;
  const anyHighlight = !!biggestCombinedWeek || !!biggestSingleDay || longestHybridStreak > 0;
  if (!anyHighlight) return null;

  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-4 py-3 flex flex-col gap-2">
      <p className="text-[9px] font-bold text-amber-700 tracking-widest uppercase">
        Hybrid Highlights
      </p>
      {biggestCombinedWeek ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Biggest combined week</span>
          <span className="font-semibold tabular-nums">
            {fmtVol(biggestCombinedWeek.totalVolume)} · {fmtDist(biggestCombinedWeek.totalDistance)}
          </span>
        </div>
      ) : null}
      {biggestSingleDay ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Biggest single day</span>
          <span className="font-semibold tabular-nums">
            {fmtVol(biggestSingleDay.totalVolume)} · {fmtDist(biggestSingleDay.totalDistance)}
          </span>
        </div>
      ) : null}
      {longestHybridStreak > 0 ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Longest hybrid streak</span>
          <span className="font-semibold tabular-nums">
            {longestHybridStreak} {longestHybridStreak === 1 ? "week" : "weeks"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── Best Effort row ────────────────────────────────────────────────────────

function BestEffortRow({ effort }: { effort: BestEffortPayload }) {
  const icon = effortIcon(effort);
  const dateLabel = formatDate(effort.date);
  const subParts: string[] = [dateLabel];

  if (effort.kind === "endurance" && effort.paceSecondsPerKm > 0) {
    subParts.push(`${formatPace(effort.paceSecondsPerKm)} /km`);
  }

  // v1: rows are display-only. Linking back to the source session needs the
  // programmeId, which the analytics payload doesn't currently carry. Easy
  // follow-up once the response includes it.
  return (
    <div className="flex items-start gap-3 px-3.5 py-3 border-b last:border-b-0">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{effort.display}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{subParts.join(" · ")}</p>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function effortIcon(effort: BestEffortPayload) {
  if (effort.kind === "lift") return <Dumbbell className="w-4 h-4" />;
  if (effort.kind === "longest") {
    if (effort.sport === "run") return <Footprints className="w-4 h-4" />;
    if (effort.sport === "cycle") return <Bike className="w-4 h-4" />;
    return <Waves className="w-4 h-4" />;
  }
  return <Footprints className="w-4 h-4" />;
}

function formatDate(d: string): string {
  try {
    return format(parseISO(d), "d MMM yyyy");
  } catch {
    return d;
  }
}

function formatPace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtVol(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}kg`;
}

function fmtDist(km: number): string {
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}
