import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Exercise, WeekProgression } from "@workspace/api-client-react";

interface ExerciseCardProps {
  exercise: Exercise;
  onChange: (id: string, updates: Partial<Exercise>) => void;
  onDelete: (id: string) => void;
}

export function ExerciseCard({ exercise, onChange, onDelete }: ExerciseCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: exercise.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  const handleUpdate = (field: keyof Exercise, value: any) => {
    onChange(exercise.id, { [field]: value });
  };

  const addWeek = () => {
    const currentWeeks = exercise.weekProgression || [];
    const nextWeekNum = currentWeeks.length > 0 ? Math.max(...currentWeeks.map(w => w.week)) + 1 : 1;
    const newWeek: WeekProgression = {
      week: nextWeekNum,
      sets: exercise.sets || null,
      reps: exercise.reps || null,
      rpe: exercise.rpe || null,
      weight: null,
    };
    handleUpdate('weekProgression', [...currentWeeks, newWeek]);
  };

  const updateWeek = (weekNum: number, field: keyof WeekProgression, value: any) => {
    const currentWeeks = exercise.weekProgression || [];
    const updated = currentWeeks.map(w => 
      w.week === weekNum ? { ...w, [field]: value } : w
    );
    handleUpdate('weekProgression', updated);
  };

  const removeWeek = (weekNum: number) => {
    const currentWeeks = exercise.weekProgression || [];
    handleUpdate('weekProgression', currentWeeks.filter(w => w.week !== weekNum));
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative bg-card rounded-xl border p-5 shadow-sm transition-all duration-200 ${
        isDragging ? "shadow-xl border-primary/50 opacity-90 scale-[1.02]" : "hover:shadow-md hover:border-border/80"
      }`}
    >
      {/* Drag Handle */}
      <div 
        {...attributes} 
        {...listeners}
        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground/40 hover:text-foreground cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="w-5 h-5" />
      </div>

      <div className="pl-6 pr-2">
        <div className="flex items-start justify-between gap-4 mb-4">
          <Input
            value={exercise.name}
            onChange={(e) => handleUpdate('name', e.target.value)}
            className="text-lg font-bold border-transparent hover:border-input focus:border-primary px-2 h-10 shadow-none rounded-lg"
            placeholder="Exercise Name"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(exercise.id)}
            className="text-muted-foreground hover:text-destructive shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Sets</Label>
            <Input 
              type="number"
              value={exercise.sets || ""} 
              onChange={(e) => handleUpdate('sets', e.target.value ? parseInt(e.target.value) : null)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg" 
              placeholder="e.g. 3"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Reps</Label>
            <Input 
              value={exercise.reps || ""} 
              onChange={(e) => handleUpdate('reps', e.target.value)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg" 
              placeholder="e.g. 8-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">RPE</Label>
            <Input 
              value={exercise.rpe || ""} 
              onChange={(e) => handleUpdate('rpe', e.target.value)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg" 
              placeholder="e.g. 8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Rest</Label>
            <Input 
              value={exercise.rest || ""} 
              onChange={(e) => handleUpdate('rest', e.target.value)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg" 
              placeholder="e.g. 90s"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Tempo</Label>
            <Input 
              value={exercise.tempo || ""} 
              onChange={(e) => handleUpdate('tempo', e.target.value)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg" 
              placeholder="e.g. 3110"
            />
          </div>
        </div>

        <div className="mb-4">
          <Textarea
            value={exercise.notes || ""}
            onChange={(e) => handleUpdate('notes', e.target.value)}
            className="bg-muted/30 border-transparent hover:border-input focus:bg-background resize-none min-h-[60px] text-sm rounded-lg"
            placeholder="Add notes (e.g. control the eccentric, pause at bottom)..."
          />
        </div>

        {/* Week Progression Section */}
        <div className="border-t pt-4 mt-2">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              Week Progression
            </h4>
            <Button variant="outline" size="sm" onClick={addWeek} className="h-7 text-xs rounded-lg">
              <Plus className="w-3 h-3 mr-1" /> Add Week
            </Button>
          </div>
          
          {(exercise.weekProgression || []).length > 0 ? (
            <div className="space-y-2">
              {(exercise.weekProgression || []).map((week) => (
                <div key={week.week} className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border border-border/50">
                  <div className="w-16 text-xs font-semibold text-muted-foreground">Week {week.week}</div>
                  <Input 
                    className="h-7 text-xs bg-background/50 flex-1" 
                    placeholder="Sets" 
                    value={week.sets || ""} 
                    onChange={(e) => updateWeek(week.week, 'sets', e.target.value ? parseInt(e.target.value) : null)}
                  />
                  <Input 
                    className="h-7 text-xs bg-background/50 flex-1" 
                    placeholder="Reps" 
                    value={week.reps || ""} 
                    onChange={(e) => updateWeek(week.week, 'reps', e.target.value)}
                  />
                  <Input 
                    className="h-7 text-xs bg-background/50 flex-1" 
                    placeholder="RPE/Load" 
                    value={week.rpe || week.weight || ""} 
                    onChange={(e) => updateWeek(week.week, 'rpe', e.target.value)}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeWeek(week.week)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
             <p className="text-xs text-muted-foreground italic">No weekly progressions set. Add one to schedule changes over time.</p>
          )}
        </div>
      </div>
    </div>
  );
}
