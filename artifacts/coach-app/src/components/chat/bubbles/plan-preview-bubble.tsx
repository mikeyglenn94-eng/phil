import { QuickReplyChips, type QuickReply } from "@/components/chat/quick-reply-chips";

export type PlanPreviewDay = {
  dayName: string;
  sessionType: string;
  title: string;
  exercises: string[];
};

export type PlanPreviewPayload = {
  days: PlanPreviewDay[];
};

type Props = {
  text?: string;
  payload: PlanPreviewPayload;
  selectedValue?: string | null;
  promoted?: boolean;
  onSelect: (value: string) => void;
  onTypeInstead: () => void;
};

const PLAN_PREVIEW_CHIPS: QuickReply[] = [
  { label: "Build full block", value: "build full block" },
  { label: "Tweak", value: "tweak" },
  { label: "Not yet", value: "not yet" },
];

export function PlanPreviewBubble({ text, payload, selectedValue, promoted, onSelect, onTypeInstead }: Props) {
  const days = Array.isArray(payload?.days) ? payload.days.slice(0, 7) : [];

  return (
    <div className="max-w-[88%] bg-muted text-foreground rounded-2xl px-3 py-2.5">
      {text && <p className="whitespace-pre-wrap leading-snug text-sm mb-2">{text}</p>}
      <div role="group" aria-label="Week 1 preview" className="-mx-3 px-3 overflow-x-auto no-scrollbar">
        <div className="flex gap-2 pb-1.5">
          {days.map((d, i) => (
            <article
              key={`${d.dayName}-${i}`}
              className="shrink-0 w-[156px] rounded-xl bg-background border border-neutral-200 p-2.5 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {d.dayName}
                </span>
                {d.sessionType && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200">
                    {d.sessionType}
                  </span>
                )}
              </div>
              <h4 className="text-[13px] font-semibold leading-tight text-neutral-900 line-clamp-2">
                {d.title}
              </h4>
              {d.exercises?.length > 0 && (
                <ul className="text-[11px] text-neutral-600 space-y-0.5 mt-0.5">
                  {d.exercises.slice(0, 3).map((ex, j) => (
                    <li key={j} className="truncate">{ex}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </div>
      <QuickReplyChips
        replies={PLAN_PREVIEW_CHIPS}
        selectedValue={selectedValue}
        promoted={promoted}
        onSelect={onSelect}
        onTypeInstead={onTypeInstead}
      />
    </div>
  );
}
