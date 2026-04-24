import { Mic } from "lucide-react";
import { QuickReplyChips, type QuickReply } from "@/components/chat/quick-reply-chips";

type Props = {
  text: string;
  replies: QuickReply[];
  selectedValue?: string | null;
  promoted?: boolean;
  onSelect: (value: string) => void;
  onTypeInstead: () => void;
  onVoiceTap: () => void;
};

/** Wave-1 chip-first bubble used after the athlete finishes a workout.
 *  Renders Phil's prompt + a row of quick reply chips + a separate voice-note
 *  affordance on the right. Voice capture itself is not wired yet — the icon
 *  exists today so the visual lockup ships with the chip pattern. */
export function FeedbackPromptBubble({
  text,
  replies,
  selectedValue,
  promoted,
  onSelect,
  onTypeInstead,
  onVoiceTap,
}: Props) {
  return (
    <div className="bg-muted/60 text-[14px] px-3.5 py-2.5 rounded-2xl rounded-tl-sm leading-relaxed max-w-[92%]">
      {text && <p className="whitespace-pre-line">{text}</p>}
      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <QuickReplyChips
            replies={replies}
            selectedValue={selectedValue}
            promoted={promoted}
            onSelect={onSelect}
            onTypeInstead={onTypeInstead}
          />
        </div>
        <button
          type="button"
          onClick={onVoiceTap}
          aria-label="Record a voice note"
          title="Record a voice note"
          className="shrink-0 mt-2 inline-flex items-center justify-center w-11 h-11 rounded-full border bg-white text-neutral-700 hover:bg-neutral-50 active:scale-95 transition-all"
        >
          <Mic className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
