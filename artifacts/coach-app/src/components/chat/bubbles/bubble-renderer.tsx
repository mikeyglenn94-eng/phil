import type { ReactNode } from "react";
import { QuickReplyChips, type QuickReply } from "@/components/chat/quick-reply-chips";
import { PlanPreviewBubble, type PlanPreviewPayload } from "./plan-preview-bubble";
import { QuickLogBubble, type QuickLogPayload, type QuickLogResult } from "./quick-log-bubble";
import { RpeBubble, type RpePayload } from "./rpe-bubble";
import { SessionCardBubble, type SessionCardPayload } from "./session-card-bubble";

/** Discriminated union of all bubble kinds. "text" is the default — backward-compatible
 *  with W1 messages that have no `kind` field. */
export type BubbleKind = "text" | "plan-preview" | "quick-log" | "rpe" | "session-card";

export type BubblePayload =
  | PlanPreviewPayload
  | QuickLogPayload
  | RpePayload
  | SessionCardPayload;

/** Per-message bubble state — selection lock for chip/rpe bubbles, submitted log for quick-log. */
export type BubbleState = {
  /** Generic chip selection (text + plan-preview + custom chip groups) */
  selected?: string | null;
  /** Whether the user demoted the chips by typing instead */
  promoted?: boolean;
  /** RPE value picked, when kind === "rpe" */
  rpe?: number | null;
  /** Submitted log entry, when kind === "quick-log" */
  log?: QuickLogResult | null;
};

export type BubbleRendererProps = {
  message: {
    id: string;
    sender: "user" | "phil";
    text: string;
    kind?: BubbleKind;
    payload?: BubblePayload;
    quickReplies?: QuickReply[];
  };
  state?: BubbleState;
  onChipSelect?: (value: string) => void;
  onChipTypeInstead?: () => void;
  onQuickLogSubmit?: (result: QuickLogResult) => void;
  onRpeSelect?: (rpe: number) => void;
  onSessionCardOpen?: (payload: SessionCardPayload) => void;
  /** Action affordances (Build this, Save to calendar, WOD picker) rendered inside text bubbles. */
  textActions?: ReactNode;
};

/** Switches on message.kind to render the right bubble. Defaults to the standard text bubble
 *  with optional quickReplies — keeps W1 messages rendering unchanged. */
export function BubbleRenderer(props: BubbleRendererProps) {
  const { message, state } = props;
  const kind: BubbleKind = message.kind ?? "text";

  if (kind === "plan-preview" && message.payload) {
    return (
      <PlanPreviewBubble
        text={message.text}
        payload={message.payload as PlanPreviewPayload}
        selectedValue={state?.selected ?? null}
        promoted={state?.promoted}
        onSelect={(v) => props.onChipSelect?.(v)}
        onTypeInstead={() => props.onChipTypeInstead?.()}
      />
    );
  }

  if (kind === "quick-log" && message.payload) {
    return (
      <QuickLogBubble
        text={message.text}
        payload={message.payload as QuickLogPayload}
        submitted={state?.log ?? null}
        onSubmit={(r) => props.onQuickLogSubmit?.(r)}
      />
    );
  }

  if (kind === "rpe") {
    return (
      <RpeBubble
        text={message.text}
        payload={(message.payload as RpePayload | undefined) ?? {}}
        selectedValue={state?.rpe ?? null}
        onSelect={(r) => props.onRpeSelect?.(r)}
      />
    );
  }

  if (kind === "session-card" && message.payload) {
    return (
      <SessionCardBubble
        text={message.text}
        payload={message.payload as SessionCardPayload}
        onOpen={(p) => props.onSessionCardOpen?.(p)}
      />
    );
  }

  // Default: text bubble with optional chips + action affordances.
  return (
    <div
      className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
        message.sender === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
      }`}
    >
      {message.text && <p className="whitespace-pre-wrap leading-snug">{message.text}</p>}
      {message.sender === "phil" && message.quickReplies && message.quickReplies.length > 0 && (
        <QuickReplyChips
          replies={message.quickReplies}
          selectedValue={state?.selected ?? null}
          promoted={state?.promoted}
          onSelect={(v) => props.onChipSelect?.(v)}
          onTypeInstead={() => props.onChipTypeInstead?.()}
        />
      )}
      {props.textActions}
    </div>
  );
}
