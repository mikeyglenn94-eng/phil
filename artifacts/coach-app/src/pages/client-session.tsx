import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Save, Loader2, CheckCircle2, Clock, Repeat, Zap,
  Mic, Square, Volume2, ArrowLeftRight, X, Check, Plus, Send, PlayCircle, Share2, Download, Copy, Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useGetProgramme,
  useUpdateProgramme,
  getListProgrammesQueryKey,
  getGetProgrammeQueryKey,
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
interface RunInterval { distance: string; pace: string; }

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

// ── Muscle heat map ────────────────────────────────────────────────────────────
// Zone names: shoulder, chest, bicep, forearm, core, quad, calf (front)
//             shoulder, upper_back, lat, tricep, lower_back, glute, hamstring, calf (back)

const MUSCLE_MAP: Array<{ patterns: string[]; primary: string[]; secondary: string[] }> = [
  { patterns: ["bench press","chest press","fly","flye","push-up","pushup","pec dec","cable crossover","dip"],
    primary: ["chest"], secondary: ["shoulder","tricep"] },
  { patterns: ["row","pull-up","pullup","pull up","pulldown","lat pull","seated cable"],
    primary: ["lat"], secondary: ["upper_back","shoulder","bicep","forearm"] },
  { patterns: ["deadlift","rdl","romanian","good morning","back extension","hyperextension"],
    primary: ["lower_back","hamstring"], secondary: ["glute","upper_back"] },
  { patterns: ["squat","leg press","lunge","step-up","split squat","hack squat","goblet squat","front squat","leg extension"],
    primary: ["quad"], secondary: ["glute"] },
  { patterns: ["hip thrust","glute bridge","hip bridge","cable kickback","donkey kick"],
    primary: ["glute"], secondary: ["hamstring"] },
  { patterns: ["hamstring","leg curl","nordic","lying curl","seated curl","stiff-leg"],
    primary: ["hamstring"], secondary: ["glute","lower_back"] },
  { patterns: ["shoulder press","overhead press","ohp","military press","arnold press","front raise"],
    primary: ["shoulder"], secondary: ["upper_back","tricep"] },
  { patterns: ["lateral raise","side raise","face pull","reverse fly","rear delt","band pull"],
    primary: ["shoulder"], secondary: ["upper_back"] },
  { patterns: ["shrug","upright row","clean","snatch","trap bar"],
    primary: ["upper_back"], secondary: ["shoulder"] },
  { patterns: ["bicep curl","biceps curl","curl","hammer curl","preacher curl","concentration curl","chin-up","chinup"],
    primary: ["bicep"], secondary: ["forearm"] },
  { patterns: ["tricep","triceps","skull crusher","close-grip","pushdown","overhead extension","kickback"],
    primary: ["tricep"], secondary: [] },
  { patterns: ["crunch","sit-up","sit up","plank","ab wheel","cable crunch","hollow","leg raise","toes to bar","russian twist"],
    primary: ["core"], secondary: [] },
  { patterns: ["calf raise","calf press","tibialis"],
    primary: ["calf"], secondary: [] },
];

function getMuscleStimulus(
  exercises: Array<{ id: string; name: string; sets?: number }>,
  logs: Record<string, Array<{ weight: number | null; reps: number | null }>>,
  nameOverrides: Record<string, string>,
): Map<string, "high" | "medium"> {
  const volume: Record<string, number> = {};
  for (const ex of exercises) {
    const n = (nameOverrides[ex.id] || ex.name).toLowerCase();
    const exSets = logs[ex.id] || [];
    let vol = 0;
    for (const s of exSets) {
      if (s.weight !== null && s.reps !== null && s.weight > 0 && s.reps > 0)
        vol += s.weight * s.reps;
    }
    if (vol === 0) vol = (ex.sets || exSets.length || 1) * 10;
    for (const entry of MUSCLE_MAP) {
      if (entry.patterns.some(p => n.includes(p))) {
        for (const m of entry.primary)   volume[m] = (volume[m] || 0) + vol;
        for (const m of entry.secondary) volume[m] = (volume[m] || 0) + vol * 0.3;
        break;
      }
    }
  }
  if (!Object.keys(volume).length) return new Map();
  const maxVol = Math.max(...Object.values(volume));
  const result = new Map<string, "high" | "medium">();
  for (const [m, v] of Object.entries(volume)) {
    if (v >= maxVol * 0.55) result.set(m, "high");
    else if (v >= maxVol * 0.20) result.set(m, "medium");
  }
  return result;
}


// ── WOD helpers ───────────────────────────────────────────────────────────────

type WodFormat = "amrap" | "for_time" | "emom" | "rounds_for_time" | "chipper" | "interval" | "other";
type WodResult = { rounds?: string; reps?: string; time?: string; completed?: boolean; score?: string };

function detectWodFormat(sess: any): WodFormat {
  const f = ((sess.format || sess.wodDefinition?.format) ?? "").toLowerCase().replace(/[\s-]/g, "_");
  if (f === "amrap") return "amrap";
  if (f.includes("for_time")) return "for_time";
  if (f === "emom") return "emom";
  if (f.includes("rounds")) return "rounds_for_time";
  if (f === "chipper") return "chipper";
  if (f === "interval") return "interval";
  const s = (sess.structure || "").toUpperCase();
  if (/\bAMRAP\b/.test(s)) return "amrap";
  if (/FOR\s+TIME/.test(s)) return "for_time";
  if (/\bEMOM\b/.test(s)) return "emom";
  if (/ROUNDS\s+FOR\s+TIME/.test(s)) return "rounds_for_time";
  if (/\bCHIPPER\b/.test(s)) return "chipper";
  if (/\bINTERVAL\b/.test(s)) return "interval";
  return "other";
}

