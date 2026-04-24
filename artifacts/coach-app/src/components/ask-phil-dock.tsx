import React, { useState } from "react";
import { useLocation } from "wouter";
import { Mic, Send } from "lucide-react";
import { useChat } from "@/contexts/chat-context";
import { format } from "date-fns";

interface AskPhilDockProps {
  /**
   * Page identifier passed through to /chat as ?context=… so the chat surface
   * (and any future analytics) knows which surface launched the thread.
   * Use "dashboard" on the dashboard tab and "calendar" on the training
   * (calendar) tab.
   */
  context: "dashboard" | "calendar";
}

/**
 * Pill input pinned to the bottom of the viewport on Dashboard and Calendar
 * surfaces. It is a launcher, not the real composer — tapping the input or
 * pressing send navigates to /chat where the chip-first Wave-1 flow takes over.
 *
 * Layout spec:
 *   - 48px tall pill, full-width minus 32px horizontal padding (mx-4)
 *   - Pinned 80px above the bottom edge (16px gap above the planned 64px nav)
 *   - shadow-sm for elevation
 *   - Mic icon on the right, send arrow to the right of that
 */
export function AskPhilDock({ context }: AskPhilDockProps) {
  const [, setLocation] = useLocation();
  const { setDraft } = useChat();
  const [value, setValue] = useState("");

  function launch(initialDraft: string) {
    const trimmed = initialDraft.trim();
    if (trimmed) setDraft(trimmed);
    const today = format(new Date(), "yyyy-MM-dd");
    setLocation(`/chat?context=${context}&date=${today}`);
  }

  return (
    <div
      className="fixed left-0 right-0 z-30 px-4 pointer-events-none"
      style={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 h-12 bg-background border rounded-full shadow-sm pl-4 pr-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // Tap on the input launches /chat (mobile tap = onClick). Using onClick
          // instead of onFocus preserves the type-then-send path for desktop
          // keyboard users (tab-to-focus does not fire onClick), while still
          // giving mobile users the spec'd one-tap launcher feel.
          onClick={() => launch(value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              launch(value);
            }
          }}
          placeholder="Ask Phil…"
          aria-label="Ask Phil"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          onClick={() => launch(value)}
          aria-label="Voice input"
          className="w-9 h-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
        >
          <Mic className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => launch(value)}
          aria-label="Send"
          className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
