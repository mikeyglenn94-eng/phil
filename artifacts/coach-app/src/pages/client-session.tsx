import { useState, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import html2canvas from "html2canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Save, Loader2, CheckCircle2, Clock, Repeat, Zap,
  Mic, Square, Volume2, ArrowLeftRight, X, Check, Plus, Send, PlayCircle, Share2, Download, Copy, Trash2,
  Pencil,
} from "lucide-react";
import {
  WorkoutPreviewEditorCard,
  type EditableSession,
  sessionToEditable,
  editableSessionToSession,
} from "@/components/workout-preview-editor";
import { useMicrophone } from "@/hooks/use-microphone";
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
import {
  normalizeExerciseName,
  findBestMatch,
} from "@/lib/exercise-matching";

interface SetLog { weight: number | null; reps: number | null; }
type LogState = Record<string, SetLog[]>;
interface RunInterval {
  label: string;           // "Rep 1", "Warm-up", or empty
  distance: string;        // planned distance/duration from session, e.g. "2 km"
  targetPace: string;      // planned target pace, e.g. "4:30/km"
  pace: string;            // actual pace logged by user
  notes: string;
  equivalentRoadPace?: string | null;
}

type RunSurface = "road" | "trail";
type TrailDifficulty = "moderate" | "hilly" | "technical";

const TRAIL_FACTORS: Record<TrailDifficulty, number> = {
  moderate: 0.92,
  hilly: 0.86,
  technical: 0.80,
};

