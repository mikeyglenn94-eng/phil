/**
 * Sticky bottom action bar shown when one or more calendar sessions are
 * selected. Spec: [N selected] [Cancel] [Repeat with progression].
 *
 * The cancel button calls onCancel which clears the selection state in the
 * parent; the progression button hands off to a sheet that drives the
 * progression flow.
 */

import { TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MultiSelectActionBarProps {
  selectedCount: number;
  onCancel: () => void;
  onRepeatWithProgression: () => void;
}

export function MultiSelectActionBar({
  selectedCount,
  onCancel,
  onRepeatWithProgression,
}: MultiSelectActionBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-[var(--sidebar-width,16rem)] z-30 border-t bg-card px-3 py-2.5 flex items-center gap-2 shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.08)]">
      <span className="text-xs font-semibold tabular-nums">
        {selectedCount} selected
      </span>
      <div className="flex-1" />
      <Button
        size="sm"
        variant="ghost"
        onClick={onCancel}
        className="h-8 px-3 text-xs gap-1.5"
      >
        <X className="w-3.5 h-3.5" />
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={onRepeatWithProgression}
        className="h-8 px-3 text-xs gap-1.5"
      >
        <TrendingUp className="w-3.5 h-3.5" />
        Repeat with progression
      </Button>
    </div>
  );
}
