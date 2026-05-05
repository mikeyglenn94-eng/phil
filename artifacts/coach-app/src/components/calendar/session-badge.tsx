/**
 * Shared session-type pill. Used by month view, week view (grid), and the
 * mobile agenda. Single source of truth for type → label + colour.
 */

import type { Session } from "@workspace/api-client-react";

interface BadgeStyle {
  label: string;
  className: string;
}

export function getSessionTypeBadge(session: Session): BadgeStyle {
  const source = (session as { source?: string | null }).source ?? null;
  switch (source) {
    case "run_brain":
      return { label: "Run", className: "bg-emerald-100 text-emerald-700" };
    case "wod_brain":
      return { label: "WOD", className: "bg-orange-100 text-orange-700" };
    case "cycle_brain":
      return { label: "Cycling", className: "bg-amber-100 text-amber-700" };
    case "swim_brain":
      return { label: "Swimming", className: "bg-sky-100 text-sky-700" };
    case "endurance_cycle":
      return { label: "Endurance", className: "bg-sky-100 text-sky-700" };
    case "strength_block":
      return { label: "Strength", className: "bg-violet-100 text-violet-700" };
    case "progression_block":
      return { label: "Progression", className: "bg-indigo-100 text-indigo-700" };
    default:
      return { label: "Strength", className: "bg-violet-100 text-violet-700" };
  }
}

export function SessionBadge({
  session,
  size = "sm",
  className = "",
}: {
  session: Session;
  size?: "xs" | "sm";
  className?: string;
}) {
  const badge = getSessionTypeBadge(session);
  const sizing =
    size === "xs"
      ? "text-[8px] px-1.5 py-0.5"
      : "text-[10px] px-2 py-0.5";
  return (
    <span
      className={`inline-block font-semibold leading-none rounded-full ${sizing} ${badge.className} ${className}`}
    >
      {badge.label}
    </span>
  );
}
