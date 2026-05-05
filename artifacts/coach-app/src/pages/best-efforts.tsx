/**
 * /best-efforts — full Best Efforts list for the logged-in athlete.
 *
 * Linked from the dashboard widget. Calls /api/clients/:clientId/best-efforts.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Trophy, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import type { BestEffortPayload } from "@/pages/dashboard-tab";
import { format, parseISO } from "date-fns";
import { Dumbbell, Footprints, Bike, Waves } from "lucide-react";

export default function BestEffortsPage() {
  const { user, token } = useAuth();
  const [, setLocation] = useLocation();
  const [list, setList] = useState<BestEffortPayload[] | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  useEffect(() => {
    if (!user?.clientId) {
      setError("No athlete account linked to this user.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${BASE}/api/clients/${user.clientId}/best-efforts`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { bestEfforts: BestEffortPayload[] };
        setList(data.bestEfforts);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [user?.clientId, token, BASE]);

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="shrink-0 px-4 py-3 border-b flex items-center gap-3 bg-background sticky top-0 z-10">
        <button
          onClick={() => setLocation("/client")}
          className="p-1 -ml-1 rounded-md hover:bg-muted transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold flex items-center gap-2">
          <Trophy className="w-4 h-4" />
          Best Efforts
        </h1>
      </header>

      <main className="flex-1 p-4 max-w-2xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading…
          </div>
        ) : error ? (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-2xl px-4 py-3">
            {error}
          </div>
        ) : !list || list.length === 0 ? (
          <div className="bg-card border rounded-2xl px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Log your first session to start building your records.
            </p>
            <Link href="/client" className="text-xs text-primary hover:underline mt-2 inline-block">
              Back to dashboard
            </Link>
          </div>
        ) : (
          <div className="bg-card border rounded-2xl overflow-hidden">
            {list.map((effort, i) => (
              <BestEffortFullRow key={i} effort={effort} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function BestEffortFullRow({ effort }: { effort: BestEffortPayload }) {
  const icon = effortIcon(effort);
  const dateLabel = formatDate(effort.date);
  const subParts: string[] = [dateLabel];

  if (effort.kind === "endurance" && effort.paceSecondsPerKm > 0) {
    subParts.push(`${formatPace(effort.paceSecondsPerKm)} /km`);
  }

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{effort.display}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{subParts.join(" · ")}</p>
      </div>
    </div>
  );
}

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
