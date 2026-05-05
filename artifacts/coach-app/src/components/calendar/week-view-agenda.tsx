/**
 * WeekViewAgenda — vertical agenda layout for mobile (viewport < 768px).
 *
 * Renders one section per day across the supplied weeks. Each day shows its
 * full-name session cards (no truncation). Empty days show a small inline
 * "+ Add session" link. Today is highlighted; past days are dimmed.
 *
 * The desktop grid view stays inline in client-area.tsx; this component is
 * purely the mobile alternative, picked via a Tailwind `md:hidden` wrapper.
 */

import { format, isSameDay, isBefore, parseISO, startOfDay } from "date-fns";
import type { Session } from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { SessionBadge } from "./session-badge";
import { sessionSubtitle, sourceLine } from "./session-subtitle";

interface ProgrammeShape {
  id: number;
  title?: string;
  blockLength?: number | null;
  sessionsPerWeek?: number | null;
  sessions: Session[];
}

interface WeekViewAgendaProps {
  /** All days to render across one or more weeks, flat ordered list. */
  weeks: Date[][];
  /** All client sessions (already filtered to the relevant programmes). */
  sessions: Session[];
  /** Programmes — used to look up blockLength + dayNumber for the source line. */
  programmes: ProgrammeShape[];
  /** Called when the user taps a session card. */
  onTapSession: (session: Session, programme: ProgrammeShape | null) => void;
  /** Called when the user taps "+ Add session" on an empty day. */
  onAddSession: (dateStr: string) => void;
}

export function WeekViewAgenda({
  weeks,
  sessions,
  programmes,
  onTapSession,
  onAddSession,
}: WeekViewAgendaProps) {
  const today = startOfDay(new Date());
  const days = weeks.flat();

  return (
    <div className="flex flex-col">
      {days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        const isToday = isSameDay(day, today);
        const isPast = isBefore(day, today) && !isToday;
        const daySessions = sessions.filter((s) => {
          try {
            return isSameDay(parseISO(s.date), day);
          } catch {
            return false;
          }
        });

        return (
          <section key={dateStr} className={`px-4 py-4 border-b last:border-b-0 ${isPast ? "text-muted-foreground" : ""}`}>
            <DayHeader day={day} isToday={isToday} isPast={isPast} />

            {daySessions.length === 0 ? (
              <button
                type="button"
                onClick={() => onAddSession(dateStr)}
                className={`mt-2 text-xs ${isPast ? "text-muted-foreground/60" : "text-primary"} hover:underline inline-flex items-center gap-1`}
              >
                <Plus className="w-3 h-3" />
                Add session
              </button>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {daySessions.map((session) => {
                  const programme = findParentProgramme(session, programmes);
                  return (
                    <SessionCardAgenda
                      key={session.id}
                      session={session}
                      programme={programme}
                      onTap={() => onTapSession(session, programme)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Day header ─────────────────────────────────────────────────────────────

function DayHeader({ day, isToday, isPast }: { day: Date; isToday: boolean; isPast: boolean }) {
  const weekday = format(day, "EEE").toUpperCase();
  const dayNum = format(day, "d");

  if (isToday) {
    return (
      <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase">
        <span className="text-primary">TODAY</span>
        <span className="text-muted-foreground/50">·</span>
        <span className="text-foreground">{weekday} {dayNum}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase ${isPast ? "text-muted-foreground/60" : "text-foreground/70"}`}>
      <span>{weekday}</span>
      <span>{dayNum}</span>
    </div>
  );
}

// ── Session card ───────────────────────────────────────────────────────────

function SessionCardAgenda({
  session,
  programme,
  onTap,
}: {
  session: Session;
  programme: ProgrammeShape | null;
  onTap: () => void;
}) {
  const subtitle = sessionSubtitle(session);

  const dayNumber = (session as Session & { dayNumber?: number | null }).dayNumber ?? null;
  const estimatedMinutes = (session as Session & { estimatedMinutes?: [number, number] | null }).estimatedMinutes ?? null;
  const source = sourceLine({
    blockLength: programme?.blockLength ?? null,
    sessionDayNumber: dayNumber,
    estimatedMinutes,
  });

  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left bg-card border rounded-2xl px-3.5 py-3 hover:bg-muted/30 active:bg-muted/40 transition-colors flex flex-col gap-1.5"
    >
      <SessionBadge session={session} size="sm" className="self-start" />
      <p className="text-sm font-semibold leading-snug text-foreground">{session.name || "Session"}</p>
      {subtitle ? (
        <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
      ) : null}
      {source ? (
        <p className="text-[11px] text-muted-foreground/70 leading-snug">{source}</p>
      ) : null}
    </button>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findParentProgramme(
  session: Session,
  programmes: ProgrammeShape[],
): ProgrammeShape | null {
  for (const p of programmes) {
    if ((p.sessions as Session[]).some((s) => s.id === session.id)) return p;
  }
  return null;
}
