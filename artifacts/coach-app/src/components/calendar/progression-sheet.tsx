/**
 * ProgressionSheet — wraps the generic GenerationFlowChat in a Sheet to drive
 * the progression-flow state machine. On completion, hands the generated
 * ProgressedBlock back to the caller for merging into the programme.
 */

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { GenerationFlowChat } from "@/components/generation-flow-chat";

interface ProgressionSourceSession {
  id: string;
  name: string;
  date: string;
  dayNumber?: number | null;
  source?: string | null;
  structure?: string | null;
  exercises: Array<{
    name: string;
    sets?: number | null;
    reps?: string | null;
    rpe?: string | null;
    rest?: string | null;
    tempo?: string | null;
    notes?: string | null;
  }>;
  runLog?: Array<{ distance?: number | null; pace?: string | null }>;
}

interface ProgressedBlock {
  weeks: number;
  style: string;
  sessions: Array<{
    id: string;
    date: string;
    dayNumber?: number | null;
    name: string;
    source: "progression_block";
    structure?: string;
    color?: string;
    exercises: Array<Record<string, unknown>>;
    progressedFromSessionId: string;
    progressionWeek: number;
  }>;
}

interface ProgressionSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourceSessions: ProgressionSourceSession[];
  programmeId: number;
  clientId: number;
  onComplete: (block: ProgressedBlock) => void;
}

export function ProgressionSheet({
  open,
  onOpenChange,
  sourceSessions,
  programmeId,
  clientId,
  onComplete,
}: ProgressionSheetProps) {
  const sourceCount = sourceSessions.length;
  const sourceLabel = sourceCount === 1
    ? sourceSessions[0]?.name ?? "1 session"
    : `${sourceCount} sessions`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Repeat with progression</SheetTitle>
          <SheetDescription>
            Picking {sourceLabel}. Choose the weeks and style and Phil generates the block.
          </SheetDescription>
        </SheetHeader>

        {open ? (
          <div className="mt-4">
            <GenerationFlowChat
              type="progression"
              context={{
                clientId,
                programmeId,
                sourceSessions,
              }}
              onComplete={(result) => {
                if (result.kind === "modification") return;
                // The flow returns the progressed block as the result.data payload.
                const block = result.data as ProgressedBlock;
                onComplete(block);
                onOpenChange(false);
              }}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
