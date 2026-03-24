import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Save, Loader2, CheckCircle2, Clock, Repeat, Zap,
  Mic, Square, Volume2, ArrowLeftRight, X, Check, Plus, Send,
} from "lucide-react";
import {
  useGetProgramme,
  useUpdateProgramme,
  getListProgrammesQueryKey,
  parseLog,
  parseTranscript,
} from "@workspace/api-client-react";
import type { Exercise, Session } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

interface SetLog { weight: number | null; reps: number | null; }
type LogState = Record<string, SetLog[]>;

// Extract a clean exercise name from spoken swap commands
function extractSwapName(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const patterns = [
    /(?:swap(?:ped)?|replace(?:d)?|change(?:d)?) .*? (?:for|with|to) (.+)/i,
    /(?:for|with|to) (.+)/i,
  ];
  for (const p of patterns) {
    const m = lower.match(p);
    if (m?.[1]) return toTitleCase(m[1].trim());
  }
  return toTitleCase(raw.trim());
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

export default function ClientSession() {
  const [, params] = useRoute("/client/programmes/:programmeId/sessions/:sessionId");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const programmeId = parseInt(params?.programmeId || "0", 10);
  const sessionId = params?.sessionId;

  const { data: programme, isLoading } = useGetProgramme(programmeId, {
    query: { enabled: !!programmeId },
  });
  const updateMutation = useUpdateProgramme();

  const session = useMemo<Session | null>(() => {
    if (!programme?.sessions) return null;
    return programme.sessions.find((s: Session) => s.id === sessionId) || null;
  }, [programme, sessionId]);

  // Local name overrides for swapped exercises
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogState>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Swap UI state
  const [swappingExId, setSwappingExId] = useState<string | null>(null);
  const [swapText, setSwapText] = useState("");
  const [swapListening, setSwapListening] = useState(false);
  const [swapInterim, setSwapInterim] = useState("");
  const swapRecRef = useRef<any>(null);

  // Add exercise state
  const [addedExercises, setAddedExercises] = useState<Exercise[]>([]);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addListening, setAddListening] = useState(false);
  const [addInterim, setAddInterim] = useState("");
  const [isParsingAdd, setIsParsingAdd] = useState(false);
  const addRecRef = useRef<any>(null);

  // Voice log state
  const [listeningFor, setListeningFor] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");
  const [parsingFor, setParsingFor] = useState<string | null>(null);
  const logRecRef = useRef<any>(null);

  // Init logs from saved data
  useEffect(() => {
    if (!session) return;
    const initial: LogState = {};
    for (const ex of session.exercises || []) {
      initial[ex.id] = Array.from({ length: ex.sets || 0 }, (_, i) => ({
        weight: ex.setWeights?.[i] ?? null,
        reps: ex.setReps?.[i] ?? null,
      }));
    }
    setLogs(initial);
    setNameOverrides({});
  }, [session]);

  // Set up log voice recognition
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInterimText(interim || fin);
      if (fin) r.finalAccumulator = (r.finalAccumulator || "") + " " + fin;
    };
    r.shouldBeListening = false;
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "audio-capture") {
        r.shouldBeListening = false;
        setListeningFor(null); setInterimText("");
      }
      // no-speech / network timeouts: let onend handle restart
    };
    r.onend = async () => {
      if (r.shouldBeListening) {
        // Browser silence timeout — restart seamlessly
        try { r.start(); } catch {}
        return;
      }
      const exId = r.currentExId;
      const final = ((r.finalAccumulator || "") + " " + (interimText || "")).trim();
      setListeningFor(null); setInterimText(""); r.finalAccumulator = "";
      if (!final || !exId || !session) return;
      const ex = session.exercises?.find((e: Exercise) => e.id === exId);
      if (!ex) return;
      setParsingFor(exId);
      try {
        const result = await parseLog({ transcript: final, exerciseName: nameOverrides[exId] || ex.name, totalSets: ex.sets || 0 });
        setLogs(prev => {
          const current = [...(prev[exId] || [])];
          for (const s of result.sets) {
            if (s.setIndex < current.length) {
              current[s.setIndex] = {
                weight: s.weight !== undefined ? s.weight : current[s.setIndex]?.weight ?? null,
                reps: s.reps !== undefined ? s.reps : current[s.setIndex]?.reps ?? null,
              };
            }
          }
          return { ...prev, [exId]: current };
        });
        setSaved(false);
        toast({ title: "Log parsed!" });
      } catch {
        toast({ title: "Couldn't parse log — try again", variant: "destructive" });
      } finally { setParsingFor(null); }
    };
    logRecRef.current = r;
    return () => { r.abort(); };
  }, [session, nameOverrides, toast]);

  // Set up swap voice recognition (separate instance)
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (fin) { setSwapText(fin.trim()); setSwapInterim(""); }
      else setSwapInterim(interim);
    };
    r.onerror = () => { setSwapListening(false); setSwapInterim(""); };
    r.onend = () => { setSwapListening(false); setSwapInterim(""); };
    swapRecRef.current = r;
    return () => { r.abort(); };
  }, []);

  // Set up add-exercise voice recognition
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (fin) { setAddInput(fin.trim()); setAddInterim(""); }
      else setAddInterim(interim);
    };
    r.onerror = () => { setAddListening(false); setAddInterim(""); };
    r.onend = () => { setAddListening(false); setAddInterim(""); };
    addRecRef.current = r;
    return () => { r.abort(); };
  }, []);

  const startAddListening = () => {
    const r = addRecRef.current;
    if (!r) { toast({ title: "Voice not supported in this browser", variant: "destructive" }); return; }
    if (addListening) { r.stop(); return; }
    setAddInterim(""); setAddInput("");
    try { r.start(); setAddListening(true); } catch {}
  };

  const submitAddInput = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIsParsingAdd(true);
    const allCurrentExercises = [...(session?.exercises || []), ...addedExercises];
    try {
      const result = await parseTranscript({ transcript: trimmed, existingExercises: allCurrentExercises });
      const newExercises = (result.exercises || []).filter(
        ex => !allCurrentExercises.some(existing => existing.id === ex.id)
      );
      if (newExercises.length === 0) {
        toast({ title: "Couldn't identify an exercise — try again", variant: "destructive" });
        return;
      }
      // Init empty logs for each new exercise
      const newLogs: LogState = {};
      for (const ex of newExercises) {
        newLogs[ex.id] = Array.from({ length: ex.sets || 0 }, () => ({ weight: null, reps: null }));
      }
      setAddedExercises(prev => [...prev, ...newExercises]);
      setLogs(prev => ({ ...prev, ...newLogs }));
      setAddInput("");
      setAddPanelOpen(false);
      setSaved(false);
      toast({
        title: newExercises.length === 1
          ? `Added "${newExercises[0].name}"`
          : `Added ${newExercises.length} exercises`,
      });
    } catch {
      toast({ title: "Failed to parse exercise — try again", variant: "destructive" });
    } finally {
      setIsParsingAdd(false);
    }
  };

  const removeAddedExercise = (exId: string) => {
    setAddedExercises(prev => prev.filter(e => e.id !== exId));
    setLogs(prev => { const n = { ...prev }; delete n[exId]; return n; });
    setSaved(false);
  };

  const startLogListening = (exId: string) => {
    const r = logRecRef.current;
    if (!r) { toast({ title: "Voice not supported", variant: "destructive" }); return; }
    if (listeningFor) {
      r.shouldBeListening = false;
      r.stop();
      return;
    }
    r.finalAccumulator = ""; r.currentExId = exId;
    r.shouldBeListening = true;
    setInterimText("");
    try { r.start(); setListeningFor(exId); } catch {}
  };

  const startSwapListening = () => {
    const r = swapRecRef.current;
    if (!r) return;
    if (swapListening) { r.stop(); return; }
    setSwapInterim(""); setSwapText("");
    try { r.start(); setSwapListening(true); } catch {}
  };

  const confirmSwap = (exId: string) => {
    const name = extractSwapName(swapText.trim());
    if (!name) return;
    setNameOverrides(prev => ({ ...prev, [exId]: name }));
    // Reset logs for this exercise since it's a different exercise
    setLogs(prev => {
      const setsCount = session?.exercises?.find((e: Exercise) => e.id === exId)?.sets || 0;
      return { ...prev, [exId]: Array.from({ length: setsCount }, () => ({ weight: null, reps: null })) };
    });
    setSaved(false);
    setSwappingExId(null);
    setSwapText("");
    toast({ title: `Exercise swapped to "${name}"` });
  };

  const cancelSwap = () => { setSwappingExId(null); setSwapText(""); setSwapInterim(""); swapRecRef.current?.stop(); };

  const handleFieldChange = (exId: string, setIdx: number, field: "weight" | "reps", raw: string) => {
    const num = raw === "" ? null : parseFloat(raw);
    setLogs(prev => {
      const current = [...(prev[exId] || [])];
      current[setIdx] = { ...current[setIdx], [field]: isNaN(num as number) ? null : num };
      return { ...prev, [exId]: current };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!programme || !session) return;
    setIsSaving(true);
    try {
      const updatedSessions = (programme.sessions || []).map((s: Session) => {
        if (s.id !== sessionId) return s;
        const originalExercises = (s.exercises || []).map((ex: Exercise) => ({
          ...ex,
          name: nameOverrides[ex.id] || ex.name,
          setWeights: (logs[ex.id] || []).map(l => l.weight),
          setReps: (logs[ex.id] || []).map(l => l.reps),
        }));
        const extraExercises = addedExercises.map(ex => ({
          ...ex,
          setWeights: (logs[ex.id] || []).map(l => l.weight),
          setReps: (logs[ex.id] || []).map(l => l.reps),
        }));
        return { ...s, exercises: [...originalExercises, ...extraExercises] };
      });
      await updateMutation.mutateAsync({ id: programmeId, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      setSaved(true);
      toast({ title: "Session saved!" });
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
    } finally { setIsSaving(false); }
  };

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!session) return (
    <div className="flex h-screen items-center justify-center flex-col gap-4">
      <p className="text-muted-foreground">Session not found.</p>
      <Button variant="outline" onClick={() => setLocation("/client")}>Back</Button>
    </div>
  );

  const safeDate = session.date || format(new Date(), "yyyy-MM-dd");
  const dateLabel = format(parseISO(safeDate), "EEEE, d MMMM yyyy");
  const totalSets = (session.exercises || []).reduce((acc, ex) => acc + (ex.sets || 0), 0);
  const loggedSets = (session.exercises || []).reduce((acc, ex) => {
    return acc + (logs[ex.id] || []).filter(l => l.weight !== null || l.reps !== null).length;
  }, 0);

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/client")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{dateLabel}</p>
              <h1 className="font-bold text-lg leading-tight truncate">{session.name || "Session"}</h1>
            </div>
          </div>
          <Button
            onClick={handleSave} disabled={isSaving}
            className={`rounded-xl px-5 gap-2 shrink-0 ${saved ? "bg-green-600 hover:bg-green-700" : ""}`}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
        {totalSets > 0 && (
          <div className="max-w-lg mx-auto px-4 pb-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{loggedSets} / {totalSets} sets logged</span>
              <span>{Math.round((loggedSets / totalSets) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${(loggedSets / totalSets) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Log voice listening banner */}
      {listeningFor && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <div className="bg-primary/5 border border-primary/30 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="relative"><span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" /><Volume2 className="w-5 h-5 text-primary relative z-10" /></span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-primary">Listening...</p>
              <p className="text-xs text-muted-foreground truncate italic">{interimText || "Speak your results..."}</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 rounded-xl" onClick={() => {
              const r = logRecRef.current;
              if (r) { r.shouldBeListening = false; r.stop(); }
            }}>
              <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />Done
            </Button>
          </div>
        </div>
      )}

      {/* Exercises */}
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">
        {(session.exercises || []).map((ex, exIdx) => {
          const setsCount = ex.sets || 0;
          const exLogs = logs[ex.id] || [];
          const isListening = listeningFor === ex.id;
          const isParsing = parsingFor === ex.id;
          const isSwapping = swappingExId === ex.id;
          const displayName = nameOverrides[ex.id] || ex.name;
          const wasSwapped = !!nameOverrides[ex.id];
          const loggedCount = exLogs.filter(l => l.weight !== null || l.reps !== null).length;
          const allLogged = setsCount > 0 && loggedCount === setsCount;

          return (
            <div key={ex.id} className={`bg-card rounded-2xl border shadow-sm overflow-hidden transition-all ${isListening ? "ring-2 ring-primary/50" : ""} ${isSwapping ? "ring-2 ring-orange-400/60" : ""}`}>
              {/* Exercise header */}
              <div className="px-4 pt-4 pb-3 border-b bg-muted/20">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${allLogged ? "bg-green-100 text-green-700" : "bg-primary/10 text-primary"}`}>
                      {allLogged ? "✓" : exIdx + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-bold text-base leading-tight">{displayName}</h3>
                      {wasSwapped && (
                        <p className="text-[10px] text-orange-600 font-medium flex items-center gap-1 mt-0.5">
                          <ArrowLeftRight className="w-2.5 h-2.5" /> swapped from {ex.name}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Swap button */}
                    <Button
                      size="sm" variant="ghost"
                      className={`rounded-xl gap-1 h-8 px-2 text-xs ${isSwapping ? "text-orange-600 bg-orange-50" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => { if (isSwapping) { cancelSwap(); } else { setSwappingExId(ex.id); setSwapText(""); } }}
                      disabled={isParsing || (!!listeningFor && !isListening)}
                    >
                      {isSwapping ? <X className="w-3.5 h-3.5" /> : <ArrowLeftRight className="w-3.5 h-3.5" />}
                      {isSwapping ? "Cancel" : "Swap"}
                    </Button>

                    {/* Log voice button */}
                    {!isSwapping && (
                      <Button
                        size="sm"
                        variant={isListening ? "default" : "outline"}
                        className={`rounded-xl gap-1.5 h-8 px-3 text-xs ${isListening ? "bg-destructive hover:bg-destructive/90 text-white border-0" : ""}`}
                        onClick={() => isListening ? logRecRef.current?.stop() : startLogListening(ex.id)}
                        disabled={isParsing || (!!listeningFor && !isListening)}
                      >
                        {isParsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                          isListening ? <><Square className="w-3 h-3 fill-current" /> Stop</> :
                          <><Mic className="w-3.5 h-3.5" /> Log</>}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Meta tags */}
                <div className="flex flex-wrap gap-1.5 mt-2 ml-8">
                  {ex.perSetReps && ex.perSetReps.length > 0
                    ? <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.perSetReps.join("/")} reps</span>
                    : ex.sets && ex.reps && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.sets} × {ex.reps}</span>}
                  {!ex.perSetRpe?.length && ex.rpe && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Zap className="w-3 h-3" />RPE {ex.rpe}</span>}
                  {ex.rest && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Clock className="w-3 h-3" />Rest {ex.rest}</span>}
                </div>
                {ex.notes && <p className="text-xs text-muted-foreground mt-1.5 ml-8 italic">{ex.notes}</p>}
              </div>

              {/* Swap input panel */}
              {isSwapping && (
                <div className="px-4 py-4 bg-orange-50/60 border-b border-orange-100">
                  <p className="text-xs font-semibold text-orange-700 mb-2 flex items-center gap-1.5">
                    <ArrowLeftRight className="w-3.5 h-3.5" /> What did you swap to?
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        value={swapListening ? (swapInterim || swapText) : swapText}
                        onChange={e => setSwapText(e.target.value)}
                        placeholder={swapListening ? "Listening..." : "New exercise name or say 'I swapped X for Y'"}
                        className="pr-10 rounded-xl bg-white"
                        autoFocus={!swapListening}
                        onKeyDown={e => e.key === "Enter" && swapText.trim() && confirmSwap(ex.id)}
                        disabled={swapListening}
                      />
                      <button
                        className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors ${swapListening ? "text-destructive bg-destructive/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                        onClick={startSwapListening}
                        type="button"
                      >
                        {swapListening
                          ? <><span className="absolute inset-0 rounded-lg bg-destructive/20 animate-ping" /><Square className="w-3.5 h-3.5 fill-current relative z-10" /></>
                          : <Mic className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <Button
                      size="sm"
                      className="rounded-xl gap-1.5 bg-orange-600 hover:bg-orange-700 text-white shrink-0"
                      disabled={!swapText.trim() && !swapInterim}
                      onClick={() => confirmSwap(ex.id)}
                    >
                      <Check className="w-3.5 h-3.5" /> Confirm
                    </Button>
                  </div>
                  <p className="text-[10px] text-orange-600/70 mt-1.5">
                    Tip: say <em>"pec deck machine"</em> or <em>"I swapped flyes for pec deck"</em>
                  </p>
                </div>
              )}

              {/* Set rows */}
              <div className="px-4 py-3">
                {isParsing ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />Parsing your log...
                  </div>
                ) : setsCount === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-2">No sets defined</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-1 mb-1">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Set</span>
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-center">Weight (kg)</span>
                      <div className="text-center">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Reps done</span>
                        {ex.perSetReps && ex.perSetReps.length > 0 ? (
                          <span className="block text-[10px] text-primary/60 font-semibold normal-case tracking-normal -mt-0.5">varies per set</span>
                        ) : ex.reps ? (
                          <span className="block text-[10px] text-primary/60 font-semibold normal-case tracking-normal -mt-0.5">target: {ex.reps}</span>
                        ) : null}
                      </div>
                    </div>
                    {Array.from({ length: setsCount }, (_, setIdx) => {
                      const log = exLogs[setIdx] || { weight: null, reps: null };
                      const isDone = log.weight !== null || log.reps !== null;
                      const perSetTarget = ex.perSetReps?.[setIdx];
                      const perSetRpeTarget = ex.perSetRpe?.[setIdx];
                      return (
                        <div key={setIdx} className={`grid grid-cols-[3rem_1fr_1fr] gap-2 items-center rounded-xl px-2 py-1.5 transition-colors ${isDone ? "bg-primary/5 border border-primary/20" : "bg-muted/40"}`}>
                          <div className={`text-sm font-bold pl-1 leading-tight ${isDone ? "text-primary" : "text-muted-foreground"}`}>
                            <div>{setIdx + 1}{isDone && <span className="ml-0.5">✓</span>}</div>
                            {perSetRpeTarget && <div className="text-[9px] font-semibold text-muted-foreground normal-case">RPE {perSetRpeTarget}</div>}
                          </div>
                          <Input
                            type="number" inputMode="decimal" step="0.5" min="0"
                            placeholder="—"
                            value={log.weight ?? ""}
                            onChange={e => handleFieldChange(ex.id, setIdx, "weight", e.target.value)}
                            className={`h-10 text-center text-base font-bold border-0 shadow-none bg-transparent focus:bg-background rounded-lg ${isDone ? "text-primary" : ""}`}
                          />
                          <div className="relative">
                            <Input
                              type="number" inputMode="numeric" step="1" min="0"
                              placeholder={perSetTarget || ex.reps || "—"}
                              value={log.reps ?? ""}
                              onChange={e => handleFieldChange(ex.id, setIdx, "reps", e.target.value)}
                              className={`h-10 text-center text-base font-bold border-0 shadow-none bg-transparent focus:bg-background rounded-lg ${isDone ? "text-primary" : ""}`}
                            />
                            {perSetTarget && (
                              <span className="absolute -bottom-3.5 left-0 right-0 text-center text-[9px] text-primary/50 font-semibold pointer-events-none">
                                target: {perSetTarget}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {(!session.exercises || session.exercises.length === 0) && addedExercises.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">No exercises in this session.</div>
        )}

        {/* Added exercises (client-added) */}
        {addedExercises.map((ex, exIdx) => {
          const setsCount = ex.sets || 0;
          const exLogs = logs[ex.id] || [];
          const loggedCount = exLogs.filter(l => l.weight !== null || l.reps !== null).length;
          const allLogged = setsCount > 0 && loggedCount === setsCount;
          const totalIdx = (session.exercises?.length || 0) + exIdx;

          return (
            <div key={ex.id} className="bg-card rounded-2xl border border-dashed border-primary/40 shadow-sm overflow-hidden">
              <div className="px-4 pt-4 pb-3 border-b bg-primary/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${allLogged ? "bg-green-100 text-green-700" : "bg-primary/20 text-primary"}`}>
                      {allLogged ? "✓" : totalIdx + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-bold text-base leading-tight">{ex.name}</h3>
                      <p className="text-[10px] text-primary/60 font-medium mt-0.5 flex items-center gap-1">
                        <Plus className="w-2.5 h-2.5" /> added by you
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => removeAddedExercise(ex.id)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 ml-8">
                  {ex.perSetReps && ex.perSetReps.length > 0
                    ? <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.perSetReps.join("/")} reps</span>
                    : ex.sets && ex.reps && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.sets} × {ex.reps}</span>}
                  {!ex.perSetRpe?.length && ex.rpe && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Zap className="w-3 h-3" />RPE {ex.rpe}</span>}
                  {ex.rest && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Clock className="w-3 h-3" />Rest {ex.rest}</span>}
                </div>
                {ex.notes && <p className="text-xs text-muted-foreground mt-1.5 ml-8 italic">{ex.notes}</p>}
              </div>

              <div className="px-4 py-3">
                {setsCount === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-2">No sets defined</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-1 mb-1">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Set</span>
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-center">Weight (kg)</span>
                      <div className="text-center">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Reps done</span>
                        {ex.reps && (
                          <span className="block text-[10px] text-primary/60 font-semibold normal-case tracking-normal -mt-0.5">
                            target: {ex.reps}
                          </span>
                        )}
                      </div>
                    </div>
                    {Array.from({ length: setsCount }, (_, setIdx) => {
                      const log = exLogs[setIdx] || { weight: null, reps: null };
                      const isDone = log.weight !== null || log.reps !== null;
                      return (
                        <div key={setIdx} className={`grid grid-cols-[3rem_1fr_1fr] gap-2 items-center rounded-xl px-2 py-1.5 ${isDone ? "bg-primary/5 border border-primary/20" : "bg-muted/40"}`}>
                          <div className={`text-sm font-bold pl-1 ${isDone ? "text-primary" : "text-muted-foreground"}`}>
                            {setIdx + 1}{isDone && <span className="ml-0.5">✓</span>}
                          </div>
                          <Input
                            type="number" inputMode="decimal" step="0.5" min="0"
                            placeholder="—"
                            value={log.weight ?? ""}
                            onChange={e => handleFieldChange(ex.id, setIdx, "weight", e.target.value)}
                            className={`h-10 text-center text-base font-bold border-0 shadow-none bg-transparent focus:bg-background rounded-lg ${isDone ? "text-primary" : ""}`}
                          />
                          <Input
                            type="number" inputMode="numeric" step="1" min="0"
                            placeholder={ex.reps || "—"}
                            value={log.reps ?? ""}
                            onChange={e => handleFieldChange(ex.id, setIdx, "reps", e.target.value)}
                            className={`h-10 text-center text-base font-bold border-0 shadow-none bg-transparent focus:bg-background rounded-lg ${isDone ? "text-primary" : ""}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Exercise panel */}
        {addPanelOpen ? (
          <div className="bg-card rounded-2xl border-2 border-dashed border-primary/30 overflow-hidden">
            <div className="px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold flex items-center gap-2">
                  <Plus className="w-4 h-4 text-primary" /> Add an exercise
                </p>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-lg text-muted-foreground" onClick={() => { setAddPanelOpen(false); setAddInput(""); addRecRef.current?.stop(); }}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={addListening ? (addInterim || addInput) : addInput}
                    onChange={e => setAddInput(e.target.value)}
                    placeholder={addListening ? "Listening…" : 'e.g. "pull-ups 3x10" or "3 sets of cable flyes RPE 8"'}
                    className="pr-10 rounded-xl"
                    disabled={addListening || isParsingAdd}
                    autoFocus={!addListening}
                    onKeyDown={e => e.key === "Enter" && !addListening && submitAddInput(addInput)}
                  />
                  <button
                    type="button"
                    onClick={startAddListening}
                    disabled={isParsingAdd}
                    className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors ${addListening ? "text-destructive bg-destructive/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                  >
                    {addListening
                      ? <Square className="w-3.5 h-3.5 fill-current" />
                      : <Mic className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <Button
                  className="rounded-xl gap-1.5 shrink-0"
                  disabled={(!addInput.trim() && !addInterim) || isParsingAdd}
                  onClick={() => submitAddInput(addInput)}
                >
                  {isParsingAdd
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Send className="w-4 h-4" />}
                  {isParsingAdd ? "Adding…" : "Add"}
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground mt-2">
                Speak or type naturally — sets, reps, RPE, rest are all understood.
              </p>
            </div>
          </div>
        ) : (
          <button
            className="w-full border-2 border-dashed border-muted rounded-2xl py-4 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
            onClick={() => setAddPanelOpen(true)}
          >
            <Plus className="w-4 h-4" /> Add exercise
          </button>
        )}
      </div>
    </div>
  );
}
