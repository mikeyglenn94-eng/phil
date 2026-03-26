import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, ChevronDown, ChevronUp, Zap, Calendar, Users, Clock,
  Plus, Loader2, CheckCircle, Dumbbell, Mic, Square, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";
import { useListClients } from "@workspace/api-client-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BlockExercise {
  name: string;
  sets: number;
  reps: string;
  percentage: string;
  notes?: string;
}

interface BlockSession {
  dayOfWeek: number;
  name: string;
  exercises: BlockExercise[];
}

interface BlockWeek {
  week: number;
  label: string;
  sessions: BlockSession[];
}

interface Template {
  id: string;
  name: string;
  liftFocus: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  level: "beginner" | "intermediate" | "advanced";
  tags: string[];
  description: string;
  notes: string;
  weeks?: BlockWeek[];
  totalSessions?: number;
}

interface GeneratedSession {
  id: string;
  date: string;
  name: string;
  structure: string;
  exercises: any[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_COLORS = {
  beginner: "bg-green-100 text-green-700",
  intermediate: "bg-amber-100 text-amber-700",
  advanced: "bg-red-100 text-red-700",
};

const LIFT_ICONS: Record<string, string> = {
  squat: "🏋️",
  bench: "💪",
  deadlift: "⛓️",
  olympic: "🥇",
};

function LevelBadge({ level }: { level: Template["level"] }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${LEVEL_COLORS[level]}`}>
      {level}
    </span>
  );
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
      {tag.replace(/-/g, " ")}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Card
// ─────────────────────────────────────────────────────────────────────────────

function TemplateCard({ template, onSelect, onInsert }: {
  template: Template;
  onSelect: () => void;
  onInsert: () => void;
}) {
  const icon = LIFT_ICONS[template.liftFocus] ?? "🏋️";
  return (
    <div className="rounded-2xl border bg-card p-5 flex flex-col gap-3 hover:shadow-md hover:border-primary/30 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5">{icon}</span>
          <div>
            <h3 className="font-bold text-sm leading-snug">{template.name}</h3>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <LevelBadge level={template.level} />
              <span className="text-[11px] text-muted-foreground">
                {template.durationWeeks}w · {template.sessionsPerWeek}×/wk
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{template.description}</p>

      <div className="flex flex-wrap gap-1">
        {template.tags.slice(0, 4).map(tag => <TagBadge key={tag} tag={tag} />)}
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1 rounded-xl text-xs h-8" onClick={onSelect}>
          View Block
        </Button>
        <Button size="sm" className="flex-1 rounded-xl text-xs h-8 gap-1" onClick={onInsert}>
          <Plus className="w-3.5 h-3.5" /> Insert
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Week Accordion
// ─────────────────────────────────────────────────────────────────────────────

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeekAccordion({ week }: { week: BlockWeek }) {
  const [open, setOpen] = useState(week.week <= 2);
  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-semibold">{week.label}</span>
        <span className="text-muted-foreground">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>
      {open && (
        <div className="divide-y">
          {week.sessions.map((session, si) => (
            <div key={si} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-muted-foreground w-8 shrink-0">{DAY_NAMES[session.dayOfWeek]}</span>
                <span className="text-sm font-medium">{session.name}</span>
              </div>
              <div className="pl-10 space-y-1">
                {session.exercises.map((ex, ei) => (
                  <div key={ei} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Dumbbell className="w-3 h-3 mt-0.5 shrink-0 text-primary/50" />
                    <span>
                      <span className="font-medium text-foreground">{ex.name}</span>
                      {" "}— {ex.sets}×{ex.reps} @ <span className="font-semibold text-primary">{ex.percentage}</span>
                      {ex.notes && <span className="text-muted-foreground"> · {ex.notes}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert Dialog
// ─────────────────────────────────────────────────────────────────────────────

function InsertDialog({
  open,
  onClose,
  template,
  clients,
}: {
  open: boolean;
  onClose: () => void;
  template: Template | null;
  clients: { id: number; name: string }[];
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [clientId, setClientId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [previewSessions, setPreviewSessions] = useState<GeneratedSession[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [done, setDone] = useState(false);
  const [insertedClientId, setInsertedClientId] = useState<number | null>(null);

  // NLP state
  const [nlpInput, setNlpInput] = useState("");
  const [nlpLoading, setNlpLoading] = useState(false);
  const [nlpResult, setNlpResult] = useState<any>(null);

  // Voice
  const recognitionRef = useRef<any>(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!open) { setDone(false); setPreviewSessions([]); setNlpResult(null); setNlpInput(""); }
  }, [open]);

  useEffect(() => {
    if (template && clientId && startDate) loadPreview();
  }, [template, clientId, startDate]);

  async function loadPreview() {
    if (!template || !startDate) return;
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/strength-blocks/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, startDate }),
      });
      const data = await res.json();
      setPreviewSessions(data.sessions ?? []);
    } catch {
      setPreviewSessions([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleInsert() {
    if (!template || !clientId || !startDate) return;
    setInserting(true);
    try {
      const res = await fetch("/api/strength-blocks/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, clientId, startDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInsertedClientId(clientId);
      setDone(true);
      toast({ title: "Block inserted!", description: `${data.sessionCount} sessions added to the calendar.` });
    } catch (err: any) {
      toast({ title: "Insert failed", description: err.message, variant: "destructive" });
    } finally {
      setInserting(false);
    }
  }

  async function handleNlp() {
    if (!nlpInput.trim()) return;
    setNlpLoading(true);
    setNlpResult(null);
    try {
      const res = await fetch("/api/strength-blocks/nlp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: nlpInput, clients }),
      });
      const data = await res.json();
      setNlpResult(data);
      if (data.clientId) setClientId(data.clientId);
      if (data.startDate) setStartDate(data.startDate);
    } catch {
      toast({ title: "Could not parse command", variant: "destructive" });
    } finally {
      setNlpLoading(false);
    }
  }

  function startVoice() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.lang = "en-GB";
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setNlpInput(text);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  if (!template) return null;

  const selectedClient = clients.find(c => c.id === clientId);

  // Group preview sessions by week label
  const sessionsByWeek: Record<string, GeneratedSession[]> = {};
  for (const s of previewSessions) {
    const label = s.structure || "Sessions";
    if (!sessionsByWeek[label]) sessionsByWeek[label] = [];
    sessionsByWeek[label].push(s);
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {done ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <CheckCircle className="w-14 h-14 text-green-500" />
            <div>
              <h2 className="text-xl font-bold mb-1">Block Inserted!</h2>
              <p className="text-sm text-muted-foreground">
                {template.name} has been added to {selectedClient?.name ?? "the client"}'s calendar.
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              {insertedClientId && (
                <Button onClick={() => { onClose(); setLocation(`/clients/${insertedClientId}`); }}>
                  View Calendar <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Insert — {template.name}
              </DialogTitle>
              <DialogDescription>
                {template.durationWeeks} weeks · {template.sessionsPerWeek} sessions/week · {template.level}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">

              {/* NLP command bar */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Natural Language Command</label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center border rounded-xl px-3 gap-2 bg-muted/30">
                    <Input
                      className="border-0 bg-transparent focus-visible:ring-0 px-0 text-sm h-9"
                      placeholder={`e.g. "Insert into Keeley starting March 30"`}
                      value={nlpInput}
                      onChange={e => setNlpInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleNlp()}
                    />
                    <button onClick={listening ? stopVoice : startVoice} className="shrink-0 p-1 rounded-lg hover:bg-muted transition-colors">
                      {listening ? <Square className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                  <Button size="sm" className="rounded-xl h-9 px-3" onClick={handleNlp} disabled={!nlpInput.trim() || nlpLoading}>
                    {nlpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Go"}
                  </Button>
                </div>
                {nlpResult && (
                  <div className={`rounded-xl px-3 py-2 text-xs ${nlpResult.confidence === "high" ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                    {nlpResult.summary || "Resolved from command"}
                    {nlpResult.missingInfo?.length > 0 && (
                      <div className="mt-1 text-amber-700">Still needed: {nlpResult.missingInfo.join(", ")}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t" />

              {/* Client selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client</label>
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                  {clients.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setClientId(c.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-left ${
                        clientId === c.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/40 hover:bg-muted/50"
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                        {c.name.charAt(0)}
                      </div>
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
                {!clients.length && <p className="text-sm text-muted-foreground">No clients found. Add clients first.</p>}
              </div>

              {/* Start date */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Start Week (Monday)</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full rounded-xl"
                />
                <p className="text-[11px] text-muted-foreground">Sessions will be scheduled from the Monday of this week.</p>
              </div>

              {/* Preview */}
              {clientId && startDate && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Session Preview
                    {previewLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  </label>
                  {!previewLoading && previewSessions.length > 0 && (
                    <div className="border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                      {Object.entries(sessionsByWeek).slice(0, 4).map(([weekLabel, sessions]) => (
                        <div key={weekLabel} className="border-b last:border-b-0">
                          <div className="px-3 py-1.5 bg-muted/30 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                            {weekLabel.split(" — ")[1] ?? weekLabel}
                          </div>
                          {sessions.map(s => (
                            <div key={s.id} className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0">
                              <span className="text-[11px] text-muted-foreground w-20 shrink-0 font-medium">
                                {format(parseISO(s.date), "EEE d MMM")}
                              </span>
                              <span className="text-xs font-medium truncate">{s.name}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {Object.keys(sessionsByWeek).length > 4 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                          +{previewSessions.length - Object.values(sessionsByWeek).slice(0,4).flat().length} more sessions...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={handleInsert}
                disabled={!clientId || !startDate || inserting}
                className="gap-1.5"
              >
                {inserting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Insert {previewSessions.length > 0 ? `${previewSessions.length} Sessions` : "Block"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function StrengthBlocks() {
  const [, setLocation] = useLocation();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [detailTemplate, setDetailTemplate] = useState<Template | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [insertDialogOpen, setInsertDialogOpen] = useState(false);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterDays, setFilterDays] = useState<number | null>(null);

  const { data: clientsData } = useListClients();
  const clients = (clientsData ?? []).map((c: any) => ({ id: c.id, name: c.name }));

  useEffect(() => {
    fetch("/api/strength-blocks/templates")
      .then(r => r.json())
      .then(d => { setTemplates(d.templates ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function openDetail(template: Template) {
    setDetailLoading(true);
    setDetailTemplate(null);
    try {
      const res = await fetch(`/api/strength-blocks/templates/${template.id}`);
      const data = await res.json();
      setDetailTemplate(data.template);
    } finally {
      setDetailLoading(false);
    }
  }

  function openInsert(template: Template) {
    setSelectedTemplate(template);
    setInsertDialogOpen(true);
  }

  const filtered = templates.filter(t => {
    if (filterLevel !== "all" && t.level !== filterLevel) return false;
    if (filterDays !== null && t.sessionsPerWeek !== filterDays) return false;
    return true;
  });

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (detailTemplate || detailLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-background">
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b bg-background">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => setDetailTemplate(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base truncate">{detailTemplate?.name ?? "Loading…"}</h1>
            {detailTemplate && (
              <p className="text-xs text-muted-foreground">
                {detailTemplate.durationWeeks} weeks · {detailTemplate.sessionsPerWeek}×/wk · {detailTemplate.level}
              </p>
            )}
          </div>
          {detailTemplate && (
            <Button size="sm" className="rounded-xl gap-1.5 shrink-0" onClick={() => openInsert(detailTemplate)}>
              <Plus className="w-3.5 h-3.5" /> Insert
            </Button>
          )}
        </div>

        {detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : detailTemplate ? (
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 max-w-2xl mx-auto w-full">
            {/* Description + stats */}
            <div className="rounded-2xl border bg-card p-5 space-y-3">
              <div className="flex flex-wrap gap-1.5 items-center">
                <LevelBadge level={detailTemplate.level} />
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" />{detailTemplate.durationWeeks} weeks
                </span>
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Calendar className="w-3 h-3" />{detailTemplate.sessionsPerWeek}×/week
                </span>
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Dumbbell className="w-3 h-3" />{detailTemplate.liftFocus}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{detailTemplate.description}</p>
              {detailTemplate.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-amber-800 leading-relaxed">⚠️ {detailTemplate.notes}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-1 pt-1">
                {detailTemplate.tags.map(tag => <TagBadge key={tag} tag={tag} />)}
              </div>
            </div>

            {/* Week-by-week breakdown */}
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Programme Schedule</h2>
              <div className="space-y-2">
                {(detailTemplate.weeks ?? []).map(week => (
                  <WeekAccordion key={week.week} week={week} />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Library view ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b bg-background">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-base">Strength Blocks</h1>
          <p className="text-xs text-muted-foreground">Insert a structured squat cycle into any client's calendar</p>
        </div>
        <Button
          size="sm"
          className="rounded-xl gap-1.5 shrink-0"
          onClick={() => { setSelectedTemplate(templates[0] ?? null); setInsertDialogOpen(true); }}
          disabled={!templates.length}
        >
          <Zap className="w-3.5 h-3.5" /> Quick Insert
        </Button>
      </div>

      {/* Filters */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b overflow-x-auto">
        {(["all", "beginner", "intermediate", "advanced"] as const).map(lvl => (
          <button
            key={lvl}
            onClick={() => setFilterLevel(lvl)}
            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              filterLevel === lvl ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {lvl === "all" ? "All" : lvl.charAt(0).toUpperCase() + lvl.slice(1)}
          </button>
        ))}
        <div className="w-px h-4 bg-border mx-1 shrink-0" />
        {[3, 4].map(days => (
          <button
            key={days}
            onClick={() => setFilterDays(filterDays === days ? null : days)}
            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              filterDays === days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {days}×/wk
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Zap className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No blocks match your filter</p>
            <p className="text-xs mt-1 opacity-60">Try removing a filter</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
              {filtered.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onSelect={() => openDetail(t)}
                  onInsert={() => openInsert(t)}
                />
              ))}
            </div>

            {/* Coming soon hint */}
            <div className="max-w-3xl mx-auto mt-6 rounded-2xl border border-dashed p-5 text-center text-muted-foreground">
              <p className="text-sm font-medium mb-1">More blocks coming soon</p>
              <p className="text-xs opacity-70">Bench press cycles, deadlift blocks, Olympic lifting programmes, and hybrid prep blocks will be added to the library.</p>
            </div>
          </>
        )}
      </div>

      {/* Insert Dialog */}
      <InsertDialog
        open={insertDialogOpen}
        onClose={() => setInsertDialogOpen(false)}
        template={selectedTemplate}
        clients={clients}
      />
    </div>
  );
}
