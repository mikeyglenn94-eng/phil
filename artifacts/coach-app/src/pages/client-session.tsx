import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Save, Loader2, CheckCircle2, Clock, Repeat, Zap, Mic, Square, Volume2,
} from "lucide-react";
import {
  useGetProgramme,
  useUpdateProgramme,
  getListProgrammesQueryKey,
  parseLog,
} from "@workspace/api-client-react";
import type { Exercise, Session } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

// Per-set log state
interface SetLog {
  weight: number | null;
  reps: number | null;
}

type LogState = Record<string, SetLog[]>; // exerciseId -> per-set logs

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

  const [logs, setLogs] = useState<LogState>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Voice state per exercise
  const [listeningFor, setListeningFor] = useState<string | null>(null); // exerciseId
  const [interimText, setInterimText] = useState("");
  const [parsingFor, setParsingFor] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Init logs from saved data
  useEffect(() => {
    if (!session) return;
    const initial: LogState = {};
    for (const ex of session.exercises || []) {
      const setsCount = ex.sets || 0;
      initial[ex.id] = Array.from({ length: setsCount }, (_, i) => ({
        weight: ex.setWeights?.[i] ?? null,
        reps: ex.setReps?.[i] ?? null,
      }));
    }
    setLogs(initial);
  }, [session]);

  // Set up speech recognition
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      let finalT = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalT += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInterimText(interim || finalT);
      if (finalT) r.finalAccumulator = (r.finalAccumulator || "") + " " + finalT;
    };
    r.onerror = () => { setListeningFor(null); setInterimText(""); };
    r.onend = async () => {
      const exId = recognitionRef.current?.currentExId;
      const final = ((r.finalAccumulator || "") + " " + (recognitionRef.current?.lastInterim || "")).trim();
      setListeningFor(null);
      setInterimText("");
      r.finalAccumulator = "";
      if (final && exId && session) {
        const ex = session.exercises?.find((e: Exercise) => e.id === exId);
        if (!ex) return;
        setParsingFor(exId);
        try {
          const result = await parseLog({ transcript: final, exerciseName: ex.name, totalSets: ex.sets || 0 });
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
          toast({ title: "Log parsed from voice!" });
        } catch {
          toast({ title: "Couldn't parse log — try again", variant: "destructive" });
        } finally {
          setParsingFor(null);
        }
      }
    };
    recognitionRef.current = r;
    return () => { r.abort(); };
  }, [session, toast]);

  const startListening = (exId: string) => {
    const r = recognitionRef.current;
    if (!r) { toast({ title: "Voice not supported in this browser", variant: "destructive" }); return; }
    if (listeningFor) { r.stop(); return; }
    r.finalAccumulator = "";
    r.currentExId = exId;
    setInterimText("");
    try { r.start(); setListeningFor(exId); } catch {}
  };

  const stopListening = () => { recognitionRef.current?.stop(); };

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
        return {
          ...s,
          exercises: (s.exercises || []).map((ex: Exercise) => {
            const exLogs = logs[ex.id] || [];
            return {
              ...ex,
              setWeights: exLogs.map(l => l.weight),
              setReps: exLogs.map(l => l.reps),
            };
          }),
        };
      });
      await updateMutation.mutateAsync({ id: programmeId, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      setSaved(true);
      toast({ title: "Session saved!" });
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
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
    const exLogs = logs[ex.id] || [];
    return acc + exLogs.filter(l => l.weight !== null || l.reps !== null).length;
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
            onClick={handleSave}
            disabled={isSaving}
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

      {/* Voice listening overlay for current exercise */}
      {listeningFor && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <div className="bg-primary/5 border border-primary/30 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <Volume2 className="w-5 h-5 text-primary relative z-10" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-primary">Listening...</p>
              <p className="text-xs text-muted-foreground truncate italic">{interimText || "Speak your results, e.g. \"set 1 I got 9 reps at 20kg\""}</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 rounded-xl" onClick={stopListening}>
              <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
              Done
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
          const loggedCount = exLogs.filter(l => l.weight !== null || l.reps !== null).length;
          const allLogged = setsCount > 0 && loggedCount === setsCount;

          return (
            <div key={ex.id} className={`bg-card rounded-2xl border shadow-sm overflow-hidden transition-all ${isListening ? "ring-2 ring-primary/50" : ""}`}>
              {/* Exercise header */}
              <div className="px-4 pt-4 pb-3 border-b bg-muted/20">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${allLogged ? "bg-green-100 text-green-700" : "bg-primary/10 text-primary"}`}>
                      {allLogged ? "✓" : exIdx + 1}
                    </span>
                    <h3 className="font-bold text-base leading-tight">{ex.name}</h3>
                  </div>

                  {/* Voice log button */}
                  <Button
                    size="sm"
                    variant={isListening ? "default" : "outline"}
                    className={`shrink-0 rounded-xl gap-1.5 h-8 px-3 text-xs ${isListening ? "bg-destructive hover:bg-destructive/90 text-white border-0" : ""}`}
                    onClick={() => isListening ? stopListening() : startListening(ex.id)}
                    disabled={isParsing || (!!listeningFor && !isListening)}
                  >
                    {isParsing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isListening ? (
                      <><Square className="w-3 h-3 fill-current" /> Stop</>
                    ) : (
                      <><Mic className="w-3.5 h-3.5" /> Log by voice</>
                    )}
                  </Button>
                </div>

                {/* Meta tags */}
                <div className="flex flex-wrap gap-1.5 mt-2 ml-8">
                  {ex.sets && ex.reps && (
                    <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium">
                      <Repeat className="w-3 h-3" />{ex.sets} × {ex.reps}
                    </span>
                  )}
                  {ex.rpe && (
                    <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium">
                      <Zap className="w-3 h-3" />RPE {ex.rpe}
                    </span>
                  )}
                  {ex.rest && (
                    <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium">
                      <Clock className="w-3 h-3" />Rest {ex.rest}
                    </span>
                  )}
                </div>
                {ex.notes && <p className="text-xs text-muted-foreground mt-1.5 ml-8 italic">{ex.notes}</p>}
              </div>

              {/* Set rows */}
              <div className="px-4 py-3">
                {isParsing ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    Parsing your log...
                  </div>
                ) : setsCount === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-2">No sets defined</p>
                ) : (
                  <div className="space-y-2">
                    {/* Column headers */}
                    <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                      <span>Set</span>
                      <span className="text-center">Weight (kg)</span>
                      <span className="text-center">Reps done</span>
                    </div>

                    {Array.from({ length: setsCount }, (_, setIdx) => {
                      const log = exLogs[setIdx] || { weight: null, reps: null };
                      const isDone = log.weight !== null || log.reps !== null;
                      return (
                        <div key={setIdx} className={`grid grid-cols-[3rem_1fr_1fr] gap-2 items-center rounded-xl px-2 py-1.5 transition-colors ${isDone ? "bg-primary/5 border border-primary/20" : "bg-muted/40"}`}>
                          <div className={`text-sm font-bold pl-1 ${isDone ? "text-primary" : "text-muted-foreground"}`}>
                            {setIdx + 1}{isDone && <span className="text-primary ml-0.5">✓</span>}
                          </div>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.5"
                            min="0"
                            placeholder={ex.reps ? `(${ex.reps})` : "—"}
                            value={log.weight ?? ""}
                            onChange={e => handleFieldChange(ex.id, setIdx, "weight", e.target.value)}
                            className={`h-10 text-center text-base font-bold border-0 shadow-none bg-transparent focus:bg-background rounded-lg ${isDone ? "text-primary" : ""}`}
                          />
                          <Input
                            type="number"
                            inputMode="numeric"
                            step="1"
                            min="0"
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

        {(!session.exercises || session.exercises.length === 0) && (
          <div className="text-center py-16 text-muted-foreground">No exercises in this session.</div>
        )}
      </div>
    </div>
  );
}
