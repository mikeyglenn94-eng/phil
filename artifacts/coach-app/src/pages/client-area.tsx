import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRoute, useLocation, Link, useSearch } from "wouter";
import { ArrowLeft, Dumbbell, Utensils, Loader2, Mic, Square, Plus, Trash2, CalendarDays, ChevronRight, ChevronLeft, Calendar, KeyRound, Target, X, Brain, Zap, Sparkles, LogOut } from "lucide-react";
import { useClientContext } from "@/contexts/client-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, startOfWeek, addWeeks, addDays, isSameDay, parseISO, differenceInDays } from "date-fns";
import {
  useGetClient,
  useListProgrammes,
  useAssignProgramme,
  useDeleteProgramme,
  useListNutritionEntries,
  useAddNutritionEntry,
  useDeleteNutritionEntry,
  useSetClientGoals,
  getListNutritionEntriesQueryKey,
  getListProgrammesQueryKey,
  getGetClientQueryKey,
} from "@workspace/api-client-react";
import type { NutritionEntry, Programme, Session } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Tab = "training" | "nutrition";

function getSessionHighlight(session: Session): string {
  const isConditioning = session.source === "wod_brain" || session.source === "run_brain";
  if (isConditioning && session.structure) return session.structure;
  const exs = session.exercises ?? [];
  return exs
    .slice(0, 3)
    .map(ex => {
      const setsReps = ex.sets && ex.reps ? ` ${ex.sets}×${ex.reps}` : ex.sets ? ` ${ex.sets}×` : "";
      return `${ex.name}${setsReps}`;
    })
    .filter(Boolean)
    .join(" · ");
}

interface ClientAreaProps {
  clientIdOverride?: number;
  mode?: "coach" | "client";
}

