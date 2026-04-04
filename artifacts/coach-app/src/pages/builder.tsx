import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { VoiceInput } from "@/components/voice-input";
import { ExerciseCard } from "@/components/exercise-card";
import { PreviewPanel } from "@/components/preview-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, ArrowLeft, Plus } from "lucide-react";
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
  useCreateProgramme, 
  useUpdateProgramme, 
  useParseTranscript,
  getListProgrammesQueryKey,
  getGetProgrammeQueryKey
} from "@workspace/api-client-react";
import type { Exercise } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Builder({ isNew = false }: { isNew?: boolean }) {
  const [, params] = useRoute("/programmes/:id");
  const [, setLocation] = useLocation();
  const id = isNew ? null : parseInt(params?.id || "0", 10);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: programme, isLoading: isLoadingProgramme } = useGetProgramme(id || 0, {
    query: { enabled: !!id }
  });

  const createMutation = useCreateProgramme();
  const updateMutation = useUpdateProgramme();
  const parseMutation = useParseTranscript();

  const [title, setTitle] = useState("Untitled Programme");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Sync state when data loads
  useEffect(() => {
    if (programme && !isNew) {
      setTitle(programme.title);
      setExercises(programme.exercises || []);
    }
  }, [programme, isNew]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // minimum drag distance before firing
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setExercises((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleTranscriptComplete = async (transcript: string) => {
    try {
      const response = await parseMutation.mutateAsync({
        data: {
          transcript,
          existingExercises: exercises
        }
      });
      // The AI returns the fully updated list of exercises
      setExercises(response.exercises);
      toast({ title: "Exercises updated from voice!" });
    } catch (error) {
      toast({ title: "Failed to parse voice input", variant: "destructive" });
    }
  };

  const updateExercise = (exerciseId: string, updates: Partial<Exercise>) => {
    setExercises(current => 
      current.map(ex => ex.id === exerciseId ? { ...ex, ...updates } : ex)
    );
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
    setIsSaving(true);
    try {
      if (isNew) {
        const result = await createMutation.mutateAsync({
          data: { title, exercises }
        });
        queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
        toast({ title: "Programme created!" });
        setLocation(`/programmes/${result.id}`);
      } else {
        await updateMutation.mutateAsync({
          id: id!,
          data: { title, exercises }
        });
        queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProgrammeQueryKey(id!) });
        toast({ title: "Saved successfully!" });
      }
    } catch (err) {
      toast({ title: "Error saving programme", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingProgramme && !isNew) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] overflow-hidden bg-background">
      
      {/* Left Panel: Editor & Voice */}
      <div className="flex-[55] flex flex-col h-full border-r bg-background relative z-10 shadow-xl overflow-hidden no-print">
        
        {/* Editor Header */}
        <div className="flex items-center justify-between p-4 border-b bg-background z-20">
          <div className="flex items-center gap-2 flex-1">
            <Button variant="ghost" size="icon" onClick={() => window.history.back()} className="mr-2">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Input 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-2xl font-display font-bold border-transparent hover:border-input focus:border-primary shadow-none rounded-xl h-12 max-w-md px-3"
              placeholder="Programme Title"
            />
          </div>
          <Button 
            onClick={handleSave} 
            disabled={isSaving || parseMutation.isPending}
            className="rounded-xl px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
          >
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {isNew ? 'Create Programme' : 'Save Changes'}
          </Button>
        </div>

        {/* Scrollable Editor Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 pb-32">
          
          {/* Voice Input Section */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-muted-foreground tracking-widest uppercase mb-4 px-2">Voice Builder</h2>
            <VoiceInput 
              onTranscriptComplete={handleTranscriptComplete} 
              isProcessing={parseMutation.isPending}
            />
          </div>

          {/* Exercises Section */}
          <div>
            <div className="flex items-center justify-between mb-4 px-2">
              <h2 className="text-sm font-semibold text-muted-foreground tracking-widest uppercase">Structured Exercises</h2>
              <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground font-medium">{exercises.length} items</span>
            </div>

            {exercises.length === 0 ? (
              <div className="text-center py-12 px-4 border-2 border-dashed rounded-2xl bg-muted/20">
                <p className="text-muted-foreground">No exercises yet. Use voice above or add manually.</p>
                <Button variant="outline" className="mt-4 rounded-xl" onClick={addEmptyExercise}>
                  <Plus className="w-4 h-4 mr-2" /> Add Manually
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <DndContext 
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext 
                    items={exercises.map(e => e.id)}
                    strategy={verticalListSortingStrategy}
                  >
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
                
                <Button variant="ghost" onClick={addEmptyExercise} className="w-full mt-4 border border-dashed rounded-xl h-12 text-muted-foreground hover:text-foreground">
                  <Plus className="w-4 h-4 mr-2" /> Add Another Exercise
                </Button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Right Panel: Live Preview */}
      <div className="flex-[45] h-full overflow-hidden bg-slate-50 relative z-0">
        <PreviewPanel title={title} exercises={exercises} />
      </div>

    </div>
  );
}
