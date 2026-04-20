import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { VoiceInput } from "@/components/voice-input";
import { ExerciseCard } from "@/components/exercise-card";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, ArrowLeft, Plus, Calendar, Brain, Zap, Trash2, CheckCircle2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useGetProgramme,
  useUpdateProgramme,
  useParseTranscript,
  getListProgrammesQueryKey,
} from "@workspace/api-client-react";
import type { Exercise, Session } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

export default function SessionEditor() {
  const [, params] = useRoute("/programmes/:programmeId/sessions/:sessionId");
  const search = useSearch();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const programmeId = parseInt(params?.programmeId || "0", 10);
  const sessionId = params?.sessionId;
  const isNew = sessionId === "new";

  const goBack = () => {
    const returnTo = sessionStorage.getItem("session_editor_returnTo");
    if (returnTo) {
      sessionStorage.removeItem("session_editor_returnTo");
      setLocation(returnTo);
    } else {
      window.history.back();
    }
  };

  const searchParams = new URLSearchParams(search);
  const dateFromUrl = searchParams.get("date") || format(new Date(), "yyyy-MM-dd");

  const { data: programme, isLoading } = useGetProgramme(programmeId, {
    query: { enabled: !!programmeId }
  });

  const updateMutation = useUpdateProgramme();
  const parseMutation = useParseTranscript();

  const [sessionName, setSessionName] = useState("");
  const [sessionDate, setSessionDate] = useState(dateFromUrl);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const existingSession = useMemo(() => {
    // Check for injected session data (used when navigating from team calendar
    // where there is no real programme to fetch from)
    const injected = sessionStorage.getItem("session_editor_injected");
    if (injected) {
      try {
        return JSON.parse(injected) as Session;
      } catch {
        // fall through to programme lookup
      }
    }
    if (!programme?.sessions || isNew) return null;
    return programme.sessions.find((s: Session) => s.id === sessionId) || null;
  }, [programme, sessionId, isNew]);

  useEffect(() => {
    if (existingSession) {
      // Clear injected data now that it's been consumed into state
      sessionStorage.removeItem("session_editor_injected");
      setSessionName(existingSession.name || "");
      setSessionDate(existingSession.date);
      setExercises(existingSession.exercises || []);
    }
  }, [existingSession]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = exercises.findIndex(i => i.id === active.id);
      const newIndex = exercises.findIndex(i => i.id === over.id);
      const next = arrayMove(exercises, oldIndex, newIndex);
      setExercises(next);
      scheduleAutosave(next, sessionName, sessionDate);
    }
  };

  const handleTranscriptComplete = async (transcript: string) => {
    try {
      const response = await parseMutation.mutateAsync({
        data: { transcript, existingExercises: exercises }
      });
      setExercises(response.exercises);
      scheduleAutosave(response.exercises, sessionName, sessionDate);

      // Show a meaningful description of what changed
      const changes = (response as any).changes as string[] | undefined;
      if (changes && changes.length > 0) {
        toast({
          title: changes.length === 1 ? changes[0] : `${changes.length} changes applied`,
          description: changes.length > 1 ? changes.join(" · ") : undefined,
        });
      } else {
        const before = exercises.length;
        const after = response.exercises.length;
        const diff = after - before;
        toast({
          title: diff > 0
            ? `Added ${diff} exercise${diff !== 1 ? "s" : ""}`
            : diff < 0
            ? `Removed ${Math.abs(diff)} exercise${Math.abs(diff) !== 1 ? "s" : ""}`
            : "Session updated",
        });
      }
    } catch {
      toast({ title: "Failed to parse input", variant: "destructive" });
    }
  };

  const updateExercise = (exerciseId: string, updates: Partial<Exercise>) => {
    const next = exercises.map(ex => ex.id === exerciseId ? { ...ex, ...updates } : ex);
    setExercises(next);
    scheduleAutosave(next, sessionName, sessionDate);
  };

  const deleteExercise = (exerciseId: string) => {
    const next = exercises.filter(ex => ex.id !== exerciseId);
    setExercises(next);
    scheduleAutosave(next, sessionName, sessionDate);
  };

  const addEmptyExercise = () => {
    const newEx: Exercise = {
      id: `manual-${Date.now()}`,
      name: "New Exercise",
      sets: null, reps: null, rpe: null, rest: null, tempo: null, notes: null, weekProgression: []
    };
    const next = [...exercises, newEx];
    setExercises(next);
    scheduleAutosave(next, sessionName, sessionDate);
  };

  const handleSaveQuiet = async (currentExercises: Exercise[], currentName: string, currentDate: string) => {
    if (!programme || isNew || isSaving) return;
    setIsSaving(true);
    setSaveStatus("saving");
    try {
      const session: Session = {
        id: sessionId!,
        date: currentDate,
        name: currentName || undefined,
        exercises: currentExercises,
      };
      const updatedSessions = (programme.sessions || []).map((s: Session) => s.id === sessionId ? session : s);
      await updateMutation.mutateAsync({ id: programmeId, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
    } finally {
      setIsSaving(false);
    }
  };

  const scheduleAutosave = (currentExercises: Exercise[], currentName: string, currentDate: string) => {
    if (isNew) return;
    setSaveStatus("unsaved");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => handleSaveQuiet(currentExercises, currentName, currentDate), 1500);
  };

  const handleSave = async () => {
    if (!programme) return;
    setIsSaving(true);
    try {
      const session: Session = {
        id: isNew ? `session-${Date.now()}` : sessionId!,
        date: sessionDate,
        name: sessionName || undefined,
        exercises,
      };

      let updatedSessions: Session[];
      if (isNew) {
        updatedSessions = [...(programme.sessions || []), session];
      } else {
        updatedSessions = (programme.sessions || []).map((s: Session) => s.id === sessionId ? session : s);
      }

      await updateMutation.mutateAsync({ id: programmeId, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      setSaveStatus("saved");
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      toast({ title: "Session saved!" });
      goBack();
    } catch {
      toast({ title: "Error saving session", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!programme || isNew) return;
    if (!confirm(`Delete this session? This cannot be undone.`)) return;
    try {
      const updatedSessions = (programme.sessions || []).filter((s: Session) => s.id !== sessionId);
      await updateMutation.mutateAsync({ id: programmeId, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      toast({ title: "Session deleted" });
      goBack();
    } catch {
      toast({ title: "Error deleting session", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const safeDate = sessionDate || format(new Date(), "yyyy-MM-dd");
  const displayTitle = sessionName
    ? `${sessionName} — ${format(parseISO(safeDate), "EEE d MMM")}`
    : format(parseISO(safeDate), "EEEE, d MMMM yyyy");

  const sessionSource = (existingSession as any)?.source as "wod_brain" | "run_brain" | "endurance_cycle" | undefined;
  const isConditioningSession = sessionSource === "wod_brain" || sessionSource === "run_brain" || sessionSource === "endurance_cycle";
  const sessionStructure = (existingSession as any)?.structure as string | undefined;

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] overflow-hidden bg-background">

      {/* Left Panel */}
      <div className="flex-1 flex flex-col h-full bg-background overflow-hidden no-print">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-background z-20 gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Button variant="ghost" size="icon" onClick={goBack}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  type="date"
                  value={sessionDate}
                  onChange={e => { setSessionDate(e.target.value); scheduleAutosave(exercises, sessionName, e.target.value); }}
                  className="text-xs text-muted-foreground bg-transparent border-none outline-none cursor-pointer"
                />
              </div>
              <Input
                value={sessionName}
                onChange={e => { setSessionName(e.target.value); scheduleAutosave(exercises, e.target.value, sessionDate); }}
                className="text-xl font-bold border-transparent hover:border-input focus:border-primary shadow-none h-9 px-2 rounded-lg"
                placeholder="Session name (e.g. Quads, Upper Body...)"
              />
            </div>
          </div>
          {!isNew && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl"
              title="Delete session"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          {!isNew && saveStatus !== "unsaved" && (
            <span className={`text-xs shrink-0 flex items-center gap-1 ${saveStatus === "saving" ? "text-muted-foreground" : "text-green-600"}`}>
              {saveStatus === "saving"
                ? <><Loader2 className="w-3 h-3 animate-spin" />Saving…</>
                : <><CheckCircle2 className="w-3 h-3" />Saved</>}
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving || parseMutation.isPending}
            className="rounded-xl px-6 shrink-0"
          >
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {isNew ? "Save" : "Done"}
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 pb-32">

          {/* Voice Input */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase">Voice / Edit</h2>
              {exercises.length > 0 && (
                <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                  Add · Edit · Remove · Reorder
                </span>
              )}
            </div>
            <VoiceInput
              onTranscriptComplete={handleTranscriptComplete}
              isProcessing={parseMutation.isPending}
              editMode={exercises.length > 0}
            />
          </div>

          {/* Exercises / Workout */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase">
                {isConditioningSession ? "Workout" : "Exercises"}
              </h2>
              {!isConditioningSession && (
                <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">{exercises.length}</span>
              )}
            </div>

            {isConditioningSession ? (
              <div className="space-y-4">
              {(() => {
                const isGreen = sessionSource === "run_brain" || sessionSource === "endurance_cycle";
                const srcLabel = sessionSource === "run_brain" ? "Run Brain" : sessionSource === "endurance_cycle" ? "Endurance Cycle" : "WOD Brain";
                const guidance = (existingSession as any)?.guidance as string | undefined;
                return (
                <div className={`rounded-2xl border p-5 space-y-4 ${isGreen ? "bg-green-50 border-green-200" : "bg-purple-50 border-purple-200"}`}>
                  <div className="flex items-center gap-2">
                    {isGreen
                      ? <Zap className="w-4 h-4 text-green-600 shrink-0" />
                      : <Brain className="w-4 h-4 text-purple-600 shrink-0" />
                    }
                    <span className={`text-xs font-bold uppercase tracking-wide ${isGreen ? "text-green-700" : "text-purple-700"}`}>
                      {srcLabel}
                    </span>
                  </div>
                  {sessionStructure && (
                    <p className={`text-sm italic leading-relaxed ${isGreen ? "text-green-900" : "text-purple-900"}`}>
                      {sessionStructure}
                    </p>
                  )}
                  <ol className="space-y-2">
                    {exercises.map((ex, i) => (
                      <li key={ex.id} className="flex items-baseline gap-3">
                        <span className={`text-sm font-bold shrink-0 w-5 ${isGreen ? "text-green-600" : "text-purple-600"}`}>{i + 1}.</span>
                        <div>
                          <span className="text-sm font-semibold text-foreground capitalize">{ex.name}</span>
                          {ex.notes && <span className="text-sm text-muted-foreground ml-2">{ex.notes}</span>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {guidance && (
                    <div className={`border-t pt-3 mt-1 space-y-1.5 ${isGreen ? "border-green-200" : "border-purple-200"}`}>
                      {guidance.split(/\n\n+/).map((para, pi) => (
                        <p key={pi} className={`text-xs leading-relaxed ${isGreen ? "text-green-900/80" : "text-purple-900/80"}`}>{para.trim()}</p>
                      ))}
                    </div>
                  )}
                </div>
                );
              })()}
              {/* Run log (read-only for coach) */}
              {(sessionSource === "run_brain" || sessionSource === "endurance_cycle") && (() => {
                const runLog = (existingSession as any)?.runLog as Array<{ distance?: number | null; pace?: string | null }> | undefined;
                if (!runLog || runLog.length === 0) return null;
                return (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="grid grid-cols-[2rem_1fr_1fr] gap-0 bg-emerald-50 border-b border-emerald-100 px-3 py-1.5 text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">
                      <span>#</span>
                      <span>Distance (km)</span>
                      <span>Pace (min/km)</span>
                    </div>
                    {runLog.map((row, i) => (
                      <div key={i} className="grid grid-cols-[2rem_1fr_1fr] gap-0 px-3 py-2 border-b border-border last:border-b-0 text-sm">
                        <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
                        <span className="font-semibold text-primary">{row.distance != null ? `${row.distance} km` : "—"}</span>
                        <span className="font-semibold">{row.pace || "—"}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {/* Client feedback (read-only for coach) */}
              {(existingSession as any)?.clientComment && (
                <div className="rounded-xl border bg-muted/30 p-4 space-y-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Client Feedback</p>
                  <p className="text-sm text-foreground leading-relaxed">{(existingSession as any).clientComment}</p>
                </div>
              )}
              </div>
            ) : exercises.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-2xl bg-muted/20">
                <p className="text-muted-foreground text-sm">No exercises yet. Use voice above or add manually.</p>
                <Button variant="outline" className="mt-4 rounded-xl" onClick={addEmptyExercise}>
                  <Plus className="w-4 h-4 mr-2" /> Add Manually
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={exercises.map(e => e.id)} strategy={verticalListSortingStrategy}>
                    {exercises.map(exercise => (
                      <ExerciseCard
                        key={exercise.id}
                        exercise={exercise}
                        onChange={updateExercise}
                        onDelete={deleteExercise}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                <Button variant="ghost" onClick={addEmptyExercise} className="w-full border border-dashed rounded-xl h-12 text-muted-foreground hover:text-foreground">
                  <Plus className="w-4 h-4 mr-2" /> Add Another Exercise
                </Button>
              </div>
            )}

            {/* Client Results — shown when client has logged data */}
            {!isConditioningSession && existingSession && (() => {
              const hasAnyResults = !!(existingSession as any).clientComment ||
                (existingSession.exercises ?? []).some((ex: any) =>
                  (ex.setReps ?? []).some((r: any) => r !== null && r !== undefined) ||
                  (ex.setWeights ?? []).some((w: any) => w !== null && w !== undefined) ||
                  ex.clientComment
                );
              if (!hasAnyResults) return null;
              return (
                <div className="mt-8">
                  <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase mb-3 px-1">Client Results</h2>
                  <div className="space-y-3">
                    {(existingSession as any).clientComment && (
                      <div className="bg-primary/5 border border-primary/15 rounded-xl px-4 py-3">
                        <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider mb-1.5">Session note</p>
                        <p className="text-sm text-foreground leading-relaxed">"{(existingSession as any).clientComment}"</p>
                      </div>
                    )}
                    {(existingSession.exercises ?? []).map((ex: any, i: number) => {
                      const hasLog = (ex.setReps ?? []).some((r: any) => r !== null && r !== undefined) ||
                                     (ex.setWeights ?? []).some((w: any) => w !== null && w !== undefined);
                      if (!hasLog && !ex.clientComment) return null;
                      const numSets = ex.sets ?? Math.max((ex.setReps ?? []).length, (ex.setWeights ?? []).length, 0);
                      return (
                        <div key={ex.id ?? i} className="border rounded-xl overflow-hidden">
                          <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                            <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">{i + 1}</span>
                            <p className="text-sm font-semibold">{ex.name}</p>
                          </div>
                          {hasLog && numSets > 0 && (
                            <div className="px-4 py-3 border-t space-y-1.5">
                              {Array.from({ length: numSets }).map((_, si) => {
                                const reps = ex.setReps?.[si];
                                const kg = ex.setWeights?.[si];
                                const done = reps !== null && reps !== undefined;
                                return (
                                  <div key={si} className={`flex items-center gap-3 text-xs ${done ? "text-foreground" : "text-muted-foreground/40"}`}>
                                    <span className="w-12 shrink-0 font-medium">Set {si + 1}</span>
                                    {done ? (
                                      <>
                                        <span className="font-semibold text-primary">{reps} reps</span>
                                        {kg !== null && kg !== undefined && <span className="text-muted-foreground">@ {kg} kg</span>}
                                      </>
                                    ) : (
                                      <span className="italic">not logged</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {ex.clientComment && (
                            <div className="px-4 py-2.5 border-t bg-primary/5">
                              <p className="text-xs text-foreground/70 italic">"{ex.clientComment}"</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

    </div>
  );
}
