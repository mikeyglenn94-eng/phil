import { Pencil } from "lucide-react";

export type QuickReply = {
  label: string;
  value: string;
  emoji?: string;
};

type Props = {
  replies: QuickReply[];
  /** The chip the user picked, if any. Once set, all chips are locked. */
  selectedValue?: string | null;
  /** True when the user chose to type instead (or focused the input). Chips grey out but stay visible. */
  promoted?: boolean;
  /** True after a chip selection — chip group is locked, only selection stays highlighted. */
  onSelect: (value: string) => void;
  /** Triggered when the user taps the "Type instead" chip. */
  onTypeInstead: () => void;
};

export function QuickReplyChips({ replies, selectedValue, promoted, onSelect, onTypeInstead }: Props) {
  const isLocked = !!selectedValue || !!promoted;

  return (
    <div className="mt-2 -mx-3 px-3">
      <div role="group" aria-label="Quick replies" className="flex gap-2 overflow-x-auto no-scrollbar pb-1.5">
        {replies.map((r, i) => {
          const isSelected = selectedValue === r.value;
          const isDimmed = isLocked && !isSelected;
          return (
            <button
              key={`${r.value}-${i}`}
              type="button"
              onClick={() => { if (!isLocked) onSelect(r.value); }}
              disabled={isLocked}
              aria-pressed={isSelected}
              aria-label={r.label}
              className={[
                "shrink-0 inline-flex items-center min-h-11 px-4 rounded-full border text-[14px] font-medium whitespace-nowrap transition-all",
                isSelected
                  ? "bg-black text-white border-black"
                  : isDimmed
                    ? "bg-neutral-100 text-neutral-500 border-neutral-200 opacity-60 cursor-default"
                    : "bg-neutral-100 text-neutral-900 border-neutral-200 hover:bg-neutral-200 active:scale-95",
              ].join(" ")}
            >
              {r.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => { if (!isLocked) onTypeInstead(); }}
          disabled={isLocked}
          aria-label="Type a different answer instead"
          className={[
            "shrink-0 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border text-[14px] font-medium whitespace-nowrap transition-all",
            isLocked
              ? "bg-neutral-50 text-neutral-400 border-neutral-200 opacity-60 cursor-default"
              : "bg-white text-neutral-700 border-dashed border-neutral-300 hover:bg-neutral-50 active:scale-95",
          ].join(" ")}
        >
          <Pencil className="w-3.5 h-3.5" />
          Type instead
        </button>
      </div>
      {/* Polite live region — announces the selection to screen readers when set. */}
      <div aria-live="polite" className="sr-only">
        {selectedValue ? `Selected ${selectedValue}` : ""}
      </div>
    </div>
  );
}
