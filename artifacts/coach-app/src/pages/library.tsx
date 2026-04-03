import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Brain, Zap, Plus, BookOpen, Loader2, ChevronDown, ChevronUp, ArrowLeft, Dumbbell, Calendar, Clock, Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Helpers ─────────────────────────────────────────────────────────────────
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoToUTCDay(iso: string): number {
  // Returns 0=Mon … 6=Sun
  const d = new Date(iso + "T00:00:00Z");
  return (d.getUTCDay() + 6) % 7;
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const dow = isoToUTCDay(iso);
  return addDaysISO(iso, -dow);
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function groupIntoWeeks(sessions: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const s of sessions) {
    if (!s.date) continue;
    const mon = mondayOf(s.date);
    if (!map.has(mon)) map.set(mon, []);
    map.get(mon)!.push(s);
  }
  return map;
}

const WOD_FORMATS = ["amrap", "emom", "for_time", "interval", "ladder"];
const FORMAT_LABELS: Record<string, string> = { amrap: "AMRAP", emom: "EMOM", for_time: "For Time", interval: "Intervals", ladder: "Ladder" };
const RUN_TYPES = ["easy", "recovery", "intervals", "threshold", "tempo", "steady", "hills", "progression", "fartlek", "long_run"];
const TYPE_LABELS: Record<string, string> = { long_run: "Long Run" };
const INTENSITIES = ["easy", "moderate", "moderate_hard", "hard"];
const INTENSITY_LABELS: Record<string, string> = { easy: "Easy", moderate: "Moderate", moderate_hard: "Moderate / Hard", hard: "Hard" };
const UNITS = ["reps", "m", "km", "cal", "seconds", "minutes"];
const TERRAINS = ["flat", "hill", "rolling", "track"];

type Tab = "blocks" | "sessions";
type SessionFilter = "all" | "wods" | "runs";
type BlockFilter = "all" | "wod" | "run" | "strength";

function typeLabel(t: string) { return TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

// ── Session cards ──────────────────────────────────────────────────────────────

function WodCard({ wod, expanded, onToggle }: { wod: any; expanded: boolean; onToggle: () => void }) {
  const blocks = Array.isArray(wod.blocks) ? wod.blocks : [];
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted rounded px-1.5 py-0.5">Session</span>
            <span className="text-xs font-bold text-purple-700 bg-purple-100 rounded px-2 py-0.5">{FORMAT_LABELS[wod.format] ?? wod.format}</span>
            <span className="text-xs text-muted-foreground">{wod.duration} min</span>
            {wod.rounds && <span className="text-xs text-muted-foreground">{wod.rounds} rounds</span>}
            {wod.source === "custom" && <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">Custom</span>}
          </div>
          <p className="font-semibold text-sm">{wod.name}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onToggle}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground italic">{wod.structure}</p>
          <div className="space-y-1">
            {blocks.map((b: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-5 text-center font-bold text-muted-foreground">{b.minute ? `M${b.minute}` : i + 1}</span>
                <span className="flex-1 font-medium capitalize">{b.movement}</span>
                <span className="text-muted-foreground">{b.amount} {b.unit}</span>
              </div>
            ))}
          </div>
          {wod.equipment?.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {wod.equipment.map((e: string) => (
                <span key={e} className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground capitalize">{e}</span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {(wod.tags ?? []).map((tag: string) => (
          <span key={tag} className="text-[10px] text-purple-600 uppercase tracking-wide font-semibold">{tag}</span>
        ))}
      </div>
    </div>
  );
}

function RunCard({ run, expanded, onToggle }: { run: any; expanded: boolean; onToggle: () => void }) {
  const meta: string[] = [];
  if (run.duration) meta.push(`${run.duration} min`);
  if (run.distanceKm) meta.push(`${run.distanceKm} km`);
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted rounded px-1.5 py-0.5">Session</span>
            <span className="text-xs font-bold text-green-700 bg-green-100 rounded px-2 py-0.5">{typeLabel(run.type)}</span>
            {meta.length > 0 && <span className="text-xs text-muted-foreground">{meta.join(" · ")}</span>}
            <span className="text-xs bg-white border rounded-full px-2 py-0.5 text-foreground">{INTENSITY_LABELS[run.intensity] ?? run.intensity}</span>
            {run.source === "custom" && <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">Custom</span>}
          </div>
          <p className="font-semibold text-sm">{run.name}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onToggle}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground italic">{run.structure}</p>
          {run.terrain?.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {run.terrain.map((t: string) => (
                <span key={t} className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground capitalize">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {(run.tags ?? []).map((tag: string) => (
          <span key={tag} className="text-[10px] text-green-600 uppercase tracking-wide font-semibold">{tag.replace(/_/g, " ")}</span>
        ))}
      </div>
    </div>
  );
}

// ── Block/Programme cards ──────────────────────────────────────────────────────

const LIFT_ICONS: Record<string, string> = { squat: "🏋️", bench: "💪", deadlift: "⛓️", olympic: "🥇" };
const LEVEL_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-700",
  intermediate: "bg-amber-100 text-amber-700",
  advanced: "bg-red-100 text-red-700",
};

