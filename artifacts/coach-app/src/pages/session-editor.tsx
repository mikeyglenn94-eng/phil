import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { VoiceInput } from "@/components/voice-input";
import { ExerciseCard } from "@/components/exercise-card";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, ArrowLeft, Plus, Calendar } from "lucide-react";
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

  const existingSession = useMemo(() => {
    if (!programme?.sessions || isNew) return null;
    return programme.sessions.find((s: Session) => s.id === sessionId) || null;
  }, [programme, sessionId, isNew]);

  useEffect(() => {
    if (existingSession) {
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
      setExercises(items => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleTranscriptComplete = async (transcript: string) => {
    try {
      const response = await parseMutation.mutateAsync({
        data: { transcript, existingExercises: exercises }
      });
      setExercises(response.exercises);

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
    setExercises(current => current.map(ex => ex.id === exerciseId ? { ...ex, ...updates } : ex));
  };

  const deleteExercise = (exerciseId: string) => {
    setExercises(current => current.filter(ex => ex.id !== exerciseId));
  };

  const addEmptyExercise = () => {
    const newEx: Exercise = {
      id: `manual-${Date.now()}`,
      name: "New Exercise",
      sets: null, reps: null, rpe: null, rest: null, tempo: null, notes: null, weekProgression: []
    };
    setExercises([...exercises, newEx]);
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

      await updateMutation.mutateAsync({
        id: programmeId,
        data: { sessions: updatedSessions }
      });

      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      toast({ title: "Session saved!" });
      setLocation(`/`);
    } catch {
      toast({ title: "Error saving session", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const safeDate = sessionDate || format(new Date(), "yyyy-MM-dd");
  const displayTitle = sessionName
    ? `${sessionName} — ${format(parseISO(safeDate), "EEE d MMM")}`
    : format(parseISO(safeDate), "EEEE, d MMMM yyyy");

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] overflow-hidden bg-background">

      {/* Left Panel */}
      <div className="flex-1 flex flex-col h-full bg-background overflow-hidden no-print">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-background z-20 gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => setLocation('/')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  type="date"
                  value={sessionDate}
                  onChange={e => setSessionDate(e.target.value)}
                  className="text-xs text-muted-foreground bg-transparent border-none outline-none cursor-pointer"
                />
              </div>
              <Input
                value={sessionName}
                onChange={e => setSessionName(e.target.value)}
                className="text-xl font-bold border-transparent hover:border-input focus:border-primary shadow-none h-9 px-2 rounded-lg"
                placeholder="Session name (e.g. Quads, Upper Body...)"
              />
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={isSaving || parseMutation.isPending}
            className="rounded-xl px-6 shrink-0"
          >
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save
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

          {/* Exercises */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase">Exercises</h2>
              <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">{exercises.length}</span>
            </div>

            {exercises.length === 0 ? (
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
          </div>
        </div>
      </div>

    </div>
  );
}
