export type RpePayload = {
  /** Optional reference label, e.g. "Last set of bench" */
  contextLabel?: string;
};

type Props = {
  text?: string;
  payload?: RpePayload;
  /** Selected RPE value (6-10). Locks the bubble. */
  selectedValue?: number | null;
  onSelect: (rpe: number) => void;
};

const PILLS: { rpe: number; emoji: string }[] = [
  { rpe: 6, emoji: "😌" },
  { rpe: 7, emoji: "🙂" },
  { rpe: 8, emoji: "😐" },
  { rpe: 9, emoji: "😬" },
  { rpe: 10, emoji: "🫠" },
];

export function RpeBubble({ text, payload, selectedValue, onSelect }: Props) {
  const isLocked = selectedValue != null;

  return (
    <div className="max-w-[78%] bg-muted text-foreground rounded-2xl px-3 py-2.5">
      {text && <p className="whitespace-pre-wrap leading-snug text-sm mb-2">{text}</p>}
      {payload?.contextLabel && (
        <p className="text-[11px] text-neutral-500 mb-1.5">{payload.contextLabel}</p>
      )}
      <div role="group" aria-label="Rate of perceived effort" className="flex gap-1.5 flex-wrap">
        {PILLS.map(({ rpe, emoji }) => {
          const isSelected = selectedValue === rpe;
          const isDimmed = isLocked && !isSelected;
          return (
            <button
              key={rpe}
              type="button"
              disabled={isLocked}
              aria-pressed={isSelected}
              aria-label={`RPE ${rpe}`}
              onClick={() => { if (!isLocked) onSelect(rpe); }}
              className={[
                "shrink-0 inline-flex flex-col items-center justify-center min-h-12 min-w-12 px-2 rounded-xl border text-sm font-medium transition-all",
                isSelected
                  ? "bg-black text-white border-black"
                  : isDimmed
                    ? "bg-neutral-100 text-neutral-400 border-neutral-200 opacity-60 cursor-default"
                    : "bg-neutral-100 text-neutral-900 border-neutral-200 hover:bg-neutral-200 active:scale-95",
              ].join(" ")}
            >
              <span className="text-base leading-none">{emoji}</span>
              <span className="text-[10px] font-semibold mt-0.5">{rpe}</span>
            </button>
          );
        })}
      </div>
      <div aria-live="polite" className="sr-only">
        {selectedValue != null ? `RPE ${selectedValue} selected` : ""}
      </div>
    </div>
  );
}