function formatWodResultForDisplay(result: WodResult, fmt: WodFormat): string {
  if (!result || !Object.keys(result).length) return "";
  if (fmt === "amrap") {
    const r = result.rounds ? `${result.rounds} rounds` : "";
    return result.reps ? `${r} + ${result.reps} reps` : r;
  }
  if (fmt === "for_time" || fmt === "chipper" || fmt === "rounds_for_time") return result.time || "";
  if (fmt === "emom") return result.completed !== undefined ? (result.completed ? "Completed ✓" : "Did not complete") : (result.score || "");
  return result.score || result.time || "";
}

function validateWodResult(fmt: WodFormat, result: WodResult): boolean {
  if (fmt === "amrap") return !!result.rounds && Number(result.rounds) >= 0;
  if (fmt === "for_time" || fmt === "chipper" || fmt === "rounds_for_time") return !!result.time;
  if (fmt === "emom") return result.completed !== undefined;
  if (fmt === "interval") return !!result.score;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Most recent past session with the same name that has any comment data
  const prevSession = useMemo<{ date: string; comment: string | null; exerciseComments: Record<string, string> } | null>(() => {
    if (!programme?.sessions || !session) return null;
    const sessionName = session.name?.toLowerCase().trim() || "";
    if (!sessionName) return null;
    const past = (programme.sessions as Session[])
      .filter(s => s.id !== sessionId && s.date < session.date && s.name?.toLowerCase().trim() === sessionName)
      .sort((a, b) => b.date.localeCompare(a.date));
    // Prefer a session that has comment data, fall back to any past session
    const candidate = past.find(s =>
      (s as any).clientComment || (s.exercises || []).some(ex => ex.clientComment)
    ) ?? past[0] ?? null;
    if (!candidate) return null;
    const exerciseComments: Record<string, string> = {};
    for (const ex of (candidate.exercises || [])) {
      if (ex.clientComment) exerciseComments[ex.name.toLowerCase().trim()] = ex.clientComment;
    }
    return { date: candidate.date, comment: (candidate as any).clientComment ?? null, exerciseComments };
  }, [programme, sessionId, session]);

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

  // Delete / set-count state
  const [deletedExIds, setDeletedExIds] = useState<Set<string>>(new Set());
  const [confirmDeleteExId, setConfirmDeleteExId] = useState<string | null>(null);
  const [setCountOverrides, setSetCountOverrides] = useState<Record<string, number>>({});

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

  // Share state
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [shareImageLoading, setShareImageLoading] = useState(false);
  const [shareSaved, setShareSaved] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareIsStrength, setShareIsStrength] = useState(false);
  const [shareShowTopSet, setShareShowTopSet] = useState(true);
  const [shareShowComment, setShareShowComment] = useState(true);

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

  // WOD result state
  const [wodResult, setWodResult] = useState<WodResult>({});

  // Run interval logging state
  const [runIntervals, setRunIntervals] = useState<RunInterval[]>([{ distance: "", pace: "" }]);

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
    // Init WOD result
    setWodResult((session as any).wodResult || {});
    // Init run intervals
    const savedRunLog = (session as any).runLog as Array<{ distance?: number | null; pace?: string | null }> | undefined;
    if (savedRunLog && savedRunLog.length > 0) {
      setRunIntervals(savedRunLog.map(r => ({ distance: r.distance != null ? String(r.distance) : "", pace: r.pace ?? "" })));
    } else {
      setRunIntervals([{ distance: "", pace: "" }]);
    }
  }, [session]);

  // Live share preview — regenerate when strength toggles change
  useEffect(() => {
    if (!showShareModal || !shareIsStrength) return;
    let cancelled = false;
    setShareImageLoading(true);
    const timer = setTimeout(async () => {
      const file = await generateShareImage({ showTopSet: shareShowTopSet, showComment: shareShowComment });
      if (cancelled) return;
      if (file) {
        setShareFile(file);
        setShareImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
      }
      setShareImageLoading(false);
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [shareShowTopSet, shareShowComment, showShareModal, shareIsStrength]);

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

    // Cancel any pending autosave so it can't overwrite the AI changes with stale data
    if (autosaveTimerRef_cs.current) {
      clearTimeout(autosaveTimerRef_cs.current);
      autosaveTimerRef_cs.current = null;
    }

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
        // Immediately update the detail cache so any subsequent autosave reads the correct merged data
        queryClient.setQueryData(getGetProgrammeQueryKey(programmeId), (old: any) =>
          old ? { ...old, sessions: merged } : old
        );
        queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProgrammeQueryKey(programmeId) });
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

  const addSetToExercise = (exId: string, currentSets: number) => {
    const newCount = currentSets + 1;
    setSetCountOverrides(prev => ({ ...prev, [exId]: newCount }));
    setLogs(prev => ({ ...prev, [exId]: [...(prev[exId] || []), { weight: null, reps: null }] }));
    setSaved(false);
    scheduleClientAutosave();
  };

  const handleSave = async (silent = false) => {
    if (!programme || !session) return;
    setIsSaving(true);
    try {
      const isRunSession = (session as any).source === "run_brain" || (session as any).source === "endurance_cycle";
      const isConditioningSession = (session as any).source === "wod_brain" || isRunSession;
      const updatedSessions = (programme.sessions || []).map((s: Session) => {
        if (s.id !== sessionId) return s;
        if (isConditioningSession) {
          const base = { ...s, clientComment: sessionComment.trim() || null };
          if (isRunSession) {
            const runLog = runIntervals
              .filter(r => r.distance !== "" || r.pace !== "")
              .map(r => ({
                distance: r.distance !== "" ? parseFloat(r.distance) : null,
                pace: r.pace || null,
              }));
            return { ...base, runLog: runLog.length > 0 ? runLog : null };
          }
          // WOD — persist structured result
          const hasResult = Object.values(wodResult).some(v => v !== undefined && v !== "" && v !== null);
          return { ...base, wodResult: hasResult ? wodResult : null };
        }
        const originalExercises = (s.exercises || [])
          .filter((ex: Exercise) => !deletedExIds.has(ex.id))
          .map((ex: Exercise) => ({
            ...ex,
            name: nameOverrides[ex.id] || ex.name,
            sets: setCountOverrides[ex.id] ?? ex.sets,
            setWeights: (logs[ex.id] || []).map(l => l.weight),
            setReps: (logs[ex.id] || []).map(l => l.reps),
            clientComment: comments[ex.id] || null,
          }));
        const extraExercises = addedExercises
          .filter(ex => !deletedExIds.has(ex.id))
          .map(ex => ({
            ...ex,
            sets: setCountOverrides[ex.id] ?? ex.sets,
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

  // ── Share workout — transparent PNG card ─────────────────────────────────────
  async function generateShareImage(
    opts: { showTopSet: boolean; showComment: boolean } = { showTopSet: true, showComment: true }
  ): Promise<File | null> {
    await document.fonts.ready;
    const W = 1080, H = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, W, H); // fully transparent background

    const src = (session as any).source as string | undefined;
    const isCondition = src === "wod_brain" || src === "run_brain" || src === "endurance_cycle";

    // ── Collect metrics — actual logged data only ─────────────────────────────
    const allExercises = [...(session.exercises || []), ...addedExercises];
    let totalKg = 0;
    if (!isCondition) {
      for (const ex of allExercises) {
        for (const set of (logs[ex.id] || [])) {
          if (set.weight !== null && set.reps !== null && set.weight > 0 && set.reps > 0) {
            totalKg += set.weight * set.reps;
          }
        }
      }
    }

    const dateStr = format(parseISO(session.date || format(new Date(), "yyyy-MM-dd")), "EEE d MMM").toUpperCase();
    const name = session.name || "Session";
    const structure = (session as any).structure as string | undefined;

    // ── Layout ────────────────────────────────────────────────────────────────
    // Card fills the bottom 68% — transparent above so video shows through
    const pad = 56;
    const cardTop = Math.round(H * 0.32);
    const cardH = H - cardTop - 40;
    const cardW = W - pad * 2;
    const cx = pad + 60;
    const right = pad + cardW - 60;

    // Rounded rect helper
    function rr(x: number, y: number, w: number, h: number, r: number) {
      ctx!.beginPath();
      ctx!.moveTo(x + r, y);
      ctx!.arcTo(x + w, y, x + w, y + h, r);
      ctx!.arcTo(x + w, y + h, x, y + h, r);
      ctx!.arcTo(x, y + h, x, y, r);
      ctx!.arcTo(x, y, x + w, y, r);
      ctx!.closePath();
    }

    // ── Card background ───────────────────────────────────────────────────────
    ctx.fillStyle = "rgba(5, 5, 16, 0.92)";
    rr(pad, cardTop, cardW, cardH, 52);
    ctx.fill();

    // Top accent gradient bar
    const accentGrad = ctx.createLinearGradient(pad, 0, pad + 320, 0);
    accentGrad.addColorStop(0, "rgba(99, 102, 241, 1)");
    accentGrad.addColorStop(1, "rgba(139, 92, 246, 0.0)");
    ctx.fillStyle = accentGrad;
    rr(pad, cardTop, 340, 6, 3);
    ctx.fill();

    let cy = cardTop + 72;

    // ── M monogram + date ────────────────────────────────────────────────────
    const logoSize = 72;
    const logoX = cx;
    const logoY = cy - logoSize * 0.78;

    // Rounded square background
    rr(logoX, logoY, logoSize, logoSize, 18);
    ctx.fillStyle = "rgba(99, 102, 241, 1)";
    ctx.fill();

    // "M" letter centred inside
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${Math.round(logoSize * 0.62)}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = "center";
    ctx.fillText("M", logoX + logoSize / 2, logoY + logoSize * 0.72);
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(255,255,255,0.40)";
    ctx.font = "500 32px 'Inter', system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(dateStr, right, cy);
    ctx.textAlign = "left";
    cy += 78;

    // ── Session name ──────────────────────────────────────────────────────────
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 76px 'Inter', system-ui, sans-serif";
    const maxNW = cardW - 120;
    let displayName = name;
    while (ctx.measureText(displayName).width > maxNW && displayName.length > 6)
      displayName = displayName.slice(0, -1);
    if (displayName !== name) displayName += "…";
    ctx.fillText(displayName, cx, cy);
    cy += 28;

    // ── Divider ───────────────────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy + 26); ctx.lineTo(right, cy + 26); ctx.stroke();
    cy += 120;

    if (!isCondition) {
      // ── STRENGTH — performance card ───────────────────────────────────────

      // Find the best single set (highest volume = weight × reps)
      let heroExName = "", heroExId = "";
      let heroWeight = 0, heroReps = 0, heroVol = 0;
      for (const ex of allExercises) {
        const eName = nameOverrides[ex.id] || ex.name;
        for (const s of (logs[ex.id] || [])) {
          if (s.weight && s.reps && s.weight > 0 && s.reps > 0) {
            const v = s.weight * s.reps;
            if (v > heroVol) {
              heroVol = v; heroWeight = s.weight; heroReps = s.reps;
              heroExName = eName; heroExId = ex.id;
            }
          }
        }
      }

      // Supporting data
      const est1RM = heroReps > 1
        ? Math.round(heroWeight * (1 + heroReps / 30))
        : heroWeight;
      const exVolToday = (logs[heroExId] || []).reduce((sum, s) =>
        (s.weight && s.reps) ? sum + s.weight * s.reps : sum, 0);

      // Previous best for this exercise
      const prevKey = heroExName.toLowerCase().trim();
      const prevData = prevLogs[prevKey];
      let prevBestW = 0, prevBestR = 0, prevBestV = 0;
      if (prevData) {
        for (const s of prevData.sets) {
          if (s.weight && s.reps) {
            const v = s.weight * s.reps;
            if (v > prevBestV) { prevBestV = v; prevBestW = s.weight; prevBestR = s.reps; }
          }
        }
      }

      // One-line insight tied to this session
      let insight = "";
      if (prevBestW > 0 && heroWeight > prevBestW)
        insight = `+${heroWeight - prevBestW}kg vs last time`;
      else if (prevBestR > 0 && heroReps > prevBestR && heroWeight >= prevBestW)
        insight = `+${heroReps - prevBestR} reps vs last time`;
      else if (prevBestV > 0 && heroVol > prevBestV)
        insight = `Best set yet for ${heroExName}`;

      if (heroExName) {
        // ── "BEST SET" label ───────────────────────────────────────────────
        ctx.fillStyle = "rgba(99,102,241,0.90)";
        ctx.font = "700 30px 'Inter', system-ui, sans-serif";
        ctx.fillText("BEST SET", cx, cy + 56);

        // ── Exercise name ──────────────────────────────────────────────────
        ctx.fillStyle = "rgba(255,255,255,0.48)";
        ctx.font = "500 58px 'Inter', system-ui, sans-serif";
        let eName = heroExName;
        while (ctx.measureText(eName).width > cardW - 120 && eName.length > 4)
          eName = eName.slice(0, -1);
        if (eName !== heroExName) eName += "…";
        ctx.fillText(eName, cx, cy + 138);

        // ── Hero: weight × reps ────────────────────────────────────────────
        const heroText = `${heroWeight}kg × ${heroReps}`;
        let hfs = 152;
        ctx.font = `800 ${hfs}px 'Inter', system-ui, sans-serif`;
        while (ctx.measureText(heroText).width > cardW - 80 && hfs > 72) {
          hfs -= 6;
          ctx.font = `800 ${hfs}px 'Inter', system-ui, sans-serif`;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillText(heroText, cx, cy + 138 + hfs + 28);
        const heroBottom = cy + 138 + hfs + 28;

        // ── Thin divider ───────────────────────────────────────────────────
        const div2Y = heroBottom + 56;
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, div2Y); ctx.lineTo(right, div2Y); ctx.stroke();

        // ── Supporting metrics (up to 3) ───────────────────────────────────
        const metrics: { label: string; value: string }[] = [];
        if (est1RM > 0)    metrics.push({ label: "EST. 1RM",    value: `${est1RM}kg` });
        if (exVolToday > 0) metrics.push({ label: "VOLUME",      value: `${Math.round(exVolToday).toLocaleString()}kg` });
        if (prevBestW > 0)  metrics.push({ label: "LAST TIME",   value: `${prevBestW}kg × ${prevBestR}` });
        const shown = metrics.slice(0, 3);

        if (shown.length) {
          const mTop = div2Y + 68;
          const mW   = (right - cx) / shown.length;
          for (let i = 0; i < shown.length; i++) {
            const mx = cx + i * mW;
            ctx.fillStyle = "rgba(255,255,255,0.28)";
            ctx.font = "600 24px 'Inter', system-ui, sans-serif";
            ctx.fillText(shown[i].label, mx, mTop);
            ctx.fillStyle = "rgba(255,255,255,0.86)";
            ctx.font = "600 50px 'Inter', system-ui, sans-serif";
            ctx.fillText(shown[i].value, mx, mTop + 62);
          }
        }

        // ── Insight line (anchored near bottom) ───────────────────────────
        const hasComment = opts.showComment && sessionComment.trim();
        if (insight) {
          const insightY = cardTop + cardH - (hasComment ? 136 : 72);
          ctx.fillStyle = "rgba(99,102,241,0.88)";
          ctx.font = "500 36px 'Inter', system-ui, sans-serif";
          ctx.fillText(`↑ ${insight}`, cx, insightY);
        }

        // ── Comment (optional, bottom of card) ────────────────────────────
        if (hasComment) {
          const comment = sessionComment.trim();
          const commentY = cardTop + cardH - 68;
          ctx.fillStyle = "rgba(255,255,255,0.34)";
          ctx.font = "italic 36px 'Inter', system-ui, sans-serif";
          let cl = `"${comment}"`;
          while (ctx.measureText(cl).width > cardW - 120 && cl.length > 4) cl = cl.slice(0, -1);
          if (cl !== `"${comment}"`) cl += '…"';
          ctx.fillText(cl, cx, commentY);
        }
      }

    } else {
      // ── WOD / Run ─────────────────────────────────────────────────────────
      const bucketLabel = src === "run_brain" ? "RUN" : "WOD";
      ctx.fillStyle = src === "run_brain" ? "rgba(134, 239, 172, 0.80)" : "rgba(196, 181, 253, 0.80)";
      ctx.font = "700 34px 'Inter', system-ui, sans-serif";
      ctx.fillText(bucketLabel, cx, cy);
      cy += 58;

      if (structure) {
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.font = "400 40px 'Inter', system-ui, sans-serif";
        const words = structure.split(" ");
        let line = "";
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width > cardW - 120) {
            if (cy > cardTop + cardH - 120) break;
            ctx.fillText(line, cx, cy); cy += 56; line = word;
          } else { line = test; }
        }
        if (line && cy <= cardTop + cardH - 120) { ctx.fillText(line, cx, cy); cy += 56; }
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.font = "400 40px 'Inter', system-ui, sans-serif";
        for (const ex of allExercises.slice(0, 5)) {
          if (cy > cardTop + cardH - 120) break;
          const notePart = ex.notes ? ` · ${ex.notes}` : "";
          let line = `· ${ex.name}${notePart}`;
          while (ctx.measureText(line).width > cardW - 120 && line.length > 4)
            line = line.slice(0, -1);
          if (line !== `· ${ex.name}${notePart}`) line += "…";
          ctx.fillText(line, cx, cy); cy += 56;
        }
      }
      const comment = sessionComment.trim();
      if (comment && cy <= cardTop + cardH - 60) {
        cy += 20;
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.font = "italic 36px 'Inter', system-ui, sans-serif";
        let cl = `"${comment}"`;
        while (ctx.measureText(cl).width > cardW - 120 && cl.length > 4) cl = cl.slice(0, -1);
        if (cl !== `"${comment}"`) cl += '…"';
        ctx.fillText(cl, cx, cy);
      }
    }

    return new Promise(resolve => {
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], "axis-workout.png", { type: "image/png" }));
      }, "image/png");
    });
  }

  function buildShareText(): string {
    const name = session.name || "Session";
    const dateStr = format(parseISO(session.date || format(new Date(), "yyyy-MM-dd")), "EEE d MMM");
    const src = (session as any).source as string | undefined;
    const isCondition = src === "wod_brain" || src === "run_brain" || src === "endurance_cycle";
    if (isCondition) {
      const emoji = src === "run_brain" ? "🏃" : "🔥";
      const structure = (session as any).structure as string | undefined;
      const lines = [`${emoji} ${name} — ${dateStr}`, ""];
      if (structure) lines.push(structure);
      else lines.push(...(session.exercises || []).map(ex => `• ${ex.name}${ex.notes ? ` — ${ex.notes}` : ""}`));
      if (sessionComment.trim()) { lines.push(""); lines.push(`"${sessionComment.trim()}"`); }
      lines.push("", "MG Coaching 🏋️");
      return lines.join("\n");
    } else {
      let totalKg = 0; let hasWeight = false;
      for (const ex of [...(session.exercises || []), ...addedExercises])
        for (const set of (logs[ex.id] || []))
          if (set.weight !== null && set.reps !== null) { totalKg += set.weight * set.reps; hasWeight = true; }
      const exNames = [...(session.exercises || []), ...addedExercises].map(ex => `• ${nameOverrides[ex.id] || ex.name}`).join("\n");
      const lines = [`💪 ${name} — ${dateStr}`];
      if (hasWeight) { lines.push(""); lines.push(`Total lifted: ${Math.round(totalKg).toLocaleString()} kg`); }
      if (exNames) { lines.push(""); lines.push("Exercises:"); lines.push(exNames); }
      lines.push("", "MG Coaching 🏋️");
      return lines.join("\n");
    }
  }

  async function openShareModal() {
    const src = (session as any).source as string | undefined;
    const isStrength = !(src === "wod_brain" || src === "run_brain" || src === "endurance_cycle");
    setShareIsStrength(isStrength);
    setShareShowTopSet(true);
    setShareShowComment(true);
    setShareSaved(false);
    setShowShareModal(true);
    setShareImageLoading(true);
    setShareImageUrl(null);
    setShareFile(null);
    const file = await generateShareImage({ showTopSet: true, showComment: true });
    if (file) {
      setShareFile(file);
      setShareImageUrl(URL.createObjectURL(file));
    }
    setShareImageLoading(false);
  }

  function closeShareModal() {
    setShowShareModal(false);
    if (shareImageUrl) { URL.revokeObjectURL(shareImageUrl); setShareImageUrl(null); }
    setShareFile(null);
  }

  async function shareInstagram() {
    if (!shareFile) return;
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [shareFile] })) {
      try { await navigator.share({ files: [shareFile], title: session.name || "Workout" }); }
      catch { /* cancelled */ }
    }
  }

  async function handleSaveImage() {
    if (!shareFile || !shareImageUrl) return;
    // On iOS/Android: native share sheet puts "Save Image" at the top
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [shareFile] })) {
      try { await navigator.share({ files: [shareFile] }); setShareSaved(true); setTimeout(() => setShareSaved(false), 2000); return; }
      catch { /* user cancelled */ return; }
    }
    // Desktop fallback: trigger download
    const a = document.createElement("a");
    a.href = shareImageUrl; a.download = "axis-workout.png"; a.click();
    setShareSaved(true); setTimeout(() => setShareSaved(false), 2000);
  }

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(buildShareText());
      setShareCopied(true); setTimeout(() => setShareCopied(false), 2000);
    } catch { /* */ }
  }

  async function handleShareMore() {
    if (!shareFile) return;
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [shareFile] })) {
      try { await navigator.share({ files: [shareFile], title: session.name || "Workout" }); }
      catch { /* cancelled */ }
    }
  }

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

      {/* Last time you did this session */}
      {prevSession && (prevSession.comment || Object.keys(prevSession.exerciseComments).length > 0) && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-amber-700 mb-1">
                Last time — {format(parseISO(prevSession.date), "EEE d MMM")}
              </p>
              {prevSession.comment && (
                <p className="text-sm text-amber-900 italic leading-snug">"{prevSession.comment}"</p>
              )}
              {Object.keys(prevSession.exerciseComments).length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {Object.entries(prevSession.exerciseComments).map(([name, comment]) => (
                    <li key={name} className="text-xs text-amber-800">
                      <span className="font-semibold capitalize">{name}:</span>{" "}
                      <span className="italic">"{comment}"</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

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
          {/* ── WOD Brain: structured workout definition + result inputs ── */}
          {src === "wod_brain" && (() => {
            const wodFmt = detectWodFormat(session as any);
            const movements = (session.exercises || []);

            // Parse a clean format header from structure or name
            const structureStr = (session as any).structure as string | undefined;
            // e.g. "AMRAP 20: 15 Wall Balls ..." → header = "AMRAP 20"
            const fmtHeader = structureStr
              ? structureStr.split(":")[0].trim()
              : (session.name || "WOD");

            return (
              <>
                {/* Workout definition card */}
                <div className="rounded-2xl border border-purple-200 bg-purple-50 overflow-hidden">
                  {/* Format header */}
                  <div className="bg-purple-600 px-5 py-3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Clock className="w-3.5 h-3.5 text-purple-200 shrink-0" />
                      <span className="text-[10px] font-bold text-purple-200 uppercase tracking-widest">WOD Brain</span>
                    </div>
                    <p className="text-white font-bold text-xl leading-tight">{fmtHeader}</p>
                  </div>

                  {/* Movements */}
                  <div className="px-5 py-4 space-y-2">
                    {movements.length > 0 ? movements.map((ex, i) => (
                      <div key={ex.id} className="flex items-baseline gap-3">
                        <span className="text-xs font-bold text-purple-400 shrink-0 w-4">{i + 1}.</span>
                        <span className="text-sm font-semibold text-foreground">
                          {ex.notes ? `${ex.notes} ` : ""}
                          <span className="capitalize">{ex.name}</span>
                        </span>
                      </div>
                    )) : structureStr ? (
                      <p className="text-sm text-purple-900 italic leading-relaxed">
                        {structureStr.includes(":") ? structureStr.split(":").slice(1).join(":").trim() : structureStr}
                      </p>
                    ) : null}
                  </div>

                  {/* Guidance */}
                  {(session as any).guidance && (
                    <div className="border-t border-purple-200 px-5 py-3 space-y-1.5">
                      {((session as any).guidance as string).split(/\n\n+/).map((para: string, pi: number) => (
                        <p key={pi} className="text-xs text-purple-900/70 leading-relaxed">{para.trim()}</p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Result input — format-specific */}
                <div className="rounded-2xl border border-border bg-background p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Your Result</p>
                    {formatWodResultForDisplay(wodResult, wodFmt) && (
                      <span className="text-xs font-semibold text-primary bg-primary/10 rounded-full px-2.5 py-0.5">
                        {formatWodResultForDisplay(wodResult, wodFmt)}
                      </span>
                    )}
                  </div>

                  {/* AMRAP → rounds + reps */}
                  {wodFmt === "amrap" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Rounds completed</label>
                          <Input
                            type="number" inputMode="numeric" min="0" placeholder="e.g. 7"
                            value={wodResult.rounds ?? ""}
                            onChange={e => { setWodResult(r => ({ ...r, rounds: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                            className="text-center font-bold text-lg h-12"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">+ Additional reps</label>
                          <Input
                            type="number" inputMode="numeric" min="0" placeholder="e.g. 12"
                            value={wodResult.reps ?? ""}
                            onChange={e => { setWodResult(r => ({ ...r, reps: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                            className="text-center font-bold text-lg h-12"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* FOR TIME / CHIPPER / ROUNDS FOR TIME → finish time */}
                  {(wodFmt === "for_time" || wodFmt === "chipper" || wodFmt === "rounds_for_time") && (
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Finish time (mm:ss)</label>
                      <Input
                        type="text" inputMode="text" placeholder="e.g. 12:34"
                        value={wodResult.time ?? ""}
                        onChange={e => { setWodResult(r => ({ ...r, time: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                        className="text-center font-bold text-xl h-14 tracking-widest"
                      />
                    </div>
                  )}

                  {/* EMOM → completed toggle OR score */}
                  {wodFmt === "emom" && (
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => { setWodResult(r => ({ ...r, completed: true })); setSaved(false); scheduleClientAutosave(); }}
                          className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all ${wodResult.completed === true ? "bg-emerald-500 border-emerald-500 text-white" : "border-border text-muted-foreground hover:border-emerald-400"}`}
                        >
                          Completed ✓
                        </button>
                        <button
                          onClick={() => { setWodResult(r => ({ ...r, completed: false })); setSaved(false); scheduleClientAutosave(); }}
                          className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all ${wodResult.completed === false ? "bg-red-500 border-red-500 text-white" : "border-border text-muted-foreground hover:border-red-400"}`}
                        >
                          Did not finish
                        </button>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Score / notes (optional)</label>
                        <Input
                          type="text" placeholder="e.g. 18/20 rounds completed, 144 reps"
                          value={wodResult.score ?? ""}
                          onChange={e => { setWodResult(r => ({ ...r, score: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                          className="text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {/* INTERVAL → total output */}
                  {wodFmt === "interval" && (
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Total output / score</label>
                      <Input
                        type="text" placeholder="e.g. 4800m, or 12 cal avg per round"
                        value={wodResult.score ?? ""}
                        onChange={e => { setWodResult(r => ({ ...r, score: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                        className="text-sm"
                      />
                    </div>
                  )}

                  {/* Other / unknown */}
                  {wodFmt === "other" && (
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Score / result</label>
                      <Input
                        type="text" placeholder="e.g. 7 rounds + 12 reps, or 14:32"
                        value={wodResult.score ?? ""}
                        onChange={e => { setWodResult(r => ({ ...r, score: e.target.value })); setSaved(false); scheduleClientAutosave(); }}
                        className="text-sm"
                      />
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* Run interval logging */}
          {(src === "run_brain" || src === "endurance_cycle") && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground tracking-widest uppercase px-1">What you ran</p>
              <div className="rounded-xl border border-border overflow-hidden">
                {/* Header row */}
                <div className="grid grid-cols-[2rem_1fr_1fr_2rem] gap-0 bg-muted/40 border-b border-border px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>#</span>
                  <span>Distance (km)</span>
                  <span>Pace (min/km)</span>
                  <span />
                </div>
                {runIntervals.map((interval, idx) => (
                  <div key={idx} className="grid grid-cols-[2rem_1fr_1fr_2rem] gap-0 items-center px-3 py-1.5 border-b border-border last:border-b-0 bg-background">
                    <span className="text-xs font-bold text-muted-foreground">{idx + 1}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      placeholder="e.g. 5.0"
                      value={interval.distance}
                      onChange={e => {
                        const updated = [...runIntervals];
                        updated[idx] = { ...updated[idx], distance: e.target.value };
                        setRunIntervals(updated);
                        setSaved(false);
                        scheduleClientAutosave();
                      }}
                      className="h-9 text-center text-sm font-bold border-0 shadow-none bg-transparent focus:bg-muted/30 rounded-lg"
                    />
                    <Input
                      type="text"
                      inputMode="text"
                      placeholder="e.g. 5:30"
                      value={interval.pace}
                      onChange={e => {
                        const updated = [...runIntervals];
                        updated[idx] = { ...updated[idx], pace: e.target.value };
                        setRunIntervals(updated);
                        setSaved(false);
                        scheduleClientAutosave();
                      }}
                      className="h-9 text-center text-sm font-bold border-0 shadow-none bg-transparent focus:bg-muted/30 rounded-lg"
                    />
                    <button
                      type="button"
                      disabled={runIntervals.length === 1}
                      onClick={() => {
                        setRunIntervals(runIntervals.filter((_, i) => i !== idx));
                        setSaved(false);
                        scheduleClientAutosave();
                      }}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-20 disabled:cursor-not-allowed p-1 rounded transition-colors flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { setRunIntervals([...runIntervals, { distance: "", pace: "" }]); setSaved(false); scheduleClientAutosave(); }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-emerald-400/60 text-emerald-700 hover:bg-emerald-50 text-xs font-medium transition-colors"
              >
                <Plus className="w-3 h-3" /> Add interval
              </button>
            </div>
          )}

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

          {/* Share workout */}
          <button onClick={openShareModal} className="button-secondary w-full">
            <Share2 className="w-4 h-4" /> Share workout
          </button>
        </div>
        );
      })()}

      {/* Exercises (strength sessions — no source, strength_block, or strength_programme) */}
      {(!(session as any).source || (session as any).source === "strength_block" || (session as any).source === "strength_programme") && (
      <div className="max-w-lg mx-auto px-4 pt-4">
        {(session.exercises || []).filter(ex => !deletedExIds.has(ex.id)).map((ex, exIdx) => {
          const setsCount = setCountOverrides[ex.id] ?? ex.sets ?? 0;
          const exLogs = logs[ex.id] || [];
          const isListening = listeningFor === ex.id;
          const isParsing = parsingFor === ex.id;
          const isSwapping = swappingExId === ex.id;
          const displayName = nameOverrides[ex.id] || ex.name;
          const wasSwapped = !!nameOverrides[ex.id];
          const loggedCount = exLogs.filter(l => l.weight !== null || l.reps !== null).length;
          const allLogged = setsCount > 0 && loggedCount === setsCount;

          return (
            <div key={ex.id} className={`exercise transition-all ${isListening ? "ring-2 ring-primary/50" : ""} ${isSwapping ? "ring-2 ring-orange-400/60" : ""}`}>
              {/* Exercise header */}
              <div className="exercise-header">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${allLogged ? "bg-green-100 text-green-700" : "bg-primary/10 text-primary"}`}>
                    {allLogged ? "✓" : exIdx + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="exercise-name">{displayName}</h3>
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
                <div className="exercise-actions">
                  <Button
                    size="sm" variant="ghost"
                    className={`rounded-xl gap-1 h-8 px-2 text-xs ${isSwapping ? "text-orange-600 bg-orange-50" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => { if (isSwapping) { cancelSwap(); } else { setSwappingExId(ex.id); setSwapText(""); } }}
                    disabled={isParsing || (!!listeningFor && !isListening)}
                  >
                    {isSwapping ? <X className="w-3.5 h-3.5" /> : <ArrowLeftRight className="w-3.5 h-3.5" />}
                    {isSwapping ? "Cancel" : "Swap"}
                  </Button>
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
                  {!isSwapping && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDeleteExId(ex.id)}
                      title="Remove exercise"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Meta tags */}
              <div className="flex flex-wrap gap-1.5 mb-2 ml-8">
                {ex.perSetReps && ex.perSetReps.length > 0
                  ? <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.perSetReps.join("/")} reps</span>
                  : ex.sets && ex.reps && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.sets} × {ex.reps}</span>}
                {!ex.perSetRpe?.length && ex.rpe && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Zap className="w-3 h-3" />RPE {ex.rpe}</span>}
                {ex.rest && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Clock className="w-3 h-3" />Rest {ex.rest}</span>}
              </div>
              {ex.notes && <p className="text-xs text-muted-foreground mb-2 ml-8 italic">{ex.notes}</p>}

              {/* Last time reminder — weights/reps */}
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
                  <div className="flex items-center gap-1.5 mb-1 ml-8">
                    <Clock className="w-3 h-3 text-blue-400 shrink-0" />
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-semibold text-blue-500">{format(parseISO(prev.date), "d MMM")}:</span>{" "}
                      {setsText}
                    </p>
                  </div>
                );
              })()}
              {(() => {
                const prevComment = prevSession?.exerciseComments[ex.name.toLowerCase().trim()];
                if (!prevComment) return null;
                return (
                  <div className="flex items-start gap-1.5 mb-1 ml-8">
                    <span className="text-[11px] text-amber-600 font-semibold shrink-0 mt-px">Note:</span>
                    <p className="text-[11px] text-amber-700 italic leading-snug">"{prevComment}"</p>
                  </div>
                );
              })()}

              {/* Swap input panel — negative margin to break out of card padding */}
              {isSwapping && (
                <div className="-mx-4 mt-3 px-4 py-4 bg-orange-50/60 border-y border-orange-100">
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
              <div className="mt-3">
                {isParsing ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />Parsing your log...
                  </div>
                ) : setsCount === 0 ? (
                  <>
                  <p className="text-xs text-muted-foreground italic text-center py-2">No sets defined</p>
                  <button
                    type="button"
                    onClick={() => addSetToExercise(ex.id, setsCount)}
                    className="mt-1 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-primary/30 text-primary/60 hover:text-primary hover:bg-primary/8 hover:border-primary/50 text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add set
                  </button>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-2 mb-1">
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
                        <div key={setIdx} className={`set-row transition-colors ${isDone ? "bg-primary/5 border border-primary/20" : "bg-muted/40"}`}>
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
                    <button
                      type="button"
                      onClick={() => addSetToExercise(ex.id, setsCount)}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-primary/30 text-primary/60 hover:text-primary hover:bg-primary/8 hover:border-primary/50 text-xs font-medium transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add set
                    </button>
                  </>
                )}
              </div>

              {/* Client comment box */}
              <div className="notes-section">
                <div className={`relative rounded-xl border transition-colors ${commentListeningFor === ex.id ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20 hover:border-muted-foreground/30"}`}>
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
        {addedExercises.filter(ex => !deletedExIds.has(ex.id)).map((ex, exIdx) => {
          const setsCount = setCountOverrides[ex.id] ?? ex.sets ?? 0;
          const exLogs = logs[ex.id] || [];
          const loggedCount = exLogs.filter(l => l.weight !== null || l.reps !== null).length;
          const allLogged = setsCount > 0 && loggedCount === setsCount;
          const totalIdx = (session.exercises?.length || 0) + exIdx;

          return (
            <div key={ex.id} className="exercise border-dashed border-primary/40">
              <div className="exercise-header">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${allLogged ? "bg-green-100 text-green-700" : "bg-primary/20 text-primary"}`}>
                    {allLogged ? "✓" : totalIdx + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="exercise-name">{ex.name}</h3>
                    <p className="text-[10px] text-primary/60 font-medium mt-0.5 flex items-center gap-1">
                      <Plus className="w-2.5 h-2.5" /> added by you
                    </p>
                  </div>
                </div>
                <div className="exercise-actions">
                  <Button
                    size="sm" variant="ghost"
                    className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => removeAddedExercise(ex.id)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-2 ml-8">
                {ex.perSetReps && ex.perSetReps.length > 0
                  ? <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.perSetReps.join("/")} reps</span>
                  : ex.sets && ex.reps && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.sets} × {ex.reps}</span>}
                {!ex.perSetRpe?.length && ex.rpe && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Zap className="w-3 h-3" />RPE {ex.rpe}</span>}
                {ex.rest && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Clock className="w-3 h-3" />Rest {ex.rest}</span>}
              </div>
              {ex.notes && <p className="text-xs text-muted-foreground mb-2 ml-8 italic">{ex.notes}</p>}

              <div className="mt-3">
                {setsCount === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-2">No sets defined</p>
                ) : (
                  <>
                    <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-2 mb-1">
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
                        <div key={setIdx} className={`set-row transition-colors ${isDone ? "bg-primary/5 border border-primary/20" : "bg-muted/40"}`}>
                          <div className={`text-sm font-bold pl-1 leading-tight ${isDone ? "text-primary" : "text-muted-foreground"}`}>
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
                    <button
                      type="button"
                      onClick={() => addSetToExercise(ex.id, setsCount)}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-primary/30 text-primary/60 hover:text-primary hover:bg-primary/8 hover:border-primary/50 text-xs font-medium transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add set
                    </button>
                  </>
                )}
              </div>

              {/* Client comment box */}
              <div className="notes-section">
                <div className={`relative rounded-xl border transition-colors ${commentListeningFor === ex.id ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20 hover:border-muted-foreground/30"}`}>
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

        {/* Share workout */}
        <button onClick={openShareModal} className="button-secondary w-full">
          <Share2 className="w-4 h-4" /> Share workout
        </button>

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

      {/* ── Share Activity Modal ──────────────────────────────────────── */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={closeShareModal} />
          <div className="relative bg-background rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <button onClick={closeShareModal} className="text-sm text-foreground font-medium">Close</button>
              <p className="font-semibold text-sm">Share Activity</p>
              <div className="w-12" />
            </div>

            {/* Card preview */}
            <div className="flex justify-center py-5 px-5">
              <div
                className="relative rounded-2xl overflow-hidden shadow-xl"
                style={{
                  width: 210, height: 374,
                  backgroundImage: "linear-gradient(45deg,#8b8b8b 25%,transparent 25%),linear-gradient(-45deg,#8b8b8b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#8b8b8b 75%),linear-gradient(-45deg,transparent 75%,#8b8b8b 75%)",
                  backgroundSize: "18px 18px",
                  backgroundPosition: "0 0,0 9px,9px -9px,-9px 0",
                  backgroundColor: "#6b7280",
                }}
              >
                <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-black/55 backdrop-blur-sm text-white text-[9px] font-bold tracking-wider px-2 py-0.5 rounded">
                  TRANSPARENT
                </div>
                {shareImageLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                  </div>
                ) : shareImageUrl ? (
                  <img src={shareImageUrl} alt="Workout card preview" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-white/40 text-xs text-center px-4">Couldn't generate card</p>
                  </div>
                )}
              </div>
            </div>

            {/* Strength-only toggle */}
            {shareIsStrength && sessionComment.trim() && (
              <div className="px-5 pb-1">
                <div className="flex gap-3">
                  <button
                    onClick={() => setShareShowComment(v => !v)}
                    className={[
                      "flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-medium transition-all",
                      shareShowComment
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-muted/40 border-border text-muted-foreground",
                    ].join(" ")}
                  >
                    <span>Include comment</span>
                    {shareShowComment && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                </div>
              </div>
            )}

            <div className="px-5 py-5">
              <button
                onClick={handleSaveImage}
                disabled={shareImageLoading || !shareFile}
                className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-base shadow-md disabled:opacity-50 transition-opacity hover:bg-primary/90"
              >
                {shareSaved
                  ? <><Check className="w-5 h-5" /> Saved to camera roll</>
                  : shareImageLoading
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Generating…</>
                  : <><Download className="w-5 h-5" /> Save Image</>
                }
              </button>
              <p className="text-xs text-muted-foreground text-center mt-3">
                Transparent PNG — layer it over your content in Instagram or any editor.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Delete exercise confirmation */}
      <AlertDialog open={!!confirmDeleteExId} onOpenChange={open => { if (!open) setConfirmDeleteExId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove exercise?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDeleteExId
                ? (session.exercises?.find(e => e.id === confirmDeleteExId)?.name
                  || addedExercises.find(e => e.id === confirmDeleteExId)?.name
                  || "This exercise")
                : "This exercise"}" will be removed from the session. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDeleteExId) return;
                setDeletedExIds(prev => new Set([...prev, confirmDeleteExId]));
                setConfirmDeleteExId(null);
                setSaved(false);
                scheduleClientAutosave();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