function StrengthBlockCard({ template, expanded, onToggle }: { template: any; expanded: boolean; onToggle: () => void }) {
  const lifts = (template.liftFocus ?? "").split(",").map((l: string) => l.trim());
  const icons = lifts.map((l: string) => LIFT_ICONS[l] ?? "🏋️").join(" ");
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          <span className="text-xl leading-none mt-0.5 shrink-0">{icons}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted rounded px-1.5 py-0.5">Block</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${LEVEL_COLORS[template.level] ?? "bg-muted text-muted-foreground"}`}>
                {template.level}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />{template.durationWeeks}w
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />{template.sessionsPerWeek}×/wk
              </span>
            </div>
            <p className="font-semibold text-sm">{template.name}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onToggle}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground italic">{template.description}</p>
          {template.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-800">⚠️ {template.notes}</p>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {(template.tags ?? []).slice(0, 5).map((tag: string) => (
          <span key={tag} className="text-[10px] text-orange-600 uppercase tracking-wide font-semibold">{tag}</span>
        ))}
      </div>
    </div>
  );
}

function EnduranceCycleCard({ cycle, expanded, onToggle }: { cycle: any; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted rounded px-1.5 py-0.5">Block</span>
            <span className="text-xs font-bold text-purple-700 bg-purple-100 rounded px-2 py-0.5">WOD</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />{cycle.totalWeeks}w
            </span>
            <span className="text-xs text-muted-foreground">{cycle.durationRange?.min}–{cycle.durationRange?.max} min</span>
          </div>
          <p className="font-semibold text-sm">{cycle.name}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onToggle}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground italic">{cycle.description}</p>
          {cycle.equipment?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {cycle.equipment.map((e: string) => (
                <span key={e} className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground capitalize">{e}</span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {(cycle.tags ?? []).slice(0, 5).map((tag: string) => (
          <span key={tag} className="text-[10px] text-purple-600 uppercase tracking-wide font-semibold">{tag}</span>
        ))}
      </div>
    </div>
  );
}

function RunTemplateCard({ template, expanded, onToggle }: { template: any; expanded: boolean; onToggle: () => void }) {
  const sessions: any[] = template.sessions ?? [];
  const weekCount = sessions.length > 0 ? Math.max(...sessions.map((s: any) => s.week ?? 0)) : 0;
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted rounded px-1.5 py-0.5">Block</span>
            <span className="text-xs font-bold text-green-700 bg-green-100 rounded px-2 py-0.5">Run</span>
            {weekCount > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />{weekCount}w
              </span>
            )}
            {sessions.length > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />{sessions.length} sessions
              </span>
            )}
          </div>
          <p className="font-semibold text-sm">{template.name}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onToggle}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>
      {expanded && (
        <p className="text-xs text-muted-foreground italic pt-1">{template.description}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {(template.tags ?? []).slice(0, 5).map((tag: string) => (
          <span key={tag} className="text-[10px] text-green-600 uppercase tracking-wide font-semibold">{tag.replace(/_/g, " ")}</span>
        ))}
      </div>
    </div>
  );
}

