import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Loader2, Mic, Square,
  Plus, Sparkles, Dumbbell, Zap, X, ChevronDown, ChevronUp, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, addWeeks, addDays, isSameDay, parseISO, differenceInDays } from "date-fns";

// ── Types ────────────────────────────────────────────────────────────────────
interface Exercise { id: string; name: string; sets?: number; reps?: string; [k: string]: any; }
interface Session { id: string; date: string; name?: string; source?: string; exercises?: Exercise[]; [k: string]: any; }
interface Programme { id: number; title: string; sessions: Session[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSessionHighlight(session: Session): string {
  if ((session.source === "wod_brain" || session.source === "run_brain") && session.structure) return session.structure;
  return (session.exercises ?? []).slice(0, 3)
    .map(ex => `${ex.name}${ex.sets && ex.reps ? ` ${ex.sets}×${ex.reps}` : ""}`)
    .filter(Boolean).join(" · ");
}

const SESSION_COLORS = [
  { bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-800"   },
  { bg: "bg-violet-50", border: "border-violet-200",  text: "text-violet-800" },
  { bg: "bg-orange-50", border: "border-orange-200",  text: "text-orange-800" },
  { bg: "bg-green-50",  border: "border-green-200",   text: "text-green-800"  },
  { bg: "bg-pink-50",   border: "border-pink-200",    text: "text-pink-800"   },
  { bg: "bg-cyan-50",   border: "border-cyan-200",    text: "text-cyan-800"   },
];
function sessionColor(name?: string) {
  if (!name) return SESSION_COLORS[0];
  let h = 0; for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return SESSION_COLORS[Math.abs(h) % SESSION_COLORS.length];
}

const DAY_WORDS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
};
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function remapSessionDays(sessions: Session[], targetDays: number[]): Session[] {
  if (!sessions.length || !targetDays.length) return sessions;
  const sorted = [...sessions].sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
  const anchor = startOfWeek(parseISO(sorted[0].date), { weekStartsOn: 1 });
  const weekMap = new Map<number, Session[]>();
  sorted.forEach(s => {
    const wn = Math.floor(differenceInDays(startOfWeek(parseISO(s.date), { weekStartsOn: 1 }), anchor) / 7);
    if (!weekMap.has(wn)) weekMap.set(wn, []);
    weekMap.get(wn)!.push(s);
  });
  const result: Session[] = [];
  Array.from(weekMap.entries()).sort(([a], [b]) => a - b).forEach(([wn, ws]) => {
    const wStart = addWeeks(anchor, wn);
    ws.forEach((s, i) => {
      const td = targetDays[i % targetDays.length];
      result.push({ ...s, date: format(addDays(wStart, td === 0 ? 6 : td - 1), "yyyy-MM-dd") });
    });
  });
  return result;
}

function dayRemapSessions(sessions: Session[], fromDays: number[], toDays: number[]): Session[] {
  return sessions.map(s => {
    const day = parseISO(s.date).getDay();
    const idx = fromDays.indexOf(day);
    if (idx === -1) return s;
    const toDay = toDays[idx];
    const ws = startOfWeek(parseISO(s.date), { weekStartsOn: 1 });
    return { ...s, date: format(addDays(ws, toDay === 0 ? 6 : toDay - 1), "yyyy-MM-dd") };
  });
}

function copyWithProgression(sessions: Session[], weekOffset: number, targetWeeks: number, setsInc: number, repsMul: number): Session[] {
  const sourceStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const sourceEnd = addDays(sourceStart, 6);
  const sourceSessions = sessions.filter(s => {
    try { const d = parseISO(s.date); return d >= sourceStart && d <= sourceEnd; } catch { return false; }
  });
  if (!sourceSessions.length) return sessions;
  const newSessions = [...sessions];
  for (let week = 1; week <= targetWeeks; week++) {
    const wStart = addWeeks(sourceStart, week);
    for (const s of sourceSessions) {
      const dow = parseISO(s.date).getDay();
      const newDate = format(addDays(wStart, dow === 0 ? 6 : dow - 1), "yyyy-MM-dd");
      const exs = ((s as any).exercises ?? []).map((ex: any) => ({
        ...ex, id: crypto.randomUUID(),
        sets: Math.max(1, Math.round((ex.sets || 0) + setsInc * week)),
        reps: Math.max(1, Math.round((ex.reps || 0) * Math.pow(repsMul, week))),
        ...(ex.setReps ? { setReps: (ex.setReps as number[]).map(r => Math.max(1, Math.round(r * Math.pow(repsMul, week)))) } : {}),
      }));
      newSessions.push({ ...s, id: crypto.randomUUID(), date: newDate, exercises: exs });
    }
  }
  return newSessions;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LibraryBuilder() {
  const [, params] = useRoute("/library/builder/:programmeId");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const programmeId = parseInt(params?.programmeId || "0", 10);

  const [programme, setProgramme] = useState<Programme | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Describe / generate
  const [descOpen, setDescOpen] = useState(true);
  const [descText, setDescText] = useState("");
  const [descStartDate, setDescStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [generating, setGenerating] = useState(false);
  const [strengthStyle, setStrengthStyle] = useState<"straight" | "variety" | null>(null);

  // Calendar
  const [weekOffset, setWeekOffset] = useState(0);
  const [calView, setCalView] = useState<"week" | "month">("week");

  // Command bar (same as client-area)
  const [cmdInput, setCmdInput] = useState("");
  const [cmdParsing, setCmdParsing] = useState(false);
  const [cmdSaving, setCmdSaving] = useState(false);
  const [cmdListening, setCmdListening] = useState(false);
  const [cmdInterim, setCmdInterim] = useState("");
  const cmdRecRef = useRef<any>(null);
  const [pendingReschedule, setPendingReschedule] = useState<{ sessions: Session[]; dayLabels: string[] } | null>(null);
  const [pendingCommand, setPendingCommand] = useState<{ description: string; sessions: Session[] } | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{ count: number } | null>(null);

  // Quick-add session by clicking a day
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState("");
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddAdding, setQuickAddAdding] = useState(false);

  // Fetch programme
  useEffect(() => {
    if (!programmeId) return;
    setLoading(true);
    fetch(`/api/programmes/${programmeId}`)
      .then(r => r.json())
      .then(data => setProgramme(data))
      .catch(() => toast({ title: "Failed to load programme", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [programmeId]);

  // Save sessions to DB
  const saveSessions = useCallback(async (sessions: Session[], newTitle?: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/programmes/${programmeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions, ...(newTitle ? { title: newTitle } : {}) }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setProgramme(updated);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally { setSaving(false); }
  }, [programmeId]);

  // Rename programme
  const renameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRename = (title: string) => {
    if (!programme) return;
    setProgramme(p => p ? { ...p, title } : p);
    if (renameDebounceRef.current) clearTimeout(renameDebounceRef.current);
    renameDebounceRef.current = setTimeout(() => saveSessions(programme.sessions, title), 800);
  };

  // Generate from AI
  function isStrengthDescription(text: string) {
    const lower = text.toLowerCase();
    const hyrox = /hyrox/i.test(lower);
    const oly = /weightlifting|olympic|snatch|clean.?jerk|oly\b/i.test(lower);
    const runOnly = /^[\s\w,]+run(ning|s)?\s*(only|focused|block|programme)?$/i.test(lower.trim());
    return !hyrox && !oly && !runOnly;
  }

  const generateSessions = async () => {
    if (!descText.trim() || !descStartDate) { toast({ title: "Add a description and start date" }); return; }
    if (isStrengthDescription(descText) && strengthStyle === null) { toast({ title: "Choose a session style first" }); return; }
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-programme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: descText.trim(), startDate: descStartDate, strengthStyle: strengthStyle ?? "variety" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const ts = Date.now();
      const sessions: Session[] = (data.sessions ?? []).map((s: any, i: number) => ({
        ...s, id: s.id ?? `builder-${ts}-${i}`,
      }));
      const title = programme?.title && programme.title !== "Untitled Programme" ? programme.title : (data.title ?? programme?.title ?? "New Programme");
      await saveSessions(sessions, title);
      // Navigate calendar to start date
      const startD = parseISO(descStartDate);
      const today = startOfWeek(new Date(), { weekStartsOn: 1 });
      const diff = Math.round(differenceInDays(startOfWeek(startD, { weekStartsOn: 1 }), today) / 7);
      setWeekOffset(diff);
      setDescOpen(false);
      toast({ title: `${sessions.length} sessions generated` });
    } catch {
      toast({ title: "Generation failed", description: "Try rephrasing your description.", variant: "destructive" });
    } finally { setGenerating(false); }
  };

  // Quick-add session by clicking a day
  const quickAddSession = async () => {
    if (!programme || !quickAddDate) return;
    setQuickAddAdding(true);
    try {
      const ts = Date.now();
      const newSession: Session = {
        id: `session-${ts}`,
        date: quickAddDate,
        name: quickAddName.trim() || "Session",
        exercises: [],
      };
      const updated = [...(programme.sessions ?? []), newSession];
      await saveSessions(updated);
      setQuickAddOpen(false);
      setQuickAddName("");
    } catch {
      toast({ title: "Failed to add session", variant: "destructive" });
    } finally { setQuickAddAdding(false); }
  };

  // Voice for command bar
  const toggleCmdListening = () => {
    if (cmdListening) {
      cmdRecRef.current?.stop();
      setCmdListening(false); return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast({ title: "Voice not supported in this browser" }); return; }
    const rec = new SpeechRecognition();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-GB";
    rec.onresult = (e: any) => {
      let interim = ""; let final = "";
      for (const r of e.results) { if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; }
      if (final) { setCmdInput(final); setCmdInterim(""); }
      else setCmdInterim(interim);
    };
    rec.onend = () => { setCmdListening(false); setCmdInterim(""); };
    rec.start();
    cmdRecRef.current = rec;
    setCmdListening(true);
  };

  // Command bar handler — same logic as client-area but for a single programme
  const handleCmd = async () => {
    const cmd = cmdInput.trim();
    if (!cmd || !programme) return;
    setCmdParsing(true);
    try {
      const res = await fetch("/api/parse-calendar-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, programmeNames: [programme.title], currentDate: format(new Date(), "yyyy-MM-dd") }),
      });
      const intent = await res.json();

      switch (intent.action) {
        case "reschedule": case "day_remap": {
          if (intent.action === "reschedule") {
            const targetDays: number[] = (intent.targetDays ?? [])
              .map((d: string) => DAY_WORDS[d.toLowerCase()] ?? DAY_WORDS[d.toLowerCase().replace(/s$/, "")])
              .filter((d: number | undefined) => d !== undefined);
            if (!targetDays.length) { toast({ title: "Couldn't parse days", variant: "destructive" }); break; }
            const newSessions = remapSessionDays(programme.sessions, targetDays);
            setPendingReschedule({ sessions: newSessions, dayLabels: targetDays.map(d => DAY_NAMES[d]) });
          } else {
            const fromDays: number[] = (intent.fromDays ?? []).map((d: string) => DAY_WORDS[d.toLowerCase()] ?? DAY_WORDS[d.toLowerCase().replace(/s$/, "")]).filter((d: number | undefined) => d !== undefined);
            const toDays: number[] = (intent.toDays ?? []).map((d: string) => DAY_WORDS[d.toLowerCase()] ?? DAY_WORDS[d.toLowerCase().replace(/s$/, "")]).filter((d: number | undefined) => d !== undefined);
            if (!fromDays.length || fromDays.length !== toDays.length) { toast({ title: "Couldn't match from/to days", variant: "destructive" }); break; }
            const newSessions = dayRemapSessions(programme.sessions, fromDays, toDays);
            const fromLabels = fromDays.map(d => DAY_NAMES[d]).join(" / ");
            const toLabels = toDays.map(d => DAY_NAMES[d]).join(" / ");
            setPendingReschedule({ sessions: newSessions, dayLabels: toLabels.split(" / ") });
            toast({ title: `Move ${fromLabels} → ${toLabels}?`, description: "Confirm below" });
          }
          break;
        }
        case "delete": {
          if (intent.scope === "all") {
            setPendingBulkDelete({ count: programme.sessions.length });
          } else {
            toast({ title: "Delete all sessions from this programme?", description: "Use 'delete all sessions'" });
          }
          break;
        }
        case "copy_expand": {
          const targetWeeks: number = intent.targetWeeks ?? 1;
          const setsInc: number = intent.setsIncrement ?? 0;
          const repsMul: number = intent.repsMultiplier ?? 1.0;
          const newSessions = copyWithProgression(programme.sessions, weekOffset, targetWeeks, setsInc, repsMul);
          const addedCount = newSessions.length - programme.sessions.length;
          setPendingCommand({
            description: `Copy ${addedCount} new session${addedCount !== 1 ? "s" : ""} into ${targetWeeks} week${targetWeeks !== 1 ? "s" : ""}`,
            sessions: newSessions,
          });
          break;
        }
        default:
          toast({ title: "Couldn't understand that command", description: intent.message ?? 'Try: "copy this week into 4 weeks" or "move Mon/Wed/Fri to Tue/Thu/Sun"', variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to parse command", variant: "destructive" });
    } finally { setCmdParsing(false); }
  };

  const applyReschedule = async () => {
    if (!pendingReschedule) return;
    setCmdSaving(true);
    await saveSessions(pendingReschedule.sessions);
    toast({ title: "Rescheduled", description: `→ ${pendingReschedule.dayLabels.join(" / ")}` });
    setPendingReschedule(null); setCmdInput("");
    setCmdSaving(false);
  };

  const applyCommand = async () => {
    if (!pendingCommand) return;
    setCmdSaving(true);
    await saveSessions(pendingCommand.sessions);
    toast({ title: "Applied", description: pendingCommand.description });
    setPendingCommand(null); setCmdInput("");
    setCmdSaving(false);
  };

  const applyBulkDelete = async () => {
    setCmdSaving(true);
    await saveSessions([]);
    toast({ title: "All sessions deleted" });
    setPendingBulkDelete(null); setCmdInput("");
    setCmdSaving(false);
  };

  // Calendar weeks
  const trainingWeeks = useMemo(() => {
    const count = calView === "week" ? 1 : 4;
    const base = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
    return Array.from({ length: count }, (_, wi) =>
      Array.from({ length: 7 }, (_, di) => addDays(addWeeks(base, wi), di))
    );
  }, [weekOffset, calView]);

  const weekLabel = useMemo(() => {
    const ws = trainingWeeks[0][0];
    const we = trainingWeeks[trainingWeeks.length - 1][6];
    return calView === "week"
      ? format(ws, "d MMM") + " – " + format(we, "d MMM yyyy")
      : format(ws, "MMM yyyy");
  }, [trainingWeeks, calView]);

  const sessions = programme?.sessions ?? [];

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (!programme) return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      Programme not found. <Button variant="link" onClick={() => setLocation("/library")}>Back to Library</Button>
    </div>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">

      {/* Header */}
      <div className="shrink-0 border-b px-4 sm:px-6 py-3 bg-background flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 -ml-1 shrink-0" onClick={() => setLocation("/library")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Input
          value={programme.title}
          onChange={e => handleRename(e.target.value)}
          className="h-8 text-sm font-semibold border-0 border-b border-transparent hover:border-border rounded-none bg-transparent px-0 focus-visible:ring-0 focus-visible:border-primary max-w-sm"
          placeholder="Programme name…"
        />
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:inline">{sessions.length} session{sessions.length !== 1 ? "s" : ""} · auto-saved</span>
          <Button size="sm" className="gap-1.5 rounded-lg text-xs" onClick={() => setLocation("/library")}>
            <Save className="w-3.5 h-3.5" /> Done
          </Button>
        </div>
      </div>

      {/* Describe / Generate — collapsible */}
      <div className="shrink-0 border-b bg-muted/20">
        <button
          className="w-full flex items-center justify-between px-4 sm:px-6 py-2.5 text-left"
          onClick={() => setDescOpen(o => !o)}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">AI Generate</span>
            {!descOpen && sessions.length > 0 && (
              <span className="text-xs text-muted-foreground ml-1">— {sessions.length} sessions built</span>
            )}
          </div>
          {descOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {descOpen && (
          <div className="px-4 sm:px-6 pb-4 space-y-3">
            <textarea
              rows={3}
              className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Wedding Dress Bodybuilding — 8 weeks, 4 sessions/week, upper body hypertrophy focus, glutes and shoulders priority, light legs, no barbell back squat, aesthetics-driven…"
              value={descText}
              onChange={e => setDescText(e.target.value)}
            />
            {descText.trim() && isStrengthDescription(descText) && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Session style</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setStrengthStyle("straight")}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${strengthStyle === "straight" ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border hover:border-primary/40 hover:bg-muted/50"}`}>
                    <p className="font-semibold">Straight Sets</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Consistent sets &amp; reps, clean progressive overload</p>
                  </button>
                  <button type="button" onClick={() => setStrengthStyle("variety")}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${strengthStyle === "variety" ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border hover:border-primary/40 hover:bg-muted/50"}`}>
                    <p className="font-semibold">Variety</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Wave loading, pyramids, drop sets, AMRAP finishers</p>
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Start</label>
                <input
                  type="date"
                  className="rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={descStartDate}
                  onChange={e => setDescStartDate(e.target.value)}
                />
              </div>
              <Button size="sm" className="gap-2 rounded-lg ml-auto" onClick={generateSessions}
                disabled={generating || !descText.trim() || !descStartDate || (isStrengthDescription(descText) && strengthStyle === null)}>
                {generating
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                  : <><Sparkles className="w-3.5 h-3.5" /> {sessions.length > 0 ? "Re-generate" : "Generate"}</>
                }
              </Button>
            </div>
            {generating && <p className="text-xs text-muted-foreground animate-pulse">Building programme — 15–30 seconds…</p>}
          </div>
        )}
      </div>

      {/* Calendar toolbar — identical to client-area */}
      <div className="shrink-0 px-4 py-2.5 border-b flex items-center justify-between gap-2 bg-background">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={() => setWeekOffset(w => w - (calView === "week" ? 1 : 4))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-3 text-xs rounded-md" onClick={() => setWeekOffset(0)}>
              Today
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={() => setWeekOffset(w => w + (calView === "week" ? 1 : 4))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="tabs">
            <button onClick={() => setCalView("month")} className={`tab${calView === "month" ? " active" : ""}`}>Month</button>
            <button onClick={() => setCalView("week")} className={`tab${calView === "week" ? " active" : ""}`}>Week</button>
          </div>
          <span className="text-xs font-medium text-muted-foreground ml-1 hidden sm:inline">{weekLabel}</span>
        </div>
      </div>

      {/* Command bar — identical to client-area */}
      <div className="shrink-0 px-4 py-2 border-b bg-muted/30 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={cmdListening ? (cmdInterim || cmdInput) : cmdInput}
            onChange={e => setCmdInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void handleCmd(); }}
            placeholder='e.g. "copy this week into 4 weeks +1 set" · "move Mon/Wed/Fri → Tue/Thu/Sun"'
            disabled={cmdListening}
            className="flex-1 text-xs bg-background border rounded-lg px-3 py-1.5 outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 transition-colors"
          />
          <button type="button" onClick={toggleCmdListening} title={cmdListening ? "Stop" : "Voice command"}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${cmdListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}>
            {cmdListening ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
          <Button size="sm" variant="outline" className="text-xs h-7 px-3 rounded-lg shrink-0"
            onClick={() => void handleCmd()} disabled={!cmdInput.trim() || cmdParsing}>
            {cmdParsing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
          </Button>
        </div>

        {pendingReschedule && (
          <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-xs text-amber-800 flex-1">Reschedule to <strong>{pendingReschedule.dayLabels.join(" / ")}</strong>?</p>
            <div className="flex gap-1.5 shrink-0">
              <Button size="sm" className="h-6 px-2 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={applyReschedule} disabled={cmdSaving}>
                {cmdSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPendingReschedule(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {pendingCommand && (
          <div className="flex items-center justify-between gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
            <p className="text-xs text-violet-900 flex-1"><strong>{pendingCommand.description}</strong> — confirm?</p>
            <div className="flex gap-1.5 shrink-0">
              <Button size="sm" className="h-6 px-2 text-xs bg-violet-600 hover:bg-violet-700 text-white" onClick={applyCommand} disabled={cmdSaving}>
                {cmdSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPendingCommand(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {pendingBulkDelete && (
          <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <p className="text-xs text-red-800 flex-1">Delete all <strong>{pendingBulkDelete.count}</strong> sessions? Cannot be undone.</p>
            <div className="flex gap-1.5 shrink-0">
              <Button size="sm" className="h-6 px-2 text-xs bg-red-600 hover:bg-red-700 text-white" onClick={applyBulkDelete} disabled={cmdSaving}>
                {cmdSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete all"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPendingBulkDelete(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Calendar grid — identical structure to client-area */}
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        <div className="min-w-[560px]">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b bg-muted/30 sticky top-0 z-10">
            {trainingWeeks[0].map((d, i) => (
              <div key={i} className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                {calView === "week" ? (
                  <>
                    <span className="block">{format(d, "EEE")}</span>
                    <span className={`block text-sm font-bold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full mx-auto ${isSameDay(d, new Date()) ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                      {format(d, "d")}
                    </span>
                  </>
                ) : format(d, "EEE")}
              </div>
            ))}
          </div>

          {trainingWeeks.map((week, wi) => (
            <div key={wi} className="calendar-grid grid-cols-7 border-b">
              {week.map((day, di) => {
                const dateStr = format(day, "yyyy-MM-dd");
                const daySessions = sessions.filter(s => { try { return isSameDay(parseISO(s.date), day); } catch { return false; } });
                const isToday = isSameDay(day, new Date());
                return (
                  <div
                    key={di}
                    className={`calendar-cell cursor-pointer transition-colors ${calView === "week" ? "!min-h-[calc(100vh-380px)]" : ""}`}
                    onClick={() => { setQuickAddDate(dateStr); setQuickAddName(""); setQuickAddOpen(true); }}
                  >
                    {calView === "month" && (
                      <div className="flex items-center justify-between">
                        <div className={`calendar-day w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : ""}`}>
                          {format(day, "d")}
                        </div>
                        <button onClick={e => { e.stopPropagation(); setQuickAddDate(dateStr); setQuickAddName(""); setQuickAddOpen(true); }}
                          className="w-5 h-5 flex items-center justify-center rounded text-primary/60 hover:text-primary hover:bg-primary/10">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      {daySessions.map(session => {
                        const col = sessionColor(session.name);
                        const highlight = getSessionHighlight(session);
                        return (
                          <div
                            key={session.id}
                            className={`session-card rounded-lg px-2 py-1.5 border ${col.bg} ${col.border} cursor-pointer group relative`}
                            onClick={e => { e.stopPropagation(); setLocation(`/programmes/${programmeId}/sessions/${session.id}`); }}
                          >
                            <p className={`text-[11px] font-semibold leading-tight ${col.text} flex items-center gap-1`}>
                              {session.source === "wod_brain" ? <Dumbbell className="w-2.5 h-2.5 shrink-0" /> : session.source === "run_brain" ? <Zap className="w-2.5 h-2.5 shrink-0" /> : null}
                              {session.name || "Session"}
                            </p>
                            {highlight && <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-2">{highlight}</p>}
                            <button
                              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              onClick={async e => {
                                e.stopPropagation();
                                await saveSessions(sessions.filter(s => s.id !== session.id));
                              }}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Quick add session dialog */}
      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
          onClick={() => setQuickAddOpen(false)}>
          <div className="bg-background rounded-2xl border shadow-xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-sm">Add session · {format(parseISO(quickAddDate), "EEE d MMM")}</p>
            <Input
              autoFocus
              placeholder="Session name (e.g. Upper Body, Snatch Focus)"
              value={quickAddName}
              onChange={e => setQuickAddName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void quickAddSession(); if (e.key === "Escape") setQuickAddOpen(false); }}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setQuickAddOpen(false)}>Cancel</Button>
              <Button className="flex-1 rounded-xl" onClick={quickAddSession} disabled={quickAddAdding}>
                {quickAddAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Session"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
