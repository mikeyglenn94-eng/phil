import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft, ChevronRight, Plus, MoreHorizontal, Trash2, Copy,
  Dumbbell, ClipboardPaste, X, Mic, Square, Loader2, Send, Undo2, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, addWeeks, startOfWeek, addDays, isSameDay, parseISO } from "date-fns";
import {
  useListProgrammes,
  useDeleteProgramme,
  useDuplicateProgramme,
  useUpdateProgramme,
  useCreateProgramme,
  getListProgrammesQueryKey,
  calendarCommand,
} from "@workspace/api-client-react";
import type { Programme, Session } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

function getSessionColor(name?: string | null): typeof SESSION_COLORS[0] {
  if (!name) return SESSION_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length];
}

function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: programmes, isLoading } = useListProgrammes();
  const deleteMutation = useDeleteProgramme();
  const duplicateMutation = useDuplicateProgramme();
  const updateMutation = useUpdateProgramme();
  const createMutation = useCreateProgramme();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedProgrammeId, setSelectedProgrammeId] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [newProgrammeOpen, setNewProgrammeOpen] = useState(false);
  const [newProgrammeTitle, setNewProgrammeTitle] = useState("");
  const [copiedSession, setCopiedSession] = useState<Session | null>(null);

  // Calendar command bar
  const [commandText, setCommandText] = useState("");
  const [commandListening, setCommandListening] = useState(false);
  const [commandInterim, setCommandInterim] = useState("");
  const [isRunningCommand, setIsRunningCommand] = useState(false);
  const [commandChanges, setCommandChanges] = useState<string[] | null>(null);
  const [previousSessions, setPreviousSessions] = useState<Session[] | null>(null);
  const commandRecRef = useRef<any>(null);

  const selectedProgramme = useMemo(() => {
    if (!programmes) return null;
    if (selectedProgrammeId) return programmes.find(p => p.id === selectedProgrammeId) || null;
    return programmes[0] || null;
  }, [programmes, selectedProgrammeId]);

  // Voice recognition setup for calendar command
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      setCommandInterim(interim);
      if (final) {
        setCommandText(prev => (prev ? prev + " " + final : final).trim());
        setCommandInterim("");
      }
    };
    rec.onend = () => setCommandListening(false);
    rec.onerror = () => setCommandListening(false);
    commandRecRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
  }, []);

  const toggleCommandListening = useCallback(() => {
    if (commandListening) {
      commandRecRef.current?.stop();
      setCommandListening(false);
    } else {
      setCommandText("");
      setCommandInterim("");
      commandRecRef.current?.start();
      setCommandListening(true);
    }
  }, [commandListening]);

  const runCalendarCommand = useCallback(async (text: string) => {
    if (!selectedProgramme || !text.trim() || isRunningCommand) return;
    setIsRunningCommand(true);
    setCommandChanges(null);
    const snapshot = (selectedProgramme.sessions ?? []) as Session[];
    setPreviousSessions(snapshot);
    try {
      const result = await calendarCommand({
        command: text,
        sessions: snapshot as any,
        referenceDate: format(new Date(), "yyyy-MM-dd"),
      });
      await updateMutation.mutateAsync({
        id: selectedProgramme.id,
        data: { sessions: result.sessions as any },
      });
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      setCommandChanges(result.changes);
      setCommandText("");
    } catch {
      toast({ title: "Command failed — please try again", variant: "destructive" });
    } finally {
      setIsRunningCommand(false);
    }
  }, [selectedProgramme, isRunningCommand, updateMutation, queryClient, toast]);

  const handleUndoCommand = useCallback(async () => {
    if (!selectedProgramme || !previousSessions) return;
    await updateMutation.mutateAsync({
      id: selectedProgramme.id,
      data: { sessions: previousSessions as any },
    });
    await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
    setPreviousSessions(null);
    setCommandChanges(null);
    toast({ title: "Reverted to previous schedule" });
  }, [selectedProgramme, previousSessions, updateMutation, queryClient, toast]);

  const baseWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
  const viewStart = addWeeks(baseWeekStart, weekOffset);
  const weeks = Array.from({ length: WEEKS_TO_SHOW }, (_, i) => addWeeks(viewStart, i));

  const getSessionForDate = (date: Date): Session | undefined => {
    if (!selectedProgramme?.sessions) return undefined;
    return selectedProgramme.sessions.find(s => isSameDay(parseISO(s.date), date));
  };

  const handleDeleteProgramme = async (id: number) => {
    if (!confirm("Delete this programme?")) return;
    await deleteMutation.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
    if (selectedProgrammeId === id) setSelectedProgrammeId(null);
    toast({ title: "Programme deleted" });
  };

  const handleDuplicateProgramme = async (id: number) => {
    await duplicateMutation.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
    toast({ title: "Programme duplicated" });
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!selectedProgramme) return;
    const updated = (selectedProgramme.sessions || []).filter(s => s.id !== sessionId);
    await updateMutation.mutateAsync({ id: selectedProgramme.id, data: { sessions: updated } });
    queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
    toast({ title: "Session removed" });
  };

  const handleCopySession = useCallback((session: Session) => {
    setCopiedSession(session);
    toast({ title: `"${session.name || "Session"}" copied — click any empty day to paste` });
  }, [toast]);

  const handlePasteSession = useCallback(async (date: Date) => {
    if (!copiedSession || !selectedProgramme) return;
    const dateStr = format(date, "yyyy-MM-dd");

    // Build a fresh session: new ID, new date, new exercise IDs, clear logged weights/reps
    const newSession: Session = {
      id: `session-${Date.now()}`,
      date: dateStr,
      name: copiedSession.name,
      exercises: (copiedSession.exercises || []).map(ex => ({
        ...ex,
        id: `ex-${Math.random().toString(36).slice(2, 8)}`,
        setWeights: undefined,
        setReps: undefined,
      })),
    };

    const updatedSessions = [...(selectedProgramme.sessions || []), newSession];
    try {
      await updateMutation.mutateAsync({ id: selectedProgramme.id, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      toast({ title: `Pasted "${newSession.name || "Session"}" to ${format(date, "EEE d MMM")}` });
    } catch {
      toast({ title: "Failed to paste session", variant: "destructive" });
    }
  }, [copiedSession, selectedProgramme, updateMutation, queryClient, toast]);

  const handleDayClick = (date: Date) => {
    if (!selectedProgramme) {
      setNewProgrammeOpen(true);
      return;
    }
    const dateStr = format(date, "yyyy-MM-dd");
    const existing = getSessionForDate(date);

    // If clipboard is active and day is empty — paste instead of navigating
    if (copiedSession && !existing) {
      handlePasteSession(date);
      return;
    }

    if (existing) {
      setLocation(`/programmes/${selectedProgramme.id}/sessions/${existing.id}`);
    } else {
      setLocation(`/programmes/${selectedProgramme.id}/sessions/new?date=${dateStr}`);
    }
  };

  const handleCreateProgramme = async () => {
    if (!newProgrammeTitle.trim()) return;
    const prog = await createMutation.mutateAsync({ data: { title: newProgrammeTitle.trim(), sessions: [] } });
    queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
    setNewProgrammeOpen(false);
    setNewProgrammeTitle("");
    setSelectedProgrammeId(prog.id);
    toast({ title: "Programme created" });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">

      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          {/* Programme Selector */}
          {programmes && programmes.length > 0 ? (
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
                <DropdownMenuItem className="cursor-pointer text-primary mt-1 border-t" onClick={() => setNewProgrammeOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> New Programme
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="font-bold text-xl text-muted-foreground">No Programmes</span>
          )}

          {/* Programme Actions */}
          {selectedProgramme && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => handleDuplicateProgramme(selectedProgramme.id)} className="cursor-pointer">
                  <Copy className="w-4 h-4 mr-2" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDeleteProgramme(selectedProgramme.id)} className="cursor-pointer text-destructive focus:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Week navigation */}
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

          <Button size="sm" className="rounded-lg gap-2" onClick={() => setNewProgrammeOpen(true)}>
            <Plus className="w-4 h-4" /> New Programme
          </Button>
        </div>
      </div>

      {/* AI Command Bar */}
      {selectedProgramme && (
        <div className="shrink-0 border-b bg-background px-4 py-2.5">
          <div className="flex items-center gap-2 max-w-3xl mx-auto">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            <div className="relative flex-1">
              <Input
                value={commandListening ? (commandInterim || commandText || "") : commandText}
                onChange={e => setCommandText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runCalendarCommand(commandText)}
                placeholder='Try: "copy this week to next week, decrease reps by 2, increase sets by 1"'
                disabled={commandListening || isRunningCommand}
                className="pr-10 h-9 text-sm bg-muted/40 border-muted rounded-lg"
              />
              <button
                onClick={toggleCommandListening}
                disabled={isRunningCommand}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors ${commandListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-foreground"}`}
                title={commandListening ? "Stop listening" : "Speak a command"}
              >
                {commandListening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
            </div>
            <Button
              size="sm"
              variant="default"
              className="h-9 px-3 gap-1.5 rounded-lg shrink-0"
              onClick={() => runCalendarCommand(commandText)}
              disabled={!commandText.trim() || isRunningCommand}
            >
              {isRunningCommand ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline text-sm">Run</span>
            </Button>
          </div>
        </div>
      )}

      {/* Command result banner */}
      {commandChanges && commandChanges.length > 0 && (
        <div className="shrink-0 bg-emerald-50 border-b border-emerald-200 px-6 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-800 leading-tight">
              {commandChanges.length} change{commandChanges.length !== 1 ? "s" : ""} applied
            </p>
            <p className="text-xs text-emerald-700 truncate">{commandChanges.join(" · ")}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {previousSessions && (
              <Button
                variant="outline" size="sm"
                className="h-7 gap-1.5 text-xs rounded-lg border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                onClick={handleUndoCommand}
              >
                <Undo2 className="w-3 h-3" /> Undo
              </Button>
            )}
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 rounded-lg text-emerald-700 hover:bg-emerald-100"
              onClick={() => { setCommandChanges(null); setPreviousSessions(null); }}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Clipboard banner */}
      {copiedSession && (
        <div className="shrink-0 bg-primary/5 border-b border-primary/20 px-6 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <ClipboardPaste className="w-4 h-4 text-primary shrink-0" />
            <span className="text-primary font-semibold">"{copiedSession.name || "Session"}" copied</span>
            <span className="text-muted-foreground hidden sm:inline">— click any empty day to paste</span>
          </div>
          <Button
            variant="ghost" size="sm"
            className="h-7 gap-1.5 text-muted-foreground hover:text-foreground rounded-lg px-2"
            onClick={() => setCopiedSession(null)}
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </Button>
        </div>
      )}

      {/* Calendar */}
      <div className="flex-1 overflow-auto">
        {(!programmes || programmes.length === 0) ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="bg-primary/10 p-8 rounded-full mb-6">
              <Dumbbell className="w-16 h-16 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">No programmes yet</h2>
            <p className="text-muted-foreground mb-6 max-w-sm">Create your first programme to start scheduling sessions on the calendar.</p>
            <Button size="lg" className="rounded-xl" onClick={() => setNewProgrammeOpen(true)}>
              <Plus className="w-5 h-5 mr-2" /> Create Programme
            </Button>
          </div>
        ) : (
          <div className="min-w-[900px]">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b bg-muted/30 sticky top-0 z-10">
              {DAYS.map(day => (
                <div key={day} className="px-3 py-2 text-xs font-bold text-muted-foreground tracking-widest border-r last:border-r-0">
                  {day}
                </div>
              ))}
            </div>

            {/* Week rows */}
            {weeks.map((weekStart, weekIdx) => {
              const dates = getWeekDates(weekStart);
              return (
                <div key={weekIdx} className="grid grid-cols-7 border-b">
                  {dates.map((date, dayIdx) => {
                    const session = getSessionForDate(date);
                    const isToday = isSameDay(date, new Date());
                    const color = getSessionColor(session?.name);

                    return (
                      <div
                        key={dayIdx}
                        className={`border-r last:border-r-0 min-h-[160px] p-2 cursor-pointer group transition-colors ${
                          copiedSession && !session
                            ? "bg-primary/5 hover:bg-primary/10 ring-inset ring-1 ring-primary/20"
                            : isToday
                            ? "bg-primary/5 hover:bg-primary/10"
                            : "hover:bg-muted/30"
                        }`}
                        onClick={() => handleDayClick(date)}
                      >
                        {/* Date Number */}
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${
                            isToday
                              ? "bg-primary text-primary-foreground"
                              : "text-foreground"
                          }`}>
                            {format(date, "d")}
                          </span>
                          {session && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                title="Copy session"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopySession(session);
                                }}
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              <button
                                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                title="Delete session"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSession(session.id);
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Session content */}
                        {session ? (
                          <div>
                            {/* Session name tag */}
                            {session.name && (
                              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold mb-2 ${color.bg} ${color.text}`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                                {session.name}
                              </div>
                            )}
                            {/* Exercise list */}
                            <div className="space-y-0.5">
                              {(session.exercises || []).slice(0, 6).map((ex, i) => (
                                <div key={ex.id} className="flex items-start gap-1.5">
                                  <span className="text-[10px] text-muted-foreground font-bold w-3 shrink-0 mt-0.5">{i + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-foreground leading-tight truncate">{ex.name}</p>
                                    {(ex.sets || ex.reps) && (
                                      <p className="text-[10px] text-muted-foreground">
                                        {ex.perSetReps && ex.perSetReps.length > 0
                                          ? ex.perSetReps.join("/")
                                          : ex.sets && ex.reps ? `${ex.sets} x ${ex.reps}` : ex.sets ? `${ex.sets} sets` : ex.reps}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {(session.exercises || []).length > 6 && (
                                <p className="text-[10px] text-muted-foreground italic pl-4">+{session.exercises.length - 6} more</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className={`flex items-center justify-center h-[100px] transition-opacity ${copiedSession ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                            {copiedSession ? (
                              <div className="flex flex-col items-center gap-1.5 text-primary/70 group-hover:text-primary transition-colors">
                                <ClipboardPaste className="w-4 h-4" />
                                <span className="text-[10px] font-semibold">Paste here</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-1 text-muted-foreground/60">
                                <Plus className="w-4 h-4" />
                                <span className="text-[10px]">Add session</span>
                              </div>
                            )}
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

      {/* New Programme Dialog */}
      <Dialog open={newProgrammeOpen} onOpenChange={setNewProgrammeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Programme</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder="Programme name (e.g. Strength Block, Off-Season...)"
              value={newProgrammeTitle}
              onChange={e => setNewProgrammeTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreateProgramme()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNewProgrammeOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateProgramme} disabled={!newProgrammeTitle.trim() || createMutation.isPending}>
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
