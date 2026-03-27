import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Save, Loader2, CheckCircle2, Clock, Repeat, Zap,
  Mic, Square, Volume2, ArrowLeftRight, X, Check, Plus, Send, PlayCircle,
} from "lucide-react";
import {
  useGetProgramme,
  useUpdateProgramme,
  getListProgrammesQueryKey,
  parseLog,
  parseTranscript,
  transcribeAudio,
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

  // Previous logged results for each exercise name — used to show "last time" reminder
  const prevLogs = useMemo<Record<string, { date: string; sets: SetLog[] }>>(() => {
    if (!programme?.sessions || !session) return {};
    const map: Record<string, { date: string; sets: SetLog[] }> = {};
    const pastSessions = (programme.sessions as Session[])
      .filter(s => s.id !== sessionId && s.date <= session.date)
      .sort((a, b) => b.date.localeCompare(a.date)); // most recent first
    for (const s of pastSessions) {
      for (const ex of (s.exercises || [])) {
        const key = ex.name.toLowerCase().trim();
        if (map[key]) continue; // already captured the most recent
        const hasWeight = ex.setWeights?.some(w => w !== null) ?? false;
        const hasReps = ex.setReps?.some(r => r !== null) ?? false;
        if (!hasWeight && !hasReps) continue;
        const count = Math.max(ex.setWeights?.length ?? 0, ex.setReps?.length ?? 0);
        const sets: SetLog[] = Array.from({ length: count }, (_, i) => ({
          weight: ex.setWeights?.[i] ?? null,
          reps: ex.setReps?.[i] ?? null,
        }));
        if (sets.length > 0) map[key] = { date: s.date, sets };
      }
    }
    return map;
  }, [programme, sessionId, session]);

  // Local name overrides for swapped exercises
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogState>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const autosaveTimerRef_cs = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSaveRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);

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
  const [logAccText, setLogAccText] = useState(""); // accumulated finals shown in live transcript
  const [parsingFor, setParsingFor] = useState<string | null>(null);
  const logRecRef = useRef<any>(null);

  // Comment state (per-exercise)
  const [comments, setComments] = useState<Record<string, string>>({});
  const [commentListeningFor, setCommentListeningFor] = useState<string | null>(null);
  const [commentInterim, setCommentInterim] = useState("");
  const commentRecRef = useRef<any>(null);
  const commentInterimRef = useRef(""); // sync ref so onend can read latest interim

  // Feedback state
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackListening, setFeedbackListening] = useState(false);
  const [feedbackInterim, setFeedbackInterim] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [feedbackConfirmation, setFeedbackConfirmation] = useState("");
  const feedbackRecRef = useRef<any>(null);
  const feedbackInterimRef = useRef("");

  // Session-level comment state (for WOD/Run Brain sessions)
  const [sessionComment, setSessionComment] = useState("");
  const [sessionCommentListening, setSessionCommentListening] = useState(false);
  const [sessionCommentInterim, setSessionCommentInterim] = useState("");
  const sessionCommentRecRef = useRef<any>(null);
  const sessionCommentInterimRef = useRef("");

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
    // Init comments from saved data
    const savedComments: Record<string, string> = {};
    for (const ex of session.exercises || []) {
      if (ex.clientComment) savedComments[ex.id] = ex.clientComment;
    }
    setComments(savedComments);
    // Init session-level comment
    setSessionComment((session as any).clientComment || "");
  }, [session]);

  // ── Mobile-safe speech recognition ──────────────────────────────────────────
  // iOS Safari requires a *fresh* SpeechRecognition instance for every start()
  // call, and does not support continuous:true. We create new instances each
  // time and simulate continuous behaviour by restarting on onend.

  function makeSR() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    return r;
  }

  function stopRef(ref: React.MutableRefObject<any>) {
    try { ref.current?.stop(); } catch {}
  }

  // ── Comment voice (per-exercise) ─────────────────────────────────────────
  const startCommentListening = (exId: string) => {
    if (commentListeningFor === exId) { stopRef(commentRecRef); return; }
    stopRef(commentRecRef);
    const r = makeSR();
    if (!r) return;
    commentInterimRef.current = "";
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      commentInterimRef.current = interim;
      setCommentInterim(interim);
      if (fin) {
        commentInterimRef.current = "";
        setComments(prev => ({ ...prev, [exId]: (prev[exId] ? prev[exId] + " " : "") + fin.trim() }));
        setCommentInterim("");
      }
    };
    r.onerror = () => { commentInterimRef.current = ""; setCommentListeningFor(null); setCommentInterim(""); };
    r.onend = () => {
      const leftover = commentInterimRef.current.trim();
      if (leftover) setComments(prev => ({ ...prev, [exId]: (prev[exId] ? prev[exId] + " " : "") + leftover }));
      commentInterimRef.current = "";
      setCommentListeningFor(null);
      setCommentInterim("");
    };
    commentRecRef.current = r;
    setCommentListeningFor(exId);
    setCommentInterim("");
    try { r.start(); } catch {}
  };

  // ── Session-level comment voice ───────────────────────────────────────────
  const toggleSessionCommentListening = () => {
    if (sessionCommentListening) { stopRef(sessionCommentRecRef); return; }
    stopRef(sessionCommentRecRef);
    const r = makeSR();
    if (!r) return;
    sessionCommentInterimRef.current = "";
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      sessionCommentInterimRef.current = interim;
      setSessionCommentInterim(interim);
      if (fin) {
        sessionCommentInterimRef.current = "";
        setSessionComment(prev => (prev ? prev + " " : "") + fin.trim());
        setSessionCommentInterim("");
      }
    };
    r.onerror = () => { sessionCommentInterimRef.current = ""; setSessionCommentListening(false); setSessionCommentInterim(""); };
    r.onend = () => {
      const leftover = sessionCommentInterimRef.current.trim();
      if (leftover) setSessionComment(prev => (prev ? prev + " " : "") + leftover);
      sessionCommentInterimRef.current = "";
      setSessionCommentListening(false);
      setSessionCommentInterim("");
    };
    sessionCommentRecRef.current = r;
    setSessionCommentListening(true);
    setSessionCommentInterim("");
    try { r.start(); } catch {}
  };

  // ── Feedback voice ────────────────────────────────────────────────────────
  const toggleFeedbackListening = () => {
    if (feedbackListening) { stopRef(feedbackRecRef); return; }
    stopRef(feedbackRecRef);
    const r = makeSR();
    if (!r) return;
    feedbackInterimRef.current = "";
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      feedbackInterimRef.current = interim;
      setFeedbackInterim(interim);
      if (fin) {
        feedbackInterimRef.current = "";
        setFeedbackText(prev => (prev ? prev + " " : "") + fin.trim());
        setFeedbackInterim("");
      }
    };
    r.onerror = () => { feedbackInterimRef.current = ""; setFeedbackListening(false); setFeedbackInterim(""); };
    r.onend = () => {
      const leftover = feedbackInterimRef.current.trim();
      if (leftover) setFeedbackText(prev => (prev ? prev + " " : "") + leftover);
      feedbackInterimRef.current = "";
      setFeedbackListening(false);
      setFeedbackInterim("");
    };
    feedbackRecRef.current = r;
    setFeedbackListening(true);
    setFeedbackInterim("");
    try { r.start(); } catch {}
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim() || !programme || !session) return;
    setFeedbackSubmitting(true);
    try {
      const res = await fetch(`/api/programmes/${programmeId}/session-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completedSession: session,
          feedback: feedbackText.trim(),
          allSessions: programme.sessions || [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const { updatedSessions, userConfirmation } = data as { updatedSessions: any[]; userConfirmation: string };
      if (updatedSessions.length > 0) {
        const updatedById = new Map(updatedSessions.map((s: any) => [s.id, s]));
        const merged = (programme.sessions || []).map((s: Session) =>
          updatedById.has(s.id) ? { ...s, ...updatedById.get(s.id) } : s
        );
        await updateMutation.mutateAsync({ id: programmeId, data: { sessions: merged } });
        queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      }
      setFeedbackDone(true);
      setFeedbackConfirmation(userConfirmation);
      toast({ title: userConfirmation });
    } catch {
      toast({ title: "Couldn't apply feedback — try again", variant: "destructive" });
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // ── Log voice (Web Speech for preview + Whisper for accuracy) ────────────
  const logAccRef = useRef("");
  const logExIdRef = useRef("");
  const logActiveRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const usingMediaRecorderRef = useRef(false);

  // Final processing: tries Whisper first, falls back to Web Speech transcript
  async function processLogRecording(exId: string, audioBlob: Blob | null) {
    let transcript = logAccRef.current.trim();
    setListeningFor(null); setInterimText(""); setLogAccText("");
    logAccRef.current = "";

    if (!exId || !session) return;
    const ex = session.exercises?.find((e: Exercise) => e.id === exId);
    if (!ex) return;

    setParsingFor(exId);

    // Whisper pass — much better in noisy environments
    if (audioBlob && audioBlob.size > 1500) {
      try {
        const result = await transcribeAudio({ audio: audioBlob });
        if (result.transcript?.trim()) transcript = result.transcript.trim();
      } catch {
        // Whisper unavailable — fall back to Web Speech text
      }
    }

    if (!transcript) { setParsingFor(null); return; }

    try {
      const result = await parseLog({ transcript, exerciseName: nameOverrides[exId] || ex.name, totalSets: ex.sets || 0 });
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
      scheduleClientAutosave();
      toast({ title: "Log parsed!" });
    } catch {
      toast({ title: "Couldn't parse log — try again", variant: "destructive" });
    } finally { setParsingFor(null); }
  }

  function stopLogRecording() {
    logActiveRef.current = false;
    stopRef(logRecRef);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop(); // onstop → processLogRecording
    } else if (!usingMediaRecorderRef.current) {
      // MediaRecorder never started — onend will call processLogRecording
    }
  }

  const startLogListening = (exId: string) => {
    if (logActiveRef.current) { stopLogRecording(); return; }

    logAccRef.current = "";
    logExIdRef.current = exId;
    logActiveRef.current = true;
    usingMediaRecorderRef.current = false;
    setListeningFor(exId);
    setInterimText("");
    setLogAccText("");

    // Start MediaRecorder for Whisper (async — Web Speech starts immediately below)
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
          if (!logActiveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
          const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find(t => MediaRecorder.isTypeSupported(t)) ?? "";
          const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          mediaChunksRef.current = [];
          mr.ondataavailable = e => { if (e.data.size > 0) mediaChunksRef.current.push(e.data); };
          mr.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            usingMediaRecorderRef.current = false;
            const blob = new Blob(mediaChunksRef.current, { type: mimeType || "audio/webm" });
            await processLogRecording(logExIdRef.current, blob);
          };
          mr.start(500);
          mediaRecorderRef.current = mr;
          usingMediaRecorderRef.current = true;
        })
        .catch(() => { /* mic denied or unavailable — Web Speech only */ });
    }

    spawnLogRec();
  };

  function spawnLogRec() {
    const r = makeSR();
    if (!r) { logActiveRef.current = false; setListeningFor(null); return; }
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (fin) {
        logAccRef.current = (logAccRef.current + " " + fin).trim();
        setLogAccText(logAccRef.current);
        setInterimText("");
      } else {
        setInterimText(interim);
      }
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "audio-capture") {
        logActiveRef.current = false;
        setListeningFor(null); setInterimText("");
      }
    };
    r.onend = async () => {
      if (logActiveRef.current) { setTimeout(spawnLogRec, 100); return; }
      // Stopped by user — if MediaRecorder is handling it, just clear visuals
      if (usingMediaRecorderRef.current) {
        setListeningFor(null); setInterimText(""); setLogAccText("");
      } else {
        // No MediaRecorder — process now with Web Speech text
        await processLogRecording(logExIdRef.current, null);
      }
    };
    logRecRef.current = r;
    try { r.start(); } catch { logActiveRef.current = false; setListeningFor(null); }
  }

  // ── Swap voice ────────────────────────────────────────────────────────────
  const startSwapListening = () => {
    if (swapListening) { stopRef(swapRecRef); return; }
    stopRef(swapRecRef);
    const r = makeSR();
    if (!r) return;
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
    setSwapListening(true);
    setSwapInterim("");
    try { r.start(); } catch { setSwapListening(false); }
  };

  // ── Add-exercise voice ────────────────────────────────────────────────────
  const startAddListening = () => {
    if (addListening) { stopRef(addRecRef); return; }
    stopRef(addRecRef);
    const r = makeSR();
    if (!r) { toast({ title: "Voice not supported in this browser", variant: "destructive" }); return; }
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
    setAddInterim(""); setAddInput("");
    setAddListening(true);
    try { r.start(); } catch { setAddListening(false); }
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
      scheduleClientAutosave();
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
    scheduleClientAutosave();
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
    scheduleClientAutosave();
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
    scheduleClientAutosave();
  };

  // Keep ref always pointing to latest handleSave (so debounced timers have fresh state)
  const scheduleClientAutosave = () => {
    if (autosaveTimerRef_cs.current) clearTimeout(autosaveTimerRef_cs.current);
    autosaveTimerRef_cs.current = setTimeout(() => { handleSaveRef.current?.(true); }, 1500);
  };

  const handleSave = async (silent = false) => {
    if (!programme || !session) return;
    setIsSaving(true);
    try {
      const isConditioningSession = (session as any).source === "wod_brain" || (session as any).source === "run_brain";
      const updatedSessions = (programme.sessions || []).map((s: Session) => {
        if (s.id !== sessionId) return s;
        if (isConditioningSession) {
          return { ...s, clientComment: sessionComment.trim() || null };
        }
        const originalExercises = (s.exercises || []).map((ex: Exercise) => ({
          ...ex,
          name: nameOverrides[ex.id] || ex.name,
          setWeights: (logs[ex.id] || []).map(l => l.weight),
          setReps: (logs[ex.id] || []).map(l => l.reps),
          clientComment: comments[ex.id] || null,
        }));
        const extraExercises = addedExercises.map(ex => ({
          ...ex,
          setWeights: (logs[ex.id] || []).map(l => l.weight),
          setReps: (logs[ex.id] || []).map(l => l.reps),
          clientComment: comments[ex.id] || null,
        }));
        return { ...s, exercises: [...originalExercises, ...extraExercises] };
      });
      await updateMutation.mutateAsync({ id: programmeId, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      setSaved(true);
      if (!silent) toast({ title: "Session saved!" });
    } catch {
      if (!silent) toast({ title: "Error saving", variant: "destructive" });
    } finally { setIsSaving(false); }
  };
  // Keep ref current so debounced timers always call the freshest version
  handleSaveRef.current = handleSave;

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!session) return (
    <div className="flex h-screen items-center justify-center flex-col gap-4">
      <p className="text-muted-foreground">Session not found.</p>
      <Button variant="outline" onClick={() => setLocation("/client?tab=training")}>Back</Button>
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
            <Button variant="ghost" size="icon" onClick={() => setLocation("/client?tab=training")}>
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
      {listeningFor && (() => {
        const listeningExName = session?.exercises?.find((e: Exercise) => e.id === listeningFor)
          ? (nameOverrides[listeningFor] || session.exercises!.find((e: Exercise) => e.id === listeningFor)!.name)
          : null;
        const hasWords = logAccText || interimText;
        return (
          <div className="max-w-lg mx-auto px-4 pt-4">
            <div className="bg-primary/5 border border-primary/30 rounded-2xl overflow-hidden shadow-sm">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-primary/20">
                <span className="relative shrink-0">
                  <span className="absolute inset-0 rounded-full bg-red-400/40 animate-ping" />
                  <Mic className="w-4 h-4 text-red-500 relative z-10" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-primary uppercase tracking-wide leading-none">Recording</p>
                  {listeningExName && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{listeningExName}</p>}
                </div>
                <Button size="sm" variant="outline" className="shrink-0 rounded-xl h-8 px-3 text-xs" onClick={stopLogRecording}>
                  <Square className="w-3 h-3 mr-1.5 fill-current" />Done
                </Button>
              </div>
              {/* Live transcript */}
              <div className="px-4 py-3 min-h-[56px]">
                {hasWords ? (
                  <p className="text-sm leading-relaxed text-foreground">
                    {logAccText && <span>{logAccText} </span>}
                    {interimText && <span className="text-muted-foreground/70 italic">{interimText}</span>}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/50 italic">Say your sets… e.g. "60kg 3 sets of 8"</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Conditioning session (WOD Brain / Run Brain / Endurance Cycle) */}
      {((session as any).source === "wod_brain" || (session as any).source === "run_brain" || (session as any).source === "endurance_cycle") && (() => {
        const src = (session as any).source as string;
        const isGreen = src === "run_brain" || src === "endurance_cycle";
        const label = src === "run_brain" ? "Run Brain" : src === "endurance_cycle" ? "Endurance Cycle" : "WOD Brain";
        return (
        <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
          {/* Workout block */}
          <div className={`rounded-2xl border p-5 space-y-4 ${isGreen ? "bg-green-50 border-green-200" : "bg-purple-50 border-purple-200"}`}>
            <div className="flex items-center gap-2">
              {isGreen
                ? <Zap className="w-4 h-4 text-green-600 shrink-0" />
                : <Clock className="w-4 h-4 text-purple-600 shrink-0" />
              }
              <span className={`text-xs font-bold uppercase tracking-wide ${isGreen ? "text-green-700" : "text-purple-700"}`}>
                {label}
              </span>
            </div>
            {(session as any).structure && (
              <p className={`text-sm italic leading-relaxed ${isGreen ? "text-green-900" : "text-purple-900"}`}>
                {(session as any).structure}
              </p>
            )}
            <ol className="space-y-2">
              {(session.exercises || []).map((ex, i) => (
                <li key={ex.id} className="flex items-baseline gap-3">
                  <span className={`text-sm font-bold shrink-0 w-5 ${isGreen ? "text-green-600" : "text-purple-600"}`}>{i + 1}.</span>
                  <div>
                    <span className="text-sm font-semibold text-foreground capitalize">{ex.name}</span>
                    {ex.notes && <span className="text-sm text-muted-foreground ml-2">{ex.notes}</span>}
                  </div>
                </li>
              ))}
            </ol>
            {(session as any).guidance && (
              <div className={`border-t pt-3 mt-1 space-y-1.5 ${isGreen ? "border-green-200" : "border-purple-200"}`}>
                {((session as any).guidance as string).split(/\n\n+/).map((para: string, pi: number) => (
                  <p key={pi} className={`text-xs leading-relaxed ${isGreen ? "text-green-900/80" : "text-purple-900/80"}`}>{para.trim()}</p>
                ))}
              </div>
            )}
          </div>

          {/* Feedback section */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground tracking-widest uppercase px-1">Your Feedback</p>
            <div className={`relative rounded-xl border transition-colors ${sessionCommentListening ? "border-primary/40 bg-primary/5" : "border-muted bg-muted/20 hover:border-muted-foreground/30"}`}>
              <textarea
                className="w-full bg-transparent text-sm rounded-xl px-3 py-3 pr-10 resize-none outline-none min-h-[80px]"
                placeholder="How did it feel? Any notes for your coach…"
                value={sessionCommentListening ? (sessionCommentInterim || sessionComment) : sessionComment}
                onChange={e => { setSessionComment(e.target.value); setSaved(false); scheduleClientAutosave(); }}
                disabled={sessionCommentListening}
              />
              <button
                className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${sessionCommentListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                title={sessionCommentListening ? "Stop" : "Dictate feedback"}
                onClick={toggleSessionCommentListening}
              >
                {sessionCommentListening ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>
            {sessionCommentListening && (
              <p className="text-xs text-primary animate-pulse px-1">
                {sessionCommentInterim || "Listening…"}
              </p>
            )}
          </div>
        </div>
        );
      })()}

      {/* Exercises (strength sessions — no source, or source = strength_block) */}
      {(!(session as any).source || (session as any).source === "strength_block") && (
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
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(displayName + " exercise tutorial")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-red-500 hover:text-red-600 font-medium mt-0.5 transition-colors"
                      >
                        <PlayCircle className="w-3 h-3" /> Watch demo
                      </a>
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
                        onClick={() => startLogListening(ex.id)}
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

                {/* Last time reminder */}
                {(() => {
                  const prev = prevLogs[ex.name.toLowerCase().trim()];
                  if (!prev) return null;
                  const setsText = prev.sets
                    .map(s => {
                      if (s.weight !== null && s.reps !== null) return `${s.weight}×${s.reps}`;
                      if (s.weight !== null) return `${s.weight}kg`;
                      if (s.reps !== null) return `×${s.reps}`;
                      return null;
                    })
                    .filter(Boolean)
                    .join(" · ");
                  if (!setsText) return null;
                  return (
                    <div className="flex items-center gap-1.5 mt-2 ml-8">
                      <Clock className="w-3 h-3 text-blue-400 shrink-0" />
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-semibold text-blue-500">{format(parseISO(prev.date), "d MMM")}:</span>{" "}
                        {setsText}
                      </p>
                    </div>
                  );
                })()}
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

              {/* Client comment box */}
              <div className="px-4 pb-4">
                <div className={`relative rounded-xl border transition-colors ${commentListeningFor === ex.id ? "border-primary/40 bg-primary/5" : "border-muted bg-muted/20 hover:border-muted-foreground/30"}`}>
                  <textarea
                    value={commentListeningFor === ex.id ? (commentInterim || comments[ex.id] || "") : (comments[ex.id] || "")}
                    onChange={e => { setComments(prev => ({ ...prev, [ex.id]: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                    placeholder="Leave a comment for your coach…"
                    rows={2}
                    disabled={commentListeningFor === ex.id}
                    className="w-full bg-transparent resize-none text-sm px-3 pt-2.5 pb-2 pr-10 rounded-xl outline-none placeholder:text-muted-foreground/50 disabled:opacity-70"
                  />
                  <button
                    type="button"
                    onClick={() => startCommentListening(ex.id)}
                    className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${commentListeningFor === ex.id ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                    title={commentListeningFor === ex.id ? "Stop" : "Dictate comment"}
                  >
                    {commentListeningFor === ex.id
                      ? <Square className="w-3.5 h-3.5 fill-current" />
                      : <Mic className="w-3.5 h-3.5" />}
                  </button>
                </div>
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

              {/* Client comment box */}
              <div className="px-4 pb-4">
                <div className={`relative rounded-xl border transition-colors ${commentListeningFor === ex.id ? "border-primary/40 bg-primary/5" : "border-muted bg-muted/20 hover:border-muted-foreground/30"}`}>
                  <textarea
                    value={commentListeningFor === ex.id ? (commentInterim || comments[ex.id] || "") : (comments[ex.id] || "")}
                    onChange={e => { setComments(prev => ({ ...prev, [ex.id]: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                    placeholder="Leave a comment for your coach…"
                    rows={2}
                    disabled={commentListeningFor === ex.id}
                    className="w-full bg-transparent resize-none text-sm px-3 pt-2.5 pb-2 pr-10 rounded-xl outline-none placeholder:text-muted-foreground/50 disabled:opacity-70"
                  />
                  <button
                    type="button"
                    onClick={() => startCommentListening(ex.id)}
                    className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${commentListeningFor === ex.id ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                    title={commentListeningFor === ex.id ? "Stop" : "Dictate comment"}
                  >
                    {commentListeningFor === ex.id
                      ? <Square className="w-3.5 h-3.5 fill-current" />
                      : <Mic className="w-3.5 h-3.5" />}
                  </button>
                </div>
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

        {/* Post-session feedback */}
        <div className="rounded-2xl border bg-muted/20 overflow-hidden">
          <div className="px-4 pt-4 pb-3">
            <p className="text-sm font-semibold mb-0.5">Any changes for next time?</p>
            <p className="text-xs text-muted-foreground mb-3">Your feedback will update future sessions of this type in the programme.</p>
            {feedbackDone ? (
              <div className="flex items-start gap-2.5 rounded-xl bg-green-50 border border-green-200 px-3 py-3">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                <p className="text-sm text-green-800">{feedbackConfirmation}</p>
              </div>
            ) : (
              <>
                <div className={`relative rounded-xl border transition-colors ${feedbackListening ? "border-primary/40 bg-primary/5" : "border-border bg-background"}`}>
                  <textarea
                    value={feedbackListening ? (feedbackInterim || feedbackText) : feedbackText}
                    onChange={e => { if (!feedbackListening) setFeedbackText(e.target.value); }}
                    placeholder={feedbackListening ? "Listening…" : 'e.g. "Too easy", "Swap burpees", "Running felt too hard"'}
                    rows={2}
                    disabled={feedbackListening || feedbackSubmitting}
                    className="w-full bg-transparent resize-none text-sm px-3 pt-2.5 pb-2 pr-10 rounded-xl outline-none placeholder:text-muted-foreground/50 disabled:opacity-70"
                  />
                  <button
                    type="button"
                    onClick={toggleFeedbackListening}
                    disabled={feedbackSubmitting}
                    className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${feedbackListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                  >
                    {feedbackListening
                      ? <Square className="w-3.5 h-3.5 fill-current" />
                      : <Mic className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <Button
                  className="w-full mt-2 rounded-xl gap-2"
                  disabled={!feedbackText.trim() || feedbackSubmitting || feedbackListening}
                  onClick={submitFeedback}
                >
                  {feedbackSubmitting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Applying…</>
                    : <><Send className="w-4 h-4" /> Apply to future sessions</>}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* WhatsApp Coach */}
        <div className="pt-4 pb-2 flex justify-center">
          <a
            href="https://wa.me/447928712251"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 bg-[#25D366] hover:bg-[#20bb5a] text-white font-semibold rounded-2xl px-6 py-3.5 text-sm shadow-md hover:shadow-lg transition-all"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp Your Coach
          </a>
        </div>
      </div>
      )}
    </div>
  );
}
