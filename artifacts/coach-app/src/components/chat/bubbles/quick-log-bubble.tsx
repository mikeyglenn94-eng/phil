import { useState } from "react";
import { Button } from "@/components/ui/button";

export type QuickLogPayload = {
  exerciseName: string;
  setLabel?: string;
  unit?: "kg" | "lb";
  /** Optional reference to the session/set this should persist to. Forwarded back via onSubmit. */
  sessionId?: string;
  setId?: string;
};

export type QuickLogResult = {
  weight: number;
  reps: number;
  unit: "kg" | "lb";
  exerciseName: string;
  sessionId?: string;
  setId?: string;
};

type Props = {
  text?: string;
  payload: QuickLogPayload;
  /** When set, the bubble is locked and shows the submitted values as a read-only summary. */
  submitted?: QuickLogResult | null;
  onSubmit: (result: QuickLogResult) => void;
};

export function QuickLogBubble({ text, payload, submitted, onSubmit }: Props) {
  const unit = payload?.unit ?? "kg";
  const [weight, setWeight] = useState<string>("");
  const [reps, setReps] = useState<string>("");

  const isLocked = !!submitted;
  const canSubmit = !isLocked && weight.trim() !== "" && reps.trim() !== "" && Number(weight) > 0 && Number(reps) > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      weight: Number(weight),
      reps: Number(reps),
      unit,
      exerciseName: payload.exerciseName,
      sessionId: payload.sessionId,
      setId: payload.setId,
    });
  };

  return (
    <div className="max-w-[78%] bg-muted text-foreground rounded-2xl px-3 py-2.5">
      {text && <p className="whitespace-pre-wrap leading-snug text-sm mb-2">{text}</p>}
      <div className="rounded-xl bg-background border border-neutral-200 p-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-neutral-900">{payload.exerciseName}</span>
          {payload.setLabel && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
              {payload.setLabel}
            </span>
          )}
        </div>
        {isLocked ? (
          <p className="text-[13px] text-neutral-700">
            Logged <span className="font-semibold">{submitted!.weight}{submitted!.unit}</span> × <span className="font-semibold">{submitted!.reps}</span>
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex-1 min-w-0">
              <span className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">Weight ({unit})</span>
              <input
                type="number"
                inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
                placeholder="0"
                className="w-full h-9 rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="w-[72px] shrink-0">
              <span className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">Reps</span>
              <input
                type="number"
                inputMode="numeric"
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
                placeholder="0"
                className="w-full h-9 rounded-lg border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <Button
              size="sm"
              className="h-9 px-3 shrink-0"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              Log
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
