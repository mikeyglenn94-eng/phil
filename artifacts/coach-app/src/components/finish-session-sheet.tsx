import { useEffect, useMemo, useState } from "react";
import { Loader2, Trophy, Timer, Activity, Dumbbell, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export type FinishSheetExercise = {
  name: string;
  sets: { weight: number | null; reps: number | null; rpe?: number | null }[];
};

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Display name shown at the top of the sheet. */
  sessionName: string;
  /** ms epoch when the workout started (first input or session open). */
  sessionStartedAt: number | null;
  /** Total programmed sets across all exercises (for the "X / Y sets" line). */
  programmedSets: number;
  /** Working sets that have at least one of weight/reps. */
  loggedSets: number;
  /** Per-exercise breakdown for volume / RPE / PB calc display. */
  exercises: FinishSheetExercise[];
  /** PBs hit, computed by the server in /session-summary. Pass null while we wait. */
  pbsHit: number | null;
  /** Submitting is true while handleFinish is running. */
  submitting: boolean;
  onFinish: () => void;
  onKeepLogging: () => void;
};

function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FinishSessionSheet({
  open,
  onOpenChange,
  sessionName,
  sessionStartedAt,
  programmedSets,
  loggedSets,
  exercises,
  pbsHit,
  submitting,
  onFinish,
  onKeepLogging,
}: Props) {
  // Tick the duration display every second while open so the readout is live.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const durationLabel = useMemo(() => {
    if (!sessionStartedAt) return "—";
    return formatDuration(now - sessionStartedAt);
  }, [now, sessionStartedAt]);

  const { totalVolume, avgRpeLabel } = useMemo(() => {
    let vol = 0;
    const rpes: number[] = [];
    for (const ex of exercises) {
      for (const s of ex.sets) {
        if (s.weight != null && s.reps != null) vol += s.weight * s.reps;
        if (typeof s.rpe === "number" && s.rpe > 0) rpes.push(s.rpe);
      }
    }
    const avg = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
    return {
      totalVolume: Math.round(vol),
      avgRpeLabel: avg != null ? avg.toFixed(1) : "—",
    };
  }, [exercises]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl px-0 pt-5 pb-4 max-h-[90vh] overflow-y-auto">
        <SheetHeader className="px-5 text-left">
          <SheetTitle className="text-xl">Finish session</SheetTitle>
          <SheetDescription className="text-sm">
            {sessionName || "Workout"}
          </SheetDescription>
        </SheetHeader>

        {/* Stat grid — 2x3, edge-to-edge spacing for readability on mobile */}
        <div className="px-5 mt-4 grid grid-cols-2 gap-3">
          <Stat icon={<Timer className="w-4 h-4" />} label="Duration" value={durationLabel} />
          <Stat
            icon={<Dumbbell className="w-4 h-4" />}
            label="Sets logged"
            value={programmedSets > 0 ? `${loggedSets} / ${programmedSets}` : `${loggedSets}`}
          />
          <Stat icon={<Activity className="w-4 h-4" />} label="Total volume" value={`${totalVolume} kg`} />
          <Stat
            icon={<Trophy className="w-4 h-4" />}
            label="PBs hit"
            value={pbsHit == null ? "—" : `${pbsHit}`}
          />
          <Stat icon={<Zap className="w-4 h-4" />} label="Avg RPE" value={avgRpeLabel} />
        </div>

        {/* Action bar — Finish primary, Keep logging secondary */}
        <div className="px-5 mt-6 space-y-2">
          <Button
            onClick={onFinish}
            disabled={submitting}
            className="w-full h-12 rounded-xl text-base font-semibold gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? "Wrapping up…" : "Finish"}
          </Button>
          <Button
            variant="ghost"
            onClick={onKeepLogging}
            disabled={submitting}
            className="w-full h-11 rounded-xl text-sm text-muted-foreground"
          >
            Keep logging
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-lg font-bold leading-tight">{value}</p>
    </div>
  );
}
