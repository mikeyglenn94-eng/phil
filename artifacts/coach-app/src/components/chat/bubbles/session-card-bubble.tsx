import { ChevronRight } from "lucide-react";

export type SessionCardPayload = {
  sessionId: string;
  programmeId?: string;
  date: string; // ISO date string
  sessionType: string;
  title: string;
};

type Props = {
  text?: string;
  payload: SessionCardPayload;
  onOpen: (payload: SessionCardPayload) => void;
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

export function SessionCardBubble({ text, payload, onOpen }: Props) {
  return (
    <div className="max-w-[78%] bg-muted text-foreground rounded-2xl px-3 py-2.5">
      {text && <p className="whitespace-pre-wrap leading-snug text-sm mb-2">{text}</p>}
      <button
        type="button"
        onClick={() => onOpen(payload)}
        className="w-full text-left rounded-xl bg-background border border-neutral-200 p-2.5 hover:border-neutral-400 active:scale-[0.99] transition-all"
        aria-label={`Open session ${payload.title} on ${formatDate(payload.date)}`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {formatDate(payload.date)}
          </span>
          {payload.sessionType && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200">
              {payload.sessionType}
            </span>
          )}
        </div>
        <h4 className="text-[13px] font-semibold leading-tight text-neutral-900 mb-1.5">
          {payload.title}
        </h4>
        <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-neutral-700">
          View session <ChevronRight className="w-3 h-3" />
        </span>
      </button>
    </div>
  );
}