export default function ClientArea({ clientIdOverride, mode = "coach" }: ClientAreaProps = {}) {
  const [, params] = useRoute("/clients/:clientId");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const clientId = clientIdOverride ?? parseInt(params?.clientId || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { clearClient } = useClientContext();

  const { data: client, isLoading: clientLoading } = useGetClient(clientId);
  const { data: masterProgrammes } = useListProgrammes(); // master programmes (no clientId)
  const { data: clientProgrammes } = useListProgrammes({ clientId });
  const assignMutation = useAssignProgramme();
  const deleteProgrammeMutation = useDeleteProgramme();

  // ── Goals dialog ──
  const setGoalsMutation = useSetClientGoals();
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalCalories, setGoalCalories] = useState("");
  const [goalProtein, setGoalProtein] = useState("");
  const [goalCarbs, setGoalCarbs] = useState("");
  const [goalFats, setGoalFats] = useState("");
  const [goalsError, setGoalsError] = useState("");
  const [savingGoals, setSavingGoals] = useState(false);

  function openGoalsDialog() {
    setGoalCalories(client?.dailyCalorieGoal?.toString() ?? "");
    setGoalProtein(client?.dailyProteinGoal?.toString() ?? "");
    setGoalCarbs(client?.dailyCarbGoal?.toString() ?? "");
    setGoalFats(client?.dailyFatGoal?.toString() ?? "");
    setGoalsError("");
    setGoalsOpen(true);
  }

  const macroKcal = (parseFloat(goalProtein || "0") * 4) + (parseFloat(goalCarbs || "0") * 4) + (parseFloat(goalFats || "0") * 9);
  const calTarget = parseFloat(goalCalories || "0");
  const macroExceedsTarget = calTarget > 0 && macroKcal > calTarget;

  async function handleSaveGoals() {
    const calories = parseInt(goalCalories, 10);
    const protein = parseInt(goalProtein, 10);
    const carbs = parseInt(goalCarbs, 10);
    const fats = parseInt(goalFats, 10);
    if ([calories, protein, carbs, fats].some(v => isNaN(v) || v < 0)) {
      setGoalsError("All fields must be valid positive numbers."); return;
    }
    if (protein * 4 + carbs * 4 + fats * 9 > calories) {
      setGoalsError(`Macro calories (${Math.round(protein * 4 + carbs * 4 + fats * 9)} kcal) exceed the calorie goal. Reduce one or more macros.`); return;
    }
    setSavingGoals(true); setGoalsError("");
    try {
      await setGoalsMutation.mutateAsync({ clientId, data: { calories, protein, carbs, fats } });
      await queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
      setGoalsOpen(false);
      toast({ title: "Goals saved" });
    } catch (e: any) {
      setGoalsError(e?.data?.error ?? "Failed to save goals.");
    } finally { setSavingGoals(false); }
  }

  const [resettingPassword, setResettingPassword] = useState(false);
  async function handleResetPassword() {
    if (!confirm(`Reset ${client?.name ?? "this client"}'s password? They will be asked to set a new one next time they log in.`)) return;
    setResettingPassword(true);
    try {
      await fetch(`/api/clients/${clientId}/reset-password`, { method: "POST" });
      toast({ title: "Password reset", description: `${client?.name ?? "Client"} will create a new password on their next login.` });
    } catch {
      toast({ title: "Failed to reset password", variant: "destructive" });
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleDeleteClientProgramme(programmeId: number, title: string) {
    if (!confirm(`Remove "${title}" from ${client?.name ?? "this client"}'s calendar?`)) return;
    try {
      await deleteProgrammeMutation.mutateAsync({ id: programmeId });
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      toast({ title: "Programme removed from calendar" });
    } catch {
      toast({ title: "Failed to remove programme", variant: "destructive" });
    }
  }

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const params = new URLSearchParams(search);
    return params.get("tab") === "training" ? "training" : "nutrition";
  });
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [assignStartDate, setAssignStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isAssigning, setIsAssigning] = useState(false);
  const [allProgrammes, setAllProgrammes] = useState<{ id: number; title: string }[]>([]);
  const [assignSearch, setAssignSearch] = useState("");

  // ── Build-from-description mode ──
  const [buildMode, setBuildMode] = useState<"template" | "describe">("template");
  const [describeText, setDescribeText] = useState("");
  const [describeListening, setDescribeListening] = useState(false);
  const [describeInterim, setDescribeInterim] = useState("");
  const describeInterimRef = useRef("");
  const describeRecRef = useRef<any>(null);
  const [describeGenerating, setDescribeGenerating] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<{ title: string; sessions: any[] } | null>(null);
  const [confirmingGenerated, setConfirmingGenerated] = useState(false);

  async function handleGenerateProgramme() {
    if (!describeText.trim() || !assignStartDate) return;
    setDescribeGenerating(true);
    setGeneratedPreview(null);
    try {
      const res = await fetch("/api/generate-programme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: describeText.trim(), startDate: assignStartDate }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setGeneratedPreview(data);
    } catch (e: any) {
      toast({ title: "Couldn't generate programme", description: e?.message ?? "Try rephrasing your description.", variant: "destructive" });
    } finally {
      setDescribeGenerating(false);
    }
  }

  async function handleConfirmGenerated() {
    if (!generatedPreview) return;
    setConfirmingGenerated(true);
    try {
      await fetch("/api/programmes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: generatedPreview.title, sessions: generatedPreview.sessions, clientId }),
      });
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      setAssignDialogOpen(false);
      setGeneratedPreview(null);
      setDescribeText("");
      toast({ title: "Programme built!", description: `"${generatedPreview.title}" added to the calendar.` });
    } catch {
      toast({ title: "Failed to save programme", variant: "destructive" });
    } finally {
      setConfirmingGenerated(false);
    }
  }

  // ── Training calendar state ──
  const [trainingWeekOffset, setTrainingWeekOffset] = useState(0);
  const [selectedTrainingSession, setSelectedTrainingSession] = useState<Session | null>(null);

  // ── Drag-and-drop ──
  const draggedItemRef = useRef<{ sessionId: string; programmeId: number } | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  // Touch DnD
  const touchDragRef = useRef<{ sessionId: string; programmeId: number } | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const [touchDragOverDate, setTouchDragOverDate] = useState<string | null>(null);

  // ── AI reschedule command bar ──
  const [cmdInput, setCmdInput] = useState("");
  const [cmdListening, setCmdListening] = useState(false);
  const [cmdInterim, setCmdInterim] = useState("");
  const cmdInterimRef = useRef("");
  const cmdRecRef = useRef<any>(null);
  const [cmdSaving, setCmdSaving] = useState(false);
  const [pendingReschedule, setPendingReschedule] = useState<{
    programmeId: number; programmeName: string; sessions: Session[]; dayLabels: string[];
  } | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{
    scope: "all" | "programme";
    programmeId?: number;
    programmeName?: string;
    sessionCount: number;
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const trainingWeeks = useMemo(() => {
    const weekStart = startOfWeek(addWeeks(new Date(), trainingWeekOffset), { weekStartsOn: 1 });
    return Array.from({ length: 4 }, (_, wi) => {
      const ws = addWeeks(weekStart, wi);
      return Array.from({ length: 7 }, (_, di) => addDays(ws, di));
    });
  }, [trainingWeekOffset]);

  const allClientSessions = useMemo<Session[]>(() => {
    if (!clientProgrammes) return [];
    return clientProgrammes.flatMap(p => p.sessions || []);
  }, [clientProgrammes]);

  async function handleAssign() {
    if (!selectedSourceId || !assignStartDate) return;
    setIsAssigning(true);
    try {
      await assignMutation.mutateAsync({
        clientId,
        data: { sourceProgrammeId: selectedSourceId, startDate: assignStartDate },
      });
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      setAssignDialogOpen(false);
      setSelectedSourceId(null);
      toast({ title: "Programme assigned", description: "Sessions have been added to the client's calendar." });
    } catch {
      toast({ title: "Failed to assign programme", variant: "destructive" });
    } finally {
      setIsAssigning(false);
    }
  }
  // ── Drag-and-drop: move a session to a new date ──
  const moveSession = async (sessionId: string, programmeId: number, newDate: string) => {
    const prog = (clientProgrammes ?? []).find(p => p.id === programmeId);
    if (!prog) return;
    const updatedSessions = (prog.sessions as Session[]).map(s =>
      s.id === sessionId ? { ...s, date: newDate } : s
    );
    await fetch(`/api/programmes/${programmeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: updatedSessions }),
    });
    await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
    toast({ title: "Session moved" });
  };

  const deleteSession = async (sessionId: string, programmeId: number | undefined) => {
    if (!programmeId) return;
    const prog = (clientProgrammes ?? []).find(p => p.id === programmeId);
    if (!prog) return;
    const updatedSessions = (prog.sessions as Session[]).filter(s => s.id !== sessionId);
    await fetch(`/api/programmes/${programmeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: updatedSessions }),
    });
    await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
    toast({ title: "Session deleted" });
  };

  // ── AI Reschedule command helpers ──
  const DAY_WORDS: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
    mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
  };
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function parseDays(text: string): number[] {
    const days: number[] = [];
    const words = text.toLowerCase().split(/[\s/,&+]+/);
    words.forEach(w => {
      const clean = w.replace(/s$/, "");
      if (DAY_WORDS[clean] !== undefined) days.push(DAY_WORDS[clean]);
      else if (DAY_WORDS[w] !== undefined) days.push(DAY_WORDS[w]);
    });
    return [...new Set(days)].sort((a, b) => {
      const aa = a === 0 ? 7 : a;
      const bb = b === 0 ? 7 : b;
      return aa - bb;
    });
  }

  function remapSessionDays(sessions: Session[], targetDays: number[]): Session[] {
    if (!sessions.length || !targetDays.length) return sessions;
    const sorted = [...sessions].sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
    const anchor = startOfWeek(parseISO(sorted[0].date), { weekStartsOn: 1 });
    const weekMap = new Map<number, Session[]>();
    sorted.forEach(s => {
      const weekNum = Math.floor(differenceInDays(startOfWeek(parseISO(s.date), { weekStartsOn: 1 }), anchor) / 7);
      if (!weekMap.has(weekNum)) weekMap.set(weekNum, []);
      weekMap.get(weekNum)!.push(s);
    });
    const result: Session[] = [];
    Array.from(weekMap.entries()).sort(([a], [b]) => a - b).forEach(([weekNum, wSessions]) => {
      const weekStart = addWeeks(anchor, weekNum);
      wSessions.forEach((session, i) => {
        const targetDay = targetDays[i % targetDays.length];
        const dayOffset = targetDay === 0 ? 6 : targetDay - 1;
        result.push({ ...session, date: format(addDays(weekStart, dayOffset), "yyyy-MM-dd") });
      });
    });
    return result;
  }

  const applyBulkDelete = async () => {
    if (!pendingBulkDelete || !clientProgrammes) return;
    setBulkDeleting(true);
    try {
      if (pendingBulkDelete.scope === "all") {
        for (const prog of clientProgrammes) {
          await deleteProgrammeMutation.mutateAsync({ id: prog.id });
        }
      } else if (pendingBulkDelete.scope === "programme" && pendingBulkDelete.programmeId) {
        await deleteProgrammeMutation.mutateAsync({ id: pendingBulkDelete.programmeId });
      }
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      toast({ title: "Sessions deleted", description: `${pendingBulkDelete.sessionCount} session${pendingBulkDelete.sessionCount !== 1 ? "s" : ""} removed from the calendar.` });
      setPendingBulkDelete(null);
      setCmdInput("");
    } catch {
      toast({ title: "Failed to delete sessions", variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleRescheduleCmd = () => {
    const cmd = cmdInput.trim();
    if (!cmd || !clientProgrammes?.length) return;

    // ── Delete commands ──
    const DELETE_ALL_RE = /^(?:delete|remove|wipe|clear|erase|reset)\s+(?:all|every(?:thing)?|my)?\s*(?:sessions?|workouts?|training|calendar|schedule|programme|everything)/i;
    const DELETE_PROG_RE = /^(?:delete|remove|clear|wipe)\s+(?:the\s+)?(?:all\s+)?(.+?)(?:\s+(?:sessions?|workouts?|programme))?$/i;

    if (DELETE_ALL_RE.test(cmd)) {
      const totalSessions = clientProgrammes.reduce((acc, p) => acc + (p.sessions?.length ?? 0), 0);
      setPendingBulkDelete({ scope: "all", sessionCount: totalSessions });
      return;
    }

    // Check for specific programme deletion: "delete squat block"
    const dm = cmd.match(DELETE_PROG_RE);
    if (dm && /^(?:delete|remove|clear|wipe)/i.test(cmd)) {
      const q = dm[1].trim().toLowerCase();
      const prog =
        clientProgrammes.find(p => p.title.toLowerCase().includes(q)) ??
        clientProgrammes.find(p => q.split(" ").some(w => w.length > 2 && p.title.toLowerCase().includes(w)));
      if (prog) {
        setPendingBulkDelete({
          scope: "programme",
          programmeId: prog.id,
          programmeName: prog.title,
          sessionCount: prog.sessions?.length ?? 0,
        });
        return;
      }
    }

    const patterns = [
      /^(?:reschedule|move|shift|edit|change|update)\s+(.+?)\s+(?:so\s+(?:it|they)\s+(?:fall|falls|land|lands)\s+)?(?:on\s+|to\s+(?:fall\s+on\s+)?)?(.+)$/i,
      /^(.+?)\s+(?:to|so it falls on|on)\s+(.+)$/i,
    ];

    let programmeQuery = "";
    let dayText = "";
    for (const p of patterns) {
      const m = cmd.match(p);
      if (m) { programmeQuery = m[1].trim(); dayText = m[2].trim(); break; }
    }
    if (!programmeQuery || !dayText) {
      toast({ title: "Couldn't parse command", description: 'Try: "reschedule squat block to tuesdays/thursdays/saturdays"', variant: "destructive" });
      return;
    }

    const days = parseDays(dayText);
    if (!days.length) {
      toast({ title: "No days found", description: "Include day names like 'tuesdays/thursdays'", variant: "destructive" });
      return;
    }

    const q = programmeQuery.toLowerCase();
    const prog =
      clientProgrammes.find(p => p.title.toLowerCase().includes(q)) ??
      clientProgrammes.find(p => q.split(" ").some(w => w.length > 2 && p.title.toLowerCase().includes(w)));

    if (!prog) {
      toast({ title: `Programme not found: "${programmeQuery}"`, variant: "destructive" });
      return;
    }

    const newSessions = remapSessionDays(prog.sessions as Session[], days);
    setPendingReschedule({
      programmeId: prog.id,
      programmeName: prog.title,
      sessions: newSessions,
      dayLabels: days.map(d => DAY_NAMES[d]),
    });
  };

  const applyReschedule = async () => {
    if (!pendingReschedule) return;
    setCmdSaving(true);
    try {
      await fetch(`/api/programmes/${pendingReschedule.programmeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: pendingReschedule.sessions }),
      });
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      toast({ title: "Programme rescheduled", description: `${pendingReschedule.programmeName} → ${pendingReschedule.dayLabels.join(" / ")}` });
      setPendingReschedule(null);
      setCmdInput("");
    } catch {
      toast({ title: "Failed to reschedule", variant: "destructive" });
    } finally {
      setCmdSaving(false);
    }
  };

  // ── WOD Brain (client view) ──
  const [wodClientBrainOpen, setWodClientBrainOpen] = useState(false);
  const [wodBrainTab, setWodBrainTab] = useState<"workouts" | "cycles">("workouts");
  const [wodClientQuery, setWodClientQuery] = useState("");
  const [wodClientListening, setWodClientListening] = useState(false);
  const [wodClientInterim, setWodClientInterim] = useState("");
  const wodClientInterimRef = useRef("");
  const wodClientRecRef = useRef<any>(null);
  const [wodClientSearching, setWodClientSearching] = useState(false);
  const [wodClientResults, setWodClientResults] = useState<any[]>([]);
  const [wodClientTargetDate, setWodClientTargetDate] = useState("");
  const [wodClientAdding, setWodClientAdding] = useState<string | null>(null);

  // ── Endurance Cycles (inside WOD Brain) ──
  const [cycleQuery, setCycleQuery] = useState("");
  const [cycleListening, setCycleListening] = useState(false);
  const [cycleInterim, setCycleInterim] = useState("");
  const cycleInterimRef = useRef("");
  const cycleRecRef = useRef<any>(null);
  const [cycleSearching, setCycleSearching] = useState(false);
  const [cycleResults, setCycleResults] = useState<any[]>([]);
  const [cycleStartDate, setCycleStartDate] = useState("");
  const [cycleInserting, setCycleInserting] = useState<string | null>(null);

  // ── Run Brain (client view) ──
  const [runClientBrainOpen, setRunClientBrainOpen] = useState(false);
  const [runClientQuery, setRunClientQuery] = useState("");
  const [runClientListening, setRunClientListening] = useState(false);
  const [runClientInterim, setRunClientInterim] = useState("");
  const runClientInterimRef = useRef("");
  const runClientRecRef = useRef<any>(null);
  const [runClientSearching, setRunClientSearching] = useState(false);
  const [runClientResults, setRunClientResults] = useState<any[]>([]);
  const [runClientTargetDate, setRunClientTargetDate] = useState("");
  const [runClientAdding, setRunClientAdding] = useState<string | null>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    function makeRec(
      setInterim: (v: string) => void,
      interimRef: React.MutableRefObject<string>,
      setQuery: React.Dispatch<React.SetStateAction<string>>,
      setListening: (v: boolean) => void,
    ) {
      const r = new SR();
      r.continuous = true; r.interimResults = true; r.lang = "en-US";
      r.onresult = (e: any) => {
        let fin = ""; let int = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) fin += e.results[i][0].transcript;
          else int += e.results[i][0].transcript;
        }
        interimRef.current = int; setInterim(int);
        if (fin) { interimRef.current = ""; setQuery(p => (p ? p + " " : "") + fin.trim()); setInterim(""); }
      };
      r.onerror = () => { setListening(false); setInterim(""); interimRef.current = ""; };
      r.onend = () => {
        const left = interimRef.current.trim();
        if (left) setQuery(p => (p ? p + " " : "") + left);
        interimRef.current = ""; setListening(false); setInterim("");
      };
      return r;
    }
    wodClientRecRef.current = makeRec(setWodClientInterim, wodClientInterimRef, setWodClientQuery, setWodClientListening);
    runClientRecRef.current = makeRec(setRunClientInterim, runClientInterimRef, setRunClientQuery, setRunClientListening);
    cycleRecRef.current = makeRec(setCycleInterim, cycleInterimRef, setCycleQuery, setCycleListening);
    return () => {
      try { wodClientRecRef.current?.abort(); } catch {}
      try { runClientRecRef.current?.abort(); } catch {}
      try { cycleRecRef.current?.abort(); } catch {}
    };
  }, []);

  const toggleWodClientListening = () => {
    if (wodClientListening) { wodClientRecRef.current?.stop(); return; }
    setWodClientListening(true); setWodClientInterim(""); wodClientInterimRef.current = "";
    try { wodClientRecRef.current?.start(); } catch {}
  };
  const toggleRunClientListening = () => {
    if (runClientListening) { runClientRecRef.current?.stop(); return; }
    setRunClientListening(true); setRunClientInterim(""); runClientInterimRef.current = "";
    try { runClientRecRef.current?.start(); } catch {}
  };

  const searchClientWods = async () => {
    const q = wodClientQuery.trim(); if (!q) return;
    if (wodClientListening) { wodClientRecRef.current?.stop(); setWodClientListening(false); }
    setWodClientSearching(true);
    try {
      const res = await fetch("/api/wod-brain/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      const data = await res.json();
      setWodClientResults(data.results ?? []);
      if (!(data.results?.length)) toast({ title: "No matching WODs found", description: "Try different keywords." });
    } catch { toast({ title: "WOD Brain error", variant: "destructive" }); }
    finally { setWodClientSearching(false); }
  };

  const searchClientRuns = async () => {
    const q = runClientQuery.trim(); if (!q) return;
    if (runClientListening) { runClientRecRef.current?.stop(); setRunClientListening(false); }
    setRunClientSearching(true);
    try {
      const res = await fetch("/api/run-brain/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      const data = await res.json();
      setRunClientResults(data.results ?? []);
      if (!(data.results?.length)) toast({ title: "No matching runs found", description: "Try different keywords." });
    } catch { toast({ title: "Run Brain error", variant: "destructive" }); }
    finally { setRunClientSearching(false); }
  };

  const toggleCycleListening = () => {
    if (cycleListening) { cycleRecRef.current?.stop(); return; }
    setCycleListening(true); setCycleInterim(""); cycleInterimRef.current = "";
    try { cycleRecRef.current?.start(); } catch {}
  };

  const searchClientCycles = async () => {
    const q = cycleQuery.trim(); if (!q) return;
    if (cycleListening) { cycleRecRef.current?.stop(); setCycleListening(false); }
    setCycleSearching(true);
    try {
      const res = await fetch("/api/endurance-cycles/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      const data = await res.json();
      setCycleResults(data.results ?? []);
      if (!(data.results?.length)) toast({ title: "No matching cycles found", description: "Try different keywords." });
    } catch { toast({ title: "Endurance Cycles error", variant: "destructive" }); }
    finally { setCycleSearching(false); }
  };

  const insertCycle = async (cycle: any) => {
    if (!cycleStartDate) return;
    setCycleInserting(cycle.id);
    try {
      const res = await fetch("/api/endurance-cycles/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId: cycle.id, clientId, startDate: cycleStartDate }),
      });
      if (!res.ok) throw new Error("Failed");
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      toast({ title: `${cycle.name} added`, description: `${cycle.totalWeeks} sessions from ${format(parseISO(cycleStartDate), "d MMM yyyy")}` });
      setWodClientBrainOpen(false);
      setCycleResults([]); setCycleQuery(""); setCycleStartDate("");
    } catch { toast({ title: "Failed to insert cycle", variant: "destructive" }); }
    finally { setCycleInserting(null); }
  };

  async function addSessionToClientCalendar(date: string, newSession: any, setAdding: (id: string | null) => void, sessionId: string, closeDialog: () => void, label: string) {
    setAdding(sessionId);
    try {
      const targetProgramme = clientProgrammes?.[0];
      if (targetProgramme) {
        const updatedSessions = [...(targetProgramme.sessions || []), newSession];
        await fetch(`/api/programmes/${targetProgramme.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessions: updatedSessions }) });
      } else {
        await fetch("/api/programmes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Sessions", clientId, sessions: [newSession] }) });
      }
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      toast({ title: `${label} added to ${format(parseISO(date), "EEE d MMM")}` });
      closeDialog();
    } catch { toast({ title: "Failed to add session", variant: "destructive" }); }
    finally { setAdding(null); }
  }

  const addWodToClientCalendar = async (wod: any) => {
    if (!wodClientTargetDate) return;
    const formatLabel = wod.formatLabel ?? wod.format;
    const sessionName = `${formatLabel} ${wod.duration}: ${wod.name}`;
    const newSession = {
      id: `session-${Date.now()}`,
      date: wodClientTargetDate,
      name: sessionName,
      source: "wod_brain",
      structure: wod.structure ?? "",
      exercises: (wod.blocks ?? []).map((block: any, idx: number) => ({
        id: `ex-${Date.now()}-${idx}`,
        name: `${block.movement.charAt(0).toUpperCase()}${block.movement.slice(1)}`,
        sets: null, reps: null, rpe: null,
        notes: `${block.amount} ${block.unit}`,
        rawText: `${block.amount} ${block.unit} ${block.movement}`,
      })),
    };
    const navigateWod = () => {
      if (wodClientTargetDate) {
        const target = startOfWeek(parseISO(wodClientTargetDate), { weekStartsOn: 1 });
        const today = startOfWeek(new Date(), { weekStartsOn: 1 });
        setTrainingWeekOffset(Math.round(differenceInDays(target, today) / 7));
      }
    };
    await addSessionToClientCalendar(wodClientTargetDate, newSession, setWodClientAdding, wod.id, () => { navigateWod(); setWodClientBrainOpen(false); setWodClientResults([]); setWodClientQuery(""); setWodClientTargetDate(""); }, sessionName);
  };

  const addRunToClientCalendar = async (run: any) => {
    if (!runClientTargetDate) return;
    const sessionName = run.name;
    const newSession = {
      id: `session-${Date.now()}`,
      date: runClientTargetDate,
      name: sessionName,
      source: "run_brain",
      structure: run.structure ?? "",
      exercises: [{ id: `ex-${Date.now()}`, name: run.name, sets: null, reps: null, rpe: null, notes: `${run.duration ? run.duration + " min" : ""}${run.distanceKm ? " · " + run.distanceKm + " km" : ""} ${run.intensity ?? ""}`.trim(), rawText: run.structure ?? "" }],
    };
    const navigateRun = () => {
      if (runClientTargetDate) {
        const target = startOfWeek(parseISO(runClientTargetDate), { weekStartsOn: 1 });
        const today = startOfWeek(new Date(), { weekStartsOn: 1 });
        setTrainingWeekOffset(Math.round(differenceInDays(target, today) / 7));
      }
    };
    await addSessionToClientCalendar(runClientTargetDate, newSession, setRunClientAdding, run.id, () => { navigateRun(); setRunClientBrainOpen(false); setRunClientResults([]); setRunClientQuery(""); setRunClientTargetDate(""); }, sessionName);
  };

  // ── Strength Brain ──
  const [strengthBrainOpen, setStrengthBrainOpen] = useState(false);
  const [strengthQuery, setStrengthQuery] = useState("");
  const [strengthListening, setStrengthListening] = useState(false);
  const [strengthInterim, setStrengthInterim] = useState("");
  const strengthInterimRef = useRef("");
  const strengthRecRef = useRef<any>(null);
  const [strengthSearching, setStrengthSearching] = useState(false);
  const [strengthResults, setStrengthResults] = useState<any[]>([]);
  const [strengthStartDate, setStrengthStartDate] = useState("");
  const [strengthInserting, setStrengthInserting] = useState<string | null>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let fin = ""; let int = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else int += e.results[i][0].transcript;
      }
      strengthInterimRef.current = int;
      setStrengthInterim(int);
      if (fin) {
        strengthInterimRef.current = "";
        setStrengthQuery(prev => (prev ? prev + " " : "") + fin.trim());
        setStrengthInterim("");
      }
    };
    r.onerror = () => { setStrengthListening(false); setStrengthInterim(""); strengthInterimRef.current = ""; };
    r.onend = () => {
      const leftover = strengthInterimRef.current.trim();
      if (leftover) setStrengthQuery(prev => (prev ? prev + " " : "") + leftover);
      strengthInterimRef.current = "";
      setStrengthListening(false);
      setStrengthInterim("");
    };
    strengthRecRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, []);

  const toggleStrengthListening = () => {
    if (strengthListening) { strengthRecRef.current?.stop(); return; }
    setStrengthListening(true); setStrengthInterim(""); strengthInterimRef.current = "";
    try { strengthRecRef.current?.start(); } catch {}
  };

  const searchStrengthBlocks = async () => {
    const q = strengthQuery.trim();
    if (!q) return;
    if (strengthListening) { strengthRecRef.current?.stop(); setStrengthListening(false); }
    setStrengthSearching(true);
    try {
      const res = await fetch("/api/strength-blocks/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      setStrengthResults(data.results ?? []);
      if ((data.results?.length ?? 0) === 0) toast({ title: "No matching blocks found", description: "Try different keywords." });
    } catch {
      toast({ title: "Strength Brain error", variant: "destructive" });
    } finally { setStrengthSearching(false); }
  };

  const insertStrengthBlock = async (templateId: string, templateName: string) => {
    if (!strengthStartDate) { toast({ title: "Pick a start date first" }); return; }
    setStrengthInserting(templateId);
    try {
      const res = await fetch("/api/strength-blocks/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, clientId, startDate: strengthStartDate }),
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      toast({ title: `${templateName} added to calendar`, description: `Starting ${format(parseISO(strengthStartDate), "d MMM yyyy")}` });
      setStrengthBrainOpen(false);
      setStrengthResults([]); setStrengthQuery(""); setStrengthStartDate("");
    } catch {
      toast({ title: "Failed to insert block", variant: "destructive" });
    } finally { setStrengthInserting(null); }
  };

  // ── Universal Brain ──
  const [brainOpen, setBrainOpen] = useState(false);
  const [brainQuery, setBrainQuery] = useState("");
  const [brainListening, setBrainListening] = useState(false);
  const [brainInterim, setBrainInterim] = useState("");
  const brainInterimRef = useRef("");
  const brainRecRef = useRef<any>(null);
  const [brainSearching, setBrainSearching] = useState(false);
  const [brainResults, setBrainResults] = useState<any[]>([]);
  const [brainIntent, setBrainIntent] = useState<string | null>(null);
  const [brainDates, setBrainDates] = useState<Record<string, string>>({});
  const [brainAdding, setBrainAdding] = useState<string | null>(null);

  const startBrainVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
    brainInterimRef.current = "";
    rec.onresult = (e: any) => {
      let interim = ""; let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      brainInterimRef.current = final || interim;
      setBrainInterim(brainInterimRef.current);
    };
    rec.onend = () => { setBrainListening(false); if (brainInterimRef.current) setBrainQuery(brainInterimRef.current); };
    rec.start();
    brainRecRef.current = rec;
    setBrainListening(true);
  };

  const stopBrainVoice = () => { brainRecRef.current?.stop(); setBrainListening(false); };

  const searchBrain = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    setBrainSearching(true);
    setBrainResults([]);
    setBrainIntent(null);
    try {
      const res = await fetch("/api/brain/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setBrainResults(data.results ?? []);
      setBrainIntent(data.intent ?? null);
      // Pre-fill dates to today for each result
      const today = format(new Date(), "yyyy-MM-dd");
      const dates: Record<string, string> = {};
      (data.results ?? []).forEach((r: any) => { dates[r.id] = today; });
      setBrainDates(dates);
    } catch { toast({ title: "Brain search failed", variant: "destructive" }); }
    finally { setBrainSearching(false); }
  };

  const navigateToWeekOf = (dateStr: string) => {
    if (!dateStr) return;
    const target = startOfWeek(parseISO(dateStr), { weekStartsOn: 1 });
    const today = startOfWeek(new Date(), { weekStartsOn: 1 });
    setTrainingWeekOffset(Math.round(differenceInDays(target, today) / 7));
  };

  const brainAddItem = async (result: any) => {
    const date = brainDates[result.id] ?? format(new Date(), "yyyy-MM-dd");
    if (!clientId) return;
    setBrainAdding(result.id);

    try {
      if (result.category === "cycle") {
        const res = await fetch("/api/endurance-cycles/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycleId: result.id, clientId, startDate: date }),
        });
        if (!res.ok) throw new Error();
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        toast({ title: `${result.name} added`, description: `${result.totalWeeks}-week cycle from ${format(parseISO(date), "d MMM yyyy")}` });
        navigateToWeekOf(date);
        setBrainOpen(false); setBrainResults([]); setBrainQuery("");
        return;
      }

      if (result.category === "strength") {
        const res = await fetch("/api/strength-blocks/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: result.id, clientId, startDate: date }),
        });
        if (!res.ok) throw new Error();
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        toast({ title: `${result.name} added to calendar`, description: `Starting ${format(parseISO(date), "d MMM yyyy")}` });
        navigateToWeekOf(date);
        setBrainOpen(false); setBrainResults([]); setBrainQuery("");
        return;
      }

      if (result.category === "run_template") {
        const res = await fetch("/api/endurance-run-templates/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: result.id, clientId, startDate: date }),
        });
        if (!res.ok) throw new Error();
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        toast({ title: `${result.name} added`, description: `${result.totalWeeks}-week run block from ${format(parseISO(date), "d MMM yyyy")}` });
        navigateToWeekOf(date);
        setBrainOpen(false); setBrainResults([]); setBrainQuery("");
        return;
      }

      // wod or run — single session
      const raw = result.raw ?? {};
      const newSession = result.category === "run"
        ? {
            id: `sess-${Date.now()}`,
            date,
            name: result.name,
            type: "Run" as const,
            order: 0,
            exercises: [{ id: `ex-${Date.now()}`, name: result.name, sets: null, reps: null, rpe: null, notes: `${raw.duration ? raw.duration + " min" : ""}${raw.distanceKm ? " · " + raw.distanceKm + " km" : ""} ${raw.intensity ?? ""}`.trim(), rawText: raw.structure ?? "" }],
          }
        : {
            id: `sess-${Date.now()}`,
            date,
            name: result.name,
            type: "Training" as const,
            order: 0,
            exercises: [{ id: `ex-${Date.now()}`, name: result.name, sets: raw.sets ?? null, reps: raw.reps ?? null, rpe: null, notes: raw.notes ?? "", rawText: raw.description ?? "" }],
          };
      await addSessionToClientCalendar(date, newSession, setBrainAdding as any, result.id, () => { navigateToWeekOf(date); setBrainOpen(false); setBrainResults([]); setBrainQuery(""); }, result.name);
    } catch {
      toast({ title: "Failed to add to calendar", variant: "destructive" });
    } finally {
      setBrainAdding(null);
    }
  };

  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: entries, isLoading: entriesLoading } = useListNutritionEntries(clientId, { date: selectedDate });
  const addMutation = useAddNutritionEntry();
  const deleteMutation = useDeleteNutritionEntry();

  const [foodInput, setFoodInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const interimRef = useRef("");
  const recRef = useRef<any>(null);

  // Voice recognition setup
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let fin = ""; let int = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else int += e.results[i][0].transcript;
      }
      interimRef.current = int;
      setInterim(int);
      if (fin) {
        interimRef.current = "";
        setFoodInput(prev => (prev ? prev + " " : "") + fin.trim());
        setInterim("");
      }
    };
    r.onerror = () => { setListening(false); setInterim(""); interimRef.current = ""; };
    r.onend = () => {
      const leftover = interimRef.current.trim();
      if (leftover) setFoodInput(prev => (prev ? prev + " " : "") + leftover);
      interimRef.current = "";
      setListening(false);
      setInterim("");
    };
    recRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, []);

  const toggleListening = () => {
    const r = recRef.current;
    if (!r) return;
    if (listening) { r.stop(); return; }
    setListening(true);
    setInterim("");
    interimRef.current = "";
    try { r.start(); } catch {}
  };

  // Command bar voice recognition
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let fin = ""; let int = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else int += e.results[i][0].transcript;
      }
      cmdInterimRef.current = int;
      setCmdInterim(int);
      if (fin) {
        cmdInterimRef.current = "";
        setCmdInput(prev => (prev ? prev + " " : "") + fin.trim());
        setCmdInterim("");
      }
    };
    r.onerror = () => { setCmdListening(false); setCmdInterim(""); cmdInterimRef.current = ""; };
    r.onend = () => {
      const leftover = cmdInterimRef.current.trim();
      if (leftover) setCmdInput(prev => (prev ? prev + " " : "") + leftover);
      cmdInterimRef.current = "";
      setCmdListening(false);
      setCmdInterim("");
    };
    cmdRecRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, []);

  // Describe-It voice recognition
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e: any) => {
      let fin = ""; let int = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else int += e.results[i][0].transcript;
      }
      describeInterimRef.current = int;
      setDescribeInterim(int);
      if (fin) {
        describeInterimRef.current = "";
        setDescribeText(prev => (prev ? prev + " " : "") + fin.trim());
        setDescribeInterim("");
      }
    };
    r.onerror = () => { setDescribeListening(false); setDescribeInterim(""); describeInterimRef.current = ""; };
    r.onend = () => {
      const leftover = describeInterimRef.current.trim();
      if (leftover) setDescribeText(prev => (prev ? prev + " " : "") + leftover);
      describeInterimRef.current = "";
      setDescribeListening(false);
      setDescribeInterim("");
    };
    describeRecRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, []);

  const toggleDescribeListening = () => {
    const r = describeRecRef.current;
    if (!r) return;
    if (describeListening) { r.stop(); return; }
    setDescribeListening(true);
    setDescribeInterim("");
    describeInterimRef.current = "";
    try { r.start(); } catch {}
  };

  useEffect(() => {
    if (!assignDialogOpen) { setAssignSearch(""); setSelectedSourceId(null); return; }
    fetch("/api/programmes?all=true")
      .then(r => r.json())
      .then((all: { id: number; title: string }[]) => {
        const seen = new Set<string>();
        const deduped: { id: number; title: string }[] = [];
        for (const p of all) {
          const base = p.title.replace(/\s*—\s*(from\s+)?\d{1,2}\s+\w+\s+\d{4}$/, "").trim();
          if (!seen.has(base)) { seen.add(base); deduped.push({ id: p.id, title: base }); }
        }
        setAllProgrammes(deduped);
      })
      .catch(() => {});
  }, [assignDialogOpen]);

  const toggleCmdListening = () => {
    const r = cmdRecRef.current;
    if (!r) return;
    if (cmdListening) { r.stop(); return; }
    setCmdListening(true);
    setCmdInterim("");
    cmdInterimRef.current = "";
    try { r.start(); } catch {}
  };

  const handleAdd = async () => {
    const text = foodInput.trim();
    if (!text) return;
    setIsAdding(true);
    try {
      await addMutation.mutateAsync({ clientId, data: { description: text, date: selectedDate } });
      queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(clientId, { date: selectedDate }) });
      setFoodInput("");
      toast({ title: "Entry added" });
    } catch {
      toast({ title: "Error adding entry", variant: "destructive" });
    } finally { setIsAdding(false); }
  };

  const handleDelete = async (entryId: number) => {
    try {
      await deleteMutation.mutateAsync({ clientId, entryId });
      queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(clientId, { date: selectedDate }) });
    } catch {
      toast({ title: "Error deleting entry", variant: "destructive" });
    }
  };

  // Daily totals
  const totals = (entries || []).reduce(
    (acc: { calories: number; protein: number; carbs: number; fats: number }, e: NutritionEntry) => ({
      calories: acc.calories + (e.calories ?? 0),
      protein: acc.protein + parseFloat(e.protein ?? "0"),
      carbs: acc.carbs + parseFloat(e.carbs ?? "0"),
      fats: acc.fats + parseFloat(e.fats ?? "0"),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  if (clientLoading) return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (!client) return (
    <div className="flex h-screen items-center justify-center flex-col gap-3">
      <p className="text-muted-foreground">Client not found</p>
      <Button variant="outline" onClick={() => setLocation("/clients")}>Back to Clients</Button>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-6 py-4">
        <div className="flex items-center gap-3">
          {mode === "coach" && (
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setLocation("/clients")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          {mode === "client" && (
            <div className="flex items-center gap-2 mr-1">
              <div className="bg-primary/15 p-1.5 rounded-lg">
                <Dumbbell className="w-4 h-4 text-primary" />
              </div>
              <span className="font-display font-bold text-sm leading-none text-foreground/70">Cue <span className="text-primary">Coaching</span></span>
            </div>
          )}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
              {client.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <h1 className="font-display font-bold text-lg truncate">{client.name}</h1>
          </div>
          {mode === "coach" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={openGoalsDialog}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground gap-1.5 text-xs h-8 px-2.5"
              title="Set daily macro & calorie goals"
            >
              <Target className="w-3.5 h-3.5" />
              Goals
            </Button>
          )}
          {mode === "coach" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetPassword}
              disabled={resettingPassword}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground gap-1.5 text-xs h-8 px-2.5"
              title="Reset client's portal password"
            >
              {resettingPassword ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              Reset PW
            </Button>
          )}
          {mode === "client" && (
            <>
              <Link href="/clients">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-shrink-0 text-muted-foreground hover:text-foreground gap-1.5 text-xs h-8 px-2.5"
                  title="Switch to coach view"
                >
                  Coach view
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearClient}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground gap-1.5 text-xs h-8 px-2.5"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </Button>
            </>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 bg-muted/50 rounded-xl p-1 w-fit">
          {(["nutrition", "training"] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "nutrition" ? <Utensils className="w-3.5 h-3.5" /> : <Dumbbell className="w-3.5 h-3.5" />}
              {tab === "nutrition" ? "Nutrition" : "Training"}
            </button>
          ))}
        </div>
      </div>

      {/* Nutrition Tab */}
      {activeTab === "nutrition" && (
        <div className="px-6 py-6 max-w-2xl mx-auto space-y-5">
          {/* Date selector */}
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="text-sm font-medium bg-transparent border-none outline-none cursor-pointer text-foreground"
            />
          </div>

          {/* Daily totals */}
          {(entries?.length ?? 0) > 0 && (
            <div className="bg-primary/5 border border-primary/15 rounded-2xl px-5 py-4">
              <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-3">Daily Totals</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                {[
                  { label: "Calories", value: Math.round(totals.calories), unit: "kcal", color: "text-orange-500" },
                  { label: "Protein", value: totals.protein.toFixed(1), unit: "g", color: "text-blue-500" },
                  { label: "Carbs", value: totals.carbs.toFixed(1), unit: "g", color: "text-yellow-500" },
                  { label: "Fats", value: totals.fats.toFixed(1), unit: "g", color: "text-pink-500" },
                ].map(({ label, value, unit, color }) => (
                  <div key={label}>
                    <p className={`text-lg font-bold ${color}`}>{value}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">{unit}</p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add food input */}
          <div className="bg-card border rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Plus className="w-3 h-3" /> Add Food / Meal
            </p>
            <div className="flex gap-2 items-end">
              <div className="relative flex-1">
                <textarea
                  value={listening ? (interim || foodInput) : foodInput}
                  onChange={e => setFoodInput(e.target.value)}
                  placeholder={listening ? "Listening…" : 'Describe what you ate, e.g. "2 scrambled eggs with toast and butter"'}
                  rows={2}
                  disabled={listening}
                  className="w-full resize-none text-sm bg-muted/40 border border-muted rounded-xl px-3 py-2.5 pr-10 outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 transition-colors"
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`absolute right-2 bottom-2.5 p-1.5 rounded-lg transition-colors ${listening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                  title={listening ? "Stop" : "Dictate"}
                >
                  {listening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              </div>
              <Button
                onClick={handleAdd}
                disabled={!foodInput.trim() || isAdding || listening}
                className="rounded-xl self-end h-10 px-4"
              >
                {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 ml-0.5">AI will estimate calories, protein, carbs & fats</p>
          </div>

          {/* Entries list */}
          {entriesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : !entries?.length ? (
            <div className="text-center py-10 text-muted-foreground">
              <Utensils className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No food logged for this day yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry: NutritionEntry) => (
                <div key={entry.id} className="bg-card border rounded-2xl px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-snug flex-1">{entry.description}</p>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="text-muted-foreground/40 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {entry.calories !== null && (
                    <div className="flex gap-3 mt-2.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-500 bg-orange-50 rounded-lg px-2 py-0.5">
                        {entry.calories} kcal
                      </span>
                      {entry.protein && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-500 bg-blue-50 rounded-lg px-2 py-0.5">
                          P: {parseFloat(entry.protein).toFixed(1)}g
                        </span>
                      )}
                      {entry.carbs && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-600 bg-yellow-50 rounded-lg px-2 py-0.5">
                          C: {parseFloat(entry.carbs).toFixed(1)}g
                        </span>
                      )}
                      {entry.fats && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-pink-500 bg-pink-50 rounded-lg px-2 py-0.5">
                          F: {parseFloat(entry.fats).toFixed(1)}g
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Training Tab */}
      {activeTab === "training" && (
        <div className="relative flex flex-col h-full overflow-hidden">

          {/* Calendar toolbar */}
          <div className="shrink-0 px-4 py-3 border-b flex items-center justify-between gap-2 bg-background">
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => setTrainingWeekOffset(w => w - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-3 text-xs rounded-md" onClick={() => setTrainingWeekOffset(0)}>
                Today
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => setTrainingWeekOffset(w => w + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase sm:hidden">
                Your workout builders
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white border-0 shadow-sm"
                  onClick={() => { setBrainResults([]); setBrainQuery(""); setBrainIntent(null); setBrainOpen(true); }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Ask Daddy</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1 border-purple-200 text-purple-700 hover:bg-purple-50"
                  onClick={() => { setWodClientResults([]); setWodClientQuery(""); setWodClientTargetDate(format(new Date(), "yyyy-MM-dd")); setWodClientBrainOpen(true); }}
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">WOD Brain</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1 border-green-200 text-green-700 hover:bg-green-50"
                  onClick={() => { setRunClientResults([]); setRunClientQuery(""); setRunClientTargetDate(format(new Date(), "yyyy-MM-dd")); setRunClientBrainOpen(true); }}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Run Brain</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1 border-orange-200 text-orange-700 hover:bg-orange-50"
                  onClick={() => { setStrengthResults([]); setStrengthQuery(""); setStrengthStartDate(format(new Date(), "yyyy-MM-dd")); setStrengthBrainOpen(true); }}
                >
                  <Dumbbell className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Strength Brain</span>
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1"
                  onClick={() => { setSelectedSourceId(null); setAssignStartDate(format(new Date(), "yyyy-MM-dd")); setBuildMode("template"); setGeneratedPreview(null); setDescribeText(""); setAssignDialogOpen(true); }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Build Programme</span>
                </Button>
              </div>
            </div>
          </div>

          {/* AI Reschedule Command Bar */}
          <div className="shrink-0 px-4 py-2 border-b bg-muted/30 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cmdListening ? (cmdInterim || cmdInput) : cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleRescheduleCmd(); }}
                placeholder='e.g. "reschedule squat block to tue/thu/sat" or "delete all sessions"'
                disabled={cmdListening}
                className="flex-1 text-xs bg-background border rounded-lg px-3 py-1.5 outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 transition-colors"
              />
              <button
                type="button"
                onClick={toggleCmdListening}
                title={cmdListening ? "Stop" : "Voice command"}
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${cmdListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
              >
                {cmdListening ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 px-3 rounded-lg shrink-0"
                onClick={handleRescheduleCmd}
                disabled={!cmdInput.trim()}
              >
                Apply
              </Button>
            </div>
            {pendingReschedule && (
              <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-800 leading-snug flex-1">
                  Reschedule <strong>{pendingReschedule.programmeName}</strong> ({pendingReschedule.sessions.length} sessions) to{" "}
                  <strong>{pendingReschedule.dayLabels.join(" / ")}</strong>?
                </p>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" className="h-6 px-2 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={applyReschedule} disabled={cmdSaving}>
                    {cmdSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPendingReschedule(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {pendingBulkDelete && (
              <div className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-xs text-red-800 leading-snug flex-1">
                  {pendingBulkDelete.scope === "all"
                    ? <>Delete <strong>all {pendingBulkDelete.sessionCount} sessions</strong> across every programme? This cannot be undone.</>
                    : <>Delete <strong>{pendingBulkDelete.programmeName}</strong> ({pendingBulkDelete.sessionCount} sessions)? This cannot be undone.</>
                  }
                </p>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" className="h-6 px-2 text-xs bg-red-600 hover:bg-red-700 text-white" onClick={applyBulkDelete} disabled={bulkDeleting}>
                    {bulkDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPendingBulkDelete(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Calendar grid */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <div className="min-w-[560px]">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b bg-muted/30 sticky top-0 z-10">
                {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                  <div key={d} className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {d}
                  </div>
                ))}
              </div>
              {trainingWeeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b min-h-[80px]">
                  {week.map((day, di) => {
                    const daySessions = allClientSessions.filter(s => {
                      try { return isSameDay(parseISO(s.date), day); } catch { return false; }
                    });
                    const isToday = isSameDay(day, new Date());
                    const dateStr = format(day, "yyyy-MM-dd");
                    const isDropTarget = dragOverDate === dateStr || touchDragOverDate === dateStr;
                    return (
                      <div
                        key={di}
                        data-date={dateStr}
                        className={`border-r last:border-r-0 p-1.5 transition-colors ${di >= 5 ? "bg-muted/20" : ""} ${isDropTarget ? "bg-primary/10 ring-2 ring-inset ring-primary/30" : ""}`}
                        onDragOver={e => { e.preventDefault(); setDragOverDate(dateStr); }}
                        onDragLeave={() => setDragOverDate(null)}
                        onDrop={e => {
                          e.preventDefault();
                          setDragOverDate(null);
                          const item = draggedItemRef.current;
                          if (item) { moveSession(item.sessionId, item.programmeId, dateStr); draggedItemRef.current = null; }
                        }}
                        onClick={() => {
                          const touch = touchDragRef.current;
                          if (touch) {
                            moveSession(touch.sessionId, touch.programmeId, dateStr);
                            touchDragRef.current = null;
                            setTouchDragOverDate(null);
                          }
                        }}
                      >
                        <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                          {format(day, "d")}
                        </div>
                        <div className="space-y-0.5">
                          {daySessions.map(session => {
                            const prog = (clientProgrammes ?? []).find(p =>
                              (p.sessions as Session[]).some(s => s.id === session.id)
                            );
                            const isTouchPicked = touchDragRef.current?.sessionId === session.id;
                            const highlight = getSessionHighlight(session);
                            return (
                              <div
                                key={session.id}
                                draggable
                                onDragStart={() => {
                                  if (prog) draggedItemRef.current = { sessionId: session.id, programmeId: prog.id };
                                }}
                                onDragEnd={() => { draggedItemRef.current = null; setDragOverDate(null); }}
                                onTouchStart={e => {
                                  touchStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                                  if (prog) touchDragRef.current = { sessionId: session.id, programmeId: prog.id };
                                }}
                                onTouchMove={e => {
                                  const t = e.touches[0];
                                  const start = touchStartPosRef.current;
                                  if (!start) return;
                                  const moved = Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y);
                                  if (moved < 8) return;
                                  e.preventDefault();
                                  const el = document.elementFromPoint(t.clientX, t.clientY);
                                  const cell = el?.closest("[data-date]") as HTMLElement | null;
                                  setTouchDragOverDate(cell?.dataset.date ?? null);
                                }}
                                onTouchEnd={e => {
                                  const t = e.changedTouches[0];
                                  const start = touchStartPosRef.current;
                                  const moved = start ? Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y) : 0;
                                  if (moved < 8) {
                                    touchDragRef.current = null;
                                    setTouchDragOverDate(null);
                                    if (mode === "client" && prog) {
                                      setLocation(`/client/programmes/${prog.id}/sessions/${session.id}`);
                                    } else {
                                      setSelectedTrainingSession(session);
                                    }
                                    return;
                                  }
                                  const el = document.elementFromPoint(t.clientX, t.clientY);
                                  const cell = el?.closest("[data-date]") as HTMLElement | null;
                                  const dropDate = cell?.dataset.date;
                                  const item = touchDragRef.current;
                                  if (dropDate && item) moveSession(item.sessionId, item.programmeId, dropDate);
                                  touchDragRef.current = null;
                                  setTouchDragOverDate(null);
                                }}
                                onClick={() => {
                                  if (touchDragRef.current) return;
                                  if (mode === "client" && prog) {
                                    setLocation(`/client/programmes/${prog.id}/sessions/${session.id}`);
                                  } else {
                                    setSelectedTrainingSession(session);
                                  }
                                }}
                                className={`relative group w-full text-left px-1.5 py-1 rounded-md transition-colors text-[10px] leading-tight font-medium cursor-grab active:cursor-grabbing ${isTouchPicked ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 shadow-md" : "bg-primary/10 hover:bg-primary/20 text-primary"}`}
                              >
                                <span className="block truncate pr-3">{session.name || "Session"}</span>
                                {highlight && (
                                  <span className={`block truncate text-[9px] leading-tight mt-0.5 font-normal ${isTouchPicked ? "opacity-80" : "opacity-60"}`}>{highlight}</span>
                                )}
                                <button
                                  onTouchStart={e => e.stopPropagation()}
                                  onClick={e => { e.stopPropagation(); deleteSession(session.id, prog?.id); }}
                                  className={`absolute top-0.5 right-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${isTouchPicked ? "text-primary-foreground hover:bg-white/20" : "text-primary hover:bg-primary/30"}`}
                                  title="Delete session"
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

          {/* Session detail slide-up panel (coach mode only) */}
          {selectedTrainingSession && (() => {
            const panelProg = (clientProgrammes ?? []).find(p =>
              (p.sessions as Session[]).some(s => s.id === selectedTrainingSession.id)
            );
            return (
              <div className="absolute inset-x-0 bottom-0 bg-background border-t rounded-t-2xl shadow-2xl z-20 max-h-[75%] flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                  <div>
                    <h2 className="font-semibold text-base">{selectedTrainingSession.name || "Session"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(parseISO(selectedTrainingSession.date), "EEEE, d MMMM yyyy")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {panelProg && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-8 px-3 rounded-xl gap-1.5"
                        onClick={() => setLocation(`/programmes/${panelProg.id}/sessions/${selectedTrainingSession.id}`)}
                      >
                        <CalendarDays className="w-3.5 h-3.5" />
                        Edit session
                      </Button>
                    )}
                    <button onClick={() => setSelectedTrainingSession(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto px-5 py-4 space-y-3">
                  {(!selectedTrainingSession.exercises || selectedTrainingSession.exercises.length === 0) ? (
                    <p className="text-sm text-muted-foreground">No exercises in this session.</p>
                  ) : (
                    selectedTrainingSession.exercises.map((ex, i) => (
                      <div key={ex.id ?? i} className="flex items-start gap-3 py-2 border-b last:border-b-0">
                        <span className="text-xs text-muted-foreground font-mono w-5 shrink-0 pt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{ex.name}</p>
                          {ex.sets && ex.reps && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {ex.sets} × {ex.reps}{ex.weight ? ` @ ${ex.weight}` : ""}
                            </p>
                          )}
                          {ex.notes && <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{ex.notes}</p>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Build Programme Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={open => { setAssignDialogOpen(open); if (!open) setGeneratedPreview(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dumbbell className="w-5 h-5 text-primary" />
              Build Your Programme
            </DialogTitle>
            <DialogDescription className="sr-only">Choose a template or describe a new programme for {client?.name ?? "this client"}</DialogDescription>
          </DialogHeader>

          {/* Mode tabs */}
          <div className="flex rounded-xl bg-muted p-1 gap-1">
            <button
              className={`flex-1 text-sm font-medium py-1.5 rounded-lg transition-all ${buildMode === "template" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => { setBuildMode("template"); setGeneratedPreview(null); }}
            >
              From Template
            </button>
            <button
              className={`flex-1 text-sm font-medium py-1.5 rounded-lg transition-all ${buildMode === "describe" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => { setBuildMode("describe"); setSelectedSourceId(null); }}
            >
              Describe It
            </button>
          </div>

          {/* From Template mode */}
          {buildMode === "template" && (
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Programme</label>
                <Input
                  placeholder="Search programmes…"
                  value={assignSearch}
                  onChange={e => setAssignSearch(e.target.value)}
                  className="rounded-xl"
                  autoFocus
                />
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                  {(allProgrammes.length ? allProgrammes : (masterProgrammes ?? []).map(p => ({ id: p.id, title: p.title || "Untitled" })))
                    .filter(p => !assignSearch.trim() || p.title.toLowerCase().includes(assignSearch.toLowerCase()))
                    .map(prog => (
                      <button
                        key={prog.id}
                        onClick={() => setSelectedSourceId(prog.id)}
                        className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                          selectedSourceId === prog.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/40 hover:bg-muted/50"
                        }`}
                      >
                        {prog.title}
                      </button>
                    ))}
                  {allProgrammes.length > 0 && !allProgrammes.some(p => !assignSearch.trim() || p.title.toLowerCase().includes(assignSearch.toLowerCase())) && (
                    <p className="text-xs text-muted-foreground text-center py-2">No programmes match</p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" value={assignStartDate} onChange={e => setAssignStartDate(e.target.value)} className="w-full" />
              </div>
              <DialogFooter className="pt-0">
                <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAssign} disabled={!selectedSourceId || !assignStartDate || isAssigning}>
                  {isAssigning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Assign to {client?.name ?? "Client"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Describe It mode */}
          {buildMode === "describe" && (
            <div className="space-y-4 py-1">
              {!generatedPreview ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Describe the programme</label>
                    <div className="relative">
                      <textarea
                        className={`w-full min-h-[110px] rounded-xl border bg-background px-3 py-2.5 pr-10 text-sm resize-none focus:outline-none focus:ring-2 placeholder:text-muted-foreground transition-all ${describeListening ? "ring-2 ring-red-400/50 border-red-300" : "focus:ring-primary/40"}`}
                        placeholder="e.g. 3 days strength per week (upper/lower split), 1 run and 1 WOD — 6 week block building intensity each week. Max 6 weeks."
                        value={describeListening ? (describeText + (describeInterim ? " " + describeInterim : "")) : describeText}
                        onChange={e => { if (!describeListening) setDescribeText(e.target.value); }}
                        autoFocus={!describeListening}
                      />
                      <button
                        type="button"
                        onClick={toggleDescribeListening}
                        className={`absolute right-2.5 bottom-2.5 p-1.5 rounded-lg transition-colors ${describeListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                        title={describeListening ? "Stop recording" : "Speak your description"}
                      >
                        {describeListening
                          ? <><span className="absolute inset-0 rounded-lg bg-red-400/20 animate-ping" /><Square className="w-3.5 h-3.5 fill-current relative z-10" /></>
                          : <Mic className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {describeListening && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        Listening… speak your programme description, then tap stop
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Start Date</label>
                    <Input type="date" value={assignStartDate} onChange={e => setAssignStartDate(e.target.value)} className="w-full" />
                  </div>
                  <DialogFooter className="pt-0">
                    <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
                    <Button
                      onClick={handleGenerateProgramme}
                      disabled={!describeText.trim() || !assignStartDate || describeGenerating}
                      className="gap-2"
                    >
                      {describeGenerating
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Building…</>
                        : <><Sparkles className="w-4 h-4" /> Generate</>}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm leading-snug">{generatedPreview.title}</p>
                      <span className="text-xs text-muted-foreground shrink-0">{generatedPreview.sessions.length} sessions</span>
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {generatedPreview.sessions.map((s: any) => {
                        const isWod = s.source === "wod_brain";
                        const isRun = s.source === "run_brain";
                        return (
                          <div key={s.id} className="flex items-center gap-2 text-xs">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isWod ? "bg-violet-500" : isRun ? "bg-green-500" : "bg-primary"}`} />
                            <span className="text-muted-foreground w-14 shrink-0">{format(parseISO(s.date), "EEE d MMM")}</span>
                            <span className="font-medium truncate">{s.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed">
                    💡 Once added, use the calendar to fine-tune dates, swap exercises, or adjust sessions — no need to regenerate for small changes.
                  </p>
                  <DialogFooter className="pt-0">
                    <Button variant="ghost" size="sm" onClick={() => setGeneratedPreview(null)} className="text-muted-foreground">← Back</Button>
                    <Button onClick={handleConfirmGenerated} disabled={confirmingGenerated} className="gap-2">
                      {confirmingGenerated ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Add to {client?.name ?? "Client"}'s Calendar
                    </Button>
                  </DialogFooter>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Goals Dialog */}
      <Dialog open={goalsOpen} onOpenChange={setGoalsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Daily Goals — {client?.name}</DialogTitle>
            <DialogDescription>
              Set target macros. Macro calories must not exceed the calorie goal<br/>
              (protein × 4 + carbs × 4 + fats × 9).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Calorie goal */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Daily Calories (kcal)</label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 2000"
                value={goalCalories}
                onChange={e => { setGoalCalories(e.target.value); setGoalsError(""); }}
              />
            </div>

            {/* Macro grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-blue-600">Protein (g)</label>
                <Input type="number" min={0} placeholder="e.g. 180" value={goalProtein}
                  onChange={e => { setGoalProtein(e.target.value); setGoalsError(""); }} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-yellow-600">Carbs (g)</label>
                <Input type="number" min={0} placeholder="e.g. 200" value={goalCarbs}
                  onChange={e => { setGoalCarbs(e.target.value); setGoalsError(""); }} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-pink-600">Fats (g)</label>
                <Input type="number" min={0} placeholder="e.g. 70" value={goalFats}
                  onChange={e => { setGoalFats(e.target.value); setGoalsError(""); }} />
              </div>
            </div>

            {/* Live macro calorie counter */}
            {(goalProtein || goalCarbs || goalFats) && (
              <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm font-medium ${macroExceedsTarget ? "bg-red-50 border border-red-200 text-red-600" : "bg-muted/60 text-muted-foreground"}`}>
                <span>Macro calories</span>
                <span className="font-bold">
                  {Math.round(macroKcal)} / {goalCalories || "—"} kcal
                  {macroExceedsTarget && " ⚠️"}
                </span>
              </div>
            )}

            {goalsError && <p className="text-sm text-red-500">{goalsError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalsOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveGoals}
              disabled={savingGoals || macroExceedsTarget || !goalCalories || !goalProtein || !goalCarbs || !goalFats}
            >
              {savingGoals ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Goals
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WOD Brain Dialog — Workouts + Cycles */}
      <Dialog
        open={wodClientBrainOpen}
        onOpenChange={open => {
          if (!open) {
            try { wodClientRecRef.current?.stop(); } catch {}
            try { cycleRecRef.current?.stop(); } catch {}
            setWodClientListening(false); setWodClientInterim("");
            setCycleListening(false); setCycleInterim("");
          }
          setWodClientBrainOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              WOD Brain
            </DialogTitle>
          </DialogHeader>

          {/* Tab switcher */}
          <div className="flex gap-1 border-b -mx-1 px-1">
            <button
              onClick={() => setWodBrainTab("workouts")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${wodBrainTab === "workouts" ? "border-purple-600 text-purple-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Brain className="w-3.5 h-3.5" /> Workouts <span className="font-normal opacity-60">(20)</span>
            </button>
            <button
              onClick={() => setWodBrainTab("cycles")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${wodBrainTab === "cycles" ? "border-purple-600 text-purple-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Zap className="w-3.5 h-3.5" /> Endurance Cycles
            </button>
          </div>

          {/* ── Workouts tab ── */}
          {wodBrainTab === "workouts" && (
            <div className="space-y-4 pt-1">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. AMRAP dumbbell engine 15 min…"
                  value={wodClientQuery + (wodClientInterim ? ` ${wodClientInterim}` : "")}
                  onChange={e => setWodClientQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchClientWods()}
                  className="flex-1 rounded-xl"
                />
                <Button size="icon" variant={wodClientListening ? "destructive" : "outline"} className="shrink-0 rounded-xl" onClick={toggleWodClientListening} title={wodClientListening ? "Stop" : "Speak"}>
                  {wodClientListening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button size="icon" className="shrink-0 rounded-xl bg-purple-600 hover:bg-purple-700" onClick={searchClientWods} disabled={!wodClientQuery.trim() || wodClientSearching}>
                  {wodClientSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                </Button>
              </div>
              {wodClientListening && <p className="text-xs text-purple-600 animate-pulse">{wodClientInterim ? `"${wodClientInterim}"` : "Listening…"}</p>}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Target date</label>
                <input type="date" value={wodClientTargetDate} onChange={e => setWodClientTargetDate(e.target.value)}
                  className="w-full rounded-xl border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              {wodClientResults.length > 0 && (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {wodClientResults.map((wod: any) => (
                    <div key={wod.id} className="rounded-xl border bg-purple-50/40 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{wod.name}</p>
                          <p className="text-xs text-purple-700 font-medium">{wod.formatLabel ?? wod.format} · {wod.duration} min{(wod.tags ?? []).length > 0 ? ` · ${wod.tags.join(", ")}` : ""}</p>
                        </div>
                        <Button size="sm" className="shrink-0 rounded-lg bg-purple-600 hover:bg-purple-700 text-white"
                          disabled={!wodClientTargetDate || wodClientAdding === wod.id}
                          onClick={() => addWodToClientCalendar(wod)}
                          title={!wodClientTargetDate ? "Choose a date first" : `Add to ${wodClientTargetDate}`}>
                          {wodClientAdding === wod.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        </Button>
                      </div>
                      {wod.structure && (
                        <p className="text-xs text-muted-foreground italic leading-relaxed">{wod.structure}</p>
                      )}
                      {(wod.blocks ?? []).length > 0 && (
                        <ol className="space-y-0.5">
                          {wod.blocks.map((b: any, i: number) => (
                            <li key={i} className="text-xs text-foreground flex items-baseline gap-1.5">
                              <span className="text-purple-500 font-bold shrink-0">{i + 1}.</span>
                              <span className="capitalize">{b.amount} {b.unit} {b.movement}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Endurance Cycles tab ── */}
          {wodBrainTab === "cycles" && (
            <div className="space-y-4 pt-1">
              <p className="text-xs text-muted-foreground">
                A cycle is a <strong>multi-week progressive programme</strong> — one session per week, each with a different duration or load. Inserting a cycle adds all sessions at once.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. EMOM ergs engine endurance…"
                  value={cycleQuery + (cycleInterim ? ` ${cycleInterim}` : "")}
                  onChange={e => setCycleQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchClientCycles()}
                  className="flex-1 rounded-xl"
                />
                <Button size="icon" variant={cycleListening ? "destructive" : "outline"} className="shrink-0 rounded-xl" onClick={toggleCycleListening} title={cycleListening ? "Stop" : "Speak"}>
                  {cycleListening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button size="icon" className="shrink-0 rounded-xl bg-purple-600 hover:bg-purple-700" onClick={searchClientCycles} disabled={!cycleQuery.trim() || cycleSearching}>
                  {cycleSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                </Button>
              </div>
              {cycleListening && <p className="text-xs text-purple-600 animate-pulse">{cycleInterim ? `"${cycleInterim}"` : "Listening…"}</p>}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Start date (Week 1 anchor)</label>
                <input type="date" value={cycleStartDate} onChange={e => setCycleStartDate(e.target.value)}
                  className="w-full rounded-xl border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              {cycleResults.length > 0 && (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {cycleResults.map((cycle: any) => (
                    <div key={cycle.id} className="rounded-xl border p-3 bg-purple-50/40 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{cycle.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {cycle.totalWeeks} weeks · {cycle.durationRange?.min}–{cycle.durationRange?.max} min · {(cycle.tags ?? []).join(", ")}
                          </p>
                        </div>
                        <Button size="sm" className="shrink-0 rounded-lg bg-purple-600 hover:bg-purple-700 text-white"
                          disabled={!cycleStartDate || cycleInserting === cycle.id}
                          onClick={() => insertCycle(cycle)}
                          title={!cycleStartDate ? "Choose a start date first" : `Insert ${cycle.totalWeeks} sessions from ${cycleStartDate}`}>
                          {cycleInserting === cycle.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        </Button>
                      </div>
                      {cycle.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{cycle.description}</p>
                      )}
                      <div className="flex gap-1 flex-wrap">
                        {(cycle.weeks ?? []).map((w: any) => (
                          <span key={w.week} className="text-[10px] bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 font-medium">
                            W{w.week}: {w.durationMin}min
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Run Brain Dialog */}
      <Dialog
        open={runClientBrainOpen}
        onOpenChange={open => {
          if (!open) { try { runClientRecRef.current?.stop(); } catch {} setRunClientListening(false); setRunClientInterim(""); }
          setRunClientBrainOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-green-600" />
              Run Brain
            </DialogTitle>
            <DialogDescription>Search 50 runs and add one to this client's calendar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 5km tempo easy aerobic…"
                value={runClientQuery + (runClientInterim ? ` ${runClientInterim}` : "")}
                onChange={e => setRunClientQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchClientRuns()}
                className="flex-1 rounded-xl"
              />
              <Button size="icon" variant={runClientListening ? "destructive" : "outline"} className="shrink-0 rounded-xl" onClick={toggleRunClientListening} title={runClientListening ? "Stop listening" : "Speak your search"}>
                {runClientListening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
              <Button size="icon" variant="default" className="shrink-0 rounded-xl bg-green-600 hover:bg-green-700" onClick={searchClientRuns} disabled={!runClientQuery.trim() || runClientSearching}>
                {runClientSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              </Button>
            </div>
            {runClientListening && (
              <p className="text-xs text-green-600 animate-pulse">{runClientInterim ? `"${runClientInterim}"` : "Listening…"}</p>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Target date</label>
              <input
                type="date"
                value={runClientTargetDate}
                onChange={e => setRunClientTargetDate(e.target.value)}
                className="w-full rounded-xl border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
            {runClientResults.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {runClientResults.map((run: any) => (
                  <div key={run.id} className="rounded-xl border bg-green-50/40 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{run.name}</p>
                        <p className="text-xs text-green-700 font-medium capitalize">
                          {run.type ?? run.runType}
                          {run.intensityLabel ? ` · ${run.intensityLabel}` : ""}
                          {run.duration ? ` · ${run.duration} min` : ""}
                          {run.distanceKm ? ` · ${run.distanceKm} km` : ""}
                          {(run.tags ?? []).length > 0 ? ` · ${run.tags.join(", ")}` : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 rounded-lg bg-green-600 hover:bg-green-700 text-white"
                        disabled={!runClientTargetDate || runClientAdding === run.id}
                        onClick={() => addRunToClientCalendar(run)}
                        title={!runClientTargetDate ? "Choose a date first" : `Add to ${runClientTargetDate}`}
                      >
                        {runClientAdding === run.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      </Button>
                    </div>
                    {run.structure && (
                      <p className="text-xs text-muted-foreground italic leading-relaxed">{run.structure}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Strength Brain Dialog */}
      <Dialog
        open={strengthBrainOpen}
        onOpenChange={open => {
          if (!open) { try { strengthRecRef.current?.stop(); } catch {} setStrengthListening(false); setStrengthInterim(""); }
          setStrengthBrainOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-orange-600" />
              Strength Brain
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">Search for a squat cycle — describe the style, duration, or difficulty.</p>

            {/* Search input */}
            <div className="relative flex items-center gap-2">
              <div className="flex-1 relative">
                <Input
                  placeholder='e.g. "low rep squat cycle" or "beginner 3 day"'
                  value={strengthListening ? (strengthQuery + (strengthInterim ? " " + strengthInterim : "")) : strengthQuery}
                  onChange={e => !strengthListening && setStrengthQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !strengthSearching && searchStrengthBlocks()}
                  className={strengthListening ? "border-red-300 bg-red-50 pr-2" : ""}
                  autoFocus
                />
                {strengthListening && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-0.5">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-0.5 bg-red-500 rounded-full animate-bounce" style={{ height: 12 + i * 4, animationDelay: `${i * 0.1}s` }} />
                    ))}
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant={strengthListening ? "destructive" : "outline"}
                size="icon"
                className="shrink-0 h-10 w-10 rounded-lg"
                onClick={toggleStrengthListening}
                title={strengthListening ? "Stop recording" : "Speak your query"}
              >
                {strengthListening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
              <Button
                size="sm"
                className="shrink-0 gap-1.5 rounded-lg h-10 px-4 bg-orange-600 hover:bg-orange-700"
                onClick={searchStrengthBlocks}
                disabled={!strengthQuery.trim() || strengthSearching}
              >
                {strengthSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Find
              </Button>
            </div>

            {/* Start date picker — shown once results are in */}
            {strengthResults.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-1.5">Start date for this block</p>
                <Input
                  type="date"
                  value={strengthStartDate}
                  onChange={e => setStrengthStartDate(e.target.value)}
                  className="rounded-lg"
                />
                <p className="text-xs text-muted-foreground mt-1">Sessions snap to Monday of the chosen week.</p>
              </div>
            )}

            {/* Results */}
            {strengthResults.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-muted-foreground">Top matches</p>
                {strengthResults.map((t, idx) => (
                  <div key={t.id} className="rounded-xl border border-orange-100 bg-orange-50/40 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-xs font-bold text-orange-700 bg-orange-100 rounded px-2 py-0.5 capitalize">{t.level}</span>
                          <span className="text-xs text-muted-foreground">{t.durationWeeks}w · {t.sessionsPerWeek}×/wk</span>
                          <span className="text-xs text-amber-600 font-bold">#{idx + 1}</span>
                        </div>
                        <p className="font-semibold text-sm">{t.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-700"
                        onClick={() => insertStrengthBlock(t.id, t.name)}
                        disabled={!strengthStartDate || strengthInserting === t.id}
                      >
                        {strengthInserting === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Add
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(t.tags ?? []).map((tag: string) => (
                        <span key={tag} className="text-xs bg-orange-100/60 text-orange-700 rounded px-1.5 py-0.5 capitalize">{tag.replace(/-/g, " ")}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Universal Brain Dialog ────────────────────────────────────────── */}
      <Dialog open={brainOpen} onOpenChange={open => { if (!open) { stopBrainVoice(); } setBrainOpen(open); }}>
        <DialogContent className="max-w-xl w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-600" />
              Ask Daddy
            </DialogTitle>
            <DialogDescription>
              Search WODs, runs, endurance cycles, and strength blocks in one place
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search input */}
            <div className="flex gap-2">
              <Input
                placeholder='e.g. "30 min EMOM" or "easy 10k" or "6 week squat cycle"'
                value={brainListening ? (brainInterim || "Listening…") : brainQuery}
                onChange={e => setBrainQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") searchBrain(brainQuery); }}
                className="flex-1"
                disabled={brainListening}
              />
              <Button
                size="icon"
                variant={brainListening ? "destructive" : "outline"}
                className="shrink-0 rounded-xl"
                onClick={brainListening ? stopBrainVoice : startBrainVoice}
              >
                {brainListening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
              <Button
                className="shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700 gap-1.5"
                onClick={() => searchBrain(brainQuery)}
                disabled={brainSearching || !brainQuery.trim()}
              >
                {brainSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Search
              </Button>
            </div>

            {/* Quick suggestion chips */}
            {!brainResults.length && !brainSearching && (
              <div className="flex flex-wrap gap-2">
                {["30 min conditioning", "long run", "easy aerobic run", "Mikko's cycle", "squat strength block"].map(s => (
                  <button
                    key={s}
                    onClick={() => { setBrainQuery(s); searchBrain(s); }}
                    className="text-xs rounded-full border border-violet-200 bg-violet-50 text-violet-700 px-3 py-1 hover:bg-violet-100 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Intent badge */}
            {brainIntent && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Searching:</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  brainIntent === "wod" ? "bg-purple-100 text-purple-700" :
                  brainIntent === "run" ? "bg-green-100 text-green-700" :
                  brainIntent === "cycle" ? "bg-blue-100 text-blue-700" :
                  brainIntent === "strength" ? "bg-orange-100 text-orange-700" :
                  "bg-gray-100 text-gray-700"
                } capitalize`}>
                  {brainIntent === "all" ? "All libraries" : brainIntent === "cycle" ? "Endurance Cycles" : brainIntent === "wod" ? "WODs" : brainIntent === "run" ? "Runs" : "Strength Blocks"}
                </span>
              </div>
            )}

            {/* Results */}
            {brainResults.length > 0 && (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {brainResults.map((result) => {
                  const catColor: Record<string, string> = {
                    wod: "border-purple-100 bg-purple-50/40",
                    run: "border-green-100 bg-green-50/40",
                    cycle: "border-blue-100 bg-blue-50/40",
                    strength: "border-orange-100 bg-orange-50/40",
                    run_template: "border-teal-100 bg-teal-50/40",
                  };
                  const badgeColor: Record<string, string> = {
                    wod: "bg-purple-100 text-purple-700",
                    run: "bg-green-100 text-green-700",
                    cycle: "bg-blue-100 text-blue-700",
                    strength: "bg-orange-100 text-orange-700",
                    run_template: "bg-teal-100 text-teal-700",
                  };
                  const btnColor: Record<string, string> = {
                    wod: "bg-purple-600 hover:bg-purple-700",
                    run: "bg-green-600 hover:bg-green-700",
                    cycle: "bg-blue-600 hover:bg-blue-700",
                    strength: "bg-orange-600 hover:bg-orange-700",
                    run_template: "bg-teal-600 hover:bg-teal-700",
                  };
                  const catLabel: Record<string, string> = { wod: "WOD", run: "Run", cycle: "Endurance Cycle", strength: "Strength Block", run_template: "Run Block" };

                  return (
                    <div key={result.id} className={`rounded-xl border p-4 space-y-2 ${catColor[result.category] ?? ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeColor[result.category]}`}>
                              {catLabel[result.category]}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">{result.subtitle}</span>
                          </div>
                          <p className="font-semibold text-sm">{result.name}</p>
                          {result.tags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {result.tags.slice(0, 5).map((tag: string) => (
                                <span key={tag} className="text-xs opacity-60 border rounded px-1.5 py-0.5 capitalize">{tag.replace(/_/g, " ")}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={brainDates[result.id] ?? ""}
                          onChange={e => setBrainDates(prev => ({ ...prev, [result.id]: e.target.value }))}
                          className="flex-1 text-xs border rounded-lg px-2 py-1.5 bg-white"
                        />
                        <Button
                          size="sm"
                          className={`shrink-0 gap-1.5 rounded-lg text-white ${btnColor[result.category]}`}
                          onClick={() => brainAddItem(result)}
                          disabled={!brainDates[result.id] || brainAdding === result.id}
                        >
                          {brainAdding === result.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          {result.category === "cycle" ? "Insert Cycle" : result.category === "strength" || result.category === "run_template" ? "Insert Block" : "Add Session"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