function paceToSeconds(pace: string): number | null {
  const match = /^(\d+):([0-5]\d)$/.exec(pace.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function secondsToPace(s: number): string {
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${(r % 60).toString().padStart(2, "0")}`;
}

function calcEquivalentPace(
  pace: string,
  surface: RunSurface,
  difficulty: TrailDifficulty | null
): string | null {
  const sec = paceToSeconds(pace);
  if (sec == null) return null;
  if (surface === "road") return null;
  if (!difficulty) return null;
  return secondsToPace(sec * TRAIL_FACTORS[difficulty]);
}

// Safely display a reps value — guards against "NaN" strings stored by old
// progression logic that ran parseInt on non-numeric rep ranges.
function safeReps(r: any): string {
  if (r == null) return "";
  const s = String(r);
  return (s === "NaN" || s === "null" || s === "undefined") ? "" : s;
}

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

// ── Bodyweight exercise detection ──────────────────────────────────────────────
const BW_TERMS = [
  "pull-up", "pull up", "pullup", "pullups",
  "chin-up", "chin up", "chinup", "chinups",
  "muscle-up", "muscle up", "muscleup",
  "ring dip",
  "push-up", "push up", "pushup", "pushups",
  "sit-up", "sit up", "situp",
  "pistol squat", "pistol",
  "handstand",
  "burpee",
  "box jump",
  "toes to bar", "toes-to-bar",
  "knees to elbow", "knees-to-elbow",
  "rope climb",
  "air squat",
  "hollow hold", "hollow rock",
  "double under",
  "wall walk",
  "dip",
];
// ── Previous performance display formatter ─────────────────────────────────
function formatPrevSets(sets: SetLog[], isBw: boolean, unit = "kg"): string {
  const valid = sets.filter(s => s.reps !== null || s.weight !== null);
  if (valid.length === 0) return "";

  // ── Bodyweight path ───────────────────────────────────────────────────────
  if (isBw) {
    const reps = valid.map(s => s.reps).filter((r): r is number => r !== null);
    if (reps.length === 0) return "";
    const allSameReps = reps.every(r => r === reps[0]);
    if (allSameReps) return `${reps.length} × ${reps[0]}`;
    return reps.join(", ");
  }

  // ── External load path ────────────────────────────────────────────────────
  const weights = valid.map(s => s.weight);
  const reps    = valid.map(s => s.reps);

  const allHaveWeight = weights.every(w => w !== null);
  const allHaveReps   = reps.every(r => r !== null);

  // All same weight AND same reps → "3 × 10kg × 4"
  if (allHaveWeight && allHaveReps) {
    const uniqueWeights = new Set(weights);
    const uniqueReps    = new Set(reps);
    if (uniqueWeights.size === 1 && uniqueReps.size === 1) {
      return `${valid.length} × ${weights[0]}${unit} × ${reps[0]}`;
    }
    // Same weight, varying reps → "10kg × 8, 8, 6"
    if (uniqueWeights.size === 1) {
      return `${weights[0]}${unit} × ${(reps as number[]).join(", ")}`;
    }
    // Varying load (with or without varying reps) → "10kg × 8, 12kg × 6, 14kg × 4"
    return valid.map(s =>
      `${s.weight}${unit} × ${s.reps}`
    ).join(", ");
  }

  // Weight only (no reps recorded)
  if (allHaveWeight && !allHaveReps) {
    const uniqueWeights = new Set(weights);
    if (uniqueWeights.size === 1) return `${valid.length} × ${weights[0]}${unit}`;
    return weights.map(w => `${w}${unit}`).join(", ");
  }

  // Reps only (no weight recorded)
  if (!allHaveWeight && allHaveReps) {
    const uniqueReps = new Set(reps);
    if (uniqueReps.size === 1) return `${valid.length} × ${reps[0]}`;
    return (reps as number[]).join(", ");
  }

  // Mixed presence — show what we have per set
  return valid.map(s => {
    if (s.weight !== null && s.reps !== null) return `${s.weight}${unit} × ${s.reps}`;
    if (s.weight !== null) return `${s.weight}${unit}`;
    if (s.reps !== null) return `×${s.reps}`;
    return null;
  }).filter(Boolean).join(", ");
}

function detectLoadType(name: string): "bodyweight" | "external_load" {
  const lower = (name || "").toLowerCase();
  return BW_TERMS.some(t => lower.includes(t)) ? "bodyweight" : "external_load";
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
      if (ex.clientComment) exerciseComments[normalizeExerciseName(ex.name)] = ex.clientComment;
    }
    return { date: candidate.date, comment: (candidate as any).clientComment ?? null, exerciseComments };
  }, [programme, sessionId, session]);

  // Previous logged results indexed by normalizedName — supports fuzzy matching
  const prevLogsMap = useMemo<Record<string, { date: string; sets: SetLog[]; originalName: string }>>(() => {
    if (!programme?.sessions || !session) return {};
    const map: Record<string, { date: string; sets: SetLog[]; originalName: string }> = {};
    const pastSessions = (programme.sessions as Session[])
      .filter(s => s.id !== sessionId && s.date <= session.date)
      .sort((a, b) => b.date.localeCompare(a.date)); // most recent first
    for (const s of pastSessions) {
      for (const ex of (s.exercises || [])) {
        // Prefer stored canonicalExerciseKey as index; fall back to normalized name
        const key = (ex as any).canonicalExerciseKey ?? normalizeExerciseName(ex.name);
        if (map[key]) continue; // already captured the most recent for this key
        const hasWeight = ex.setWeights?.some(w => w !== null) ?? false;
        const hasReps = ex.setReps?.some(r => r !== null) ?? false;
        if (!hasWeight && !hasReps) continue;
        const count = Math.max(ex.setWeights?.length ?? 0, ex.setReps?.length ?? 0);
        const sets: SetLog[] = Array.from({ length: count }, (_, i) => ({
          weight: ex.setWeights?.[i] ?? null,
          reps: ex.setReps?.[i] ?? null,
        }));
        if (sets.length > 0) map[key] = { date: s.date, sets, originalName: ex.name };
      }
    }
    return map;
  }, [programme, sessionId, session]);

  // Flat index of normalizedKey → originalName for findBestMatch
  const prevLogsCandidates = useMemo<Record<string, string>>(() => {
    const idx: Record<string, string> = {};
    for (const [key, val] of Object.entries(prevLogsMap)) {
      idx[key] = val.originalName;
    }
    return idx;
  }, [prevLogsMap]);

  // ── Edit-mode state (edit published workout inline) ────────────────────────
  const [isEditMode, setIsEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState<EditableSession | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  function enterEditMode() {
    if (!session) return;
    setEditDraft(sessionToEditable(session));
    setIsEditMode(true);
  }

  function cancelEditMode() {
    setIsEditMode(false);
    setEditDraft(null);
  }

  async function saveEdit() {
    if (!programme || !session || !editDraft) return;
    setIsSavingEdit(true);
    try {
      const updatedSessionData = editableSessionToSession(editDraft);
      // Preserve logging data that should not be wiped by a structural edit
      const preserved = {
        clientComment: (session as any).clientComment ?? null,
        wodResult: (session as any).wodResult ?? null,
        runLog: (session as any).runLog ?? null,
        setWeights: undefined,
        setReps: undefined,
      };
      const merged = {
        ...updatedSessionData,
        id: session.id,
        date: session.date,
        clientComment: preserved.clientComment,
        ...(preserved.wodResult ? { wodResult: preserved.wodResult } : {}),
        ...(preserved.runLog ? { runLog: preserved.runLog } : {}),
      };
      const updatedSessions = (programme.sessions || []).map((s: Session) =>
        s.id !== sessionId ? s : merged
      );
      await updateMutation.mutateAsync({ id: programmeId, data: { sessions: updatedSessions } });
      queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey() });
      toast({ title: "Workout updated!" });
      setIsEditMode(false);
      setEditDraft(null);
    } catch {
      toast({ title: "Error saving changes", variant: "destructive" });
    } finally {
      setIsSavingEdit(false);
    }
  }

  // Local name overrides for swapped exercises
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogState>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const autosaveTimerRef_cs = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSaveRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);
  const savedRef = useRef(true);
  // Keep savedRef in sync with saved state (used by beforeunload and unmount handlers)
  useEffect(() => { savedRef.current = saved; }, [saved]);

  // Flush pending autosave immediately when the component unmounts (e.g. user navigates away or logs out)
  useEffect(() => {
    return () => {
      if (autosaveTimerRef_cs.current) {
        clearTimeout(autosaveTimerRef_cs.current);
        autosaveTimerRef_cs.current = null;
        handleSaveRef.current?.(true);
      }
    };
  }, []);

  // Warn the browser if the user tries to close the tab with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!savedRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

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
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [shareImageLoading, setShareImageLoading] = useState(false);
  const [shareSaved, setShareSaved] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareShowComment, setShareShowComment] = useState(true);
  const [shareGoals, setShareGoals] = useState<any[]>([]);
  const shareWidgetRef = useRef<HTMLDivElement>(null);

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
  // Session comment MediaRecorder (Whisper pass — same pattern as strength log)
  const sessionCommentActiveRef = useRef(false);
  const sessionCommentMrRef = useRef<MediaRecorder | null>(null);
  const sessionCommentChunksRef = useRef<Blob[]>([]);
  const sessionCommentUsingMrRef = useRef(false);

  // Mic permission + bodyweight overrides
  const { requestPermission: warmMic } = useMicrophone();
  const [loadTypeOverrides, setLoadTypeOverrides] = useState<Record<string, "bodyweight" | "external_load">>({});

  // WOD result state
  const [wodResult, setWodResult] = useState<WodResult>({});

  // Run interval logging state
  const [runIntervals, setRunIntervals] = useState<RunInterval[]>([{ label: "", distance: "", targetPace: "", pace: "", notes: "" }]);
  const [runSurface, setRunSurface] = useState<RunSurface>("road");
  const [trailDifficulty, setTrailDifficulty] = useState<TrailDifficulty | null>(null);

  // Init logs from saved data
  useEffect(() => {
    if (!session) return;
    const initial: LogState = {};
    for (const ex of session.exercises || []) {
      // Use the greater of: planned sets, logged weights count, logged reps count
      // This ensures we never silently drop logged data if ex.sets doesn't match
      const count = Math.max(
        ex.sets || 0,
        ex.setWeights?.length || 0,
        ex.setReps?.length || 0,
      );
      initial[ex.id] = Array.from({ length: count }, (_, i) => ({
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
    // Init run intervals from saved log (first priority) or structured plan data
    const savedRunLog = (session as any).runLog as Array<{
      label?: string | null; distance?: number | string | null; targetPace?: string | null; pace?: string | null; notes?: string | null;
    }> | undefined;
    // Restore surface/difficulty at session level
    const savedSurface = (session as any).runSurface as RunSurface | undefined;
    const savedDifficulty = (session as any).trailDifficulty as TrailDifficulty | undefined;
    if (savedSurface) setRunSurface(savedSurface);
    if (savedDifficulty) setTrailDifficulty(savedDifficulty);

    if (savedRunLog && savedRunLog.length > 0) {
      setRunIntervals(savedRunLog.map(r => ({
        label: r.label ?? "",
        distance: r.distance != null ? String(r.distance) : "",
        targetPace: r.targetPace ?? "",
        pace: r.pace ?? "",
        notes: r.notes ?? "",
        equivalentRoadPace: (r as any).equivalentRoadPace ?? null,
      })));
    } else {
      // Pre-populate from structured runBlocks or exercises (plan data)
      const runBlocks = (session as any).runBlocks as Array<{ blockType: string; label: string; rows: any[] }> | undefined;
      if (runBlocks?.length) {
        const intervals: RunInterval[] = [];
        for (const block of runBlocks) {
          for (const row of (block.rows ?? [])) {
            if (row.rowType === "rest") continue;
            intervals.push({
              label: row.rowType === "interval" ? `Rep ${row.repNumber ?? ""}`.trim() : (block.label || ""),
              distance: row.distance || row.duration || "",
              targetPace: row.pace || "",
              pace: "",
              notes: row.effort || "",
            });
          }
        }
        setRunIntervals(intervals.length > 0 ? intervals : [{ label: "", distance: "", targetPace: "", pace: "", notes: "" }]);
      } else {
        // Fallback: one row per exercise that looks like an interval
        const exs = (session.exercises ?? []).filter((e: any) => e.name?.startsWith("Rep") || (session as any).source === "run_brain");
        if (exs.length > 1) {
          setRunIntervals(exs.map((e: any) => ({
            label: e.name || "",
            distance: e.reps || "",
            targetPace: e.notes?.match(/@ ?([\d:]+\/km)/)?.[1] ?? "",
            pace: "",
            notes: "",
          })));
        } else {
          setRunIntervals([{ label: "", distance: "", targetPace: "", pace: "", notes: "" }]);
        }
      }
    }
  }, [session]);


  // ── Pre-warm mic permission (prevents iOS freeze on first Record tap) ─────────
  useEffect(() => {
    const timer = setTimeout(() => { warmMic(); }, 1000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bodyweight helpers ────────────────────────────────────────────────────────
  const getExLoadType = (exId: string, exName: string): "bodyweight" | "external_load" => {
    const override = loadTypeOverrides[exId];
    if (override) return override;
    return detectLoadType(nameOverrides[exId] || exName);
  };
  const toggleExLoadType = (exId: string, exName: string) => {
    const current = getExLoadType(exId, exName);
    setLoadTypeOverrides(prev => ({ ...prev, [exId]: current === "bodyweight" ? "external_load" : "bodyweight" }));
  };

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

  // ── Session-level comment voice (WOD/Run Brain) ───────────────────────────
  // Mirrors the strength log recording: Web Speech for live preview +
  // MediaRecorder → Whisper for accuracy. Fixes the WOD-only recording issue.
  const toggleSessionCommentListening = () => {
    if (sessionCommentActiveRef.current) {
      // STOP
      sessionCommentActiveRef.current = false;
      stopRef(sessionCommentRecRef);
      if (sessionCommentUsingMrRef.current && sessionCommentMrRef.current?.state === "recording") {
        sessionCommentMrRef.current.stop(); // onstop handles Whisper + cleanup
      } else {
        const leftover = sessionCommentInterimRef.current.trim();
        if (leftover) setSessionComment(prev => (prev ? prev + " " : "") + leftover);
        sessionCommentInterimRef.current = "";
        setSessionCommentInterim("");
        setSessionCommentListening(false);
      }
      return;
    }
    // START
    sessionCommentActiveRef.current = true;
    sessionCommentUsingMrRef.current = false;
    sessionCommentInterimRef.current = "";
    setSessionCommentInterim("");
    setSessionCommentListening(true);
    // MediaRecorder for Whisper accuracy (async — Web Speech starts immediately)
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
          if (!sessionCommentActiveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
          const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find(t => MediaRecorder.isTypeSupported(t)) ?? "";
          const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          sessionCommentChunksRef.current = [];
          mr.ondataavailable = e => { if (e.data.size > 0) sessionCommentChunksRef.current.push(e.data); };
          mr.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            sessionCommentUsingMrRef.current = false;
            const blob = new Blob(sessionCommentChunksRef.current, { type: mimeType || "audio/webm" });
            let transcript = sessionCommentInterimRef.current.trim();
            if (blob.size > 1500) {
              try {
                const result = await transcribeAudio({ audio: blob });
                if (result.transcript?.trim()) transcript = result.transcript.trim();
              } catch {}
            }
            if (transcript) setSessionComment(prev => (prev ? prev + " " : "") + transcript);
            sessionCommentInterimRef.current = "";
            setSessionCommentInterim("");
            setSessionCommentListening(false);
          };
          mr.start(500);
          sessionCommentMrRef.current = mr;
          sessionCommentUsingMrRef.current = true;
        })
        .catch(() => { /* mic denied — Web Speech only continues */ });
    }
    spawnSessionCommentRec();
  };

  function spawnSessionCommentRec() {
    if (!sessionCommentActiveRef.current) return;
    const r = makeSR();
    if (!r) { sessionCommentActiveRef.current = false; setSessionCommentListening(false); return; }
    r.onresult = (e: any) => {
      let fin = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      sessionCommentInterimRef.current = interim;
      setSessionCommentInterim(interim);
      if (fin) { sessionCommentInterimRef.current = fin; setSessionCommentInterim(""); }
    };
    r.onerror = () => { sessionCommentInterimRef.current = ""; setSessionCommentInterim(""); };
    r.onend = () => {
      if (sessionCommentActiveRef.current) { setTimeout(spawnSessionCommentRec, 100); return; }
      // Stopped by user and no MediaRecorder running — commit Web Speech text
      if (!sessionCommentUsingMrRef.current) {
        const leftover = sessionCommentInterimRef.current.trim();
        if (leftover) setSessionComment(prev => (prev ? prev + " " : "") + leftover);
        sessionCommentInterimRef.current = "";
        setSessionCommentInterim("");
        setSessionCommentListening(false);
      }
    };
    sessionCommentRecRef.current = r;
    try { r.start(); } catch { sessionCommentActiveRef.current = false; setSessionCommentListening(false); }
  }

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
    autosaveTimerRef_cs.current = setTimeout(() => { handleSaveRef.current?.(true); }, 800);
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
              .filter(r => r.distance !== "" || r.pace !== "" || r.label !== "")
              .map(r => {
                // Parse distance string to number (km). "9.57" → 9.57, "10 km" → 10, "" → null.
                const rawDist = r.distance.trim();
                const distNum = rawDist !== ""
                  ? (() => { const n = parseFloat(rawDist); return isNaN(n) ? null : n; })()
                  : null;
                return {
                  label: r.label || null,
                  distance: distNum,
                  targetPace: r.targetPace || null,
                  pace: r.pace || null,
                  notes: r.notes || null,
                  equivalentRoadPace: calcEquivalentPace(r.pace, runSurface, trailDifficulty),
                };
              });
            return {
              ...base,
              runLog: runLog.length > 0 ? runLog : null,
              runSurface,
              trailDifficulty: runSurface === "trail" ? trailDifficulty : null,
            };
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
      // Also refresh dashboard analytics so it reflects the newly logged data
      if (programme?.clientId) {
        queryClient.invalidateQueries({ queryKey: ["client-analytics", programme.clientId] });
      }
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
    setShareSaved(false);
    setShareCopied(false);
    setShareShowComment(true);
    setShareFile(null);
    setShareGoals([]);
    setShowShareModal(true);
    // Fetch goals for goal progress strip
    const cid = programme?.clientId;
    if (cid) {
      fetch(`/api/clients/${cid}/training-goals`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setShareGoals(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }

  function closeShareModal() {
    setShowShareModal(false);
    setShareFile(null);
  }

  async function handleSaveImage() {
    if (!shareWidgetRef.current) return;
    setShareImageLoading(true);
    try {
      const canvas = await html2canvas(shareWidgetRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      canvas.toBlob(blob => {
        if (!blob) return;
        const name = session.name || "session";
        const file = new File([blob], `phil-${name.toLowerCase().replace(/\s+/g, "-")}.png`, { type: "image/png" });
        setShareFile(file);
        // iOS/Android: native share sheet
        if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
          navigator.share({ files: [file] }).then(() => {
            setShareSaved(true); setTimeout(() => setShareSaved(false), 2500);
          }).catch(() => {});
        } else {
          // Desktop: download
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = file.name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          setShareSaved(true); setTimeout(() => setShareSaved(false), 2500);
        }
      }, "image/png");
    } catch (err) {
      console.error("html2canvas error", err);
    } finally {
      setShareImageLoading(false);
    }
  }

  async function handleCopyImage() {
    if (!shareWidgetRef.current) return;
    setShareImageLoading(true);
    try {
      const canvas = await html2canvas(shareWidgetRef.current, {
        backgroundColor: null, scale: 2, useCORS: true, allowTaint: true, logging: false,
      });
      canvas.toBlob(async blob => {
        if (!blob) return;
        const file = new File([blob], "phil-workout.png", { type: "image/png" });
        setShareFile(file);
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          setShareCopied(true); setTimeout(() => setShareCopied(false), 2500);
        } catch {
          // Clipboard blocked — fall back to download
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = file.name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          setShareSaved(true); setTimeout(() => setShareSaved(false), 2500);
        }
      }, "image/png");
    } catch (err) {
      console.error("html2canvas copy error", err);
    } finally {
      setShareImageLoading(false);
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
            <Button variant="ghost" size="icon" onClick={isEditMode ? cancelEditMode : () => setLocation("/client?tab=training")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{isEditMode ? "Editing workout" : dateLabel}</p>
              <h1 className="font-bold text-lg leading-tight truncate">{isEditMode ? (editDraft?.title || session.name || "Session") : (session.name || "Session")}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isEditMode ? (
              <>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={cancelEditMode}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="rounded-xl px-5 gap-2 bg-primary"
                  onClick={() => void saveEdit()}
                  disabled={isSavingEdit}
                >
                  {isSavingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Save changes
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost" size="icon"
                  className="rounded-xl text-muted-foreground hover:text-foreground"
                  onClick={enterEditMode}
                  title="Edit workout"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleSave} disabled={isSaving}
                  className={`rounded-xl px-5 gap-2 ${saved ? "bg-green-600 hover:bg-green-700" : ""}`}
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {saved ? "Saved" : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>
        {!isEditMode && totalSets > 0 && (
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

      {/* ── EDIT MODE: full-page inline editor ── */}
      {isEditMode && editDraft && (
        <div className="max-w-lg mx-auto px-4 pt-5 pb-8">
          <WorkoutPreviewEditorCard
            editableSession={editDraft}
            onChange={setEditDraft as (v: EditableSession) => void}
            compact
          />
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 leading-relaxed">
            <strong>Note:</strong> Editing the workout structure won't delete any logged results or feedback you've already saved.
          </div>
        </div>
      )}

      {/* ── NORMAL VIEW (hidden while editing) ── */}
      {!isEditMode && (<>

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
            const structureStr = (session as any).structure as string | undefined;
            const fmtHeader = structureStr
              ? structureStr.split(":")[0].trim()
              : (session.name || "WOD");

            // ── Canonical wod field (new schema) ──────────────────────────────
            const wodData = (session as any).wod as {
              blocks?: Array<{
                id?: string;
                type?: string;
                steps?: Array<{
                  id?: string;
                  label?: string;
                  movement?: { name?: string };
                  target?: { type?: string; value?: number | null; valueRange?: [number, number]; targetText?: string; unit?: string };
                  load?: { display?: string };
                }>;
              }>;
            } | undefined | null;

            // Flatten all steps across all blocks for the movement list
            const canonicalSteps = wodData?.blocks?.flatMap(b => b.steps ?? []) ?? [];

            // ── Legacy fallback: exercises[].notes ────────────────────────────
            // Sanitize any corrupted notes that contain "undefined" from old saves
            const sanitizeNotes = (notes: string | null | undefined): string => {
              if (!notes) return "";
              // Strip any "undefined " prefix that may have been saved
              return notes.replace(/\bundefined\s*/gi, "").trim();
            };
            const legacyExercises = (session.exercises || []);

            // Build the display rows from canonical steps (preferred) or legacy exercises
            const useCanonical = canonicalSteps.length > 0;

            // Format a canonical step quantity — supports ranges: "12–18 reps", "10–12 cal", "35 sec"
            const stepLabel = (step: typeof canonicalSteps[0]): string => {
              const t = step.target;
              const unit = t?.unit ?? "";
              const load = step.load?.display;
              // targetText takes priority (already formatted range string)
              const amountStr = t?.targetText
                ? t.targetText.replace(/ ?(reps|cal|sec|m|km|seconds)$/i, "").trim()
                : t?.valueRange
                  ? `${t.valueRange[0]}–${t.valueRange[1]}`
                  : (t?.value != null ? String(t.value) : "");
              if (!amountStr) return load ?? "";
              const display = `${amountStr} ${unit}`.trim();
              return load ? `${display} (${load})` : display;
            };

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

                  {/* Movements — canonical steps preferred, legacy exercises fallback */}
                  <div className="px-5 py-4 space-y-2">
                    {useCanonical ? (
                      canonicalSteps.map((step, i) => {
                        const label = stepLabel(step);
                        const movName = step.movement?.name ?? "";
                        return (
                          <div key={step.id ?? i} className="flex items-baseline gap-3">
                            <span className="text-xs font-bold text-purple-400 shrink-0 w-4">{i + 1}.</span>
                            <span className="text-sm font-semibold text-foreground">
                              {label && <span className="text-purple-700">{label} </span>}
                              <span className="capitalize">{movName}</span>
                            </span>
                          </div>
                        );
                      })
                    ) : legacyExercises.length > 0 ? (
                      legacyExercises.map((ex, i) => {
                        const notes = sanitizeNotes(ex.notes);
                        return (
                          <div key={ex.id ?? i} className="flex items-baseline gap-3">
                            <span className="text-xs font-bold text-purple-400 shrink-0 w-4">{i + 1}.</span>
                            <span className="text-sm font-semibold text-foreground">
                              {notes && <span className="text-purple-700">{notes} </span>}
                              <span className="capitalize">{ex.name}</span>
                            </span>
                          </div>
                        );
                      })
                    ) : structureStr ? (
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
            <div className="space-y-3">

              {/* ── RUN TYPE ── */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-muted-foreground tracking-widest uppercase px-1">Run Type</p>
                <div className="flex gap-2">
                  {(["road", "trail"] as RunSurface[]).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setRunSurface(s); if (s === "road") setTrailDifficulty(null); setSaved(false); scheduleClientAutosave(); }}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
                        runSurface === s
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                          : "bg-background border-border text-muted-foreground hover:border-emerald-400/60"
                      }`}
                    >
                      {s === "road" ? "🛣 Road" : "🏔 Trail"}
                    </button>
                  ))}
                </div>

                {/* Trail difficulty — animates open */}
                {runSurface === "trail" && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-medium text-muted-foreground px-0.5">Trail difficulty</p>
                    <div className="flex gap-2">
                      {(["moderate", "hilly", "technical"] as TrailDifficulty[]).map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => { setTrailDifficulty(d); setSaved(false); scheduleClientAutosave(); }}
                          className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                            trailDifficulty === d
                              ? "bg-amber-500 border-amber-500 text-white shadow-sm"
                              : "bg-background border-border text-muted-foreground hover:border-amber-400/60"
                          }`}
                        >
                          {d.charAt(0).toUpperCase() + d.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2 px-0.5">
                      {[
                        { d: "moderate", hint: "Mostly flat, decent footing" },
                        { d: "hilly", hint: "Climbs and descents affect pace" },
                        { d: "technical", hint: "Uneven ground, footing slows you" },
                      ].map(({ d, hint }) => (
                        <p key={d} className="text-[10px] text-muted-foreground/70 leading-tight text-center">{hint}</p>
                      ))}
                    </div>
                    {trailDifficulty === null && (
                      <p className="text-xs text-amber-600 font-medium px-0.5">Select trail difficulty</p>
                    )}
                  </div>
                )}
              </div>

              {/* ── WHAT YOU RAN ── */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-muted-foreground tracking-widest uppercase px-1">What you ran</p>
                <div className="rounded-xl border border-border overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-[3rem_1fr_4.5rem_4.5rem_2rem] gap-0 bg-muted/40 border-b border-border px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <span className="pl-1">Rep</span>
                    <span>Distance</span>
                    <span className="text-center">Target</span>
                    <span className="text-center">Actual</span>
                    <span />
                  </div>
                  {runIntervals.map((interval, idx) => {
                    const eqPace = calcEquivalentPace(interval.pace, runSurface, trailDifficulty);
                    return (
                      <div key={idx} className="border-b border-border last:border-b-0">
                        <div className="grid grid-cols-[3rem_1fr_4.5rem_4.5rem_2rem] gap-0 items-center px-2 py-1.5 bg-background">
                          {/* Rep label */}
                          <Input
                            type="text"
                            placeholder={String(idx + 1)}
                            value={interval.label}
                            onChange={e => {
                              const updated = [...runIntervals];
                              updated[idx] = { ...updated[idx], label: e.target.value };
                              setRunIntervals(updated);
                              setSaved(false);
                              scheduleClientAutosave();
                            }}
                            className="h-7 text-xs font-semibold border border-transparent bg-muted/30 hover:border-border focus:border-primary/40 focus:bg-background rounded-lg text-muted-foreground pl-1.5 transition-colors"
                          />
                          {/* Distance */}
                          <Input
                            type="text"
                            inputMode="text"
                            placeholder="e.g. 1 km"
                            value={interval.distance}
                            onChange={e => {
                              const updated = [...runIntervals];
                              updated[idx] = { ...updated[idx], distance: e.target.value };
                              setRunIntervals(updated);
                              setSaved(false);
                              scheduleClientAutosave();
                            }}
                            className="h-7 text-sm font-bold border border-transparent bg-muted/30 hover:border-border focus:border-primary/40 focus:bg-background rounded-lg mx-1 transition-colors"
                          />
                          {/* Target pace */}
                          <Input
                            type="text"
                            inputMode="text"
                            placeholder="—"
                            value={interval.targetPace}
                            onChange={e => {
                              const updated = [...runIntervals];
                              updated[idx] = { ...updated[idx], targetPace: e.target.value };
                              setRunIntervals(updated);
                              setSaved(false);
                              scheduleClientAutosave();
                            }}
                            className="h-7 text-xs text-center text-muted-foreground border border-transparent bg-muted/30 hover:border-border focus:border-primary/40 focus:bg-background rounded-lg font-mono transition-colors"
                          />
                          {/* Actual pace */}
                          <Input
                            type="text"
                            inputMode="text"
                            placeholder="5:30"
                            value={interval.pace}
                            onChange={e => {
                              const updated = [...runIntervals];
                              updated[idx] = { ...updated[idx], pace: e.target.value };
                              setRunIntervals(updated);
                              setSaved(false);
                              scheduleClientAutosave();
                            }}
                            className="h-7 text-sm text-center font-bold border border-transparent bg-muted/30 hover:border-border focus:border-primary/40 focus:bg-background rounded-lg font-mono text-emerald-700 dark:text-emerald-400 ml-1 transition-colors"
                          />
                          <button
                            type="button"
                            disabled={runIntervals.length === 1}
                            onClick={() => {
                              setRunIntervals(runIntervals.filter((_, i) => i !== idx));
                              setSaved(false);
                              scheduleClientAutosave();
                            }}
                            className="text-muted-foreground/60 hover:text-destructive disabled:opacity-20 disabled:cursor-not-allowed p-1.5 rounded-lg transition-colors flex items-center justify-center"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {/* Trail equivalent pace */}
                        {eqPace && (
                          <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium px-3 pb-1.5 -mt-0.5">
                            ≈ {eqPace}/km road equivalent
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRunIntervals([...runIntervals, { label: "", distance: "", targetPace: "", pace: "", notes: "" }]);
                    setSaved(false);
                    scheduleClientAutosave();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-emerald-400/60 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 text-xs font-medium transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add interval
                </button>
              </div>
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
          const isBw = getExLoadType(ex.id, ex.name) === "bodyweight";
          const loggedCount = exLogs.filter(l => isBw ? l.reps !== null : (l.weight !== null || l.reps !== null)).length;
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
                  {!isSwapping && (
                    <button
                      type="button"
                      onClick={() => toggleExLoadType(ex.id, ex.name)}
                      title={isBw ? "Bodyweight — tap to add weight" : "Mark as bodyweight"}
                      className={`h-8 px-2 rounded-xl text-[10px] font-bold border transition-colors ${
                        isBw ? "bg-blue-100 text-blue-700 border-blue-300" : "text-muted-foreground border-border hover:border-blue-300 hover:text-blue-600"
                      }`}
                    >
                      BW
                    </button>
                  )}
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
                  : ex.sets && safeReps(ex.reps) && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.sets} × {safeReps(ex.reps)}</span>}
                {!ex.perSetRpe?.length && ex.rpe && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Zap className="w-3 h-3" />RPE {ex.rpe}</span>}
                {ex.rest && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Clock className="w-3 h-3" />Rest {ex.rest}</span>}
              </div>
              {ex.notes && <p className="text-xs text-muted-foreground mb-2 ml-8 italic">{ex.notes}</p>}

              {/* Last time reminder — weights/reps (uses fuzzy exercise matching) */}
              {(() => {
                const displayName = (ex as any).swappedName ?? ex.name;
                const matchResult = findBestMatch(displayName, prevLogsCandidates);
                const prev = matchResult ? prevLogsMap[matchResult.normalizedKey] : null;
                if (!prev) return null;
                const setsText = formatPrevSets(prev.sets, isBw);
                if (!setsText) return null;
                const showMatchedFrom =
                  matchResult.tier > 1 &&
                  matchResult.matchedFrom !== undefined &&
                  normalizeExerciseName(matchResult.matchedFrom) !== normalizeExerciseName(displayName);
                return (
                  <div className="flex flex-col gap-0.5 mb-1 ml-8">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-blue-400 shrink-0" />
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-semibold text-blue-500">Last time · {format(parseISO(prev.date), "d MMM")}:</span>{" "}
                        {setsText}
                      </p>
                    </div>
                    {showMatchedFrom && (
                      <p className="text-[10px] text-muted-foreground/55 ml-[18px] italic leading-tight">
                        Matched from {matchResult.matchedFrom}
                      </p>
                    )}
                  </div>
                );
              })()}
              {(() => {
                const displayName = (ex as any).swappedName ?? ex.name;
                const normKey = normalizeExerciseName(displayName);
                // Try direct lookup first, then fuzzy fallback for comment matching
                const prevComment =
                  prevSession?.exerciseComments[normKey] ??
                  (() => {
                    if (!prevSession?.exerciseComments) return undefined;
                    const m = findBestMatch(displayName, Object.fromEntries(
                      Object.keys(prevSession.exerciseComments).map(k => [k, k])
                    ));
                    return m ? prevSession.exerciseComments[m.normalizedKey] : undefined;
                  })();
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
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-center">
                        {isBw ? "Load" : "Weight (kg)"}
                      </span>
                      <div className="text-center">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Reps done</span>
                        {ex.perSetReps && ex.perSetReps.length > 0 ? (
                          <span className="block text-[10px] text-primary/60 font-semibold normal-case tracking-normal -mt-0.5">varies per set</span>
                        ) : safeReps(ex.reps) ? (
                          <span className="block text-[10px] text-primary/60 font-semibold normal-case tracking-normal -mt-0.5">target: {safeReps(ex.reps)}</span>
                        ) : null}
                      </div>
                    </div>
                    {Array.from({ length: setsCount }, (_, setIdx) => {
                      const log = exLogs[setIdx] || { weight: null, reps: null };
                      const isDone = isBw ? log.reps !== null : (log.weight !== null || log.reps !== null);
                      const perSetTarget = ex.perSetReps?.[setIdx];
                      const perSetRpeTarget = ex.perSetRpe?.[setIdx];
                      return (
                        <div key={setIdx} className={`set-row transition-colors ${isDone ? "bg-primary/5 border border-primary/20" : "bg-muted/40"}`}>
                          <div className={`text-sm font-bold pl-1 leading-tight ${isDone ? "text-primary" : "text-muted-foreground"}`}>
                            <div>{setIdx + 1}{isDone && <span className="ml-0.5">✓</span>}</div>
                            {perSetRpeTarget && <div className="text-[9px] font-semibold text-muted-foreground normal-case">RPE {perSetRpeTarget}</div>}
                          </div>
                          {isBw ? (
                            <div className="flex items-center justify-center">
                              <span className="text-sm font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 h-10 flex items-center">BW</span>
                            </div>
                          ) : (
                            <Input
                              type="number" inputMode="decimal" step="0.5" min="0"
                              placeholder="—"
                              value={log.weight ?? ""}
                              onChange={e => handleFieldChange(ex.id, setIdx, "weight", e.target.value)}
                              className={`h-10 text-center text-base font-bold border-0 shadow-none bg-transparent focus:bg-background rounded-lg ${isDone ? "text-primary" : ""}`}
                            />
                          )}
                          <div className="relative">
                            <Input
                              type="number" inputMode="numeric" step="1" min="0"
                              placeholder={perSetTarget != null ? String(perSetTarget) : safeReps(ex.reps) || "—"}
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
                    placeholder="Leave a note for Phil…"
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
                  : ex.sets && safeReps(ex.reps) && <span className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full font-medium"><Repeat className="w-3 h-3" />{ex.sets} × {safeReps(ex.reps)}</span>}
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
                            placeholder={safeReps(ex.reps) || "—"}
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
                    placeholder="Leave a note for Phil…"
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

        {/* Email Coach */}
        <div className="pt-4 pb-2 flex justify-center">
          <a
            href="mailto:hello@mikeyglenncoaching.com"
            className="inline-flex items-center gap-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-2xl px-6 py-3.5 text-sm shadow-md hover:shadow-lg transition-all"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
              <rect width="20" height="16" x="2" y="4" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
            Email Your Coach
          </a>
        </div>
      </div>
      )}

      {/* ── Share Activity Modal ──────────────────────────────────────── */}
      {showShareModal && (() => {
        // ── Widget data ──────────────────────────────────────────────────────
        const shareSrc = (session as any).source as string | undefined;
        const shareIsRun = shareSrc === "run_brain" || shareSrc === "endurance_cycle";
        const shareIsWod = shareSrc === "wod_brain";
        const shareIsStrength = !shareIsRun && !shareIsWod;
        const shareAllEx = [...(session.exercises || []), ...addedExercises];

        const shareDateStr = format(parseISO(session.date || format(new Date(), "yyyy-MM-dd")), "EEE d MMM").toUpperCase();

        const calcE1rm = (w: number, r: number) => w * (1 + r / 30);

        // Run: logged intervals
        const shareLoggedRuns = runIntervals.filter(r => r.pace?.trim());
        const shareTotalKm = shareLoggedRuns.reduce((s, r) => { const k = parseFloat(r.distance); return s + (isNaN(k) ? 0 : k); }, 0);

        // WOD result
        const shareWodVal = (wodResult as any)?.value as string | undefined;

        // Goal strip — pick most relevant (goals have parsedTargets[] not a flat metric field)
        let shareGoalItem: any = null;
        let shareGoalParsedTarget: any = null;
        for (const g of shareGoals) {
          const pts: any[] = g.parsedTargets ?? [];
          for (const pt of pts) {
            if (shareIsRun && ["5k","10k","half_marathon","marathon"].includes(pt.metric)) { shareGoalItem = g; shareGoalParsedTarget = pt; break; }
            if (shareIsStrength && ["bench_e1rm","squat_e1rm","deadlift_e1rm"].includes(pt.metric)) { shareGoalItem = g; shareGoalParsedTarget = pt; break; }
          }
          if (shareGoalItem) break;
        }
        if (!shareGoalItem && shareGoals.length > 0) {
          shareGoalItem = shareGoals[0];
          shareGoalParsedTarget = (shareGoals[0]?.parsedTargets ?? [])[0] ?? null;
        }

        // Goal-anchored best set: prefer the exercise that matches the strength goal
        const goalLiftKeyword = shareGoalParsedTarget?.metric === "bench_e1rm" ? "bench"
          : shareGoalParsedTarget?.metric === "squat_e1rm" ? "squat"
          : shareGoalParsedTarget?.metric === "deadlift_e1rm" ? "deadlift"
          : null;
        const goalMatchedExIds = new Set(
          goalLiftKeyword
            ? shareAllEx.filter(ex => (nameOverrides[ex.id] || ex.name).toLowerCase().includes(goalLiftKeyword)).map(ex => ex.id)
            : []
        );

        // Recompute shareBest — goal-anchored first, then global
        let shareBestAnchored: { name: string; weight: number; reps: number } | null = null;
        let shareBestAnchoredE1rm = 0;
        let shareBestGlobal: { name: string; weight: number; reps: number } | null = null;
        let shareBestGlobalE1rm = 0;
        let shareTotalVol = 0;
        shareAllEx.forEach(ex => {
          (logs[ex.id] || []).forEach(lg => {
            if (lg.weight && lg.reps) {
              shareTotalVol += lg.weight * lg.reps;
              const e = calcE1rm(lg.weight, lg.reps);
              if (goalMatchedExIds.has(ex.id) && e > shareBestAnchoredE1rm) {
                shareBestAnchoredE1rm = e;
                shareBestAnchored = { name: nameOverrides[ex.id] || ex.name, weight: lg.weight, reps: lg.reps };
              }
              if (e > shareBestGlobalE1rm) {
                shareBestGlobalE1rm = e;
                shareBestGlobal = { name: nameOverrides[ex.id] || ex.name, weight: lg.weight, reps: lg.reps };
              }
            }
          });
        });
        const shareBest = shareBestAnchored ?? shareBestGlobal;
        const shareBestE1rm = shareBestAnchored ? shareBestAnchoredE1rm : shareBestGlobalE1rm;

        // Goal progress % — use session e1RM vs goal target for strength; hide for run (no baseline here)
        let shareGoalPct = 0;
        let shareGoalLabel = "";
        let shareShowGoalBar = false;
        if (shareGoalParsedTarget) {
          const targetNum = Number(shareGoalParsedTarget.target ?? 0);
          const METRIC_DISPLAY: Record<string, string> = {
            bench_e1rm: "Bench", squat_e1rm: "Squat", deadlift_e1rm: "Deadlift",
            "5k": "5K", "10k": "10K", half_marathon: "Half Marathon",
            marathon: "Marathon", bodyweight: "Bodyweight", sessions_per_week: "Sessions/Week",
          };
          shareGoalLabel = METRIC_DISPLAY[String(shareGoalParsedTarget.metric ?? "")] ?? String(shareGoalParsedTarget.metric ?? "").replace(/_/g, " ");
          if (shareIsStrength && shareBestE1rm > 0 && targetNum > 0) {
            shareGoalPct = Math.min(100, Math.round((shareBestE1rm / targetNum) * 100));
            shareShowGoalBar = true;
          }
        }

        // Badge colours
        const badgeBg = shareIsRun ? "rgba(134,239,172,0.15)" : shareIsWod ? "rgba(196,181,253,0.15)" : "rgba(99,102,241,0.20)";
        const badgeColor = shareIsRun ? "#86EFAC" : shareIsWod ? "#C4B5FD" : "#818CF8";
        const badgeText = shareIsRun ? "RUN" : shareIsWod ? "WOD" : "STRENGTH";

        return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/70" onClick={closeShareModal} />
          <div className="relative bg-background rounded-t-3xl shadow-2xl max-h-[94vh] overflow-y-auto flex flex-col">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
              <button onClick={closeShareModal} className="text-sm text-foreground font-medium">Close</button>
              <p className="font-semibold text-sm">Share Workout</p>
              <div className="w-12" />
            </div>

            {/* Widget preview — on subtle grey background */}
            <div className="px-5 pt-5 pb-3 shrink-0 bg-[#f0f0f0] dark:bg-zinc-800">
              {/* The widget div — captured by html2canvas */}
              <div
                ref={shareWidgetRef}
                style={{
                  width: "100%",
                  background: "#0d0d0d",
                  borderRadius: 16,
                  overflow: "hidden",
                  fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
                  color: "#ffffff",
                }}
              >
                {/* ── Header ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img src="/phil.png" crossOrigin="anonymous" style={{ width: 28, height: 28, minWidth: 28, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }} />
                    <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 600, fontSize: 14, letterSpacing: "-0.01em" }}>Trained with Phil</span>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 500 }}>{shareDateStr}</span>
                </div>

                {/* ── Main content ── */}
                <div style={{ padding: "16px 18px" }}>
                  {/* Badge + name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: badgeBg, color: badgeColor }}>{badgeText}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#ffffff" }}>{session.name || "Session"}</span>
                  </div>

                  {/* ── STRENGTH content ── */}
                  {shareIsStrength && shareBest && (
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.02em", lineHeight: 1 }}>
                        {shareBest.weight}kg <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 20 }}>× {shareBest.reps}</span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{shareBest.name}</div>
                      {shareTotalVol > 0 && (
                        <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
                          Total volume: {Math.round(shareTotalVol).toLocaleString()} kg
                        </div>
                      )}
                    </div>
                  )}
                  {shareIsStrength && !shareBest && (
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
                      {shareAllEx.slice(0, 4).map(ex => <div key={ex.id} style={{ marginBottom: 4 }}>• {nameOverrides[ex.id] || ex.name}</div>)}
                    </div>
                  )}

                  {/* ── RUN content ── */}
                  {shareIsRun && shareLoggedRuns.length > 0 && (
                    <div>
                      {shareLoggedRuns.map((r, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>
                            {r.distance ? `${r.distance} km` : r.label || `Rep ${i + 1}`}
                          </span>
                          <span style={{ fontSize: 13, color: badgeColor, fontWeight: 600 }}>
                            {r.pace} /km
                          </span>
                        </div>
                      ))}
                      {shareTotalKm > 0 && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                          Total {shareTotalKm.toFixed(1)} km
                        </div>
                      )}
                    </div>
                  )}
                  {shareIsRun && shareLoggedRuns.length === 0 && (() => {
                    const struct = (session as any).structure as string | undefined;
                    return (
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
                        {struct || runIntervals.map((r, i) => (
                          <div key={i} style={{ marginBottom: 4 }}>• {r.distance ? `${r.distance} km` : r.label || `Rep ${i + 1}`}{r.targetPace ? ` @ ${r.targetPace}/km` : ""}</div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* ── WOD content ── */}
                  {shareIsWod && (
                    <div>
                      {shareWodVal ? (
                        <div style={{ fontSize: 28, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.02em" }}>{shareWodVal}</div>
                      ) : (
                        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
                          {((session as any).structure as string | undefined) || session.name}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Comment ── */}
                  {shareShowComment && sessionComment.trim() && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(255,255,255,0.50)", fontStyle: "italic", lineHeight: 1.5 }}>
                      "{sessionComment.trim()}"
                    </div>
                  )}
                </div>

                {/* ── Goal strip (anchored to bottom of card) ── */}
                {shareShowGoalBar && (
                  <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", fontWeight: 500 }}>{shareGoalLabel}</span>
                      <span style={{ fontSize: 11, color: badgeColor, fontWeight: 700 }}>{shareGoalPct}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${shareGoalPct}%`, background: "linear-gradient(90deg, #6366F1, #8B5CF6)", borderRadius: 3 }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Comment toggle */}
            {sessionComment.trim() && (
              <div className="px-5 pt-3 shrink-0">
                <button
                  onClick={() => setShareShowComment(v => !v)}
                  className={[
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-medium transition-all",
                    shareShowComment
                      ? "bg-primary/10 border-primary text-primary"
                      : "bg-muted/40 border-border text-muted-foreground",
                  ].join(" ")}
                >
                  <span>Include comment</span>
                  {shareShowComment && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              </div>
            )}

            {/* Action buttons — two equal side-by-side */}
            <div className="px-5 py-4 flex flex-col gap-2.5 shrink-0">
              <div className="flex gap-3">
                <button
                  onClick={() => void handleSaveImage()}
                  disabled={shareImageLoading}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm shadow-md disabled:opacity-50 transition-opacity"
                >
                  {shareSaved
                    ? <><Check className="w-4 h-4" /> Saved!</>
                    : <><Download className="w-4 h-4" /> Save Image</>
                  }
                </button>
                <button
                  onClick={() => void handleCopyImage()}
                  disabled={shareImageLoading}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-border bg-muted/40 text-foreground font-semibold text-sm disabled:opacity-50 transition-opacity"
                >
                  {shareImageLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Working…</>
                    : shareCopied
                    ? <><Check className="w-4 h-4" /> Copied!</>
                    : <><Copy className="w-4 h-4" /> Copy Image</>
                  }
                </button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Add to your Instagram or WhatsApp story.
              </p>
            </div>
          </div>
        </div>
        );
      })()}

      </>)} {/* end !isEditMode */}

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
