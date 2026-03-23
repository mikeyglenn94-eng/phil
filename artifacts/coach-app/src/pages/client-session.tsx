import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Loader2, CheckCircle2, Clock, Repeat, Zap } from "lucide-react";
import {
  useGetProgramme,
  useUpdateProgramme,
  getListProgrammesQueryKey,
} from "@workspace/api-client-react";
import type { Exercise, Session } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

export default function ClientSession() {
  const [, params] = useRoute("/client/programmes/:programmeId/sessions/:sessionId");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const programmeId = parseInt(params?.programmeId || "0", 10);
  const sessionId = params?.sessionId;

  const { data: programme, isLoading } = useGetProgramme(programmeId, {
    query: { enabled: !!programmeId },
  });

  const updateMutation = useUpdateProgramme();

  const session = useMemo<Session | null>(() => {
    if (!programme?.sessions) return null;
    return programme.sessions.find((s: Session) => s.id === sessionId) || null;
  }, [programme, sessionId]);

  // Local weight state: { [exerciseId]: (number | null)[] }
  const [weights, setWeights] = useState<Record<string, (number | null)[]>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session) return;
    const initial: Record<string, (number | null)[]> = {};
    for (const ex of session.exercises || []) {
      const setsCount = ex.sets || 0;
      const existing = ex.setWeights || [];
      initial[ex.id] = Array.from({ length: setsCount }, (_, i) => existing[i] ?? null);
    }
    setWeights(initial);
  }, [session]);

  const handleWeightChange = (exerciseId: string, setIdx: number, value: string) => {
    const num = value === "" ? null : parseFloat(value);
    setWeights(prev => {
      const current = [...(prev[exerciseId] || [])];
      current[setIdx] = isNaN(num as number) ? null : num;
      return { ...prev, [exerciseId]: current };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!programme || !session) return;
    setIsSaving(true);
    try {
      const updatedSessions = (programme.sessions || []).map((s: Session) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          exercises: (s.exercises || []).map((ex: Exercise) => ({
            ...ex,
            setWeights: weights[ex.id] ?? ex.setWeights ?? [],
          })),
        };
      });

      await updateMutation.mutateAsync({
        id: programmeId,
        data: { sessions: updatedSessions },
      });

      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      setSaved(true);
      toast({ title: "Weights saved!" });
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <p className="text-muted-foreground">Session not found.</p>
        <Button variant="outline" onClick={() => setLocation("/client")}>Back</Button>
      </div>
    );
  }

  const safeDate = session.date || format(new Date(), "yyyy-MM-dd");
  const dateLabel = format(parseISO(safeDate), "EEEE, d MMMM yyyy");

  const totalSets = (session.exercises || []).reduce((acc, ex) => acc + (ex.sets || 0), 0);
  const loggedSets = (session.exercises || []).reduce((acc, ex) => {
    const w = weights[ex.id] || [];
    return acc + w.filter(v => v !== null).length;
  }, 0);

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background border-b shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/client")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <p className="text-xs text-muted-foreground">{dateLabel}</p>
              <h1 className="font-bold text-lg leading-tight">
                {session.name || "Session"}
              </h1>
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className={`rounded-xl px-5 gap-2 ${saved ? "bg-green-600 hover:bg-green-700" : ""}`}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>

        {/* Progress bar */}
        {totalSets > 0 && (
          <div className="max-w-lg mx-auto px-4 pb-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{loggedSets} / {totalSets} sets logged</span>
              <span>{Math.round((loggedSets / totalSets) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${(loggedSets / totalSets) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Exercises */}
      <div className="max-w-lg mx-auto px-4 pt-5 space-y-5">
        {(session.exercises || []).map((ex, exIdx) => {
          const setsCount = ex.sets || 0;
          const exWeights = weights[ex.id] || [];

          return (
            <div key={ex.id} className="bg-card rounded-2xl border shadow-sm overflow-hidden">
              {/* Exercise header */}
              <div className="px-4 pt-4 pb-3 border-b bg-muted/20">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                      {exIdx + 1}
                    </span>
                    <h3 className="font-bold text-base">{ex.name}</h3>
                  </div>
                </div>

                {/* Meta tags */}
                <div className="flex flex-wrap gap-2 mt-2 ml-8">
                  {ex.sets && ex.reps && (
                    <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium">
                      <Repeat className="w-3 h-3" />
                      {ex.sets} × {ex.reps}
                    </span>
                  )}
                  {ex.rpe && (
                    <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium">
                      <Zap className="w-3 h-3" />
                      RPE {ex.rpe}
                    </span>
                  )}
                  {ex.rest && (
                    <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium">
                      <Clock className="w-3 h-3" />
                      Rest {ex.rest}
                    </span>
                  )}
                  {ex.tempo && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-medium">
                      Tempo {ex.tempo}
                    </span>
                  )}
                </div>

                {ex.notes && (
                  <p className="text-xs text-muted-foreground mt-2 ml-8 italic">{ex.notes}</p>
                )}
              </div>

              {/* Set weight inputs */}
              <div className="px-4 py-3">
                {setsCount === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-2">No sets defined</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                      <span className="w-14">Set</span>
                      <span>Weight (kg)</span>
                      <span className="w-14 text-right">Target</span>
                    </div>
                    {Array.from({ length: setsCount }, (_, setIdx) => {
                      const val = exWeights[setIdx];
                      const hasValue = val !== null && val !== undefined;
                      return (
                        <div key={setIdx} className={`grid grid-cols-[auto_1fr_auto] gap-2 items-center rounded-xl px-3 py-2 transition-colors ${
                          hasValue ? "bg-primary/5 border border-primary/20" : "bg-muted/40"
                        }`}>
                          <div className={`w-14 text-sm font-bold ${hasValue ? "text-primary" : "text-muted-foreground"}`}>
                            Set {setIdx + 1}
                            {hasValue && <span className="ml-1 text-primary">✓</span>}
                          </div>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.5"
                            min="0"
                            placeholder="—"
                            value={val ?? ""}
                            onChange={e => handleWeightChange(ex.id, setIdx, e.target.value)}
                            className={`h-10 text-center text-base font-bold border-0 shadow-none rounded-lg bg-transparent focus:bg-background ${
                              hasValue ? "text-primary" : "text-foreground"
                            }`}
                          />
                          <div className="w-14 text-right text-xs text-muted-foreground font-medium">
                            {ex.reps || "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {session.exercises?.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p>No exercises in this session.</p>
          </div>
        )}
      </div>
    </div>
  );
}
