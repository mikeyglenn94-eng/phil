import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { Loader2, MessageSquare, Trophy, AlertTriangle } from "lucide-react";

interface DashboardNote {
  id: number;
  noteText: string;
  sessionId: string;
  updatedAt: string;
}

interface DashboardPB {
  exerciseName: string;
  weightKg: string;
}

interface DashboardClient {
  clientId: number;
  name: string;
  status: "green" | "amber" | "red" | "none";
  missedCount: number;
  todaySessionName: string | null;
  unreadNotes: DashboardNote[];
  pbs: DashboardPB[];
  programmeId: number | null;
  programmeName: string | null;
}

interface DashboardData {
  today: string;
  weekStart: string;
  weekEnd: string;
  clients: DashboardClient[];
}

const STATUS_DOT: Record<DashboardClient["status"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
  none: "bg-muted-foreground/20",
};

const STATUS_RING: Record<DashboardClient["status"], string> = {
  green: "",
  amber: "",
  red: "ring-1 ring-red-400/40",
  none: "",
};

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

export default function CoachDashboard() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["coach-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/coach/dashboard");
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const clients = data?.clients ?? [];
  const today = data?.today ?? format(new Date(), "yyyy-MM-dd");
  const todayLabel = format(parseISO(today + "T12:00:00"), "EEEE d MMMM");

  const hasAnything = clients.some(c => c.status !== "none" || c.unreadNotes.length > 0 || c.pbs.length > 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 lg:px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-xl">Morning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{todayLabel}</p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> Done today</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" /> Due today</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /> 3+ missed</span>
        </div>

        {/* Client list */}
        {!hasAnything ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            All clear — no sessions due, no unread notes.
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map(client => {
              const hasHighlight = client.status !== "none" || client.unreadNotes.length > 0 || client.pbs.length > 0;
              if (!hasHighlight) return null;

              return (
                <button
                  key={client.clientId}
                  onClick={() => setLocation(`/clients/${client.clientId}`)}
                  className={`w-full text-left rounded-2xl border bg-card hover:bg-accent/40 transition-colors p-4 ${STATUS_RING[client.status]}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar + status dot */}
                    <div className="relative shrink-0 mt-0.5">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                        {initials(client.name)}
                      </div>
                      {client.status !== "none" && (
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${STATUS_DOT[client.status]}`} />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Name row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{client.name}</span>

                        {client.status === "red" && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {client.missedCount} missed
                          </span>
                        )}

                        {client.todaySessionName && client.status !== "none" && (
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                            client.status === "green"
                              ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                              : "text-amber-700 bg-amber-50 border-amber-200"
                          }`}>
                            {client.todaySessionName}
                            {client.status === "green" && " ✓"}
                          </span>
                        )}
                      </div>

                      {/* Unread notes */}
                      {client.unreadNotes.map(note => (
                        <div key={note.id} className="flex items-start gap-1.5">
                          <MessageSquare className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground leading-snug">
                            <span className="font-medium text-foreground">Note</span>
                            {" · "}
                            <span className="italic">"{note.noteText.length > 80 ? note.noteText.slice(0, 80) + "…" : note.noteText}"</span>
                          </p>
                        </div>
                      ))}

                      {/* PBs */}
                      {client.pbs.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Trophy className="w-3 h-3 text-amber-500 shrink-0" />
                          <div className="flex gap-1.5 flex-wrap">
                            {client.pbs.map(pb => (
                              <span key={pb.exerciseName} className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                {pb.exerciseName} — {pb.weightKg} kg
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Clients with no activity this week - collapsed list */}
        {(() => {
          const quiet = clients.filter(c => c.status === "none" && c.unreadNotes.length === 0 && c.pbs.length === 0);
          if (!quiet.length) return null;
          return (
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">No activity this week</p>
              <div className="flex flex-wrap gap-2">
                {quiet.map(c => (
                  <button
                    key={c.clientId}
                    onClick={() => setLocation(`/clients/${c.clientId}`)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-full border border-border hover:bg-accent/40"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
