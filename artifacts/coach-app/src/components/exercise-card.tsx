import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Exercise } from "@workspace/api-client-react";

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

        <div>
          <Textarea
            value={exercise.notes || ""}
            onChange={(e) => handleUpdate('notes', e.target.value)}
            className="bg-muted/30 border-transparent hover:border-input focus:bg-background resize-none min-h-[60px] text-sm rounded-lg"
            placeholder="Add notes (e.g. control the eccentric, pause at bottom)..."
          />
        </div>
      </div>
    </div>
  );
}
