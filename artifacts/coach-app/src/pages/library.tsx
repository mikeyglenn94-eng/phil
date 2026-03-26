import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Brain, Zap, Plus, Trash2, BookOpen, Loader2, ChevronDown, ChevronUp, ArrowLeft, Dumbbell, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const WOD_FORMATS = ["amrap", "emom", "for_time", "interval", "ladder"];
const FORMAT_LABELS: Record<string, string> = { amrap: "AMRAP", emom: "EMOM", for_time: "For Time", interval: "Intervals", ladder: "Ladder" };
const RUN_TYPES = ["easy", "recovery", "intervals", "threshold", "tempo", "steady", "hills", "progression", "fartlek", "long_run"];
const TYPE_LABELS: Record<string, string> = { long_run: "Long Run" };
const INTENSITIES = ["easy", "moderate", "moderate_hard", "hard"];
const INTENSITY_LABELS: Record<string, string> = { easy: "Easy", moderate: "Moderate", moderate_hard: "Moderate / Hard", hard: "Hard" };
const UNITS = ["reps", "m", "km", "cal", "seconds", "minutes"];
const TERRAINS = ["flat", "hill", "rolling", "track"];

type Tab = "wods" | "runs" | "strength";

function typeLabel(t: string) { return TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

function WodCard({ wod, expanded, onToggle }: { wod: any; expanded: boolean; onToggle: () => void }) {
  const blocks = Array.isArray(wod.blocks) ? wod.blocks : [];
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
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

const LIFT_ICONS: Record<string, string> = { squat: "🏋️", bench: "💪", deadlift: "⛓️", olympic: "🥇" };
const LEVEL_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-700",
  intermediate: "bg-amber-100 text-amber-700",
  advanced: "bg-red-100 text-red-700",
};

function StrengthCard({ template, expanded, onToggle }: { template: any; expanded: boolean; onToggle: () => void }) {
  const lifts = (template.liftFocus ?? "").split(",").map((l: string) => l.trim());
  const icons = lifts.map((l: string) => LIFT_ICONS[l] ?? "🏋️").join(" ");
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          <span className="text-xl leading-none mt-0.5 shrink-0">{icons}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
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

export default function Library() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("wods");
  const [search, setSearch] = useState("");
  const [wods, setWods] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [strengthTemplates, setStrengthTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add WOD dialog
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
    ]).then(([wodData, runData, strengthData]) => {
      setWods(wodData.workouts ?? []);
      setRuns(runData.workouts ?? []);
      setStrengthTemplates(strengthData.templates ?? []);
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
          <h1 className="font-bold text-xl">Session Library</h1>
        </div>
        {tab !== "strength" && (
          <Button
            size="sm"
            className="gap-2 rounded-lg"
            onClick={() => tab === "wods" ? setAddWodOpen(true) : setAddRunOpen(true)}
          >
            <Plus className="w-4 h-4" />
            {tab === "wods" ? "Add WOD" : "Add Run"}
          </Button>
        )}
        {tab === "strength" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-2 rounded-lg border-orange-200 text-orange-700 hover:bg-orange-50"
            onClick={() => setLocation("/strength-blocks")}
          >
            <Dumbbell className="w-4 h-4" />
            View Blocks
          </Button>
        )}
      </div>

      {/* Tabs + Search */}
      <div className="shrink-0 border-b px-4 sm:px-6 pt-3 pb-0 bg-background space-y-3">
        <div className="flex gap-1">
          <button
            onClick={() => { setTab("wods"); setSearch(""); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${tab === "wods" ? "border-purple-600 text-purple-700 bg-purple-50" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Brain className="w-4 h-4" /> WODs <span className="text-xs font-normal">({wods.length})</span>
          </button>
          <button
            onClick={() => { setTab("runs"); setSearch(""); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${tab === "runs" ? "border-green-600 text-green-700 bg-green-50" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Zap className="w-4 h-4" /> Runs <span className="text-xs font-normal">({runs.length})</span>
          </button>
          <button
            onClick={() => { setTab("strength"); setSearch(""); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${tab === "strength" ? "border-orange-600 text-orange-700 bg-orange-50" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Dumbbell className="w-4 h-4" /> Strength <span className="text-xs font-normal">({strengthTemplates.length})</span>
          </button>
        </div>
        {tab !== "strength" && (
          <Input
            placeholder={tab === "wods" ? "Search WODs by name, format, or tag…" : "Search runs by name, type, or tag…"}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-sm rounded-lg mb-3"
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading library…
          </div>
        ) : tab === "wods" ? (
          filteredWods.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No WODs found.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredWods.map(w => (
                <WodCard key={w.id} wod={w} expanded={expandedId === w.id} onToggle={() => setExpandedId(expandedId === w.id ? null : w.id)} />
              ))}
            </div>
          )
        ) : tab === "runs" ? (
          filteredRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No runs found.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRuns.map(r => (
                <RunCard key={r.id} run={r} expanded={expandedId === r.id} onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)} />
              ))}
            </div>
          )
        ) : (
          strengthTemplates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No strength programmes yet</p>
              <p className="text-xs mt-1 opacity-60">Programmes you upload will appear here</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {strengthTemplates.map((t: any) => (
                <StrengthCard
                  key={t.id}
                  template={t}
                  expanded={expandedId === t.id}
                  onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                />
              ))}
            </div>
          )
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
            <Input placeholder="Structure description (e.g. AMRAP 10: 200m run, 15 wall balls)" value={wodForm.structure} onChange={e => setWodForm(f => ({ ...f, structure: e.target.value }))} />
            <Input placeholder="Rounds (optional)" type="number" value={wodForm.rounds} onChange={e => setWodForm(f => ({ ...f, rounds: e.target.value }))} />

            <div className="space-y-2">
              <p className="text-sm font-medium">Movement Blocks</p>
              {wodBlocks.map((block, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input className="flex-1" placeholder="Movement (e.g. burpees)" value={block.movement} onChange={e => setWodBlocks(b => b.map((x, j) => j === i ? { ...x, movement: e.target.value } : x))} />
                  <Input className="w-20" placeholder="Amt" type="number" value={block.amount} onChange={e => setWodBlocks(b => b.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                  <Select value={block.unit} onValueChange={v => setWodBlocks(b => b.map((x, j) => j === i ? { ...x, unit: v } : x))}>
                    <SelectTrigger className="w-24 rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                  {wodBlocks.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive shrink-0" onClick={() => setWodBlocks(b => b.filter((_, j) => j !== i))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={() => setWodBlocks(b => [...b, { movement: "", amount: "", unit: "reps" }])}>
                <Plus className="w-3.5 h-3.5" /> Add Movement
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddWodOpen(false)}>Cancel</Button>
            <Button onClick={saveWod} disabled={savingWod || !wodForm.name.trim() || !wodForm.duration || !wodForm.structure} className="bg-purple-600 hover:bg-purple-700">
              {savingWod ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Save WOD
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
            <Input placeholder="Session name" value={runForm.name} onChange={e => setRunForm(f => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={runForm.type} onValueChange={v => setRunForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>{RUN_TYPES.map(t => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={runForm.intensity} onValueChange={v => setRunForm(f => ({ ...f, intensity: v }))}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>{INTENSITIES.map(i => <SelectItem key={i} value={i}>{INTENSITY_LABELS[i]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Duration (min, optional)" type="number" value={runForm.duration} onChange={e => setRunForm(f => ({ ...f, duration: e.target.value }))} />
              <Input placeholder="Distance km (optional)" type="number" value={runForm.distanceKm} onChange={e => setRunForm(f => ({ ...f, distanceKm: e.target.value }))} />
            </div>
            <Input placeholder="Structure (e.g. 10 min easy, 20 min threshold, 10 min easy)" value={runForm.structure} onChange={e => setRunForm(f => ({ ...f, structure: e.target.value }))} />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Terrain</p>
              <div className="flex gap-2 flex-wrap">
                {TERRAINS.map(t => (
                  <button
                    key={t}
                    onClick={() => setRunForm(f => ({ ...f, terrain: f.terrain.includes(t) ? f.terrain.filter(x => x !== t) : [...f.terrain, t] }))}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${runForm.terrain.includes(t) ? "bg-green-100 border-green-300 text-green-700" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRunOpen(false)}>Cancel</Button>
            <Button onClick={saveRun} disabled={savingRun || !runForm.name.trim() || !runForm.structure} className="bg-green-600 hover:bg-green-700">
              {savingRun ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Save Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