function ProgrammeCard({ programme, expanded, onToggle }: { programme: any; expanded: boolean; onToggle: () => void }) {
  const sessions: any[] = programme.sessions ?? [];
  const sessionCount = sessions.length;
  const dates = sessions.map((s: any) => s.date).filter(Boolean).sort();
  const weeks = dates.length >= 2
    ? Math.ceil((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (7 * 86400000)) + 1
    : Math.ceil(sessionCount / 5);
  const sessionNames = [...new Set(sessions.map((s: any) => s.name).filter(Boolean))].slice(0, 6);
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted rounded px-1.5 py-0.5">Block</span>
            {sessionCount > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />{sessionCount} sessions
              </span>
            )}
            {weeks > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />{weeks}w
              </span>
            )}
          </div>
          <p className="font-semibold text-sm">{programme.title}</p>
        </div>
        {sessionCount > 0 && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onToggle}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        )}
      </div>
      {expanded && sessionNames.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Sessions</p>
          <div className="flex flex-wrap gap-1">
            {sessionNames.map((name: string) => (
              <span key={name} className="text-xs bg-muted rounded-full px-2 py-0.5 text-foreground">{name}</span>
            ))}
          </div>
          {dates[0] && (
            <p className="text-xs text-muted-foreground">
              Starts {new Date(dates[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Library() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("blocks");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [blockFilter, setBlockFilter] = useState<BlockFilter>("all");
  const [search, setSearch] = useState("");
  const [wods, setWods] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [strengthTemplates, setStrengthTemplates] = useState<any[]>([]);
  const [masterProgrammes, setMasterProgrammes] = useState<any[]>([]);
  const [enduranceCycles, setEnduranceCycles] = useState<any[]>([]);
  const [runTemplates, setRunTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Programme Builder ──────────────────────────────────────────────────────
  const [creatingBuilder, setCreatingBuilder] = useState(false);

  const openBuilder = async () => {
    setCreatingBuilder(true);
    try {
      const res = await fetch("/api/programmes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled Programme", sessions: [] }),
      });
      if (!res.ok) throw new Error();
      const programme = await res.json();
      setLocation(`/library/builder/${programme.id}`);
    } catch {
      toast({ title: "Failed to create programme", variant: "destructive" });
    } finally { setCreatingBuilder(false); }
  };

  // ── Add WOD dialog ─────────────────────────────────────────────────────────
  const [addWodOpen, setAddWodOpen] = useState(false);
  const [savingWod, setSavingWod] = useState(false);
  const [wodForm, setWodForm] = useState({ name: "", format: "amrap", duration: "", structure: "", rounds: "" });
  const [wodBlocks, setWodBlocks] = useState([{ movement: "", amount: "", unit: "reps" }]);

  // Add Run dialog
  const [addRunOpen, setAddRunOpen] = useState(false);
  const [savingRun, setSavingRun] = useState(false);
  const [runForm, setRunForm] = useState({ name: "", type: "easy", duration: "", distanceKm: "", structure: "", intensity: "moderate", terrain: [] as string[] });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/wod-brain/workouts").then(r => r.json()),
      fetch("/api/run-brain/workouts").then(r => r.json()),
      fetch("/api/strength-blocks/templates").then(r => r.json()),
      fetch("/api/programmes").then(r => r.json()),
      fetch("/api/endurance-cycles/templates").then(r => r.json()),
      fetch("/api/endurance-run-templates").then(r => r.json()),
    ]).then(([wodData, runData, strengthData, progData, cycleData, runTplData]) => {
      setWods(wodData.workouts ?? []);
      setRuns(runData.workouts ?? []);
      setStrengthTemplates(strengthData.templates ?? []);
      setMasterProgrammes((Array.isArray(progData) ? progData : []).filter((p: any) => (p.sessions ?? []).length > 0));
      setEnduranceCycles(cycleData.cycles ?? []);
      setRunTemplates(runTplData.templates ?? []);
    }).catch(() => toast({ title: "Failed to load library", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  const filteredWods = wods.filter(w =>
    !search || w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.tags ?? []).some((t: string) => t.includes(search.toLowerCase())) ||
    w.format.includes(search.toLowerCase())
  );

  const filteredRuns = runs.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.type.includes(search.toLowerCase()) ||
    (r.tags ?? []).some((t: string) => t.includes(search.toLowerCase()))
  );

  const totalBlocks = masterProgrammes.length + strengthTemplates.length + enduranceCycles.length + runTemplates.length;
  const totalSessions = wods.length + runs.length;

  const saveWod = async () => {
    if (!wodForm.name.trim() || !wodForm.format || !wodForm.duration || !wodForm.structure) return;
    const validBlocks = wodBlocks.filter(b => b.movement.trim() && b.amount);
    if (!validBlocks.length) { toast({ title: "Add at least one movement block" }); return; }
    setSavingWod(true);
    try {
      const res = await fetch("/api/wod-brain/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...wodForm,
          duration: Number(wodForm.duration),
          rounds: wodForm.rounds ? Number(wodForm.rounds) : undefined,
          blocks: validBlocks.map(b => ({ movement: b.movement.trim(), amount: Number(b.amount), unit: b.unit })),
          equipment: [],
          tags: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWods(prev => [...prev, data.workout]);
      setAddWodOpen(false);
      setWodForm({ name: "", format: "amrap", duration: "", structure: "", rounds: "" });
      setWodBlocks([{ movement: "", amount: "", unit: "reps" }]);
      toast({ title: `"${data.workout.name}" added to library` });
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to save", variant: "destructive" });
    } finally { setSavingWod(false); }
  };

  const saveRun = async () => {
    if (!runForm.name.trim() || !runForm.type || !runForm.structure || !runForm.intensity) return;
    setSavingRun(true);
    try {
      const res = await fetch("/api/run-brain/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...runForm,
          duration: runForm.duration ? Number(runForm.duration) : undefined,
          distanceKm: runForm.distanceKm ? Number(runForm.distanceKm) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRuns(prev => [...prev, data.workout]);
      setAddRunOpen(false);
      setRunForm({ name: "", type: "easy", duration: "", distanceKm: "", structure: "", intensity: "moderate", terrain: [] });
      toast({ title: `"${data.workout.name}" added to library` });
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to save", variant: "destructive" });
    } finally { setSavingRun(false); }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 border-b px-4 sm:px-6 py-4 bg-background flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 -ml-1 shrink-0" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <BookOpen className="w-5 h-5 text-primary" />
          <h1 className="font-bold text-xl">Library</h1>
        </div>
        {tab === "sessions" && sessionFilter !== "runs" && (
          <Button size="sm" className="gap-2 rounded-lg" onClick={() => setAddWodOpen(true)}>
            <Plus className="w-4 h-4" /> Add WOD
          </Button>
        )}
        {tab === "sessions" && sessionFilter === "runs" && (
          <Button size="sm" className="gap-2 rounded-lg" onClick={() => setAddRunOpen(true)}>
            <Plus className="w-4 h-4" /> Add Run
          </Button>
        )}
        {tab === "blocks" && (
          <Button size="sm" variant="outline" className="gap-2 rounded-lg" onClick={openBuilder} disabled={creatingBuilder}>
            {creatingBuilder ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Build Programme
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="shrink-0 border-b px-4 sm:px-6 pt-3 pb-0 bg-background space-y-3">
        <div className="flex gap-1">
          <button
            onClick={() => { setTab("blocks"); setSearch(""); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${tab === "blocks" ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Layers className="w-4 h-4" /> Blocks <span className="text-xs font-normal">({totalBlocks})</span>
          </button>
          <button
            onClick={() => { setTab("sessions"); setSearch(""); setSessionFilter("all"); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${tab === "sessions" ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Dumbbell className="w-4 h-4" /> Sessions <span className="text-xs font-normal">({totalSessions})</span>
          </button>
        </div>

        {/* Blocks sub-filter */}
        {tab === "blocks" && totalBlocks > 0 && (
          <div className="flex items-center gap-2 pb-3">
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {([
                { key: "all", label: `All (${totalBlocks})` },
                { key: "wod", label: `WOD (${enduranceCycles.length})` },
                { key: "run", label: `Run (${runTemplates.length})` },
                { key: "strength", label: `Strength (${masterProgrammes.length + strengthTemplates.length})` },
              ] as { key: BlockFilter; label: string }[]).map(f => (
                <button
                  key={f.key}
                  onClick={() => setBlockFilter(f.key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${blockFilter === f.key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sessions sub-filter + search */}
        {tab === "sessions" && (
          <div className="flex items-center gap-3 pb-3">
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(["all", "wods", "runs"] as SessionFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => { setSessionFilter(f); setSearch(""); }}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${sessionFilter === f ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {f === "all" ? `All (${totalSessions})` : f === "wods" ? `WODs (${wods.length})` : `Runs (${runs.length})`}
                </button>
              ))}
            </div>
            <Input
              placeholder={sessionFilter === "runs" ? "Search runs…" : "Search WODs…"}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-xs rounded-lg h-8 text-sm"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading library…
          </div>
        ) : tab === "blocks" ? (
          <div className="space-y-8">
            {/* WOD blocks: endurance cycles only */}
            {(blockFilter === "all" || blockFilter === "wod") && enduranceCycles.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase mb-3 px-1 flex items-center gap-2">
                  <Brain className="w-3.5 h-3.5 text-purple-500" /> WOD Blocks
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {enduranceCycles.map((c: any) => (
                    <EnduranceCycleCard
                      key={c.id}
                      cycle={c}
                      expanded={expandedId === c.id}
                      onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Run blocks */}
            {(blockFilter === "all" || blockFilter === "run") && runTemplates.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase mb-3 px-1 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-green-500" /> Run Blocks
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {runTemplates.map((t: any) => (
                    <RunTemplateCard
                      key={t.id}
                      template={t}
                      expanded={expandedId === String(t.id)}
                      onToggle={() => setExpandedId(expandedId === String(t.id) ? null : String(t.id))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Strength cycles: master programmes + strength templates */}
            {(blockFilter === "all" || blockFilter === "strength") && (masterProgrammes.length > 0 || strengthTemplates.length > 0) && (
              <div>
                <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase mb-3 px-1 flex items-center gap-2">
                  <Dumbbell className="w-3.5 h-3.5 text-orange-500" /> Strength Cycles
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {masterProgrammes.map((p: any) => (
                    <ProgrammeCard
                      key={p.id}
                      programme={p}
                      expanded={expandedId === String(p.id)}
                      onToggle={() => setExpandedId(expandedId === String(p.id) ? null : String(p.id))}
                    />
                  ))}
                  {strengthTemplates.map((t: any) => (
                    <StrengthBlockCard
                      key={t.id}
                      template={t}
                      expanded={expandedId === t.id}
                      onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {totalBlocks === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <Layers className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">No blocks yet</p>
                <p className="text-xs mt-1 opacity-60">Multi-week programmes and cycles will appear here</p>
              </div>
            )}
          </div>
        ) : (
          /* Sessions tab */
          (() => {
            const showWods = sessionFilter !== "runs";
            const showRuns = sessionFilter !== "wods";
            const visibleWods = showWods ? filteredWods : [];
            const visibleRuns = showRuns ? filteredRuns : [];
            const isEmpty = visibleWods.length === 0 && visibleRuns.length === 0;

            return isEmpty ? (
              <p className="text-sm text-muted-foreground text-center py-10">No sessions found.</p>
            ) : (
              <div className="space-y-8">
                {visibleWods.length > 0 && (
                  <div>
                    {sessionFilter === "all" && (
                      <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase mb-3 px-1 flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-purple-500" /> WODs
                      </h2>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {visibleWods.map(w => (
                        <WodCard key={w.id} wod={w} expanded={expandedId === w.id} onToggle={() => setExpandedId(expandedId === w.id ? null : w.id)} />
                      ))}
                    </div>
                  </div>
                )}
                {visibleRuns.length > 0 && (
                  <div>
                    {sessionFilter === "all" && (
                      <h2 className="text-xs font-bold text-muted-foreground tracking-widest uppercase mb-3 px-1 flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-green-500" /> Runs
                      </h2>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {visibleRuns.map(r => (
                        <RunCard key={r.id} run={r} expanded={expandedId === r.id} onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* Add WOD Dialog */}
      <Dialog open={addWodOpen} onOpenChange={setAddWodOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" /> Add WOD to Library
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="WOD name" value={wodForm.name} onChange={e => setWodForm(f => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={wodForm.format} onValueChange={v => setWodForm(f => ({ ...f, format: v }))}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WOD_FORMATS.map(fmt => <SelectItem key={fmt} value={fmt}>{FORMAT_LABELS[fmt] ?? fmt}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Duration (min)" type="number" value={wodForm.duration} onChange={e => setWodForm(f => ({ ...f, duration: e.target.value }))} />
            </div>
            <Input placeholder="Rounds (optional)" type="number" value={wodForm.rounds} onChange={e => setWodForm(f => ({ ...f, rounds: e.target.value }))} />
            <Input placeholder="Structure description (e.g. AMRAP 10: 200m run, 15 wall balls)" value={wodForm.structure} onChange={e => setWodForm(f => ({ ...f, structure: e.target.value }))} />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Movements</p>
              {wodBlocks.map((block, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input placeholder="Movement" value={block.movement} onChange={e => setWodBlocks(bs => bs.map((b, j) => j === i ? { ...b, movement: e.target.value } : b))} className="flex-1" />
                  <Input placeholder="Amount" type="number" value={block.amount} onChange={e => setWodBlocks(bs => bs.map((b, j) => j === i ? { ...b, amount: e.target.value } : b))} className="w-20" />
                  <Select value={block.unit} onValueChange={v => setWodBlocks(bs => bs.map((b, j) => j === i ? { ...b, unit: v } : b))}>
                    <SelectTrigger className="w-28 rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full rounded-lg" onClick={() => setWodBlocks(bs => [...bs, { movement: "", amount: "", unit: "reps" }])}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Movement
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddWodOpen(false)}>Cancel</Button>
            <Button onClick={saveWod} disabled={savingWod} className="rounded-lg">
              {savingWod ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Save WOD
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Run Dialog */}
      <Dialog open={addRunOpen} onOpenChange={setAddRunOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-green-600" /> Add Run to Library
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Run name" value={runForm.name} onChange={e => setRunForm(f => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={runForm.type} onValueChange={v => setRunForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>{RUN_TYPES.map(t => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={runForm.intensity} onValueChange={v => setRunForm(f => ({ ...f, intensity: v }))}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>{INTENSITIES.map(i => <SelectItem key={i} value={i}>{INTENSITY_LABELS[i] ?? i}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Duration (min)" type="number" value={runForm.duration} onChange={e => setRunForm(f => ({ ...f, duration: e.target.value }))} />
              <Input placeholder="Distance (km)" type="number" value={runForm.distanceKm} onChange={e => setRunForm(f => ({ ...f, distanceKm: e.target.value }))} />
            </div>
            <Input placeholder="Structure / description" value={runForm.structure} onChange={e => setRunForm(f => ({ ...f, structure: e.target.value }))} />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Terrain</p>
              <div className="flex gap-2 flex-wrap">
                {TERRAINS.map(t => (
                  <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={runForm.terrain.includes(t)}
                      onChange={e => setRunForm(f => ({ ...f, terrain: e.target.checked ? [...f.terrain, t] : f.terrain.filter(x => x !== t) }))}
                      className="rounded"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddRunOpen(false)}>Cancel</Button>
            <Button onClick={saveRun} disabled={savingRun} className="rounded-lg">
              {savingRun ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Save Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
