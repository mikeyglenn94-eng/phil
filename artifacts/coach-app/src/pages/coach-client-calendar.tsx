import { useState, useMemo, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, Dumbbell, MessageSquare, CheckCircle2, X, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, addWeeks, startOfWeek, addDays, parseISO } from "date-fns";
import { useGetProgramme, useGetClient } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, Exercise } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const WEEKS_TO_SHOW = 4;

const SESSION_COLORS = [
  { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-800", dot: "bg-blue-500", header: "bg-blue-100" },
  { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", dot: "bg-green-500", header: "bg-green-100" },
  { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-800", dot: "bg-purple-500", header: "bg-purple-100" },
  { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-800", dot: "bg-orange-500", header: "bg-orange-100" },
  { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-800", dot: "bg-pink-500", header: "bg-pink-100" },
  { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-800", dot: "bg-yellow-500", header: "bg-yellow-100" },
  { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-800", dot: "bg-cyan-500", header: "bg-cyan-100" },
];

function getSessionColor(name?: string | null) {
  if (!name) return SESSION_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length];
}

function sessionHasResults(session: Session): boolean {
  return (session.exercises || []).some(ex =>
    (ex.setWeights || []).some(w => w !== null && w !== undefined) ||
    (ex.setReps || []).some(r => r !== null && r !== undefined)
  );
}

function sessionHasFeedback(session: Session): boolean {
  if ((session as any).clientComment) return true;
  return (session.exercises || []).some(ex => !!(ex as any).clientComment);
}

interface ClientNote {
  id: number;
  clientId: number;
  sessionId: string;
  exerciseId: string | null;
  noteText: string;
  readByCoach: boolean;
  updatedAt: string;
}

export default function CoachClientCalendar() {
  const [, params] = useRoute("/clients/:clientId/programmes/:programmeId");
  const [, setLocation] = useLocation();
  const clientId = parseInt(params?.clientId || "0", 10);
  const programmeId = parseInt(params?.programmeId || "0", 10);
  const qc = useQueryClient();

  const { data: client } = useGetClient(clientId);
  const { data: programme, isLoading } = useGetProgramme(programmeId, {
    query: { enabled: !!programmeId },
  });

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const { data: clientNotes = [] } = useQuery<ClientNote[]>({
    queryKey: ["client-notes", clientId],
    queryFn: async () => {
      const r = await fetch(`/api/client-notes?clientId=${clientId}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!clientId,
  });

  const notesBySessionId = useMemo(() => {
    const map: Record<string, ClientNote[]> = {};
    for (const n of clientNotes) {
      if (!map[n.sessionId]) map[n.sessionId] = [];
      map[n.sessionId].push(n);
    }
    return map;
  }, [clientNotes]);

  useEffect(() => {
    if (!selectedSession) return;
    const notes = notesBySessionId[selectedSession.id];
    if (!notes?.length) return;
    const hasUnread = notes.some(n => !n.readByCoach);
    if (!hasUnread) return;
    fetch("/api/client-notes/mark-read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, sessionId: selectedSession.id }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: ["client-notes", clientId] });
    }).catch(() => {});
  }, [selectedSession?.id]);

  const weekStart = useMemo(
    () => startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 }),
    [weekOffset]
  );

  const weeks = useMemo(() =>
    Array.from({ length: WEEKS_TO_SHOW }, (_, wi) => {
      const ws = addWeeks(weekStart, wi);
      return Array.from({ length: 7 }, (_, di) => addDays(ws, di));
    }),
    [weekStart]
  );

  const sessionsByDate = useMemo(() => {
    const map: Record<string, Session> = {};
    for (const s of programme?.sessions || []) {
      map[s.date] = s;
    }
    return map;
  }, [programme]);

  if (isLoading) return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  const clientInitials = client?.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() ?? "??";

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 lg:px-6 py-4 border-b bg-background">
        <Button variant="ghost" size="icon" className="rounded-xl shrink-0" onClick={() => setLocation(`/clients/${clientId}`)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
          {clientInitials}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-base leading-tight truncate">{programme?.title || "Programme"}</h1>
          {client && <p className="text-xs text-muted-foreground truncate">{client.name}</p>}
        </div>
        {/* Week nav */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => setWeekOffset(o => o - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="rounded-xl px-2 text-xs h-8" onClick={() => setWeekOffset(0)}>
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => setWeekOffset(o => o + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-w-[640px]">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b sticky top-0 bg-background z-10">
            {DAYS.map(day => (
              <div key={day} className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-r last:border-r-0">
                {day}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
              {week.map((day, di) => {
                const dateKey = format(day, "yyyy-MM-dd");
                const session = sessionsByDate[dateKey];
                const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                const color = session ? getSessionColor(session.name) : null;
                const hasResults = session ? sessionHasResults(session) : false;
                const hasFeedback = session ? sessionHasFeedback(session) : false;
                const isConditioning = session && ((session as any).source === "wod_brain" || (session as any).source === "run_brain");
                const sessionNotes = session ? (notesBySessionId[session.id] ?? []) : [];
                const hasUnreadNote = sessionNotes.some(n => !n.readByCoach);
                const hasNote = sessionNotes.length > 0;

                return (
                  <div
                    key={di}
                    className="border-r last:border-r-0 min-h-[100px] p-1.5 relative"
                  >
                    {/* Date number */}
                    <div className={`text-xs font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                      {format(day, "d")}
                    </div>

                    {session && color && (
                      <button
                        onClick={() => setSelectedSession(session)}
                        className={`w-full text-left rounded-xl border ${color.bg} ${color.border} overflow-hidden hover:shadow-sm transition-all hover:scale-[1.02] active:scale-100 ${hasUnreadNote ? "ring-2 ring-amber-400/60 ring-offset-1" : ""}`}
                      >
                        {/* Session name bar */}
                        <div className={`px-2 py-1 ${color.header} flex items-center justify-between gap-1`}>
                          <span className={`text-[10px] font-bold truncate ${color.text}`}>{session.name || "Session"}</span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {hasResults && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />}
                            {hasFeedback && <MessageSquare className="w-2.5 h-2.5 text-amber-500" />}
                            {hasNote && (
                              <span className="relative flex items-center">
                                <MessageSquare className="w-2.5 h-2.5 text-blue-500" />
                                {hasUnreadNote && (
                                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Exercise list */}
                        <div className="px-2 py-1 space-y-0.5">
                          {isConditioning ? (
                            <span className={`text-[9px] font-semibold uppercase tracking-wide ${(session as any).source === "run_brain" ? "text-green-600" : "text-purple-600"}`}>
                              {(session as any).source === "run_brain" ? "Run Brain" : "WOD Brain"}
                            </span>
                          ) : (
                            (session.exercises || []).slice(0, 4).map((ex: Exercise) => {
                              const logged = (ex.setWeights || []).some(w => w != null) || (ex.setReps || []).some(r => r != null);
                              return (
                                <div key={ex.id} className="flex items-center gap-1">
                                  {logged && <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />}
                                  <p className={`text-[9px] truncate leading-tight ${logged ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                    {ex.name}
                                  </p>
                                </div>
                              );
                            })
                          )}
                          {!isConditioning && (session.exercises || []).length > 4 && (
                            <p className="text-[9px] text-muted-foreground">+{(session.exercises || []).length - 4} more</p>
                          )}
                        </div>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Session detail panel */}
      {selectedSession && (() => {
        const panelNotes = notesBySessionId[selectedSession.id] ?? [];
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedSession(null)} />
            <div className="relative z-10 w-full sm:max-w-lg bg-background rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85dvh] sm:max-h-[80vh]">
              {/* Panel header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0">
                <div className={`w-3 h-3 rounded-full ${getSessionColor(selectedSession.name).dot}`} />
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-base truncate">{selectedSession.name || "Session"}</h2>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(selectedSession.date + "T12:00:00"), "EEEE d MMMM yyyy")}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="rounded-xl shrink-0" onClick={() => setSelectedSession(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Conditioning session */}
                {((selectedSession as any).source === "wod_brain" || (selectedSession as any).source === "run_brain") && (() => {
                  const isRun = (selectedSession as any).source === "run_brain";
                  return (
                    <div className={`rounded-2xl border p-4 ${isRun ? "bg-green-50 border-green-200" : "bg-purple-50 border-purple-200"}`}>
                      <div className="flex items-center gap-2 mb-3">
                        {isRun
                          ? <Zap className="w-4 h-4 text-green-600" />
                          : <Clock className="w-4 h-4 text-purple-600" />}
                        <span className={`text-xs font-bold uppercase tracking-wide ${isRun ? "text-green-700" : "text-purple-700"}`}>
                          {isRun ? "Run Brain" : "WOD Brain"}
                        </span>
                      </div>
                      {(selectedSession as any).structure && (
                        <p className={`text-sm font-medium mb-3 ${isRun ? "text-green-800" : "text-purple-800"}`}>
                          {(selectedSession as any).structure}
                        </p>
                      )}
                      <div className="space-y-1">
                        {(selectedSession.exercises || []).map((ex: Exercise) => (
                          <div key={ex.id} className="flex items-baseline gap-2">
                            <span className={`text-xs font-semibold ${isRun ? "text-green-700" : "text-purple-700"}`}>{ex.name}</span>
                            {ex.notes && <span className={`text-xs ${isRun ? "text-green-600/70" : "text-purple-600/70"}`}>{ex.notes}</span>}
                          </div>
                        ))}
                      </div>
                      {/* Session feedback */}
                      {(selectedSession as any).clientComment && (
                        <div className="mt-4 pt-3 border-t border-current/10">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <MessageSquare className={`w-3.5 h-3.5 ${isRun ? "text-green-600" : "text-purple-600"}`} />
                            <span className={`text-xs font-semibold ${isRun ? "text-green-700" : "text-purple-700"}`}>Client Feedback</span>
                          </div>
                          <p className={`text-sm ${isRun ? "text-green-800" : "text-purple-800"}`}>{(selectedSession as any).clientComment}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Strength exercises */}
                {!(selectedSession as any).source && (selectedSession.exercises || []).map((ex: Exercise) => {
                  const hasLog = (ex.setWeights || []).some(w => w != null) || (ex.setReps || []).some(r => r != null);
                  const setsCount = ex.sets || 0;
                  return (
                    <div key={ex.id} className="bg-muted/40 rounded-2xl border p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-semibold text-sm">{ex.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {ex.sets} sets
                            {ex.reps ? ` × ${ex.reps} reps` : ""}
                            {ex.rpe ? ` · RPE ${ex.rpe}` : ""}
                          </p>
                        </div>
                        {hasLog && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Logged
                          </span>
                        )}
                      </div>

                      {/* Set table */}
                      {setsCount > 0 && (
                        <div className="mt-2 rounded-xl overflow-hidden border bg-background">
                          <div className="grid grid-cols-3 px-3 py-1.5 bg-muted/60 border-b">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Set</span>
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide text-center">Weight (kg)</span>
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide text-center">Reps</span>
                          </div>
                          {Array.from({ length: setsCount }, (_, i) => {
                            const weight = ex.setWeights?.[i];
                            const reps = ex.setReps?.[i];
                            const logged = weight != null || reps != null;
                            return (
                              <div key={i} className={`grid grid-cols-3 px-3 py-2 border-b last:border-b-0 ${logged ? "bg-emerald-50/50" : ""}`}>
                                <span className="text-xs font-semibold text-muted-foreground">{i + 1}</span>
                                <span className={`text-xs text-center font-medium ${logged ? "text-foreground" : "text-muted-foreground/40"}`}>
                                  {weight != null ? `${weight}` : "—"}
                                </span>
                                <span className={`text-xs text-center font-medium ${logged ? "text-foreground" : "text-muted-foreground/40"}`}>
                                  {reps != null ? `${reps}` : "—"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Per-exercise client comment */}
                      {(ex as any).clientComment && (
                        <div className="mt-3 flex gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-foreground/80 italic">"{(ex as any).clientComment}"</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Empty state */}
                {!(selectedSession as any).source && !(selectedSession.exercises || []).length && (
                  <div className="text-center py-10 text-muted-foreground">
                    <Dumbbell className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No exercises in this session</p>
                  </div>
                )}

                {/* Client notes from client_notes table */}
                {panelNotes.length > 0 && (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-blue-600" />
                      <span className="text-xs font-bold uppercase tracking-wide text-blue-700">
                        Notes from {client?.name?.split(" ")[0] ?? "Client"}
                      </span>
                    </div>
                    {panelNotes.map(note => (
                      <div key={note.id} className="space-y-0.5">
                        <p className="text-sm text-blue-900 leading-snug">"{note.noteText}"</p>
                        <p className="text-[11px] text-blue-500">
                          {format(new Date(note.updatedAt), "d MMM yyyy · HH:mm")}
                          {note.exerciseId && <span className="ml-1 italic">· exercise note</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
