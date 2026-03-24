import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Rows3, Minus } from "lucide-react";
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

  const setCount = exercise.sets || 0;
  const isVariableMode = !!(exercise.perSetReps && exercise.perSetReps.length > 0);

  const perSetRows = Array.from({ length: setCount }, (_, i) => ({
    reps: exercise.perSetReps?.[i] ?? "",
    rpe: exercise.perSetRpe?.[i] ?? "",
  }));

  const enableVariableMode = () => {
    onChange(exercise.id, {
      perSetReps: Array.from({ length: setCount }, () => exercise.reps ?? ""),
      perSetRpe: Array.from({ length: setCount }, () => exercise.rpe ?? ""),
    });
  };

  const disableVariableMode = () => {
    onChange(exercise.id, { perSetReps: undefined, perSetRpe: undefined });
  };

  const updatePerSetField = (idx: number, field: "reps" | "rpe", value: string) => {
    const key = field === "reps" ? "perSetReps" : "perSetRpe";
    const current = [...((exercise[key] as string[] | undefined) ?? Array(setCount).fill(""))];
    while (current.length < setCount) current.push("");
    current[idx] = value;
    onChange(exercise.id, { [key]: current.slice(0, setCount) });
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
        {/* Name row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <Input
            value={exercise.name}
            onChange={(e) => handleUpdate("name", e.target.value)}
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

        {/* Uniform fields — Sets always shown; Reps + RPE hidden in variable mode */}
        <div className={`grid gap-3 mb-4 ${isVariableMode ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-5"}`}>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Sets</Label>
            <Input
              type="number"
              value={exercise.sets || ""}
              onChange={(e) => handleUpdate("sets", e.target.value ? parseInt(e.target.value) : null)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg"
              placeholder="e.g. 3"
            />
          </div>

          {!isVariableMode && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Reps</Label>
                  {setCount > 0 && (
                    <button
                      type="button"
                      onClick={enableVariableMode}
                      className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary font-semibold transition-colors"
                      title="Set different reps/RPE per set"
                    >
                      <Rows3 className="w-3 h-3" />Variable
                    </button>
                  )}
                </div>
                <Input
                  value={exercise.reps || ""}
                  onChange={(e) => handleUpdate("reps", e.target.value)}
                  className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg"
                  placeholder="e.g. 8-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">RPE</Label>
                <Input
                  value={exercise.rpe || ""}
                  onChange={(e) => handleUpdate("rpe", e.target.value)}
                  className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg"
                  placeholder="e.g. 8"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Rest</Label>
            <Input
              value={exercise.rest || ""}
              onChange={(e) => handleUpdate("rest", e.target.value)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg"
              placeholder="e.g. 90s"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground px-1 uppercase tracking-wider font-semibold">Tempo</Label>
            <Input
              value={exercise.tempo || ""}
              onChange={(e) => handleUpdate("tempo", e.target.value)}
              className="bg-muted/50 border-transparent focus:bg-background h-9 rounded-lg"
              placeholder="e.g. 3110"
            />
          </div>
        </div>

        {/* Per-set variable scheme table */}
        {isVariableMode && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Rows3 className="w-3.5 h-3.5" />Per-Set Scheme
              </Label>
              <button
                type="button"
                onClick={disableVariableMode}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground font-semibold transition-colors"
              >
                <Minus className="w-3 h-3" />Use uniform
              </button>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-[2.5rem_1fr_1fr] text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/60 px-3 py-2 gap-2">
                <span>Set</span>
                <span>Reps</span>
                <span>RPE</span>
              </div>
              {perSetRows.map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[2.5rem_1fr_1fr] items-center border-t gap-2 px-3 py-1.5 hover:bg-muted/20 transition-colors"
                >
                  <span className="text-sm font-bold text-muted-foreground">{i + 1}</span>
                  <Input
                    value={row.reps}
                    onChange={(e) => updatePerSetField(i, "reps", e.target.value)}
                    className="h-8 text-sm border-0 shadow-none bg-transparent px-1 focus:bg-muted/40 rounded"
                    placeholder="—"
                  />
                  <Input
                    value={row.rpe}
                    onChange={(e) => updatePerSetField(i, "rpe", e.target.value)}
                    className="h-8 text-sm border-0 shadow-none bg-transparent px-1 focus:bg-muted/40 rounded"
                    placeholder="—"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <Textarea
            value={exercise.notes || ""}
            onChange={(e) => handleUpdate("notes", e.target.value)}
            className="bg-muted/30 border-transparent hover:border-input focus:bg-background resize-none min-h-[60px] text-sm rounded-lg"
            placeholder="Add notes (e.g. control the eccentric, pause at bottom)..."
          />
        </div>
      </div>
    </div>
  );
}
