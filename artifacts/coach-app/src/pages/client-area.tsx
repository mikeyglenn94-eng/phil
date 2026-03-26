import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Dumbbell, Utensils, Loader2, Mic, Square, Plus, Trash2, CalendarDays, ChevronRight, ChevronLeft, Calendar, KeyRound, Target, X, Brain, Zap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, startOfWeek, addWeeks, addDays, isSameDay, parseISO } from "date-fns";
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

export default function ClientArea() {
  const [, params] = useRoute("/clients/:clientId");
  const [, setLocation] = useLocation();
  const clientId = parseInt(params?.clientId || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const [activeTab, setActiveTab] = useState<Tab>("nutrition");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [assignStartDate, setAssignStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isAssigning, setIsAssigning] = useState(false);

  // ── Training calendar state ──
  const [trainingWeekOffset, setTrainingWeekOffset] = useState(0);
  const [selectedTrainingSession, setSelectedTrainingSession] = useState<Session | null>(null);

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
        const existingOnDay = (targetProgramme.sessions || []).find((s: any) => s.date === date);
        if (existingOnDay && !confirm(`${format(parseISO(date), "EEE d MMM")} already has a session. Replace it?`)) { setAdding(null); return; }
        const updatedSessions = [...(targetProgramme.sessions || []).filter((s: any) => s.date !== date), newSession];
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
    await addSessionToClientCalendar(wodClientTargetDate, newSession, setWodClientAdding, wod.id, () => { setWodClientBrainOpen(false); setWodClientResults([]); setWodClientQuery(""); setWodClientTargetDate(""); }, sessionName);
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
    await addSessionToClientCalendar(runClientTargetDate, newSession, setRunClientAdding, run.id, () => { setRunClientBrainOpen(false); setRunClientResults([]); setRunClientQuery(""); setRunClientTargetDate(""); }, sessionName);
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
        setBrainOpen(false); setBrainResults([]); setBrainQuery("");
        return;
      }

      // wod or run — single session
      const raw = result.raw ?? {};
      const newSession = result.category === "run"
        ? {
            id: `sess-${Date.now()}`,
            name: result.name,
            type: "Run" as const,
            order: 0,
            exercises: [{ id: `ex-${Date.now()}`, name: result.name, sets: null, reps: null, rpe: null, notes: `${raw.duration ? raw.duration + " min" : ""}${raw.distanceKm ? " · " + raw.distanceKm + " km" : ""} ${raw.intensity ?? ""}`.trim(), rawText: raw.structure ?? "" }],
          }
        : {
            id: `sess-${Date.now()}`,
            name: result.name,
            type: "Training" as const,
            order: 0,
            exercises: [{ id: `ex-${Date.now()}`, name: result.name, sets: raw.sets ?? null, reps: raw.reps ?? null, rpe: null, notes: raw.notes ?? "", rawText: raw.description ?? "" }],
          };
      await addSessionToClientCalendar(date, newSession, setBrainAdding as any, result.id, () => { setBrainOpen(false); setBrainResults([]); setBrainQuery(""); }, result.name);
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
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setLocation("/clients")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
              {client.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <h1 className="font-display font-bold text-lg truncate">{client.name}</h1>
          </div>
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
                  <span className="hidden sm:inline">Ask Brain</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1 border-purple-200 text-purple-700 hover:bg-purple-50"
                  onClick={() => { setWodClientResults([]); setWodClientQuery(""); setWodClientTargetDate(""); setWodClientBrainOpen(true); }}
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">WOD Brain</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1 border-green-200 text-green-700 hover:bg-green-50"
                  onClick={() => { setRunClientResults([]); setRunClientQuery(""); setRunClientTargetDate(""); setRunClientBrainOpen(true); }}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Run Brain</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1 border-orange-200 text-orange-700 hover:bg-orange-50"
                  onClick={() => { setStrengthResults([]); setStrengthQuery(""); setStrengthStartDate(""); setStrengthBrainOpen(true); }}
                >
                  <Dumbbell className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Strength Brain</span>
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="rounded-xl text-xs h-8 px-2 sm:px-3 gap-1"
                  onClick={() => { setSelectedSourceId(null); setAssignStartDate(format(new Date(), "yyyy-MM-dd")); setAssignDialogOpen(true); }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Assign Programme</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Calendar grid */}
          {!clientProgrammes?.length ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Calendar className="w-10 h-10 opacity-20" />
              <p className="text-sm font-medium">No programmes assigned yet</p>
              <p className="text-xs opacity-60">Use "Assign Programme" to populate the calendar</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
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
                    return (
                      <div key={di} className={`border-r last:border-r-0 p-1.5 ${di >= 5 ? "bg-muted/20" : ""}`}>
                        <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                          {format(day, "d")}
                        </div>
                        <div className="space-y-0.5">
                          {daySessions.map(session => (
                            <button
                              key={session.id}
                              onClick={() => setSelectedTrainingSession(session)}
                              className="w-full text-left px-1.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors text-[10px] leading-tight font-medium text-primary truncate block"
                            >
                              {session.name || "Session"}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Session detail slide-up panel */}
          {selectedTrainingSession && (
            <div className="absolute inset-x-0 bottom-0 bg-background border-t rounded-t-2xl shadow-2xl z-20 max-h-[70%] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div>
                  <h2 className="font-semibold text-base">{selectedTrainingSession.name || "Session"}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(parseISO(selectedTrainingSession.date), "EEEE, d MMMM yyyy")}
                  </p>
                </div>
                <button onClick={() => setSelectedTrainingSession(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-4 h-4" />
                </button>
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
          )}
        </div>
      )}

      {/* Assign Programme Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Programme</DialogTitle>
            <DialogDescription>
              Choose a programme and start date. Sessions will be re-dated from that day.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Programme</label>
              <div className="space-y-1.5">
                {masterProgrammes?.map(prog => (
                  <button
                    key={prog.id}
                    onClick={() => setSelectedSourceId(prog.id)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      selectedSourceId === prog.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/40 hover:bg-muted/50"
                    }`}
                  >
                    {prog.title || "Untitled Programme"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Start Date</label>
              <Input
                type="date"
                value={assignStartDate}
                onChange={e => setAssignStartDate(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedSourceId || !assignStartDate || isAssigning}
            >
              {isAssigning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Assign to {client?.name ?? "Client"}
            </Button>
          </DialogFooter>
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
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {wodClientResults.map((wod: any) => (
                    <div key={wod.id} className="flex items-start justify-between gap-3 rounded-xl border p-3 bg-purple-50/40">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{wod.name}</p>
                        <p className="text-xs text-muted-foreground">{wod.formatLabel ?? wod.format} · {wod.duration} min · {(wod.tags ?? []).join(", ")}</p>
                      </div>
                      <Button size="sm" className="shrink-0 rounded-lg bg-purple-600 hover:bg-purple-700 text-white"
                        disabled={!wodClientTargetDate || wodClientAdding === wod.id}
                        onClick={() => addWodToClientCalendar(wod)}
                        title={!wodClientTargetDate ? "Choose a date first" : `Add to ${wodClientTargetDate}`}>
                        {wodClientAdding === wod.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      </Button>
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
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {runClientResults.map((run: any) => (
                  <div key={run.id} className="flex items-start justify-between gap-3 rounded-xl border p-3 bg-green-50/40">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{run.name}</p>
                      <p className="text-xs text-muted-foreground">{run.type ?? run.runType} · {run.duration ? `${run.duration} min` : ""}{run.distanceKm ? ` · ${run.distanceKm} km` : ""} · {(run.tags ?? []).join(", ")}</p>
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
              Ask Brain
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
