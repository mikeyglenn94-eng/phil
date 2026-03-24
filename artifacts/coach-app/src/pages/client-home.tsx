import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { ChevronLeft, ChevronRight, Dumbbell, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, addWeeks, startOfWeek, addDays, isSameDay, parseISO } from "date-fns";
import { useListProgrammes } from "@workspace/api-client-react";
import type { Session } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const WEEKS_TO_SHOW = 4;

const SESSION_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-800", dot: "bg-blue-500" },
  { bg: "bg-green-100", text: "text-green-800", dot: "bg-green-500" },
  { bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500" },
  { bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500" },
  { bg: "bg-pink-100", text: "text-pink-800", dot: "bg-pink-500" },
  { bg: "bg-yellow-100", text: "text-yellow-800", dot: "bg-yellow-500" },
  { bg: "bg-cyan-100", text: "text-cyan-800", dot: "bg-cyan-500" },
];

function getSessionColor(name?: string | null) {
  if (!name) return SESSION_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length];
}

function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export default function ClientHome() {
  const [, setLocation] = useLocation();
  const { data: programmes, isLoading } = useListProgrammes();

  const [selectedProgrammeId, setSelectedProgrammeId] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const selectedProgramme = useMemo(() => {
    if (!programmes) return null;
    if (selectedProgrammeId) return programmes.find(p => p.id === selectedProgrammeId) || null;
    return programmes[0] || null;
  }, [programmes, selectedProgrammeId]);

  const baseWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const viewStart = addWeeks(baseWeekStart, weekOffset);
  const weeks = Array.from({ length: WEEKS_TO_SHOW }, (_, i) => addWeeks(viewStart, i));

  const getSessionForDate = (date: Date): Session | undefined => {
    if (!selectedProgramme?.sessions) return undefined;
    return selectedProgramme.sessions.find(s => isSameDay(parseISO(s.date), date));
  };

  const handleDayClick = (date: Date) => {
    if (!selectedProgramme) return;
    const session = getSessionForDate(date);
    if (session) {
      setLocation(`/client/programmes/${selectedProgramme.id}/sessions/${session.id}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Client view banner */}
      <div className="bg-primary text-primary-foreground px-4 py-1.5 flex items-center justify-between text-xs font-medium shrink-0">
        <span>Client View</span>
        <Link href="/">
          <button className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
            <LayoutDashboard className="w-3.5 h-3.5" />
            Switch to Coach View
          </button>
        </Link>
      </div>

      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          {programmes && programmes.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="font-bold text-xl gap-2 px-2 hover:bg-muted rounded-lg">
                  {selectedProgramme?.title || "Select Programme"}
                  <ChevronRight className="w-4 h-4 rotate-90 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {programmes.map(p => (
                  <DropdownMenuItem
                    key={p.id}
                    className={`cursor-pointer font-medium ${selectedProgramme?.id === p.id ? "text-primary" : ""}`}
                    onClick={() => setSelectedProgrammeId(p.id)}
                  >
                    <Dumbbell className="w-4 h-4 mr-2 opacity-50" />
                    {p.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="font-bold text-xl">{selectedProgramme?.title || "Programme"}</span>
          )}
        </div>

        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-3 text-xs font-medium rounded-md" onClick={() => setWeekOffset(0)}>
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => setWeekOffset(w => w + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1 overflow-auto">
        {!selectedProgramme ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <Dumbbell className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">No programme available yet.</p>
          </div>
        ) : (
          <div className="min-w-[700px]">
            <div className="grid grid-cols-7 border-b bg-muted/30 sticky top-0 z-10">
              {DAYS.map(day => (
                <div key={day} className="px-3 py-2 text-xs font-bold text-muted-foreground tracking-widest border-r last:border-r-0">
                  {day}
                </div>
              ))}
            </div>

            {weeks.map((weekStart, weekIdx) => {
              const dates = getWeekDates(weekStart);
              return (
                <div key={weekIdx} className="grid grid-cols-7 border-b">
                  {dates.map((date, dayIdx) => {
                    const session = getSessionForDate(date);
                    const isToday = isSameDay(date, new Date());
                    const color = getSessionColor(session?.name);
                    const hasSession = !!session;

                    return (
                      <div
                        key={dayIdx}
                        className={`border-r last:border-r-0 min-h-[160px] p-2 transition-colors ${
                          hasSession ? "cursor-pointer hover:bg-primary/5" : ""
                        } ${isToday ? "bg-primary/5" : ""}`}
                        onClick={() => hasSession && handleDayClick(date)}
                      >
                        <div className="mb-2">
                          <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${
                            isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                          }`}>
                            {format(date, "d")}
                          </span>
                        </div>

                        {session && (
                          <div>
                            {session.name && (
                              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold mb-2 ${color.bg} ${color.text}`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                                {session.name}
                              </div>
                            )}

                            {/* Completion indicator */}
                            {(() => {
                              const total = session.exercises?.length ?? 0;
                              const logged = session.exercises?.filter(ex =>
                                ex.setWeights && ex.setWeights.some(w => w !== null && w !== undefined)
                              ).length ?? 0;
                              const complete = total > 0 && logged === total;
                              return total > 0 ? (
                                <div className={`text-[10px] font-semibold mb-1.5 px-1.5 py-0.5 rounded w-fit ${
                                  complete
                                    ? "bg-green-100 text-green-700"
                                    : logged > 0
                                    ? "bg-yellow-100 text-yellow-700"
                                    : "bg-muted text-muted-foreground"
                                }`}>
                                  {complete ? "✓ Complete" : logged > 0 ? `${logged}/${total} logged` : `${total} exercises`}
                                </div>
                              ) : null;
                            })()}

                            <div className="space-y-0.5">
                              {(session.exercises || []).slice(0, 5).map((ex, i) => (
                                <div key={ex.id} className="flex items-start gap-1.5">
                                  <span className="text-[10px] text-muted-foreground font-bold w-3 shrink-0 mt-0.5">{i + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-foreground leading-tight truncate">{ex.name}</p>
                                    {(ex.sets || ex.reps) && (
                                      <p className="text-[10px] text-muted-foreground">
                                        {ex.perSetReps && ex.perSetReps.length > 0
                                          ? ex.perSetReps.join("/")
                                          : ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ex.sets ? `${ex.sets} sets` : ex.reps}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {(session.exercises || []).length > 5 && (
                                <p className="text-[10px] text-muted-foreground italic pl-4">+{session.exercises.length - 5} more</p>
                              )}
                            </div>

                            <div className="mt-2">
                              <span className="text-[10px] font-semibold text-primary hover:underline">
                                Tap to log →
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
