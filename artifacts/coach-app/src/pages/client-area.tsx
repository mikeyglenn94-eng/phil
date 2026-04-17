import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRoute, useLocation, Link, useSearch } from "wouter";
import { ArrowLeft, Dumbbell, Utensils, Loader2, Mic, Square, Plus, Trash2, CalendarDays, ChevronRight, ChevronLeft, Calendar, KeyRound, Target, X, Brain, Zap, Sparkles, LogOut, Pencil, Check, Info, ChevronDown, ChevronUp, Camera, CheckSquare, MousePointer2, BookMarked, Globe, CalendarPlus, Copy, Clipboard, Undo2, Redo2, BarChart3, MapPin, Lock, Send, Eye, MoreVertical, EyeOff, RefreshCw, TrendingUp } from "lucide-react";
import { useClientContext } from "@/contexts/client-context";
import { useAuth } from "@/contexts/auth-context";
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
  useUpdateNutritionEntry,
  useSetClientGoals,
  getListNutritionEntriesQueryKey,
  getListProgrammesQueryKey,
  getGetClientQueryKey,
} from "@workspace/api-client-react";
import type { NutritionEntry, Programme, Session } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import DashboardTab, { type AnalyticsData } from "./dashboard-tab";
import { useToast } from "@/hooks/use-toast";
import {
  WorkoutPreviewEditorCard,
  type EditableRow,
  type EditableSession,
  FORMAT_LABELS,
  blankRow,
  parseStrengthToEditable,
  parseWodToEditable,
  parseRunToEditable,
  editableSessionToSession,
} from "@/components/workout-preview-editor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tab = "dashboard" | "training" | "nutrition" | "irl";

interface IrlSlot { id: number; date: string; startTime: string; endTime: string; location: string | null; coachNote: string | null; status: string; }
interface IrlBookingRow { booking: { id: number; slotId: number; creditsUsed: number; status: string; cancelledAt: string | null; creditRefunded: boolean; createdAt: string; }; slot: IrlSlot | null; }
interface IrlLedgerEntry { id: number; delta: number; type: string; note: string | null; createdAt: string; }

/** Fetch /api/generate-programme via SSE stream — heartbeats keep the proxy alive on mobile */
async function streamProgramme(body: object): Promise<any> {
  const res = await fetch("/api/generate-programme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) return { t: "429" };
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) return { t: "ok", ...(await res.json()) };
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      let msg: any;
      try { msg = JSON.parse(json); } catch { continue; }
      if (msg.t === "hb") continue;
      return msg;
    }
  }
  throw new Error("Programme generation timed out. Check your connection and try again.");
}

function getSessionHighlight(session: Session): string {
  const isConditioning = session.source === "wod_brain" || session.source === "run_brain" || session.source === "cycle_brain" || session.source === "swim_brain";
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

function getSessionTypeBadge(session: Session): { label: string; className: string } {
  switch (session.source) {
    case "run_brain":
      return { label: "Run", className: "bg-emerald-100 text-emerald-700" };
    case "wod_brain":
      return { label: "WOD", className: "bg-orange-100 text-orange-700" };
    case "cycle_brain":
      return { label: "Cycling", className: "bg-amber-100 text-amber-700" };
    case "swim_brain":
      return { label: "Swimming", className: "bg-sky-100 text-sky-700" };
    case "endurance_cycle":
      return { label: "Endurance", className: "bg-sky-100 text-sky-700" };
    case "strength_block":
      return { label: "Strength", className: "bg-violet-100 text-violet-700" };
    default:
      return { label: "Strength", className: "bg-violet-100 text-violet-700" };
  }
}

/** Renders a structured BUY-IN / ROUNDS / CASH-OUT breakdown from a WOD option object. */
function renderWodStructure(opt: any): React.ReactNode {
  const blocks: any[] = opt.wod?.blocks ?? [];
  if (blocks.length === 0) {
    return opt.structure
      ? <p className="text-xs text-muted-foreground leading-relaxed mt-1">{opt.structure}</p>
      : null;
  }
  const isMulti = blocks.length > 1 || blocks.some((b: any) => b.label);
  return (
    <div className={`${isMulti ? "space-y-2" : "space-y-0.5"} mt-1.5`}>
      {blocks.map((block: any, bi: number) => {
        const label: string = block.label ?? (block.rounds ? `${block.rounds} rounds` : "");
        return (
          <div key={bi}>
            {label && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary/50 mb-0.5">
                {label}
              </p>
            )}
            {(block.steps ?? []).map((step: any, si: number) => {
              const name: string = step.movement?.name ?? "";
              const unitRaw: string = step.target?.unit ?? "";
              const val = step.target?.targetText
                ? step.target.targetText
                : step.target?.value != null
                  ? (unitRaw === "reps" ? String(step.target.value) : `${step.target.value} ${unitRaw}`.trim())
                  : "";
              const load: string = step.load?.display ?? "";
              return (
                <p key={si} className="text-xs text-foreground/75">
                  {[val, name, load ? `(${load})` : ""].filter(Boolean).join(" ")}
                </p>
              );
            })}
          </div>
        );
      })}
      {Array.isArray(opt.estimatedMinutes) && opt.estimatedMinutes.length === 2 && (
        <p className="text-[10px] text-primary/50 font-medium pt-0.5">
          ⏱ Est. {opt.estimatedMinutes[0]}–{opt.estimatedMinutes[1]} min
        </p>
      )}
    </div>
  );
}

export type CalendarContext = "client" | "team";

interface TeamSessionRow {
  id: number;
  teamId: number;
  sessionData: Session;
  date: string;
  status: "draft" | "published";
  publishedAt: string | null;
}

interface ClientAreaProps {
  clientIdOverride?: number;
  mode?: "coach" | "client";
  calendarContext?: CalendarContext;
  teamId?: number;
  teamMemberCount?: number;
}

export default function ClientArea({ clientIdOverride, mode = "coach", calendarContext = "client", teamId, teamMemberCount = 0 }: ClientAreaProps = {}) {
  const [, params] = useRoute("/clients/:clientId");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const clientId = clientIdOverride ?? parseInt(params?.clientId || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { clearClient } = useClientContext();
  const { logout } = useAuth();

  const isTeamMode = calendarContext === "team" && !!teamId;
  const showPublishOpts = isTeamMode || mode !== "client";
  const { data: client, isLoading: clientLoading } = useGetClient(clientId, { query: { enabled: !isTeamMode && !!clientId } });
  const { data: masterProgrammes } = useListProgrammes(); // master programmes (no clientId)
  const { data: _rawClientProgrammes } = useListProgrammes({ clientId }, { query: { enabled: !isTeamMode && !!clientId } });

  // Team sessions query (only active in team mode)
  const { data: _rawTeamSessions } = useQuery<TeamSessionRow[]>({
    queryKey: ["team-sessions", teamId],
    queryFn: async () => {
      const token = localStorage.getItem("axis_auth_token");
      const r = await fetch(`/api/teams/${teamId}/sessions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error("Failed to load team sessions");
      return r.json();
    },
    enabled: isTeamMode,
    refetchInterval: 8000,
  });

  // Ref: session UUID → { dbId, status, publishedAt }  — updated each render
  const teamSessionsMetaRef = useRef<Map<string, { dbId: number; status: string; publishedAt: string | null }>>(new Map());

  // Unified clientProgrammes: real data for client mode, synthetic Programme for team mode
  const clientProgrammes = useMemo(() => {
    if (isTeamMode && _rawTeamSessions) {
      const map = new Map<string, { dbId: number; status: string; publishedAt: string | null }>();
      for (const ts of _rawTeamSessions) {
        map.set(ts.sessionData.id, { dbId: ts.id, status: ts.status, publishedAt: ts.publishedAt });
      }
      teamSessionsMetaRef.current = map;
      return [{
        id: teamId!,
        title: "Team Programme",
        clientId: null,
        sessions: _rawTeamSessions.map(ts => ts.sessionData),
        blockLength: null,
        sessionsPerWeek: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }] as any[];
    }
    return _rawClientProgrammes;
  }, [isTeamMode, _rawTeamSessions, _rawClientProgrammes, teamId]);
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["client-analytics", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/analytics`);
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json() as Promise<AnalyticsData>;
    },
    enabled: !!clientId,
  });
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
  const [resettingCredits, setResettingCredits] = useState(false);
  async function handleResetCredits() {
    if (!confirm(`Give ${client?.name ?? "this client"} a fresh set of 2 programme generations? Their existing programmes are kept.`)) return;
    setResettingCredits(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/reset-credits`, { method: "POST" });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["clients", clientId] });
      toast({ title: "Credits refreshed", description: `${client?.name ?? "Client"} can now generate up to 2 more programmes this month.` });
    } catch {
      toast({ title: "Failed to reset credits", variant: "destructive" });
    } finally {
      setResettingCredits(false);
    }
  }
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
    const t = params.get("tab");
    if (t === "dashboard") return "dashboard";
    if (t === "nutrition") return "nutrition";
    return "training";
  });
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [assignStartDate, setAssignStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isAssigning, setIsAssigning] = useState(false);
  const [allProgrammes, setAllProgrammes] = useState<{ id: number; title: string }[]>([]);
  const [assignSearch, setAssignSearch] = useState("");

  // ── Build-from-description / from-scratch mode ──
  const [aiMode, setAiMode] = useState<"session" | "programme">("programme");
  const [buildMode, setBuildMode] = useState<"describe" | "scratch">("describe");
  const [fromScratchTitle, setFromScratchTitle] = useState("");
  const [fromScratchCreating, setFromScratchCreating] = useState(false);
  const [describeText, setDescribeText] = useState("");
  const [describeListening, setDescribeListening] = useState(false);
  const [describeInterim, setDescribeInterim] = useState("");
  const describeInterimRef = useRef("");
  const describeRecRef = useRef<any>(null);
  const [describeGenerating, setDescribeGenerating] = useState(false);
  const [rationaleText, setRationaleText] = useState("");
  const [rationaleReady, setRationaleReady] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<{ title: string; sessions: any[]; blockLength?: number | null; sessionsPerWeek?: number | null } | null>(null);
  const [confirmingGenerated, setConfirmingGenerated] = useState(false);
  const [strengthStyle, setStrengthStyle] = useState<"straight" | "variety">("straight");
  const [runEnv, setRunEnv] = useState<string[]>([]);
  const [previewTweakInput, setPreviewTweakInput] = useState("");
  const [previewTweakLoading, setPreviewTweakLoading] = useState(false);
  const [previewTweakMessage, setPreviewTweakMessage] = useState("");

  // IRL booking state
  const [isIrlEnabled, setIsIrlEnabled] = useState(false);
  const [irlSlots, setIrlSlots] = useState<IrlSlot[]>([]);
  const [irlBalance, setIrlBalance] = useState(0);
  const [irlLedger, setIrlLedger] = useState<IrlLedgerEntry[]>([]);
  const [irlBookings, setIrlBookings] = useState<IrlBookingRow[]>([]);
  const [irlSubTab, setIrlSubTab] = useState<"book" | "my-bookings" | "credits">("book");
  const [bookingSlotId, setBookingSlotId] = useState<number | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [pendingBookSlot, setPendingBookSlot] = useState<{ id: number; date: string; startTime: string; credits: number } | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<number | null>(null);
  const [generationLimitError, setGenerationLimitError] = useState(false);

  // Proactive client-side limit check from loaded programmes
  const monthlyLimitHit = useMemo(() => {
    if (!clientProgrammes) return false;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    // Mirror server logic: if creditResetAt is set and is later than start of month, use it as cutoff
    const creditResetAt = (client as any)?.creditResetAt ? new Date((client as any).creditResetAt) : null;
    const cutoff = creditResetAt && creditResetAt > startOfMonth ? creditResetAt : startOfMonth;
    return clientProgrammes.filter(p => {
      const created = (p as any).createdAt ? new Date((p as any).createdAt) : null;
      return created && created >= cutoff;
    }).length >= 2;
  }, [clientProgrammes, client]);

  function isStrengthDescription(text: string) {
    const lower = text.toLowerCase();
    const hyrox = /hyrox/i.test(lower);
    const oly = /weightlifting|olympic|snatch|clean.?jerk|oly\b/i.test(lower);
    const runOnly = /^[\s\w,]+run(ning|s)?\s*(only|focused|block|programme)?$/i.test(lower.trim());
    return !hyrox && !oly && !runOnly;
  }

  function isRunDescription(text: string) {
    return /\brun(ning|s)?\b|\bhybrid\b|\bcardio\b|\bwod\b|\binterval(s)?\b|\btreadmill\b|\btrack\b|\bhills?\b|\bhalf.?marathon\b|\bmarathon\b|\b5k\b|\b10k\b|\bendurance\b/i.test(text);
  }

  function toggleRunEnv(env: string) {
    setRunEnv(prev => prev.includes(env) ? prev.filter(e => e !== env) : [...prev, env]);
  }

  async function handleGenerateProgramme(overrides?: { description?: string; startDate?: string }) {
    const description = overrides?.description ?? describeText;
    const startDate = overrides?.startDate ?? assignStartDate;
    if (!description.trim() || !startDate) return;
    setDescribeGenerating(true);
    setGeneratedPreview(null);
    setRationaleText("");
    setRationaleReady(false);
    let capturedRationale = "";
    try {
      // Step 1: get rationale quickly (shows during the long wait)
      const envSuffix = runEnv.length > 0 ? ` Running environment: ${runEnv.join(", ")}.` : "";
      const body = { description: description.trim() + envSuffix, startDate, strengthStyle: strengthStyle ?? "straight", clientId };
      const rationaleRes = await fetch("/api/generate-rationale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (rationaleRes.ok) {
        const { rationale } = await rationaleRes.json();
        capturedRationale = rationale ?? "";
        setRationaleText(capturedRationale);
        setRationaleReady(true);
      }
      // Step 2: generate week 1 preview only (user confirms before weeks 2-4 are built)
      const data = await streamProgramme({ ...body, weekOnly: true });
      if (data.t === "429") { setGenerationLimitError(true); return; }
      if (data.t === "err") throw new Error(data.error ?? "generation_failed");
      setGeneratedPreview({ ...data, rationale: capturedRationale });
    } catch (e: any) {
      toast({ title: "Couldn't generate programme", description: e?.message ?? "Try rephrasing your description.", variant: "destructive" });
    } finally {
      setDescribeGenerating(false);
    }
  }

  function decreaseCompoundReps(reps: string | undefined | null, weekIdx: number): string {
    if (!reps) return "";
    const r = String(reps).trim();
    const single = r.match(/^(\d+)$/);
    if (single) return String(Math.max(1, parseInt(single[1]) - weekIdx));
    const range = r.match(/^(\d+)[–\-](\d+)$/);
    if (range) {
      const lo = Math.max(1, parseInt(range[1]) - weekIdx);
      const hi = Math.max(lo + 1, parseInt(range[2]) - weekIdx);
      return `${lo}-${hi}`;
    }
    return r;
  }

  function expandWeeks(week1Sessions: any[], totalWeeks: number = 4): any[] {
    if (week1Sessions.length === 0) return [];
    const dates = week1Sessions.map((s: any) => s.date).filter(Boolean).sort() as string[];
    if (dates.length === 0) return week1Sessions;
    const anchor = parseISO(dates[0]);
    const result: any[] = week1Sessions.map((s: any) => ({ ...s }));
    for (let week = 2; week <= totalWeeks; week++) {
      const weekDayOffset = (week - 1) * 7;
      const isDeload = week === totalWeeks;
      for (const session of week1Sessions) {
        const sessionDate = parseISO(session.date);
        const dayOffset = differenceInDays(sessionDate, anchor);
        const newDate = format(addDays(anchor, weekDayOffset + dayOffset), "yyyy-MM-dd");
        const weekIdx = week - 1;
        const updatedExercises = (session.exercises ?? []).map((ex: any) => {
          const newId = `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          if (isDeload) return { ...ex, id: newId, sets: Math.max(1, Math.round((ex.sets ?? 3) / 2)) };
          if (isPrimaryCompound(ex.name ?? "")) {
            return { ...ex, id: newId, sets: Math.min(5, (ex.sets ?? 3) + weekIdx), reps: decreaseCompoundReps(ex.reps, weekIdx) };
          }
          return { ...ex, id: newId, sets: weekIdx >= 1 ? Math.min(4, (ex.sets ?? 3) + 1) : (ex.sets ?? 3) };
        });
        result.push({
          ...session,
          id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          date: newDate,
          exercises: updatedExercises,
        });
      }
    }
    return result;
  }

  async function handleTweakPreview() {
    if (!generatedPreview || !previewTweakInput.trim()) return;
    setPreviewTweakLoading(true);
    setPreviewTweakMessage("");
    try {
      const res = await fetch("/api/tweak-programme-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: generatedPreview.sessions, instruction: previewTweakInput.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setGeneratedPreview(prev => prev ? { ...prev, sessions: data.sessions } : null);
      setPreviewTweakMessage(data.message ?? "Preview updated.");
      setPreviewTweakInput("");
    } catch {
      setPreviewTweakMessage("Couldn't apply that change. Try rephrasing.");
    } finally {
      setPreviewTweakLoading(false);
    }
  }

  async function handleConfirmGenerated() {
    if (!generatedPreview) return;
    setConfirmingGenerated(true);
    try {
      // Expand week 1 to a full 4-week programme with progression rules applied
      const allSessions = expandWeeks(generatedPreview.sessions, 4);
      const saveRes = await fetch("/api/programmes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: generatedPreview.title,
          sessions: allSessions,
          clientId,
          blockLength: 4,
          ...(generatedPreview.sessionsPerWeek != null ? { sessionsPerWeek: generatedPreview.sessionsPerWeek } : {}),
        }),
      });
      if (saveRes.status === 429) {
        setGeneratedPreview(null);
        setGenerationLimitError(true);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      setAssignDialogOpen(false);
      setGeneratedPreview(null);
      setDescribeText("");
      setStrengthStyle(null);
      setPreviewTweakInput("");
      setPreviewTweakMessage("");
      toast({ title: "Programme built!", description: `"${generatedPreview.title}", 4 weeks added to the calendar.` });
    } catch {
      toast({ title: "Failed to save programme", variant: "destructive" });
    } finally {
      setConfirmingGenerated(false);
    }
  }

  async function handleCreateFromScratch() {
    if (!fromScratchTitle.trim() || !assignStartDate) return;
    setFromScratchCreating(true);
    try {
      const res = await fetch("/api/programmes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: fromScratchTitle.trim(), sessions: [], clientId }),
      });
      if (!res.ok) throw new Error("Failed");
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      setAssignDialogOpen(false);
      setFromScratchTitle("");
      toast({ title: "Programme created!", description: `"${fromScratchTitle.trim()}" is ready. Add sessions from the calendar.` });
    } catch {
      toast({ title: "Failed to create programme", variant: "destructive" });
    } finally {
      setFromScratchCreating(false);
    }
  }

  // ── Training calendar state ──
  const [trainingWeekOffset, setTrainingWeekOffset] = useState(0);

  // ── Quick-add single session ──
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState("");
  const [quickAddType, setQuickAddType] = useState<"strength" | "wod" | "run">("strength");
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddDesc, setQuickAddDesc] = useState("");
  const [quickAddParsing, setQuickAddParsing] = useState(false);
  const [quickAddError, setQuickAddError] = useState("");
  const [quickAddListening, setQuickAddListening] = useState(false);
  const [quickAddInterim, setQuickAddInterim] = useState("");
  // ── AI session generation from Build Through AI dialog ──
  const [aiSessionGenerating, setAiSessionGenerating] = useState(false);
  const [parsedAiSession, setParsedAiSession] = useState<any | null>(null);
  const [savingAiSession, setSavingAiSession] = useState<"private" | "public" | "calendar" | null>(null);
  const [parsedQuickSession, setParsedQuickSession] = useState<any | null>(null);
  const [quickAddWodOptions, setQuickAddWodOptions] = useState<any[] | null>(null);
  const [savingQuickSession, setSavingQuickSession] = useState<"private" | "public" | "calendar" | null>(null);
  const quickAddInterimRef = useRef("");
  const quickAddRecRef = useRef<any>(null);

  // ── Unified editable session state (types + converters imported from shared component) ────
  const [editableSession, setEditableSession] = useState<EditableSession | null>(null);
  const editableWod = editableSession;
  function editableWodToSession(ew: EditableSession): any { return editableSessionToSession(ew); }
  function parseOptToEditable(opt: any): EditableSession { return parseWodToEditable(opt); }

  function toggleQuickAddListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (quickAddListening) {
      quickAddRecRef.current?.stop();
      setQuickAddListening(false);
      setQuickAddInterim("");
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-GB";
    r.onstart = () => setQuickAddListening(true);
    r.onend = () => { setQuickAddListening(false); setQuickAddInterim(""); quickAddInterimRef.current = ""; };
    r.onresult = (e: any) => {
      let final = ""; let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) {
        setQuickAddDesc(prev => {
          const sep = prev.trim() ? "\n" : "";
          return prev.trim() + sep + final.trim();
        });
        setQuickAddInterim("");
        quickAddInterimRef.current = "";
      } else {
        quickAddInterimRef.current = interim;
        setQuickAddInterim(interim);
      }
    };
    r.start();
    quickAddRecRef.current = r;
  }

  async function handleQuickAdd() {
    if (!quickAddDesc.trim()) return;
    setQuickAddParsing(true);
    setQuickAddError("");
    setParsedQuickSession(null);
    setEditableSession(null);
    setQuickAddWodOptions(null);
    try {
      const endpoint = quickAddType === "wod" ? "/api/parse-wod-session" : quickAddType === "run" ? "/api/parse-run-session" : "/api/parse-session";
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), 60000);
      let data: any;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: quickAddDesc.trim(), name: quickAddName.trim() || undefined }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error();
        data = await res.json();
      } finally {
        clearTimeout(abortTimer);
      }
      // WOD endpoint returns { options: [...] } — show choice cards
      if (data.options && Array.isArray(data.options) && data.options.length > 1) {
        setQuickAddWodOptions(data.options);
      } else {
        const single = data.options?.[0] ?? data;
        setParsedQuickSession(single);
        if (quickAddType === "wod") {
          setEditableSession(parseWodToEditable(single));
        } else if (quickAddType === "run") {
          setEditableSession(parseRunToEditable(single));
        } else {
          setEditableSession(parseStrengthToEditable(single));
        }
      }
    } catch {
      setQuickAddError(quickAddType === "wod" ? "Couldn't design your WOD. Please try again." : "Couldn't parse your session. Please try again.");
    } finally {
      setQuickAddParsing(false);
    }
  }

  async function confirmQuickAdd(dest: "calendar" | "private" | "public") {
    if (!parsedQuickSession || !quickAddDate) return;
    setSavingQuickSession(dest);
    try {
      // ── Build session from editable session (always preferred) ──
      const baseSession = editableSession
        ? editableSessionToSession(editableSession)
        : parsedQuickSession;
      const newSession = { ...baseSession, id: `session-${Date.now()}`, date: quickAddDate };

      if (dest === "private" || dest === "public") {
        await fetch("/api/session-library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newSession.name || quickAddName || "Saved Session",
            type: quickAddType,
            sessionData: newSession,
            clientId: dest === "private" ? clientId : null,
          }),
        });
      }

      await addSessionToClientCalendar(quickAddDate, newSession, () => {}, newSession.id, () => {
        setQuickAddOpen(false);
        setParsedQuickSession(null);
        setEditableSession(null);
        setQuickAddName("");
        setQuickAddDesc("");
        setQuickAddType("strength");
        navigateToWeekOf(quickAddDate);
        if (dest === "private") toast({ title: "Saved to your sessions", description: "Find it in Build From Library." });
        if (dest === "public") toast({ title: "Added to public library", description: "Visible to all coaches and clients." });
      }, newSession.name);
    } catch {
      setQuickAddError("Something went wrong. Please try again.");
    } finally {
      setSavingQuickSession(null);
    }
  }

  /** Build Through AI — single session mode: parses and shows preview with save options */
  async function handleAiSession(overrides?: { desc?: string; type?: "strength" | "wod" | "run" }) {
    const desc = overrides?.desc ?? quickAddDesc;
    const type = overrides?.type ?? quickAddType;
    if (!desc.trim() || !assignStartDate) return;
    setAiSessionGenerating(true);
    setQuickAddError("");
    setParsedAiSession(null);
    setQuickAddWodOptions(null);
    try {
      const endpoint = type === "wod" ? "/api/parse-wod-session" : type === "run" ? "/api/parse-run-session" : "/api/parse-session";
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), 60000);
      let data: any;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: desc.trim(), name: quickAddName.trim() || undefined }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error();
        data = await res.json();
      } finally {
        clearTimeout(abortTimer);
      }
      // WOD endpoint returns { options: [...] } — show choice cards
      if (data.options && Array.isArray(data.options) && data.options.length > 1) {
        setQuickAddWodOptions(data.options);
      } else {
        setParsedAiSession(data.options?.[0] ?? data);
      }
    } catch {
      setQuickAddError(quickAddType === "wod" ? "Couldn't design your WOD. Please try again." : "Couldn't parse your session. Please try again.");
    } finally {
      setAiSessionGenerating(false);
    }
  }

  /** Confirm generated session: add to calendar + optionally save to library */
  async function confirmAiSession(dest: "calendar" | "private" | "public") {
    if (!parsedAiSession || !assignStartDate) return;
    setSavingAiSession(dest);
    try {
      const newSession = { ...parsedAiSession, id: `session-${Date.now()}`, date: assignStartDate };

      // Save to library if requested
      if (dest === "private" || dest === "public") {
        await fetch("/api/session-library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: parsedAiSession.name || quickAddName || "Saved Session",
            type: quickAddType,
            sessionData: parsedAiSession,
            clientId: dest === "private" ? clientId : null,
          }),
        });
      }

      // Always add to calendar
      await addSessionToClientCalendar(assignStartDate, newSession, () => {}, newSession.id, () => {
        setAssignDialogOpen(false);
        setParsedAiSession(null);
        setQuickAddName("");
        setQuickAddDesc("");
        setQuickAddType("strength");
        navigateToWeekOf(assignStartDate);
        if (dest === "private") toast({ title: "Saved to your sessions", description: "Find it in Build From Library." });
        if (dest === "public") toast({ title: "Added to public library", description: "Visible to all coaches and clients." });
      }, parsedAiSession.name);
    } catch {
      setQuickAddError("Something went wrong. Please try again.");
    } finally {
      setSavingAiSession(null);
    }
  }

  // ── Drag-and-drop ──
  const draggedItemRef = useRef<{ sessionId: string; programmeId: number; isGroupDrag?: boolean; originalDate?: string } | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  // Touch DnD
  const touchDragRef = useRef<{ sessionId: string; programmeId: number; isGroupDrag?: boolean; originalDate?: string } | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const [touchDragOverDate, setTouchDragOverDate] = useState<string | null>(null);
  const [touchDraggingActive, setTouchDraggingActive] = useState(false);
  const [touchGhostPos, setTouchGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [touchGhostLabel, setTouchGhostLabel] = useState("");
  const isDragActiveRef = useRef(false);
  const cellPointerMovedRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── AI reschedule command bar ──
  const [cmdInput, setCmdInput] = useState("");
  const [cmdListening, setCmdListening] = useState(false);
  const [cmdInterim, setCmdInterim] = useState("");
  const cmdInterimRef = useRef("");
  const cmdRecRef = useRef<any>(null);
  const [cmdSaving, setCmdSaving] = useState(false);
  const [cmdParsing, setCmdParsing] = useState(false);
  const [coachInlineResponse, setCoachInlineResponse] = useState<string | null>(null);

  // ── Phil Chat Panel ──────────────────────────────────────────────────────
  interface PhilMessage {
    id: string;
    sender: "user" | "phil";
    text: string;
    ts: Date;
    coachParseData?: CoachParseResult;
    action?: {
      type: "save_session";
      session: any;
      sessionType: string;
      date: string;
    } | {
      type: "pick_wod";
      options: any[];
      date: string;
    };
  }
  const [philOpen, setPhilOpen] = useState(false);
  const [philExpanded, setPhilExpanded] = useState(false);
  const [philUnread, setPhilUnread] = useState(false);
  const [philMessages, setPhilMessages] = useState<PhilMessage[]>([]);
  const [philPanelInput, setPhilPanelInput] = useState("");
  const philScrollRef = useRef<HTMLDivElement>(null);
  const philInputRef = useRef<HTMLInputElement>(null);
  const [hasSeenWelcome, setHasSeenWelcome] = useState<boolean | null>(null);

  // ── Injury flow state ─────────────────────────────────────────────────────
  interface InjuryFlowState { phase: "severity" | "choice"; context: Record<string, any>; }
  const [injuryFlow, setInjuryFlow] = useState<InjuryFlowState | null>(null);

  const addPhilMsg = (text: string, extra?: Partial<PhilMessage>) => {
    setPhilMessages(prev => [...prev, { id: crypto.randomUUID(), sender: "phil", text, ts: new Date(), ...extra }]);
    setPhilUnread(prev => prev || !philExpanded);
  };

  const addUserMsg = (text: string) =>
    setPhilMessages(prev => [...prev, { id: crypto.randomUUID(), sender: "user", text, ts: new Date() }]);

  const getRecentHistory = () =>
    philMessages.slice(-6).map(m => ({
      role: (m.sender === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.text,
    }));

  useEffect(() => {
    if (philScrollRef.current) {
      philScrollRef.current.scrollTop = philScrollRef.current.scrollHeight;
    }
  }, [philMessages]);

  // Phil first-load nudge — fires once when dashboard opens with no sessions and no programme
  const philNudgeSentRef = useRef(false);
  useEffect(() => {
    if (philNudgeSentRef.current) return;
    if (analyticsLoading || !analytics) return;
    if (analytics.sessions.length > 0) return;
    if ((clientProgrammes ?? []).flatMap((p: any) => p.sessions ?? []).length > 0) return;
    philNudgeSentRef.current = true;
    addPhilMsg("No programme yet. Head to Training and let's build one.");
  }, [analyticsLoading, analytics, clientProgrammes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch welcome status once (client mode only)
  useEffect(() => {
    if (!clientId || mode !== "client") { setHasSeenWelcome(true); return; }
    const token = localStorage.getItem("axis_auth_token");
    fetch(`/api/clients/${clientId}/welcome-status`, {
      headers: { Authorization: token ? `Bearer ${token}` : "" },
    })
      .then(r => r.ok ? r.json() : { hasSeenWelcome: true })
      .then(d => setHasSeenWelcome(d.hasSeenWelcome ?? true))
      .catch(() => setHasSeenWelcome(true));
  }, [clientId, mode]);

  // Welcome tour: fires once when hasSeenWelcome === false + analytics loaded + zero sessions
  useEffect(() => {
    if (hasSeenWelcome !== false) return;
    if (analyticsLoading || !analytics) return;
    if (mode !== "client") return;

    // Mark seen immediately so it never fires again
    setHasSeenWelcome(true);
    const token = localStorage.getItem("axis_auth_token");
    fetch(`/api/clients/${clientId}/mark-welcome-seen`, {
      method: "PATCH",
      headers: { Authorization: token ? `Bearer ${token}` : "" },
    }).catch(() => {});

    // Navigate to dashboard and expand Phil
    setActiveTab("dashboard");
    setPhilOpen(true);
    setPhilExpanded(true);
    setPhilUnread(false);

    // Send 3 messages sequentially
    const t1 = setTimeout(() => {
      addPhilMsg("Right, welcome. I'm Phil, your coach. I live here across the whole app so you can ask me anything at any time.");
    }, 500);
    const t2 = setTimeout(() => {
      addPhilMsg("Quick lay of the land. Training tab is where your programme lives and where we'll build everything. Nutrition tab tracks what you're eating. This dashboard shows your progress over time as you train.");
    }, 1500);
    const t3 = setTimeout(() => {
      addPhilMsg("That's enough admin. What are you training for? Tell me your goal and I'll build your first month.");
      setTimeout(() => { philInputRef.current?.focus(); }, 300);
    }, 2500);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [hasSeenWelcome, analyticsLoading, analytics, clientId, mode]);

  // ── Coach parse result (parse-first plan/session flow) ───────────────────
  interface CoachParseResult {
    requestType: "programme" | "session";
    acknowledgement: string;
    hasEnough: boolean;
    followUpQuestion?: string;
    assumptions?: string[];
    planSummary?: string[];
    intentNote?: string;
    suggestedBrief?: string;
    parsedConstraints: Record<string, unknown> & { progressionStyle?: "straight" | "variety" | null };
  }
  const [coachParseResult, setCoachParseResult] = useState<CoachParseResult | null>(null);
  const [coachFollowUpInput, setCoachFollowUpInput] = useState("");
  const [originalCoachInput, setOriginalCoachInput] = useState("");
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
  const [pendingCommand, setPendingCommand] = useState<{
    description: string;
    changes: { programmeId: number; sessions: Session[] }[];
  } | null>(null);
  const [calendarView, setCalendarView] = useState<"month" | "week">(
    () => (sessionStorage.getItem("axis_calendar_view") as "month" | "week") || "month"
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [pasteMode, setPasteMode] = useState(false);
  const [sessionClipboard, setSessionClipboard] = useState<{ sessions: Session[]; baseDate: string } | null>(null);

  // ── Undo / redo history ──────────────────────────────────────────────────
  // Each entry is a snapshot of all client programmes' sessions at that moment.
  type ProgSnapshot = { id: number; sessions: Session[] }[];
  const [calHistory, setCalHistory] = useState<ProgSnapshot[]>([]);
  const [calFuture, setCalFuture] = useState<ProgSnapshot[]>([]);

  // Team-mode state
  const [teamPublishConfirm, setTeamPublishConfirm] = useState<{ sessionId: string; dbId: number } | null>(null);
  const [teamPublishing, setTeamPublishing] = useState(false);
  const [teamCopiesPanel, setTeamCopiesPanel] = useState<{ dbId: number; sessionName: string } | null>(null);
  const [teamCopies, setTeamCopies] = useState<any[]>([]);
  const [teamCopiesLoading, setTeamCopiesLoading] = useState(false);

  /** Team mode: sync sessions to team API (create/update drafts, delete removed drafts) */
  const syncTeamSessions = async (newSessions: Session[]) => {
    if (!teamId) return;
    const token = localStorage.getItem("axis_auth_token");
    const headers = { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "application/json" };
    const meta = teamSessionsMetaRef.current;
    const newIds = new Set(newSessions.map(s => s.id));

    for (const session of newSessions) {
      const existing = meta.get(session.id);
      if (existing) {
        if (existing.status === "published") continue; // never overwrite published
        await fetch(`/api/teams/${teamId}/sessions/${existing.dbId}`, {
          method: "PUT", headers, body: JSON.stringify({ sessionData: session, date: session.date }),
        });
      } else {
        await fetch(`/api/teams/${teamId}/sessions`, {
          method: "POST", headers, body: JSON.stringify({ sessionData: session, date: session.date }),
        });
      }
    }

    for (const [uuid, { dbId, status }] of meta.entries()) {
      if (!newIds.has(uuid) && status === "draft") {
        await fetch(`/api/teams/${teamId}/sessions/${dbId}`, { method: "DELETE", headers });
      }
    }
  };

  /** Call before any calendar mutation to save a restore point. */
  const pushHistory = () => {
    if (!clientProgrammes) return;
    const snapshot: ProgSnapshot = clientProgrammes.map(p => ({ id: p.id, sessions: (p.sessions as Session[]).slice() }));
    setCalHistory(prev => [...prev.slice(-19), snapshot]); // keep last 20
    setCalFuture([]); // new action clears redo stack
  };

  const applySnapshot = async (snapshot: ProgSnapshot) => {
    if (isTeamMode && teamId) {
      const newSessions = snapshot[0]?.sessions ?? [];
      await syncTeamSessions(newSessions);
      await queryClient.invalidateQueries({ queryKey: ["team-sessions", teamId] });
      return;
    }
    await Promise.all(
      snapshot.map(({ id, sessions }) =>
        fetch(`/api/programmes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessions }) })
      )
    );
    await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
  };

  const undo = async () => {
    if (calHistory.length === 0 || !clientProgrammes) return;
    const previous = calHistory[calHistory.length - 1];
    const current: ProgSnapshot = clientProgrammes.map(p => ({ id: p.id, sessions: (p.sessions as Session[]).slice() }));
    setCalHistory(prev => prev.slice(0, -1));
    setCalFuture(prev => [...prev, current]);
    await applySnapshot(previous);
    toast({ title: "Undone" });
  };

  const redo = async () => {
    if (calFuture.length === 0) return;
    const next = calFuture[calFuture.length - 1];
    const current: ProgSnapshot = (clientProgrammes ?? []).map(p => ({ id: p.id, sessions: (p.sessions as Session[]).slice() }));
    setCalFuture(prev => prev.slice(0, -1));
    setCalHistory(prev => [...prev, current]);
    await applySnapshot(next);
    toast({ title: "Redone" });
  };

  // Clear history when switching clients
  useEffect(() => { setCalHistory([]); setCalFuture([]); }, [clientId]);
  useEffect(() => { sessionStorage.setItem("axis_calendar_view", calendarView); }, [calendarView]);

  // IRL data: only fetch in client mode
  const getIrlHeaders = () => {
    const t = localStorage.getItem("axis_auth_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  };
  const fetchIrlData = async () => {
    const slotRes = await fetch("/api/irl-slots", { headers: getIrlHeaders() });
    if (slotRes.status === 403 || slotRes.status === 401) { setIsIrlEnabled(false); return; }
    if (slotRes.ok) {
      setIsIrlEnabled(true);
      setIrlSlots(await slotRes.json());
    }
    const creditRes = await fetch("/api/irl-credits", { headers: getIrlHeaders() });
    if (creditRes.ok) {
      const creditData = await creditRes.json();
      setIrlBalance(creditData.balance);
      setIrlLedger(creditData.ledger);
    }
    const bookingsRes = await fetch("/api/irl-bookings", { headers: getIrlHeaders() });
    if (bookingsRes.ok) setIrlBookings(await bookingsRes.json());
  };
  useEffect(() => { if (mode === "client") { void fetchIrlData(); } }, [mode, clientId]);

  // Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); void undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); void redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [calHistory, calFuture, clientProgrammes]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelectSession = (id: string) => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedSessionIds(new Set());
    setPasteMode(false);
    setSessionClipboard(null);
  };

  const deleteSelectedSessions = async () => {
    if (selectedSessionIds.size === 0) return;
    pushHistory();
    // Build snapshot with selected sessions removed
    const newSnapshot: { id: number; sessions: Session[] }[] = (clientProgrammes ?? []).map(prog => ({
      id: prog.id,
      sessions: (prog.sessions as Session[]).filter(s => !selectedSessionIds.has(s.id)),
    }));
    await applySnapshot(newSnapshot);
    const n = selectedSessionIds.size;
    toast({ title: `${n} session${n > 1 ? "s" : ""} deleted` });
    exitSelectionMode();
  };

  /**
   * Single source of truth for result vs prescription fields.
   *
   * PRESCRIPTION (kept):  exercise name, order, sets, reps, rpe (target), perSetReps,
   *   perSetRpe (target), rest, tempo, notes, rawText, weekProgression, source,
   *   session type, workout structure (wod.blocks / segments), target distance/time/
   *   calories, coaching notes, color.
   *
   * RESULT (cleared):     setWeights, setReps, clientComment (exercise-level),
   *   session clientComment, wodResult (score / rounds / time / completion),
   *   runLog (actual pace, distance, equivalent road pace per interval),
   *   runSurface, trailDifficulty.
   *
   * Applies identically to strength, run, WOD/Hyrox, and mixed sessions.
   */
  function clearExerciseResults(ex: any): any {
    return {
      ...ex,
      id: crypto.randomUUID(),
      // ── Result fields ────────────────────────────────────────────────────────
      clientComment: null,   // athlete's post-set note to coach
      setWeights: null,      // weight logged per set
      setReps: null,         // reps achieved per set
      // NOTE: ex.rpe / ex.perSetRpe are PRESCRIPTION (coach-prescribed target)
      // — they are intentionally kept. There is no separate logged-RPE field.
    };
  }

  /** Strips all logged/result data from a session so the copy is a clean prescription. */
  function clearSessionResults(session: any, newId: string, newDate: string): any {
    return {
      ...session,
      id: newId,
      date: newDate,
      exercises: (session.exercises ?? []).map(clearExerciseResults),
      // ── Session-level result fields ──────────────────────────────────────────
      clientComment: null,    // athlete's post-session note
      wodResult: null,        // WOD: score, rounds, time, completion status
      runLog: null,           // run intervals: actual pace, distance, equiv road pace
      runSurface: null,       // road / trail (logged environment, not prescription)
      trailDifficulty: null,  // moderate / hilly / technical
    };
  }

  /** Alias used by paste-to-date — delegates to the shared clearing function. */
  function cleanSessionForCopy(session: any, newId: string, newDate: string): any {
    return clearSessionResults(session, newId, newDate);
  }

  const copySelectedSessions = () => {
    const allSessions: Session[] = (clientProgrammes ?? []).flatMap(p => p.sessions as Session[]);
    const selected = allSessions.filter(s => selectedSessionIds.has(s.id));
    if (selected.length === 0) return;
    const dates = selected.map(s => s.date).filter(Boolean) as string[];
    const baseDate = dates.sort()[0];
    setSessionClipboard({ sessions: selected, baseDate });
    setPasteMode(true);
  };

  const copyOneSession = (session: Session) => {
    const baseDate = session.date || format(new Date(), "yyyy-MM-dd");
    setSessionClipboard({ sessions: [session], baseDate });
    setSelectionMode(true);
    setPasteMode(true);
    toast({ title: "Session copied — tap a day to paste" });
  };

  const deleteOneSession = async (session: Session) => {
    pushHistory();
    const newSnapshot = (clientProgrammes ?? []).map(prog => ({
      id: prog.id,
      sessions: (prog.sessions as Session[]).filter(s => s.id !== session.id),
    }));
    await applySnapshot(newSnapshot);
    toast({ title: "Session deleted" });
  };

  const pasteToDate = async (targetDateStr: string) => {
    if (!sessionClipboard || !clientId) return;
    pushHistory();
    const { sessions, baseDate } = sessionClipboard;
    const baseDateObj = parseISO(baseDate);
    const targetDateObj = parseISO(targetDateStr);
    const now = Date.now();
    const newSessions = sessions.map((s, i) => {
      const offset = s.date ? differenceInDays(parseISO(s.date), baseDateObj) : 0;
      const newDate = format(addDays(targetDateObj, offset), "yyyy-MM-dd");
      return cleanSessionForCopy(s, `session-${now}-${i}`, newDate);
    });
    try {
      const targetProg = (clientProgrammes ?? [])[0];
      if (targetProg) {
        const updatedSessions = [...(targetProg.sessions as Session[]), ...newSessions];
        await applySnapshot([{ id: targetProg.id, sessions: updatedSessions }]);
      } else if (!isTeamMode) {
        await fetch("/api/programmes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Sessions", clientId, sessions: newSessions }) });
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      }
      const n = newSessions.length;
      toast({ title: `${n} session${n > 1 ? "s" : ""} pasted from ${format(targetDateObj, "EEE d MMM")}` });
      exitSelectionMode();
    } catch {
      toast({ title: "Failed to paste sessions", variant: "destructive" });
    }
  };

  const shiftSelectedSessions = async (deltaWeeks: number) => {
    if (selectedSessionIds.size === 0) return;
    pushHistory();
    const newSnapshot = (clientProgrammes ?? []).map(prog => {
      const sessions = prog.sessions as Session[];
      return {
        id: prog.id,
        sessions: sessions.map(s =>
          selectedSessionIds.has(s.id) && s.date
            ? { ...s, date: format(addDays(parseISO(s.date), deltaWeeks * 7), "yyyy-MM-dd") }
            : s
        ),
      };
    });
    await applySnapshot(newSnapshot);
    const n = selectedSessionIds.size;
    toast({ title: `${n} session${n > 1 ? "s" : ""} shifted ${deltaWeeks > 0 ? "forward" : "back"} 1 week` });
    exitSelectionMode();
  };

  const trainingWeeks = useMemo(() => {
    const weekStart = startOfWeek(addWeeks(new Date(), trainingWeekOffset), { weekStartsOn: 1 });
    if (calendarView === "week") {
      return [Array.from({ length: 7 }, (_, di) => addDays(weekStart, di))];
    }
    return Array.from({ length: 4 }, (_, wi) => {
      const ws = addWeeks(weekStart, wi);
      return Array.from({ length: 7 }, (_, di) => addDays(ws, di));
    });
  }, [trainingWeekOffset, calendarView]);

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
    pushHistory();
    const updatedSessions = (prog.sessions as Session[]).map(s =>
      s.id === sessionId ? { ...s, date: newDate } : s
    );
    await applySnapshot([{ id: programmeId, sessions: updatedSessions }]);
    toast({ title: "Session moved" });
  };

  const moveGroupSessions = async (originalDate: string, targetDate: string) => {
    const delta = differenceInDays(parseISO(targetDate), parseISO(originalDate));
    if (delta === 0) return;
    pushHistory();
    try {
      const newSnapshot = (clientProgrammes ?? []).map(prog => {
        const sessions = prog.sessions as Session[];
        if (!sessions.some(s => selectedSessionIds.has(s.id))) return { id: prog.id, sessions };
        return {
          id: prog.id,
          sessions: sessions.map(s =>
            selectedSessionIds.has(s.id)
              ? { ...s, date: format(addDays(parseISO(s.date), delta), "yyyy-MM-dd") }
              : s
          ),
        };
      });
      await applySnapshot(newSnapshot);
      toast({ title: `${selectedSessionIds.size} sessions moved` });
    } catch {
      toast({ title: "Failed to move sessions", variant: "destructive" });
    }
  };

  const deleteSession = async (sessionId: string, programmeId: number | undefined) => {
    if (!programmeId) return;
    const prog = (clientProgrammes ?? []).find(p => p.id === programmeId);
    if (!prog) return;
    const updatedSessions = (prog.sessions as Session[]).filter(s => s.id !== sessionId);
    await applySnapshot([{ id: programmeId, sessions: updatedSessions }]);
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

  // ── Compound vs accessory classification ─────────────────────────────────────
  // Primary compounds progress differently: sets cap at 5, reps decrease as
  // sets increase. Everything else caps sets at 4 and keeps the rep range fixed.
  const PRIMARY_COMPOUNDS = [
    "squat", "back squat", "front squat", "low bar squat", "high bar squat",
    "bench press", "close grip bench", "incline bench", "decline bench",
    "deadlift", "conventional deadlift", "sumo deadlift", "romanian deadlift",
    "strict press", "overhead press", "ohp", "press",
  ];
  function isPrimaryCompound(name: string): boolean {
    const lower = (name || "").toLowerCase();
    return PRIMARY_COMPOUNDS.some(c => lower.includes(c));
  }

  function copyWithProgression(
    sourceWeekOffset: number,
    targetWeeks: number,
    setsIncrement: number,
    repsMultiplier: number
  ): { programmeId: number; sessions: Session[] }[] {
    if (!clientProgrammes) return [];
    const sourceStart = startOfWeek(addWeeks(new Date(), sourceWeekOffset), { weekStartsOn: 1 });
    const sourceEnd = addDays(sourceStart, 6);
    const result: { programmeId: number; sessions: Session[] }[] = [];
    for (const prog of clientProgrammes) {
      const allSessions = (prog.sessions ?? []) as Session[];
      const sourceSessions = allSessions.filter(s => {
        try { const d = parseISO(s.date); return d >= sourceStart && d <= sourceEnd; }
        catch { return false; }
      });
      if (!sourceSessions.length) continue;
      const newSessions = [...allSessions];
      for (let week = 1; week <= targetWeeks; week++) {
        const weekStart = addWeeks(sourceStart, week);
        for (const session of sourceSessions) {
          const dayOfWeek = parseISO(session.date).getDay();
          const dayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          const newDate = format(addDays(weekStart, dayOffset), "yyyy-MM-dd");
          // Step 1: apply week-over-week progression to prescription fields only.
          // Compounds (squat, bench, deadlift, press): sets ↑ (hard cap 5), reps ↓ to match.
          // Accessories / everything else: sets ↑ (hard cap 4), rep range stays FIXED.
          const progressedExercises = ((session as any).exercises ?? []).map((ex: any) => {
            const isCompound = isPrimaryCompound(ex.name || "");
            const maxSets = isCompound ? 5 : 4;

            const newSets = setsIncrement !== 0
              ? Math.min(Math.max(1, (ex.sets || 3) + setsIncrement * week), maxSets)
              : ex.sets;

            // Compounds: exact rep number decreases in step with set increase.
            // Accessories: rep range is frozen — never modified.
            let newReps = ex.reps;
            if (isCompound && setsIncrement !== 0) {
              const baseReps = parseInt(String(ex.reps || 8), 10);
              newReps = isNaN(baseReps)
                ? ex.reps
                : String(Math.max(2, baseReps - setsIncrement * week));
            }

            return { ...ex, sets: newSets, reps: newReps };
          });
          // Step 2: clear ALL result fields using the shared helper — consistent
          // across strength, run, WOD/Hyrox, and mixed sessions.
          const progressedSession = { ...(session as any), exercises: progressedExercises };
          newSessions.push(clearSessionResults(progressedSession, crypto.randomUUID(), newDate) as Session);
        }
      }
      result.push({ programmeId: prog.id, sessions: newSessions });
    }
    return result;
  }

  function dayRemapAll(fromDays: number[], toDays: number[]): { programmeId: number; sessions: Session[] }[] {
    if (!clientProgrammes) return [];
    const result: { programmeId: number; sessions: Session[] }[] = [];
    for (const prog of clientProgrammes) {
      let changed = false;
      const newSessions = ((prog.sessions ?? []) as Session[]).map(session => {
        const day = parseISO(session.date).getDay();
        const fromIdx = fromDays.indexOf(day);
        if (fromIdx === -1) return session;
        changed = true;
        const toDay = toDays[fromIdx];
        const weekStart = startOfWeek(parseISO(session.date), { weekStartsOn: 1 });
        const dayOffset = toDay === 0 ? 6 : toDay - 1;
        return { ...session, date: format(addDays(weekStart, dayOffset), "yyyy-MM-dd") };
      });
      if (changed) result.push({ programmeId: prog.id, sessions: newSessions });
    }
    return result;
  }

  const applyCommand = async () => {
    if (!pendingCommand) return;
    setCmdSaving(true);
    try {
      await applySnapshot(pendingCommand.changes.map(c => ({ id: c.programmeId, sessions: c.sessions })));
      addPhilMsg(`Done. ${pendingCommand.description}.`);
      setPendingCommand(null);
      setCmdInput("");
    } catch {
      toast({ title: "Failed to apply command", variant: "destructive" });
    } finally {
      setCmdSaving(false);
    }
  };

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
      const count = pendingBulkDelete.sessionCount;
      addPhilMsg(`${count} session${count !== 1 ? "s" : ""} removed from the calendar.`);
      setPendingBulkDelete(null);
      setCmdInput("");
    } catch {
      toast({ title: "Failed to delete sessions", variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleRescheduleCmd = async () => {
    const cmd = cmdInput.trim();
    if (!cmd || !clientProgrammes?.length) return;

    setCmdParsing(true);
    try {
      const res = await fetch("/api/parse-calendar-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: cmd,
          programmeNames: clientProgrammes.map(p => p.title),
          currentDate: format(new Date(), "yyyy-MM-dd"),
        }),
      });
      const intent = await res.json();

      switch (intent.action) {
        case "delete": {
          if (intent.scope === "all") {
            const totalSessions = clientProgrammes.reduce((acc, p) => acc + (p.sessions?.length ?? 0), 0);
            setPendingBulkDelete({ scope: "all", sessionCount: totalSessions });
            addPhilMsg(`I'll clear all ${totalSessions} session${totalSessions !== 1 ? "s" : ""} from the calendar. Confirm in the bar below.`);
          } else {
            const q = (intent.programmeQuery ?? "").toLowerCase();
            const prog =
              clientProgrammes.find(p => p.title.toLowerCase().includes(q)) ??
              clientProgrammes.find(p => q.split(" ").some((w: string) => w.length > 2 && p.title.toLowerCase().includes(w)));
            if (prog) {
              setPendingBulkDelete({ scope: "programme", programmeId: prog.id, programmeName: prog.title, sessionCount: prog.sessions?.length ?? 0 });
              addPhilMsg(`I'll delete all ${prog.sessions?.length ?? 0} sessions from "${prog.title}". Confirm in the bar below.`);
            } else {
              addPhilMsg(`I couldn't find a programme matching "${intent.programmeQuery}". Try using the exact programme name.`);
            }
          }
          break;
        }

        case "reschedule": {
          const targetDays: number[] = (intent.targetDays ?? [])
            .map((d: string) => DAY_WORDS[d.toLowerCase()] ?? DAY_WORDS[d.toLowerCase().replace(/s$/, "")])
            .filter((d: number | undefined) => d !== undefined);
          if (!targetDays.length) {
            addPhilMsg("I couldn't work out which days you want. Try saying something like \"move to Mon, Wed, Fri\"."); break;
          }
          const q = (intent.programmeQuery ?? "").toLowerCase();
          const prog =
            clientProgrammes.find(p => p.title.toLowerCase().includes(q)) ??
            clientProgrammes.find(p => q.split(" ").some((w: string) => w.length > 2 && p.title.toLowerCase().includes(w)));
          if (!prog) {
            addPhilMsg(`I couldn't find a programme matching "${intent.programmeQuery}". Try using the exact name.`); break;
          }
          const newSessions = remapSessionDays(prog.sessions as Session[], targetDays);
          setPendingReschedule({ programmeId: prog.id, programmeName: prog.title, sessions: newSessions, dayLabels: targetDays.map(d => DAY_NAMES[d]) });
          addPhilMsg(`I'll move "${prog.title}" to ${targetDays.map(d => DAY_NAMES[d]).join(" / ")}. Confirm in the bar below.`);
          break;
        }

        case "day_remap": {
          const fromDays: number[] = (intent.fromDays ?? [])
            .map((d: string) => DAY_WORDS[d.toLowerCase()] ?? DAY_WORDS[d.toLowerCase().replace(/s$/, "")])
            .filter((d: number | undefined) => d !== undefined);
          const toDays: number[] = (intent.toDays ?? [])
            .map((d: string) => DAY_WORDS[d.toLowerCase()] ?? DAY_WORDS[d.toLowerCase().replace(/s$/, "")])
            .filter((d: number | undefined) => d !== undefined);
          if (!fromDays.length || fromDays.length !== toDays.length) {
            addPhilMsg("The from/to day lists need to match up, e.g. \"move Mon/Wed to Tue/Thu\"."); break;
          }
          const changes = dayRemapAll(fromDays, toDays);
          if (!changes.length) {
            addPhilMsg("I didn't find any sessions on those days to move."); break;
          }
          const fromLabels = fromDays.map(d => DAY_NAMES[d]).join(" / ");
          const toLabels = toDays.map(d => DAY_NAMES[d]).join(" / ");
          setPendingCommand({ description: `Move all sessions: ${fromLabels} → ${toLabels}`, changes });
          addPhilMsg(`Moving all ${fromLabels} sessions to ${toLabels}. Confirm in the bar below.`);
          break;
        }

        case "copy_progress": {
          const { sourceWeekOffset = 0, targetWeeks = 1, setsIncrement = 0, repsMultiplier = 1.0 } = intent;
          const changes = copyWithProgression(sourceWeekOffset, targetWeeks, setsIncrement, repsMultiplier);
          if (!changes.length) {
            addPhilMsg("No sessions found in the source week. Make sure there are sessions in the week you're copying from."); break;
          }
          const parts: string[] = [];
          if (setsIncrement > 0) parts.push(`+${setsIncrement} set${setsIncrement !== 1 ? "s" : ""}/week`);
          else if (setsIncrement < 0) parts.push(`${setsIncrement} sets/week`);
          if (repsMultiplier !== 1.0) parts.push(`reps ×${repsMultiplier.toFixed(2).replace(/\.?0+$/, "")}/week`);
          const progression = parts.length ? ` (${parts.join(", ")})` : "";
          const totalNew = changes.reduce((acc, c) => acc + c.sessions.length, 0);
          const desc = `Copy sessions into ${targetWeeks} week${targetWeeks !== 1 ? "s" : ""} with progressive overload${progression}`;
          setPendingCommand({ description: desc, changes });
          addPhilMsg(`Adding ${totalNew} sessions across ${targetWeeks} week${targetWeeks !== 1 ? "s" : ""}${progression}. Confirm in the bar below.`);
          break;
        }

        default: {
          // Never show raw backend error text — always use a Phil-voiced message
          addPhilMsg("I didn't catch that as a calendar command. For scheduling, try something like \"copy this week into 4 weeks\" or \"move Mon sessions to Wednesday\". Want to build a programme or session instead? Just tell me what you're working on.");
        }
      }
    } catch {
      addPhilMsg("Something went wrong processing that command. Try again or rephrase it.");
    } finally {
      setCmdParsing(false);
    }
  };

  // ── Unified coach input routing ──────────────────────────────────────────────
  // "plan"          → parse-first: call /api/coach-parse, Phil asks clarifying questions
  // "library"       → open library browser pre-filled and auto-search
  // "review"        → coaching endpoint → Phil analysis answer
  // "conversational"→ lightweight Phil reply (greetings, affirmations, vague chat)
  // "schedule"      → calendar command parser (copy, move, remap, delete)
  function classifyCoachIntent(input: string): "plan" | "library" | "review" | "schedule" | "conversational" {
    const lower = input.toLowerCase().trim();
    // ① Calendar commands — must check first so "copy this week" doesn't hit "plan"
    if (/\b(copy|paste|repeat|duplicate|clone|reschedule|remap|shift|move sessions|delete sessions|clear all|delete all)\b/.test(lower)) return "schedule";
    // ② Library search
    if (/\b(find|search|browse|show me|look for|library|template|from library)\b/.test(lower)) return "library";
    // ③ Review / analysis
    if (/\b(review|check|is this|balanced|analyse|analyze|explain|what.s missing|what am i missing)\b/.test(lower)) return "review";
    // ④ Explicit build requests
    if (/\b(build|create|generate|design|programme|program|session|workout)\b/.test(lower)) return "plan";
    // ⑤ Goal statements — always route to plan so Phil asks clarifying questions
    if (/\b(i want|want to|my goal|i need|help me|i.?d like|looking to|training for|training to|get stronger|get fitter|lose weight|lose fat|build muscle|run a|marathon|half marathon|triathlon|hyrox|5k|10k)\b/.test(lower)) return "plan";
    // ⑥ Generic plan language without explicit build verb
    if (/\b(plan|make|week|schedule)\b/.test(lower)) return "plan";
    // ⑦ Greetings / short affirmations — lightweight conversational reply
    if (/^(hi|hello|hey|thanks|thank you|great|awesome|perfect|sounds good|ok|okay|yes|yep|no|nope|sure|got it|cool|nice)[.!?]?$/.test(lower)) return "conversational";
    // ⑧ Questions that don't fit other buckets → conversational
    if (/\b(how do|can you|any advice|what should|should i|when should|is it|am i|what.s the best|how many)\b/.test(lower)) return "conversational";
    return "schedule";
  }

  // ── Parse-first: called when user submits a plan/session brief ───────────
  const callCoachParse = async (
    input: string,
    followUpAnswer?: string,
    refinement?: string,
    previousPlan?: CoachParseResult
  ) => {
    setCmdParsing(true);
    try {
      const res = await fetch("/api/coach-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          ...(followUpAnswer ? { followUpAnswer } : {}),
          ...(refinement ? { refinement } : {}),
          ...(previousPlan ? { previousPlan } : {}),
          clientContext: {
            name: client?.name,
            programmes: (clientProgrammes ?? []).map(p => p.title),
          },
          history: getRecentHistory(),
        }),
      });
      const data = await res.json();
      setCoachParseResult(data);
      // Build Phil message text from parse result
      let philText = data.acknowledgement ?? "";
      if (data.hasEnough && (data.planSummary as string[] | undefined)?.length) {
        philText += "\n\nHere's what I'm going to build:\n" +
          (data.planSummary as string[]).map((l: string) => `• ${l}`).join("\n");
        if (data.intentNote) philText += `\n\n${data.intentNote}`;
      } else if (!data.hasEnough && data.followUpQuestion) {
        philText += `\n\n${data.followUpQuestion}`;
      }
      addPhilMsg(philText, { coachParseData: data });
    } catch {
      addPhilMsg("Couldn't reach the coaching service. Check your connection and try again.");
    } finally {
      setCmdParsing(false);
    }
  };

  // ── Infer session type from a natural-language brief ─────────────────────
  function inferSessionTypeFromBrief(brief: string): "strength" | "wod" | "run" {
    const lower = brief.toLowerCase();
    if (/\b(wod|amrap|emom|for time|metcon|box jump|wall ball|burpee|double under|pull.?up|kb|kettlebell|row.*cal|cal.*row|chipper)\b/.test(lower)) return "wod";
    if (/\b(run|km|kilometer|metre|meter|mile|interval|tempo|sprint|jog|5k|10k|half marathon|marathon|parkrun|pace|treadmill|track)\b/.test(lower)) return "run";
    return "strength";
  }

  // ── Next Monday date helper ────────────────────────────────────────────────
  function getNextMonday(): string {
    const today = new Date();
    const day = today.getDay();
    const daysToAdd = day === 0 ? 1 : 8 - day;
    return format(addDays(today, daysToAdd), "yyyy-MM-dd");
  }

  // ── Save a single session directly to the calendar ─────────────────────────
  async function saveSessionDirectly(session: any, date: string) {
    setSavingAiSession("calendar");
    try {
      const newSession = { ...session, id: `session-${Date.now()}`, date };
      await addSessionToClientCalendar(date, newSession, () => {}, newSession.id, () => {
        navigateToWeekOf(date);
        addPhilMsg(`Done. "${session.name ?? "Session"}" added to ${format(parseISO(date), "EEE d MMM")}.`);
      }, session.name ?? "Session");
    } catch {
      addPhilMsg("Something went wrong saving the session. Try again.");
    } finally {
      setSavingAiSession(null);
    }
  }

  // ── Build a single session from Phil — no modal ────────────────────────────
  async function handleBuildSessionFromPhil(brief: string, type: "strength" | "wod" | "run") {
    setPhilOpen(true);
    setCmdParsing(true);
    const date = assignStartDate || format(new Date(), "yyyy-MM-dd");
    try {
      const endpoint = type === "wod" ? "/api/parse-wod-session" : type === "run" ? "/api/parse-run-session" : "/api/parse-session";
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), 60000);
      let data: any;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: brief }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error();
        data = await res.json();
      } finally {
        clearTimeout(abortTimer);
      }
      if (type === "wod" && data.options && data.options.length > 1) {
        addPhilMsg(`Got some WOD options for ${format(parseISO(date), "EEE d MMM")}. Tap to add one:`, {
          action: { type: "pick_wod", options: data.options, date },
        });
      } else {
        const session = data.options?.[0] ?? data;
        const exercises: any[] = session.exercises ?? [];
        const preview = exercises.slice(0, 3)
          .map((ex: any) => `• ${ex.name}${ex.sets && ex.reps ? ` ${ex.sets}×${ex.reps}` : ex.sets ? ` ${ex.sets} sets` : ""}`)
          .join("\n");
        const suffix = exercises.length > 3 ? `\n+${exercises.length - 3} more` : "";
        addPhilMsg(
          `Here's your ${type === "run" ? "run" : "session"}, ${session.name ?? "Session"}:\n\n${preview}${suffix}`,
          { action: { type: "save_session", session, sessionType: type, date } }
        );
      }
    } catch {
      addPhilMsg("Couldn't generate that session. Give me a bit more detail and try again.");
    } finally {
      setCmdParsing(false);
    }
  }

  // ── Build a full programme with Phil thinking stream — no modal ────────────
  async function handleGenerateProgrammeWithThinking(brief: string, startDate: string) {
    setPhilOpen(true);
    setCmdParsing(true);

    const envSuffix = runEnv.length > 0 ? ` Running environment: ${runEnv.join(", ")}.` : "";
    const fullBrief = brief + envSuffix;
    const body = { description: fullBrief, startDate, strengthStyle: strengthStyle ?? "straight", clientId };

    // ① Fire generation immediately (long-running) — don't await yet
    let generationResult: any = null;
    let generationError: string | null = null;
    const genPromise = (async () => {
      try {
        const data = await streamProgramme({ ...body, weekOnly: false });
        if (data.t === "429") { generationError = "limit"; return; }
        if (data.t === "err") throw new Error(data.error ?? "generation_failed");
        generationResult = data;
      } catch (e: any) {
        generationError = e?.message ?? "failed";
      }
    })();

    // ② Fetch thinking messages in parallel — typically faster than generation
    let thinkingMessages: string[] = [];
    try {
      const tr = await fetch("/api/programme-thinking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSummary: fullBrief }),
      });
      const td = await tr.json();
      thinkingMessages = Array.isArray(td.messages) ? td.messages : [];
    } catch {
      thinkingMessages = ["Working through your goals.", "Setting up the weekly structure.", "Balancing load and recovery.", "Adding progressions."];
    }

    // ③ Show thinking messages one by one (max 6s window)
    const thinkingStart = Date.now();
    for (const msg of thinkingMessages) {
      if (Date.now() - thinkingStart > 6000) break;
      addPhilMsg(msg);
      await new Promise<void>(resolve => setTimeout(resolve, 800));
    }

    // ④ Wait for generation — heartbeat messages every 15s so it never looks frozen
    const WAIT_MESSAGES = [
      "Still building — this one's detailed.",
      "Working through the progressions…",
      "Nearly there.",
    ];
    let waitIdx = 0;
    let generationDone = false;
    const heartbeat = setInterval(() => {
      if (!generationDone && waitIdx < WAIT_MESSAGES.length) {
        addPhilMsg(WAIT_MESSAGES[waitIdx++]);
      }
    }, 15000);
    await genPromise;
    generationDone = true;
    clearInterval(heartbeat);

    if (generationError === "limit") {
      addPhilMsg("You've hit your monthly generation limit. Drop your coach a message to unlock more.");
      setCmdParsing(false);
      return;
    }
    if (generationError || !generationResult) {
      addPhilMsg("Something went wrong building the programme. Try again or rephrase the brief.");
      setCmdParsing(false);
      return;
    }

    // ⑤ Final message — then land on calendar
    addPhilMsg("Right. Let's go.");
    await new Promise<void>(resolve => setTimeout(resolve, 600));

    try {
      const allSessions = expandWeeks(generationResult.sessions ?? [], 4);
      if (isTeamMode && teamId) {
        const token = localStorage.getItem("axis_auth_token");
        const headers = { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "application/json" };
        for (const session of allSessions) {
          await fetch(`/api/teams/${teamId}/sessions`, {
            method: "POST",
            headers,
            body: JSON.stringify({ sessionData: session, date: session.date }),
          });
        }
        await queryClient.invalidateQueries({ queryKey: ["team-sessions", teamId] });
      } else {
        const saveRes = await fetch("/api/programmes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: generationResult.title ?? "Custom Programme",
            sessions: allSessions,
            clientId,
            blockLength: 4,
            ...(generationResult.sessionsPerWeek != null ? { sessionsPerWeek: generationResult.sessionsPerWeek } : {}),
          }),
        });
        if (!saveRes.ok) throw new Error("save_failed");
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      }
      navigateToWeekOf(startDate);
      addPhilMsg(`Done. "${generationResult.title}" is live on your calendar. 4 weeks, deload in week 4.`);
    } catch {
      addPhilMsg("Programme generated but I couldn't save it. Try again.");
    } finally {
      setCmdParsing(false);
    }
  }

  const handleBuildFromParse = () => {
    if (!coachParseResult) return;
    const brief = coachParseResult.suggestedBrief ?? originalCoachInput;
    const isSession = coachParseResult.requestType === "session";
    const inferredStyle = coachParseResult.parsedConstraints?.progressionStyle ?? "straight";
    setCoachParseResult(null);
    setCoachFollowUpInput("");
    setStrengthStyle(inferredStyle);

    if (isSession) {
      const inferredType = inferSessionTypeFromBrief(brief);
      void handleBuildSessionFromPhil(brief, inferredType);
    } else {
      const startDate = getNextMonday();
      void handleGenerateProgrammeWithThinking(brief, startDate);
    }
  };

  // ── Handle user's answer to a coach follow-up question ──────────────────
  const handleCoachFollowUp = async () => {
    if (!coachFollowUpInput.trim()) return;
    addUserMsg(coachFollowUpInput.trim());
    await callCoachParse(originalCoachInput, coachFollowUpInput);
    setCoachFollowUpInput("");
  };

  // ── Main entry point: dispatch based on intent ───────────────────────────
  const handleCoachInput = async (overrideInput?: string) => {
    const input = (overrideInput !== undefined ? overrideInput : cmdInput).trim();
    if (!input) return;

    // Log user message + open Phil panel
    addUserMsg(input);
    setPhilOpen(true);
    if (overrideInput === undefined) setCmdInput("");
    setCoachInlineResponse(null);
    setCoachParseResult(null);

    const intent = classifyCoachIntent(input);

    // ── Injury intent: intercept before other routing ─────────────────────────
    if (INJURY_KEYWORDS.some(kw => input.toLowerCase().includes(kw))) {
      await handleInjuryChat(input);
      return;
    }

    // ── Plan / Session: parse-first → Phil chat response ─────────────────────
    if (intent === "plan") {
      setOriginalCoachInput(input);
      await callCoachParse(input);
      return;
    }

    // ── Conversational: lightweight Phil reply (greetings, short affirmations) ─
    if (intent === "conversational" && clientId) {
      setCmdParsing(true);
      try {
        const res = await fetch(`/api/clients/${clientId}/phil-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: input, history: getRecentHistory() }),
        });
        const data = await res.json();
        addPhilMsg(data.reply ?? "What would you like to work on today?");
      } catch {
        addPhilMsg("Something went wrong on my end. Try again or ask me something else.");
      } finally {
        setCmdParsing(false);
      }
      return;
    }

    // ── Library: open the library browser pre-filled and auto-search ─────────
    if (intent === "library") {
      setBrainQuery(input);
      setBrainResults([]);
      setBrainIntent(null);
      setBrainOpen(true);
      setTimeout(() => void searchBrain(input), 150);
      addPhilMsg("Opening the library for you. Have a browse and tap anything you want to add.");
      return;
    }

    // ── Review: coaching endpoint → Phil chat message ────────────────────────
    if (intent === "review" && clientId) {
      setCmdParsing(true);
      try {
        const sessionCount = (clientProgrammes ?? []).reduce((n, p) => n + (p.sessions?.length ?? 0), 0);
        const programmeNames = (clientProgrammes ?? []).map(p => p.title).join(", ") || "none";
        const context = `Client training plans: ${programmeNames}. Total scheduled sessions: ${sessionCount}.`;
        const res = await fetch(`/api/clients/${clientId}/coaching`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: input, context, history: getRecentHistory() }),
        });
        const data = await res.json();
        addPhilMsg(data.answer ?? "I couldn't analyse that. Try asking something more specific.");
      } catch {
        addPhilMsg("Couldn't reach the coaching service. Check your connection.");
      } finally {
        setCmdParsing(false);
      }
      return;
    }

    // ── Default: calendar / schedule command ──────────────────────────────────
    await handleRescheduleCmd();
  };

  // ── Injury modification flow ──────────────────────────────────────────────────
  const INJURY_KEYWORDS = [
    "sore", "hurting", "pain", "injury", "injured", "flaring", "flare up", "flared",
    "niggle", "tweaked", "tweak", "strain", "strained", "bad back", "bad knee",
    "bad shoulder", "bad hip", "can't do", "cant do", "aggravating", "aggravates",
    "inflammation", "inflamed", "tight", "tightness",
  ];

  const handleInjuryChat = async (input: string) => {
    const token = localStorage.getItem("axis_auth_token");
    const phase = injuryFlow?.phase ?? "start";
    const context = injuryFlow?.context ?? {};
    setCmdParsing(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/injury-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ phase: injuryFlow ? phase : "start", message: input, context }),
      });
      const data = await res.json();
      const reply: string = data.reply ?? "Something went wrong. Try again.";
      addPhilMsg(reply);

      if (data.nextPhase === "severity") {
        setInjuryFlow({ phase: "severity", context: data.context ?? {} });
      } else if (data.nextPhase === "choice") {
        setInjuryFlow({ phase: "choice", context: data.context ?? {} });
      } else {
        // done — clear flow and refresh programmes
        setInjuryFlow(null);
        if (data.nextPhase === "done" && data.context?.confirmedSwaps?.length > 0) {
          await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        }
      }
    } catch {
      addPhilMsg("Something went wrong. Try again.");
      setInjuryFlow(null);
    } finally {
      setCmdParsing(false);
    }
  };

  const handlePhilPanelSubmit = async () => {
    const input = philPanelInput.trim();
    if (!input) return;
    setPhilPanelInput("");
    setPhilExpanded(true);
    setPhilUnread(false);

    // Injury flow: intercept if active or if injury keywords detected
    const hasInjuryKeyword = !injuryFlow && INJURY_KEYWORDS.some(kw => input.toLowerCase().includes(kw));
    if (injuryFlow || hasInjuryKeyword) {
      addUserMsg(input);
      await handleInjuryChat(input);
      return;
    }

    // On Training (or team mode): use existing routing logic unchanged
    if (activeTab === "training" || isTeamMode) {
      if (coachParseResult && !coachParseResult.hasEnough) {
        // Still gathering info — pass the answer to Phil's clarifying question
        addUserMsg(input);
        await callCoachParse(originalCoachInput, input);
        return;
      }
      if (coachParseResult && coachParseResult.hasEnough) {
        // A plan preview is showing with "Build this" — treat this message as a refinement
        addUserMsg(input);
        await callCoachParse(originalCoachInput, undefined, input, coachParseResult);
        return;
      }
      await handleCoachInput(input);
      return;
    }

    // On Dashboard / Nutrition: send directly to phil-chat with tab context
    addUserMsg(input);
    setCmdParsing(true);
    try {
      const token = localStorage.getItem("axis_auth_token");
      const dashboardContext = activeTab === "dashboard" && analytics ? {
        fitnessScore: analytics.fitnessScore.current,
        fitnessScoreChange: analytics.fitnessScore.change,
        consistency: analytics.adherence.thisWeek,
        weeklyWin: analytics.weeklyWin,
        performanceMetrics: {
          squat: analytics.strengthMetrics.squat.current,
          bench: analytics.strengthMetrics.bench.current,
          deadlift: analytics.strengthMetrics.deadlift.current,
          fiveK: analytics.runMetrics.estimated5K.current,
        },
      } : undefined;

      const res = await fetch(`/api/clients/${clientId}/phil-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          message: input,
          history: getRecentHistory(),
          currentTab: activeTab,
          dashboardContext,
        }),
      });
      const data = await res.json();
      addPhilMsg(data.reply ?? "What would you like to work on today?");

      // Handle tab navigation
      if (data.navigateTo === "training" || data.navigateTo === "nutrition" || data.navigateTo === "dashboard") {
        setTimeout(() => setActiveTab(data.navigateTo), 800);
      }

      // Handle food log action (Nutrition tab)
      if (data.action?.type === "log_food" && data.action.description) {
        try {
          await addMutation.mutateAsync({ clientId, data: { description: data.action.description, date: selectedDate } });
          queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(clientId, { date: selectedDate }) });
          refetchWeeklyLogs();
        } catch { /* non-fatal */ }
      }
    } catch {
      addPhilMsg("Something went wrong. Try again.");
    } finally {
      setCmdParsing(false);
    }
  };

  const applyReschedule = async () => {
    if (!pendingReschedule) return;
    setCmdSaving(true);
    try {
      await applySnapshot([{ id: pendingReschedule.programmeId, sessions: pendingReschedule.sessions }]);
      addPhilMsg(`"${pendingReschedule.programmeName}" rescheduled to ${pendingReschedule.dayLabels.join(" / ")}.`);
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
      if (isTeamMode && teamId) {
        const token = localStorage.getItem("axis_auth_token");
        const headers = { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "application/json" };
        await fetch(`/api/teams/${teamId}/sessions`, {
          method: "POST", headers, body: JSON.stringify({ sessionData: newSession, date }),
        });
        await queryClient.invalidateQueries({ queryKey: ["team-sessions", teamId] });
      } else {
        const targetProgramme = clientProgrammes?.[0];
        if (targetProgramme) {
          const updatedSessions = [...(targetProgramme.sessions || []), newSession];
          await fetch(`/api/programmes/${targetProgramme.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessions: updatedSessions }) });
        } else {
          await fetch("/api/programmes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Sessions", clientId, sessions: [newSession] }) });
        }
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      }
      toast({ title: `${label} added to ${format(parseISO(date), "EEE d MMM")}` });
      closeDialog();
    } catch { toast({ title: "Failed to add session", variant: "destructive" }); }
    finally { setAdding(null); }
  }

  const addWodToClientCalendar = async (wod: any) => {
    if (!wodClientTargetDate) return;
    const formatLabel = wod.formatLabel ?? wod.format;
    const sessionName = `${formatLabel} ${wod.duration}: ${wod.name}`;

    // ── Safe block helpers (mirrors parse.ts) ──
    const _candidates = ["amount", "reps", "duration", "time", "seconds", "distance", "calories", "value", "count"];
    const _extractAmt = (b: any): number | undefined => {
      for (const k of _candidates) {
        const v = b[k];
        if (v != null && v !== "") {
          const n = Number(v);
          if (!Number.isNaN(n)) return n;
          if (typeof v === "string") { const m = v.match(/\d+/); if (m) return Number(m[0]); }
        }
      }
      return undefined;
    };
    const _resolveUnit = (u: string | undefined): string => {
      if (!u) return "reps";
      const l = u.toLowerCase().trim();
      if (l === "seconds" || l === "sec" || l === "s") return "seconds";
      if (l === "m" || l === "metres" || l === "meters") return "m";
      if (l === "km") return "km";
      if (l === "calories" || l === "cal" || l === "cals") return "cal";
      return "reps";
    };
    const _buildNotes = (b: any): string => {
      const amt = _extractAmt(b);
      const unit = _resolveUnit(b.unit);
      if (amt == null) return b.weight ?? "";
      return b.weight ? `${amt} ${unit} (${b.weight})` : `${amt} ${unit}`;
    };
    const _buildStepType = (u: string | undefined): string => {
      const l = (u ?? "").toLowerCase().trim();
      if (l === "seconds" || l === "sec" || l === "s") return "seconds";
      if (l === "m" || l === "metres" || l === "meters" || l === "km") return "distance";
      if (l === "calories" || l === "cal" || l === "cals") return "calories";
      return "reps";
    };

    const rawBlocks: any[] = wod.blocks ?? [];
    const now = Date.now();

    // Canonical wod structure
    const wodCanonical = {
      format: (wod.format ?? "amrap") as string,
      totalDurationSeconds: wod.duration ? wod.duration * 60 : undefined,
      blocks: [{
        id: "block-0",
        type: wod.format ?? "amrap",
        durationSeconds: wod.duration ? wod.duration * 60 : undefined,
        steps: rawBlocks.map((block: any, idx: number) => {
          const amt = _extractAmt(block);
          const unit = _resolveUnit(block.unit);
          return {
            id: `step-${idx}`,
            movement: { name: `${block.movement.charAt(0).toUpperCase()}${block.movement.slice(1)}` },
            target: { type: _buildStepType(block.unit), value: amt, unit },
            ...(block.weight ? { load: { display: block.weight } } : {}),
          };
        }),
      }],
    };

    const newSession = {
      id: `session-${now}`,
      date: wodClientTargetDate,
      name: sessionName,
      source: "wod_brain",
      structure: wod.structure ?? "",
      wod: wodCanonical,
      exercises: rawBlocks.map((block: any, idx: number) => ({
        id: `ex-${now}-${idx}`,
        name: `${block.movement.charAt(0).toUpperCase()}${block.movement.slice(1)}`,
        sets: null, reps: null, rpe: null,
        notes: _buildNotes(block),
        rawText: `${_buildNotes(block)} ${block.movement}`.trim(),
      })),
    };
    // ── Save-point diagnostic log (library WOD path) ──────────────────────────
    {
      const steps = newSession.wod?.blocks?.[0]?.steps ?? [];
      console.log("[WOD LIBRARY SAVE] wod present:", !!newSession.wod);
      console.log("[WOD LIBRARY SAVE] canonical steps:", steps.map((s: any) => ({
        movement: s.movement?.name, value: s.target?.value, unit: s.target?.unit,
      })));
      console.log("[WOD LIBRARY SAVE] legacy notes:", newSession.exercises.map((e: any) => e.notes));
    }

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
      const preview = await fetch("/api/strength-blocks/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, startDate: strengthStartDate }),
      });
      if (!preview.ok) throw new Error();
      const { sessions: rawSessions } = await preview.json();
      const ts = Date.now();
      const sessions = (rawSessions ?? []).map((s: any, si: number) => ({
        ...s,
        id: `session-${ts}-${si}`,
        exercises: (s.exercises ?? []).map((ex: any, ei: number) => ({
          ...ex,
          id: `ex-${ts}-${si}-${ei}`,
          rpe: ex.rpe ?? null,
          rest: ex.rest ?? null,
          tempo: ex.tempo ?? null,
          rawText: ex.rawText ?? ex.name ?? "",
          clientComment: ex.clientComment ?? null,
          setReps: Array.isArray(ex.setReps) ? ex.setReps : Array(ex.sets ?? 0).fill(null),
          setWeights: Array.isArray(ex.setWeights) ? ex.setWeights : Array(ex.sets ?? 0).fill(null),
          weekProgression: ex.weekProgression ?? [],
        })),
      }));
      const res = await fetch("/api/programmes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: templateName, clientId, sessions }),
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
        body: JSON.stringify({ query, clientId: clientId || null }),
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
      const source = result.source ?? (result.isBlock ? "strength_template" : result.bucket === "run" ? "run_session" : "wod_session");

      // ── Saved session from session library ───────────────────────
      if (source === "saved_session") {
        const sessionData = result.raw ?? {};
        const newSession = { ...sessionData, id: `session-${Date.now()}`, date };
        await addSessionToClientCalendar(date, newSession, () => {}, newSession.id, () => {
          navigateToWeekOf(date);
          setBrainOpen(false);
          setBrainResults([]);
          setBrainQuery("");
          toast({ title: `${result.name} added to calendar` });
        }, result.name);
        return;
      }

      // ── Block insertion — routed by source ──────────────────────
      if (source === "wod_cycle") {
        const res = await fetch("/api/endurance-cycles/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycleId: result.id, clientId, startDate: date }),
        });
        if (!res.ok) throw new Error();
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        toast({ title: `${result.name} added`, description: `${result.totalWeeks}-week block from ${format(parseISO(date), "d MMM yyyy")}` });
        navigateToWeekOf(date); setBrainOpen(false); setBrainResults([]); setBrainQuery(""); return;
      }

      if (source === "wod_engine") {
        const res = await fetch("/api/engine-builder/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ programmeId: result.id, clientId, startDate: date }),
        });
        if (!res.ok) throw new Error();
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        toast({ title: `${result.name} added`, description: `${result.durationWeeks}-week block from ${format(parseISO(date), "d MMM yyyy")}` });
        navigateToWeekOf(date); setBrainOpen(false); setBrainResults([]); setBrainQuery(""); return;
      }

      if (source === "run_block") {
        const res = await fetch("/api/endurance-run-templates/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: result.id, clientId, startDate: date }),
        });
        if (!res.ok) throw new Error();
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        toast({ title: `${result.name} added`, description: `${result.totalWeeks}-week run block from ${format(parseISO(date), "d MMM yyyy")}` });
        navigateToWeekOf(date); setBrainOpen(false); setBrainResults([]); setBrainQuery(""); return;
      }

      if (source === "strength_template" || source === "strength_programme") {
        const normalizeExercise = (ex: any, idx: number, sessionIdx: number) => {
          const sets = ex.sets ?? 0;
          return {
            ...ex,
            id: `ex-${Date.now()}-${sessionIdx}-${idx}`,
            rpe: ex.rpe ?? null,
            rest: ex.rest ?? null,
            tempo: ex.tempo ?? null,
            rawText: ex.rawText ?? ex.name ?? "",
            clientComment: ex.clientComment ?? null,
            setReps: Array.isArray(ex.setReps) ? ex.setReps : Array(sets).fill(null),
            setWeights: Array.isArray(ex.setWeights) ? ex.setWeights : Array(sets).fill(null),
            weekProgression: ex.weekProgression ?? [],
          };
        };

        let title = result.name;
        let sessions: any[] = [];

        if (source === "strength_template") {
          // Get sessions from the preview endpoint — sessions already start on the chosen date
          const preview = await fetch("/api/strength-blocks/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId: result.id, startDate: date }),
          });
          if (!preview.ok) throw new Error();
          const previewData = await preview.json();
          sessions = (previewData.sessions ?? []).map((s: any, si: number) => ({
            ...s,
            id: `session-${Date.now()}-${si}`,
            exercises: (s.exercises ?? []).map((ex: any, ei: number) => normalizeExercise(ex, ei, si)),
          }));
        } else {
          // strength_programme: re-date sessions from the chosen start date
          const raw = result.raw ?? {};
          title = raw.title ?? result.name;
          const rawSessions: any[] = (raw.sessions ?? []).slice().sort((a: any, b: any) => {
            if (a.dayNumber != null && b.dayNumber != null) return a.dayNumber - b.dayNumber;
            return (a.date ?? "").localeCompare(b.date ?? "");
          });
          const hasDayNumbers = rawSessions.length > 0 && rawSessions.every((s: any) => s.dayNumber != null);

          if (hasDayNumbers) {
            // New-style: use stored dayNumber directly
            sessions = rawSessions.map((s: any, si: number) => ({
              ...s,
              id: `session-${Date.now()}-${si}`,
              date: format(addDays(parseISO(date), s.dayNumber - 1), "yyyy-MM-dd"),
              exercises: (s.exercises ?? []).map((ex: any, ei: number) => normalizeExercise(ex, ei, si)),
            }));
          } else {
            // Old-style: no dayNumber stored — use sessionsPerWeek from DB if available,
            // otherwise infer by finding which value divides totalSessions into a clean number of weeks.
            const totalSessions = rawSessions.length;
            let sessionsPerWeek: number;
            if (typeof raw.sessionsPerWeek === "number" && raw.sessionsPerWeek > 0) {
              // Explicit value stored on the programme — use it directly
              sessionsPerWeek = raw.sessionsPerWeek;
            } else {
              // Infer: e.g. 16 sessions: 16÷4=4.0 ✓, 16÷3=5.33 ✗ → 4/week
              sessionsPerWeek = 4;
              let bestRemainder = Infinity;
              for (const spw of [4, 3, 5, 6, 2]) {
                const remainder = Math.abs((totalSessions / spw) - Math.round(totalSessions / spw));
                if (remainder < bestRemainder) { bestRemainder = remainder; sessionsPerWeek = spw; }
                if (remainder === 0) break;
              }
            }
            // Gap offsets within each 7-day week by frequency
            const gapPatterns: Record<number, number[]> = {
              2: [0, 3],
              3: [0, 2, 4],
              4: [0, 1, 3, 5],
              5: [0, 1, 2, 3, 5],
              6: [0, 1, 2, 3, 4, 5],
            };
            const gaps = gapPatterns[sessionsPerWeek] ?? gapPatterns[4];
            sessions = rawSessions.map((s: any, si: number) => {
              const weekIdx = Math.floor(si / sessionsPerWeek);
              const dayIdx = si % sessionsPerWeek;
              const dayOffset = weekIdx * 7 + (gaps[dayIdx] ?? dayIdx);
              return {
                ...s,
                id: `session-${Date.now()}-${si}`,
                dayNumber: dayOffset + 1,
                date: format(addDays(parseISO(date), dayOffset), "yyyy-MM-dd"),
                exercises: (s.exercises ?? []).map((ex: any, ei: number) => normalizeExercise(ex, ei, si)),
              };
            });
          }
        }

        const res = await fetch("/api/programmes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, clientId, sessions }),
        });
        if (!res.ok) throw new Error();
        await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
        toast({ title: `${title} added to calendar`, description: `Starting ${format(parseISO(date), "d MMM yyyy")}` });
        navigateToWeekOf(date); setBrainOpen(false); setBrainResults([]); setBrainQuery(""); return;
      }

      // ── Session insertion (wod_session / run_session) ───────────
      const raw = result.raw ?? {};
      const newSession = (result.bucket === "run" || source === "run_session")
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

  // Tracking mode (persisted per-client)
  const [nutritionTrackingMode, setNutritionTrackingModeRaw] = useState<"calories" | "protein_only">(() => {
    try {
      const v = localStorage.getItem(`nutrition-mode-${clientId}`);
      if (v === "protein_only") return "protein_only";
      return "calories";
    }
    catch { return "calories"; }
  });
  const [pendingModeSwitch, setPendingModeSwitch] = useState<"protein_only" | null>(null);
  const requestNutritionMode = (mode: "calories" | "protein_only") => {
    if (mode === "protein_only" && nutritionTrackingMode !== "protein_only") {
      setPendingModeSwitch("protein_only");
    } else {
      setNutritionTrackingModeRaw(mode);
      try { localStorage.setItem(`nutrition-mode-${clientId}`, mode); } catch {}
    }
  };
  const confirmModeSwitch = () => {
    if (!pendingModeSwitch) return;
    setNutritionTrackingModeRaw(pendingModeSwitch);
    try { localStorage.setItem(`nutrition-mode-${clientId}`, pendingModeSwitch); } catch {}
    setPendingModeSwitch(null);
  };

  // Weekly nutrition logs (all entries, for the 7-day strip)
  const [weeklyNutritionLogs, setWeeklyNutritionLogs] = useState<Array<{ date: string; calories?: number | null; protein?: string | null }>>([]);
  const refetchWeeklyLogs = () => {
    fetch(`/api/clients/${clientId}/nutrition`)
      .then(r => r.ok ? r.json() : [])
      .then(setWeeklyNutritionLogs)
      .catch(() => {});
  };
  useEffect(() => { refetchWeeklyLogs(); }, [clientId]);

  const { data: entries, isLoading: entriesLoading } = useListNutritionEntries(clientId, { date: selectedDate });
  const addMutation = useAddNutritionEntry();
  const deleteMutation = useDeleteNutritionEntry();
  const updateMutation = useUpdateNutritionEntry();

  const [foodInput, setFoodInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [labelImages, setLabelImages] = useState<File[]>([]);
  const [labelPreviews, setLabelPreviews] = useState<string[]>([]);
  const labelInputRef = useRef<HTMLInputElement>(null);

  function handleLabelPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newPreviews = files.map(f => URL.createObjectURL(f));
    setLabelImages(prev => [...prev, ...files]);
    setLabelPreviews(prev => [...prev, ...newPreviews]);
    e.target.value = "";
  }
  function removeLabelPhoto(index: number) {
    setLabelImages(prev => prev.filter((_, i) => i !== index));
    setLabelPreviews(prev => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }
  function clearAllLabelPhotos() {
    labelPreviews.forEach(url => URL.revokeObjectURL(url));
    setLabelImages([]);
    setLabelPreviews([]);
  }

  // Resize image to max 1024px and JPEG 0.85 quality before sending — keeps payload under ~300KB
  async function resizeImageToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX = 1024;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height / width) * MAX); width = MAX; }
          else { width = Math.round((width / height) * MAX); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = objectUrl;
    });
  }
  const [showGuide, setShowGuide] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editDescriptionOriginal, setEditDescriptionOriginal] = useState("");
  const [editCalories, setEditCalories] = useState("");
  const [editProtein, setEditProtein] = useState("");
  const [editCarbs, setEditCarbs] = useState("");
  const [editFats, setEditFats] = useState("");
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

  // Non-passive touchmove: blocks browser scroll while a drag is active
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (isDragActiveRef.current) e.preventDefault();
    };
    document.addEventListener("touchmove", handler, { passive: false });
    return () => document.removeEventListener("touchmove", handler);
  }, []);

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
    if (!text && !labelImages.length) return;
    setIsAdding(true);
    try {
      if (labelImages.length > 0) {
        const resized = await Promise.all(labelImages.map(f => resizeImageToBase64(f)));
        const res = await fetch(`/api/clients/${clientId}/nutrition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: text || "Nutrition label scan",
            date: selectedDate,
            imageBase64Array: resized.map(r => r.base64),
            imageMimeTypes: resized.map(r => r.mimeType),
          }),
        });
        if (!res.ok) throw new Error();
        clearAllLabelPhotos();
      } else {
        await addMutation.mutateAsync({ clientId, data: { description: text, date: selectedDate } });
      }
      queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(clientId, { date: selectedDate }) });
      refetchWeeklyLogs();
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
      refetchWeeklyLogs();
    } catch {
      toast({ title: "Error deleting entry", variant: "destructive" });
    }
  };

  const startEditing = (entry: NutritionEntry) => {
    setEditingEntryId(entry.id);
    setEditDescription(entry.description ?? "");
    setEditDescriptionOriginal(entry.description ?? "");
    setEditCalories(entry.calories?.toString() ?? "");
    setEditProtein(entry.protein ? parseFloat(entry.protein).toFixed(1) : "");
    setEditCarbs(entry.carbs ? parseFloat(entry.carbs).toFixed(1) : "");
    setEditFats(entry.fats ? parseFloat(entry.fats).toFixed(1) : "");
  };

  const handleSaveEdit = async (entryId: number) => {
    try {
      const descriptionChanged = editDescription.trim() !== editDescriptionOriginal.trim();
      await updateMutation.mutateAsync({
        clientId,
        entryId,
        data: descriptionChanged
          ? { description: editDescription.trim() }
          : {
              calories: editCalories ? parseInt(editCalories, 10) : undefined,
              protein: editProtein ? parseFloat(editProtein) : undefined,
              carbs: editCarbs ? parseFloat(editCarbs) : undefined,
              fats: editFats ? parseFloat(editFats) : undefined,
            },
      });
      queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(clientId, { date: selectedDate }) });
      setEditingEntryId(null);
      toast({ title: descriptionChanged ? "Re-parsed and updated" : "Updated" });
    } catch {
      toast({ title: "Error updating entry", variant: "destructive" });
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

  // Force training tab in team mode
  useEffect(() => {
    if (isTeamMode) setActiveTab("training");
  }, [isTeamMode]);

  // Team: publish a session
  const handleTeamPublishSession = async () => {
    if (!teamPublishConfirm || !teamId) return;
    setTeamPublishing(true);
    try {
      const token = localStorage.getItem("axis_auth_token");
      const r = await fetch(`/api/teams/${teamId}/sessions/${teamPublishConfirm.dbId}/publish`, {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error("Publish failed");
      await queryClient.invalidateQueries({ queryKey: ["team-sessions", teamId] });
      toast({ title: "Session published to all members" });
      setTeamPublishConfirm(null);
    } catch {
      toast({ title: "Failed to publish session", variant: "destructive" });
    } finally {
      setTeamPublishing(false);
    }
  };

  // Team: load client copies for a session
  const handleViewTeamCopies = async (dbId: number, sessionName: string) => {
    setTeamCopiesPanel({ dbId, sessionName });
    setTeamCopiesLoading(true);
    try {
      const token = localStorage.getItem("axis_auth_token");
      const r = await fetch(`/api/teams/${teamId}/sessions/${dbId}/client-copies`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (r.ok) setTeamCopies(await r.json());
    } catch { /* ignore */ } finally {
      setTeamCopiesLoading(false);
    }
  };

  if (!isTeamMode && clientLoading) return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (!isTeamMode && !client) return (
    <div className="flex h-screen items-center justify-center flex-col gap-3">
      <p className="text-muted-foreground">Client not found</p>
      <Button variant="outline" onClick={() => setLocation("/clients")}>Back to Clients</Button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header — hidden in team mode */}
      {!isTeamMode && <div className="shrink-0 z-10 bg-background/95 backdrop-blur border-b px-6 py-4">
        <div className="flex items-center gap-3">
          {mode === "coach" && (
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setLocation("/clients")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          {mode === "client" && (
            <Link href="/clients">
              <div className="flex items-center mr-1 cursor-pointer opacity-80 hover:opacity-100 transition-opacity" title="Coach dashboard">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-white font-black text-lg leading-none" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>M</span>
                </div>
              </div>
            </Link>
          )}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
              {client.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <h1 className="font-display font-bold text-lg truncate">{client.name}</h1>
          </div>
          {mode === "coach" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetCredits}
                disabled={resettingCredits}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground gap-1.5 text-xs h-8 px-2.5"
                title="Refresh client's monthly programme generation credits"
              >
                {resettingCredits ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Credits
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
            </>
          )}
          {mode === "client" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { logout(); clearClient(); setLocation("/"); }}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground gap-1.5 text-xs h-8 px-2.5"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </Button>
          )}
        </div>

        {/* Tabs + Phil toggle */}
        <div className="flex items-center gap-2 mt-4">
          <div className="tabs flex-1">
            {([
              { id: "dashboard", label: "Dashboard", icon: <BarChart3 className="w-3.5 h-3.5" /> },
              { id: "nutrition",  label: "Nutrition",  icon: <Utensils  className="w-3.5 h-3.5" /> },
              { id: "training",   label: "Training",   icon: <Dumbbell  className="w-3.5 h-3.5" /> },
              ...(mode === "client" && isIrlEnabled ? [{ id: "irl" as Tab, label: "IRL Sessions", icon: <MapPin className="w-3.5 h-3.5" /> }] : []),
            ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`tab gap-1.5${activeTab === id ? " active" : ""}`}
              >
                {icon}{label}
              </button>
            ))}
          </div>
        </div>
      </div>}

      {/* Dashboard Tab */}
      {!isTeamMode && activeTab === "dashboard" && (
        <div className="flex-1 overflow-y-auto">
          <DashboardTab
            analytics={analytics}
            isLoading={analyticsLoading}
            clientId={clientId}
            calorieTarget={client?.dailyCalorieGoal ?? null}
            proteinTarget={client?.dailyProteinGoal ?? null}
            nutritionMode={nutritionTrackingMode}
            hasSessionData={!analytics || analytics.sessions.length > 0}
          />
        </div>
      )}


      {/* Nutrition Tab */}
      {!isTeamMode && activeTab === "nutrition" && (
        <div className="flex-1 overflow-y-auto">
        <div className="nutrition-screen px-6 py-6 max-w-2xl mx-auto">

          {/* ── Nutrition Goals ───────────────────────────────────── */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nutrition goals</p>
            <Button
              variant="outline"
              size="sm"
              onClick={openGoalsDialog}
              className="gap-1.5 text-xs h-7 px-2.5 rounded-lg"
              title="Set daily macro & calorie goals"
            >
              <Target className="w-3 h-3" />
              Set Goals
            </Button>
          </div>

          {/* ── Tracking Mode ─────────────────────────────────────── */}
          <div className="mb-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Tracking mode</p>
            <div className="flex gap-1 bg-muted rounded-xl p-1">
              {(["calories", "protein_only"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => requestNutritionMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                    nutritionTrackingMode === m
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "calories" ? "Calories" : "Protein only"}
                </button>
              ))}
            </div>
          </div>

          {/* ── Date selector ─────────────────────────────────────── */}
          <div className="nutrition-date">
            <CalendarDays className="w-5 h-5 text-muted-foreground" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-transparent border-none outline-none cursor-pointer"
            />
          </div>

          {/* ── Today status ──────────────────────────────────────── */}
          {(() => {
            const hasTarget = (client?.dailyCalorieGoal ?? 0) > 0;
            const hasEntries = (entries?.length ?? 0) > 0;
            const isToday = selectedDate === format(new Date(), "yyyy-MM-dd");

            // In protein_only mode, check protein target instead of calorie target
            const isProteinOnly = nutritionTrackingMode === "protein_only";
            const proTarget = client?.dailyProteinGoal ?? 0;
            const effectiveTarget = isProteinOnly ? proTarget : (client?.dailyCalorieGoal ?? 0);

            if (!effectiveTarget) return (
              <div className="rounded-xl border border-dashed border-muted-foreground/30 px-4 py-3 text-sm text-muted-foreground text-center mb-3">
                Set a {isProteinOnly ? "protein" : "calorie"} target in Goals to see your daily status
              </div>
            );

            let statusText = "";
            let statusColor = "text-muted-foreground";
            let statusBg = "bg-muted/40";

            if (!isProteinOnly) {
              const calTarget = client!.dailyCalorieGoal ?? 0;
              if (!hasEntries) {
                statusText = isToday ? "Nothing logged yet" : "No entries for this day";
              } else {
                const diff = Math.round(totals.calories) - calTarget;
                if (Math.abs(diff) <= 100) {
                  statusText = "On track";
                  statusColor = "text-emerald-600";
                  statusBg = "bg-emerald-50 dark:bg-emerald-950/30";
                } else if (diff > 0) {
                  statusText = `+${diff} kcal over target`;
                  statusColor = "text-red-600";
                  statusBg = "bg-red-50 dark:bg-red-950/30";
                } else {
                  statusText = `${Math.abs(diff)} kcal to go`;
                  statusColor = "text-amber-600";
                  statusBg = "bg-amber-50 dark:bg-amber-950/30";
                }
              }
            } else {
              // Protein only mode
              if (!hasEntries) {
                statusText = isToday ? "Nothing logged yet" : "No entries for this day";
              } else {
                const logged = totals.protein;
                const rem = proTarget - logged;
                if (rem <= 0) {
                  statusText = "Protein target hit";
                  statusColor = "text-emerald-600";
                  statusBg = "bg-emerald-50 dark:bg-emerald-950/30";
                } else {
                  statusText = `${rem.toFixed(0)}g to go`;
                  statusColor = "text-amber-600";
                  statusBg = "bg-amber-50 dark:bg-amber-950/30";
                }
              }
            }

            return (
              <div className={`rounded-xl px-4 py-3 mb-3 flex items-center justify-between ${statusBg}`}>
                <p className={`text-sm font-semibold ${statusColor}`}>{statusText}</p>
                {hasEntries && isProteinOnly && totals.protein > 0 && (
                  <p className="text-[11px] text-muted-foreground font-medium">{totals.protein.toFixed(0)}g logged</p>
                )}
                {!hasEntries && (
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                    {isProteinOnly ? "Protein" : "Calories"}
                  </p>
                )}
              </div>
            );
          })()}

          {/* ── 7-day weekly strip ────────────────────────────────── */}
          {(() => {
            // Compute the current ISO week Mon–Sun
            const today = new Date();
            const dow = today.getDay(); // 0=Sun
            const diffToMon = dow === 0 ? -6 : 1 - dow;
            const weekDays: Array<{ label: string; dateStr: string }> = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(today);
              d.setDate(today.getDate() + diffToMon + i);
              return {
                label: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i],
                dateStr: d.toISOString().slice(0, 10),
              };
            });

            // Group logs by date
            const byDate = new Map<string, typeof weeklyNutritionLogs>();
            for (const e of weeklyNutritionLogs) {
              if (!byDate.has(e.date)) byDate.set(e.date, []);
              byDate.get(e.date)!.push(e);
            }

            const calTarget = client?.dailyCalorieGoal ?? 0;
            const proTarget = client?.dailyProteinGoal ?? 0;
            const todayStr = today.toISOString().slice(0, 10);

            return (
              <div className="flex gap-1.5 mb-4">
                {weekDays.map(({ label, dateStr }) => {
                  const dayEntries = byDate.get(dateStr) ?? [];
                  const logged = dayEntries.length > 0;
                  const isFuture = dateStr > todayStr;
                  const isSelected = dateStr === selectedDate;

                  let dotColor = "bg-muted";
                  if (!isFuture && logged) {
                    if (nutritionTrackingMode === "protein_only" && proTarget > 0) {
                      const dayPro = dayEntries.reduce((s, e) => s + parseFloat((e.protein as string) ?? "0"), 0);
                      const rem = proTarget - dayPro;
                      dotColor = rem <= 0 ? "bg-emerald-500" : rem <= 20 ? "bg-amber-400" : "bg-muted-foreground/40";
                    } else if (nutritionTrackingMode === "calories" && calTarget > 0) {
                      const dayCals = dayEntries.reduce((s, e) => s + (e.calories ?? 0), 0);
                      const diff = Math.abs(dayCals - calTarget);
                      dotColor = diff <= 200 ? "bg-emerald-500" : diff <= 300 ? "bg-amber-400" : "bg-muted-foreground/40";
                    } else {
                      dotColor = "bg-emerald-500"; // logged, no target — show green
                    }
                  }

                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all ${
                        isSelected ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/60"
                      } ${isFuture ? "opacity-30" : ""}`}
                    >
                      <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
                      <div className={`w-2 h-2 rounded-full ${isFuture ? "bg-muted" : dotColor}`} />
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Daily totals / Protein-only card ─────────────────── */}
          {nutritionTrackingMode === "protein_only" ? (
            // ── Protein only mode: single focused protein card ──
            <div className="card totals-card">
              <div className="totals-section">
                <p className="totals-heading">Protein</p>
                {(() => {
                  const proGoal = client?.dailyProteinGoal ?? 0;
                  const logged = totals.protein;
                  const hasEntries = (entries?.length ?? 0) > 0;
                  if (!proGoal && !hasEntries) return (
                    <p className="meal-help-text mt-2">Set a protein goal in Goals, then log meals to track progress</p>
                  );
                  if (proGoal > 0) {
                    const rem = proGoal - logged;
                    const pct = Math.min(logged / proGoal, 1);
                    return (
                      <>
                        <div className="flex items-end gap-2 mt-1">
                          <p className="text-4xl font-black tabular-nums text-blue-500">{Math.max(0, Math.round(rem))}<span className="text-xl font-bold">g</span></p>
                          <p className="mb-1 text-sm text-muted-foreground">{rem <= 0 ? "over target" : "remaining"}</p>
                        </div>
                        <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${pct >= 1 ? "bg-emerald-500" : pct >= 0.7 ? "bg-blue-500" : "bg-blue-300"}`}
                            style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                        </div>
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {hasEntries ? `${logged.toFixed(0)}g logged of ${proGoal}g target` : "Nothing logged yet, full allowance remaining"}
                        </p>
                      </>
                    );
                  }
                  return (
                    <>
                      <p className="text-4xl font-black tabular-nums text-blue-500 mt-1">{logged.toFixed(0)}<span className="text-xl font-bold">g</span></p>
                      <p className="mt-1 text-[11px] text-muted-foreground">logged today</p>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            // ── Calories mode: existing full macro card ──
            ((entries?.length ?? 0) > 0 || (client?.dailyCalorieGoal ?? 0) > 0) && (
              <div className="card totals-card">
                {(entries?.length ?? 0) > 0 && (
                  <div className="totals-section">
                    <p className="totals-heading">Daily Totals</p>
                    <div className="totals-grid">
                      {[
                        { label: "Calories", value: Math.round(totals.calories), unit: "kcal", color: "text-orange-500" },
                        { label: "Protein",  value: totals.protein.toFixed(1),   unit: "g",    color: "text-blue-500"   },
                        { label: "Carbs",    value: totals.carbs.toFixed(1),     unit: "g",    color: "text-yellow-500" },
                        { label: "Fats",     value: totals.fats.toFixed(1),      unit: "g",    color: "text-pink-500"   },
                      ].map(({ label, value, unit, color }) => (
                        <div key={label} className="total-metric">
                          <p className={`total-value ${color}`}>{value}</p>
                          <p className="total-unit">{unit}</p>
                          <p className="total-label">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(client?.dailyCalorieGoal ?? 0) > 0 && (() => {
                  const remCal  = (client!.dailyCalorieGoal ?? 0) - Math.round(totals.calories);
                  const remPro  = (client!.dailyProteinGoal ?? 0) - totals.protein;
                  const remCarb = (client!.dailyCarbGoal ?? 0) - totals.carbs;
                  const remFat  = (client!.dailyFatGoal ?? 0) - totals.fats;
                  const remainingItems = [
                    { label: "Calories", value: Math.abs(Math.round(remCal)), unit: "kcal", over: remCal < 0 },
                    { label: "Protein",  value: Math.abs(remPro).toFixed(1),  unit: "g",    over: remPro < 0  },
                    { label: "Carbs",    value: Math.abs(remCarb).toFixed(1), unit: "g",    over: remCarb < 0 },
                    { label: "Fats",     value: Math.abs(remFat).toFixed(1),  unit: "g",    over: remFat < 0  },
                  ];
                  return (
                    <div className="totals-section">
                      <p className="totals-heading">{remainingItems.some(r => r.over) ? "Remaining / Over" : "Remaining"}</p>
                      <div className="totals-grid">
                        {remainingItems.map(({ label, value, unit, over }) => (
                          <div key={label} className="total-metric">
                            <p className={`total-value ${over ? "text-red-500" : "text-green-500"}`}>{over ? "-" : ""}{value}</p>
                            <p className="total-unit">{unit}</p>
                            <p className="total-label">{label}</p>
                          </div>
                        ))}
                      </div>
                      {(entries?.length ?? 0) === 0 && (
                        <p className="meal-help-text text-center mt-3">Nothing logged yet, full allowance remaining</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )
          )}

          {/* Add food input */}
          <div className="card meal-card">
            <p className="section-title mb-4 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Food / Meal
            </p>

            <div className="meal-input-group">
              {/* Label photo thumbnails */}
              {labelPreviews.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {labelPreviews.map((src, i) => (
                    <div key={i} className="relative inline-block">
                      <img src={src} alt={`Label ${i + 1}`} className="h-24 w-auto rounded-xl border object-cover shadow-sm" />
                      <button
                        onClick={() => removeLabelPhoto(i)}
                        className="absolute -top-2 -right-2 bg-background border rounded-full p-0.5 shadow-sm text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <div className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[10px] font-medium rounded-md px-1.5 py-0.5">
                        {i + 1}/{labelPreviews.length}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Text input */}
              <div className="relative">
                <textarea
                  value={listening ? (interim || foodInput) : foodInput}
                  onChange={e => setFoodInput(e.target.value)}
                  placeholder={
                    labelImages.length > 0
                      ? 'Add a note (optional), e.g. "2 servings" or "half a pack"'
                      : listening
                      ? "Listening…"
                      : 'e.g. "200g chicken breast, 100g basmati rice, 1 tbsp olive oil"'
                  }
                  rows={2}
                  disabled={listening}
                  className="input resize-none !min-h-[64px] pr-10"
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

              {/* Actions row */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => labelInputRef.current?.click()}
                  className={`button-secondary flex-shrink-0 gap-1.5 ${labelImages.length > 0 ? "border-primary/40 bg-primary/10 text-primary" : ""}`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  {labelImages.length > 0 ? `${labelImages.length} label${labelImages.length > 1 ? "s" : ""} added` : "Scan labels"}
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={(!foodInput.trim() && !labelImages.length) || isAdding || listening}
                  className="flex flex-1 items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-primary text-primary-foreground border border-primary hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
                </button>
              </div>

              {/* Guide toggle */}
              <button
                onClick={() => setShowGuide(g => !g)}
                className="meal-help-text flex items-center gap-1 hover:text-primary transition-colors"
              >
                <Info className="w-3 h-3" />
                Tips for accurate estimates
                {showGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showGuide && (
                <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
                  <p className="font-semibold text-foreground/70 mb-1">Always describe your quantity in <span className="text-primary">servings or grams</span>. Even grams gives a better estimate than nothing:</p>
                  <p>✅ <span className="text-foreground/80">200g chicken breast, 120g cooked white rice, 1 tbsp olive oil</span></p>
                  <p>✅ <span className="text-foreground/80">3 large scrambled eggs, 2 slices wholegrain toast, 10g butter</span></p>
                  <p>✅ <span className="text-foreground/80">McDonald's Big Mac and medium fries</span></p>
                  <p>✅ <span className="text-foreground/80">Protein shake, 1 scoop MyProtein Impact Whey, 300ml whole milk</span></p>
                  <p className="pt-1 border-t border-primary/10">📷 <strong>Scanning a label?</strong> Add a note like <em>"4 bags"</em> or <em>"120g"</em> so the AI knows your portion. Without a quantity it assumes 1 serving.</p>
                  <p className="border-t border-primary/10 pt-1">The AI shows what it assumed so you can spot any errors.</p>
                </div>
              )}
            </div>

            <input
              ref={labelInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleLabelPhoto}
            />
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
            <div className="flex flex-col gap-3">
              {entries.map((entry: NutritionEntry) => {
                const isEditing = editingEntryId === entry.id;
                return (
                  <div key={entry.id} className="card">
                    <div className="food-entry">
                      <div className="food-entry-header">
                        {isEditing ? (
                          <textarea
                            autoFocus
                            value={editDescription}
                            onChange={e => setEditDescription(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Escape") setEditingEntryId(null);
                              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveEdit(entry.id);
                            }}
                            rows={2}
                            className="flex-1 text-sm bg-muted/50 border border-primary/30 rounded-lg px-2.5 py-1.5 outline-none focus:border-primary/60 resize-none leading-snug"
                            style={{ touchAction: "manipulation" }}
                          />
                        ) : (
                          <p className="food-entry-title flex-1">{entry.description}</p>
                        )}
                        <div className="food-entry-actions">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveEdit(entry.id)}
                                className="icon-button text-green-500 hover:text-green-600"
                                title="Save"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingEntryId(null)}
                                className="icon-button hover:text-muted-foreground"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEditing(entry)}
                              className="icon-button"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!isEditing && (
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="icon-button hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="mt-2">
                          <p className="text-[10px] text-muted-foreground mb-1.5">
                            Edit description to re-parse with AI, or adjust macros directly:
                          </p>
                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: "kcal", value: editCalories, set: setEditCalories, color: "text-orange-500" },
                              { label: "P (g)", value: editProtein, set: setEditProtein, color: "text-blue-500" },
                              { label: "C (g)", value: editCarbs, set: setEditCarbs, color: "text-yellow-600" },
                              { label: "F (g)", value: editFats, set: setEditFats, color: "text-pink-500" },
                            ].map(({ label, value, set, color }) => (
                              <div key={label} className="flex flex-col gap-0.5">
                                <label className={`text-[10px] font-semibold ${color}`}>{label}</label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={value}
                                  onChange={e => set(e.target.value)}
                                  className="w-full text-xs bg-muted/50 border border-muted rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 text-center"
                                  onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(entry.id); if (e.key === "Escape") setEditingEntryId(null); }}
                                  style={{ touchAction: "manipulation" }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        entry.calories !== null && (
                          <div className="food-entry-badges">
                            <span className="badge text-orange-500 bg-orange-50">{entry.calories} kcal</span>
                            {entry.protein && <span className="badge text-blue-500 bg-blue-50">P: {parseFloat(entry.protein).toFixed(1)}g</span>}
                            {entry.carbs   && <span className="badge text-yellow-600 bg-yellow-50">C: {parseFloat(entry.carbs).toFixed(1)}g</span>}
                            {entry.fats    && <span className="badge text-pink-500 bg-pink-50">F: {parseFloat(entry.fats).toFixed(1)}g</span>}
                          </div>
                        )
                      )}

                      {!isEditing && entry.aiNote && (
                        <p className="food-entry-note">AI assumed: {entry.aiNote}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Protein only confirmation modal ───────────────────── */}
          <Dialog open={pendingModeSwitch === "protein_only"} onOpenChange={open => { if (!open) setPendingModeSwitch(null); }}>
            <DialogContent className="max-w-sm rounded-2xl">
              <DialogHeader>
                <DialogTitle>Switch to Protein only?</DialogTitle>
                <DialogDescription className="pt-1 space-y-2 text-sm text-muted-foreground leading-relaxed">
                  <span className="block">This will simplify nutrition tracking to protein only.</span>
                  <span className="block">Calories, carbs, and fats will no longer be shown as active targets on this screen.</span>
                  <span className="block">Your nutrition score will be based on protein logging only.</span>
                  <span className="block text-[11px] opacity-70">Your existing nutrition history is not deleted. Only the active display and scoring changes.</span>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-col gap-2 sm:flex-row pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setPendingModeSwitch(null)}>Cancel</Button>
                <Button className="flex-1" onClick={confirmModeSwitch}>Switch to Protein only</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        </div>
      )}

      {/* IRL Sessions Tab */}
      {!isTeamMode && activeTab === "irl" && mode === "client" && isIrlEnabled && (
        <div className="flex-1 flex flex-col overflow-y-auto px-4 py-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-base">IRL Sessions</h2>
              <p className="text-muted-foreground text-xs mt-0.5">Book in-person coaching sessions with your coach</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Credits</div>
                <div className="text-xl font-bold text-primary">{irlBalance}</div>
              </div>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {(["book", "my-bookings", "credits"] as const).map(t => (
              <button key={t} onClick={() => setIrlSubTab(t)}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${irlSubTab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {t === "book" ? "Book" : t === "my-bookings" ? "My Bookings" : "Credits"}
              </button>
            ))}
          </div>

          {/* Book a slot */}
          {irlSubTab === "book" && (
            <div className="space-y-3">
              {irlBalance === 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  You have no IRL credits. Contact your coach to add credits before booking.
                </div>
              )}
              {irlSlots.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No sessions available right now. Check back soon.
                </div>
              ) : (
                irlSlots.map(slot => (
                  <div key={slot.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">
                          {new Date(slot.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                        </div>
                        <div className="text-muted-foreground text-xs mt-0.5">
                          {slot.startTime} – {slot.endTime} · 60 min
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={irlBalance < 1 || bookingLoading}
                        onClick={() => setPendingBookSlot({ id: slot.id, date: slot.date, startTime: slot.startTime, credits: 1 })}
                        className="shrink-0"
                      >
                        {bookingLoading && bookingSlotId === slot.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Book"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* My bookings */}
          {irlSubTab === "my-bookings" && (
            <div className="space-y-3">
              {irlBookings.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No bookings yet.
                </div>
              ) : (
                irlBookings.map(({ booking, slot }) => {
                  const isPast = slot ? new Date(slot.date + "T" + (slot.endTime ?? "23:59") + ":00") < new Date() : false;
                  const canCancel = booking.status === "confirmed" && !isPast;
                  return (
                    <div key={booking.id} className={`rounded-xl border p-4 ${booking.status === "cancelled" ? "opacity-50" : ""}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {slot ? new Date(slot.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "Session"}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${booking.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : booking.status === "cancelled" ? "bg-red-100 text-red-700" : booking.status === "completed" ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                              {booking.status}
                            </span>
                            {booking.creditRefunded && <span className="text-xs text-muted-foreground">(credit refunded)</span>}
                          </div>
                          {slot && (
                            <div className="text-muted-foreground text-xs mt-0.5">
                              {slot.startTime} – {slot.endTime}
                            </div>
                          )}
                          <div className="text-muted-foreground text-xs mt-0.5">
                            {booking.creditsUsed} credit · booked {new Date(booking.createdAt).toLocaleDateString("en-GB")}
                          </div>
                        </div>
                        {canCancel && (
                          cancellingBookingId === booking.id ? (
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="text-xs text-red-600 border-red-300" onClick={async () => {
                                const r = await fetch(`/api/irl-bookings/${booking.id}/cancel`, { method: "POST", headers: getIrlHeaders() });
                                const d = await r.json();
                                if (!r.ok) toast({ title: "Error", description: d.error, variant: "destructive" });
                                else { toast({ title: "Cancelled", description: d.creditRefunded ? "Credit refunded." : "No refund, cancelled within 24h." }); await fetchIrlData(); }
                                setCancellingBookingId(null);
                              }}>Confirm cancel</Button>
                              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setCancellingBookingId(null)}>Keep</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCancellingBookingId(booking.id)}>Cancel</Button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Credits history */}
          {irlSubTab === "credits" && (
            <div className="space-y-3">
              <div className="rounded-xl border bg-card p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Current balance</div>
                  <div className="text-3xl font-bold text-primary mt-0.5">{irlBalance}</div>
                  <div className="text-xs text-muted-foreground mt-1">credits</div>
                </div>
              </div>
              {irlLedger.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No transactions yet</div>
              ) : (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-2">Transaction history</div>
                  {irlLedger.map(e => (
                    <div key={e.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <div>
                        <span className={`font-semibold mr-1.5 ${e.delta > 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {e.delta > 0 ? `+${e.delta}` : e.delta}
                        </span>
                        <span className="text-muted-foreground text-xs">{e.type.replace(/_/g, " ")}</span>
                        {e.note && <span className="ml-1 text-muted-foreground/60 text-xs">— {e.note}</span>}
                      </div>
                      <span className="text-muted-foreground text-xs shrink-0 ml-2">{new Date(e.createdAt).toLocaleDateString("en-GB")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Training Tab */}
      {(isTeamMode || activeTab === "training") && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Calendar toolbar */}
          <div className="shrink-0 px-4 py-3 border-b flex items-center justify-between gap-2 bg-background">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => setTrainingWeekOffset(w => w - (calendarView === "week" ? 1 : 4))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-3 text-xs rounded-md" onClick={() => setTrainingWeekOffset(0)}>
                  Today
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => setTrainingWeekOffset(w => w + (calendarView === "week" ? 1 : 4))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <div className="tabs">
                <button onClick={() => setCalendarView("month")} className={`tab${calendarView === "month" ? " active" : ""}`}>Month</button>
                <button onClick={() => setCalendarView("week")} className={`tab${calendarView === "week" ? " active" : ""}`}>Week</button>
              </div>
              <Button
                size="sm"
                variant={selectionMode ? "default" : "outline"}
                className={`h-7 px-2.5 text-xs rounded-lg gap-1 ${selectionMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                title="Select sessions to shift by week"
              >
                <MousePointer2 className="w-3 h-3" />
                <span className="hidden sm:inline">{selectionMode ? "Cancel" : "Select"}</span>
              </Button>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Undo / Redo */}
              <div className="flex items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-md text-muted-foreground"
                  onClick={() => void undo()}
                  disabled={calHistory.length === 0}
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-md text-muted-foreground"
                  onClick={() => void redo()}
                  disabled={calFuture.length === 0}
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-xl text-xs h-8 px-2.5 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => { setBrainResults([]); setBrainQuery(""); setBrainIntent(null); setBrainOpen(true); }}
                title="Browse programme library"
              >
                <BookMarked className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Library</span>
              </Button>
            </div>
          </div>

          {/* ── Ask your coach ─────────────────────────────────────── */}
          <div className="shrink-0 px-4 pt-3 pb-2 border-b bg-background flex flex-col gap-2">
            {/* Empty-calendar nudge — shown only when no sessions exist and bar is idle */}
            {(() => {
              const isBarIdle = !cmdInput && !pendingReschedule && !pendingBulkDelete && !pendingCommand;
              const totalSessions = (clientProgrammes ?? []).flatMap(p => p.sessions as Session[]).length;
              if (!isBarIdle || totalSessions > 0) return null;
              return (
                <p className="text-xs text-muted-foreground/60 text-center pb-0.5">
                  Your training calendar is empty. Tell me what you're training for and I'll build your first month.
                </p>
              );
            })()}
            {/* Quick action chips — shown when idle */}
            {!cmdInput && !pendingReschedule && !pendingBulkDelete && !pendingCommand && (
              <div className="flex flex-wrap gap-1.5">
                {(["Build my plan", "Add a session", "What should I work on?", "Review my week"] as const).map(chip => (
                  <button
                    key={chip}
                    onClick={() => setCmdInput(chip)}
                    className="text-[11px] px-2.5 py-1 rounded-lg border bg-muted/40 hover:bg-muted transition-colors text-muted-foreground"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            {/* Input row */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cmdListening ? (cmdInterim || cmdInput) : cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleCoachInput(); }}
                placeholder="Ask Phil: plan, adjust, progress or review your training…"
                disabled={cmdListening || cmdParsing}
                className="flex-1 text-sm text-foreground bg-muted/30 border rounded-xl px-3.5 py-2 outline-none placeholder:text-muted-foreground/50 focus:border-primary/40 focus:bg-background transition-colors"
              />
              <button
                type="button"
                onClick={toggleCmdListening}
                title={cmdListening ? "Stop listening" : "Voice input"}
                className={`p-2 rounded-xl transition-colors shrink-0 ${cmdListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
              >
                {cmdListening
                  ? <><Square className="w-3.5 h-3.5" /><span className="sr-only">Stop</span></>
                  : <><Mic className="w-3.5 h-3.5" /><span className="sr-only">Voice</span></>
                }
              </button>
              <Button
                size="sm"
                className="rounded-xl h-9 px-3 shrink-0"
                onClick={() => void handleCoachInput()}
                disabled={!cmdInput.trim() || cmdParsing}
              >
                {cmdParsing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <ChevronRight className="w-3.5 h-3.5" />
                }
              </Button>
              <button
                type="button"
                onClick={() => setPhilOpen(v => !v)}
                title={philOpen ? "Close Phil" : "Open Phil chat"}
                className={`p-2 rounded-xl transition-colors shrink-0 ${philOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
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
            {pendingCommand && (
              <div className="flex items-center justify-between gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                <p className="text-xs text-violet-900 leading-snug flex-1">
                  <strong>{pendingCommand.description}</strong>. Affects {pendingCommand.changes.length} programme{pendingCommand.changes.length !== 1 ? "s" : ""}. Confirm?
                </p>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" className="h-6 px-2 text-xs bg-violet-600 hover:bg-violet-700 text-white" onClick={applyCommand} disabled={cmdSaving}>
                    {cmdSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPendingCommand(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Calendar grid */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <div className={calendarView === "week" ? "min-w-[560px]" : "min-w-[560px]"}>
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b bg-muted/30 sticky top-0 z-10">
                {(calendarView === "week" ? trainingWeeks[0] : ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]).map((d, i) => (
                  <div key={i} className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {calendarView === "week"
                      ? <><span className="block">{format(d as Date, "EEE")}</span><span className={`block text-sm font-bold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full mx-auto ${isSameDay(d as Date, new Date()) ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{format(d as Date, "d")}</span></>
                      : d as string
                    }
                  </div>
                ))}
              </div>
              {trainingWeeks.map((week, wi) => (
                <div key={wi} className={`calendar-grid grid-cols-7 border-b ${calendarView === "week" ? "min-h-[calc(100vh-280px)]" : ""}`}>
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
                        className={`calendar-cell transition-colors ${isDropTarget ? "!bg-primary/10 ring-2 ring-inset ring-primary/30" : ""} ${calendarView === "week" ? "!min-h-[calc(100vh-280px)]" : ""} ${pasteMode ? "cursor-copy hover:!bg-emerald-50 hover:ring-2 hover:ring-inset hover:ring-emerald-400/50" : ""}`}
                        onPointerDown={() => { cellPointerMovedRef.current = false; }}
                        onPointerMove={() => { cellPointerMovedRef.current = true; }}
                        onPointerUp={() => {
                          if (cellPointerMovedRef.current) return;
                          if (pasteMode) { void pasteToDate(dateStr); return; }
                          if (isDragActiveRef.current) return;
                          setQuickAddDate(dateStr);
                          setQuickAddName("");
                          setQuickAddDesc("");
                          setQuickAddError("");
                          setQuickAddOpen(true);
                        }}
                        onDragOver={e => { e.preventDefault(); setDragOverDate(dateStr); }}
                        onDragLeave={() => setDragOverDate(null)}
                        onDrop={e => {
                          e.preventDefault();
                          setDragOverDate(null);
                          const item = draggedItemRef.current;
                          if (item) {
                            if (item.isGroupDrag && item.originalDate) {
                              void moveGroupSessions(item.originalDate, dateStr);
                            } else {
                              moveSession(item.sessionId, item.programmeId, dateStr);
                            }
                            draggedItemRef.current = null;
                          }
                        }}
                      >
                        {calendarView === "month" ? (
                          <div className="flex items-center justify-between">
                            <div className={`calendar-day w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : ""}`}>
                              {format(day, "d")}
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); setQuickAddDate(dateStr); setQuickAddName(""); setQuickAddDesc(""); setQuickAddError(""); setQuickAddOpen(true); }}
                              className="w-5 h-5 flex items-center justify-center rounded text-primary/60 hover:text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors"
                              title="Add session"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        ) : null}
                        <div className="flex flex-col gap-1">
                          {daySessions.map(session => {
                            const prog = (clientProgrammes ?? []).find(p =>
                              (p.sessions as Session[]).some(s => s.id === session.id)
                            );
                            const isTouchPicked = touchDraggingActive && touchDragRef.current?.sessionId === session.id;
                            const highlight = getSessionHighlight(session);
                            const isSelected = selectedSessionIds.has(session.id);
                            const teamMeta = isTeamMode ? teamSessionsMetaRef.current.get(session.id) : undefined;
                            const isPublished = teamMeta?.status === "published";
                            return (
                              <div
                                key={session.id}
                                draggable={(!selectionMode || isSelected) && !isPublished}
                                onDragStart={() => {
                                  if (selectionMode && isSelected) {
                                    draggedItemRef.current = { sessionId: session.id, programmeId: prog?.id ?? 0, isGroupDrag: true, originalDate: dateStr };
                                  } else if (!selectionMode && prog) {
                                    draggedItemRef.current = { sessionId: session.id, programmeId: prog.id };
                                  }
                                }}
                                onDragEnd={() => { draggedItemRef.current = null; setDragOverDate(null); }}
                                onTouchStart={e => {
                                  const touch = e.touches[0];
                                  touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
                                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                  if (selectionMode && isSelected && prog) {
                                    // Long-press on selected session = group drag
                                    longPressTimerRef.current = setTimeout(() => {
                                      touchDragRef.current = { sessionId: session.id, programmeId: prog.id, isGroupDrag: true, originalDate: dateStr };
                                      isDragActiveRef.current = true;
                                      setTouchDraggingActive(true);
                                      const count = selectedSessionIds.size;
                                      setTouchGhostLabel(count > 1 ? `${count} sessions` : session.name || "Session");
                                      setTouchGhostPos({ x: touch.clientX, y: touch.clientY });
                                      if (navigator.vibrate) navigator.vibrate(50);
                                    }, 450);
                                  } else if (!selectionMode && prog) {
                                    longPressTimerRef.current = setTimeout(() => {
                                      touchDragRef.current = { sessionId: session.id, programmeId: prog.id };
                                      isDragActiveRef.current = true;
                                      setTouchDraggingActive(true);
                                      setTouchGhostLabel(session.name || "Session");
                                      setTouchGhostPos({ x: touch.clientX, y: touch.clientY });
                                      if (navigator.vibrate) navigator.vibrate(50);
                                    }, 450);
                                  }
                                }}
                                onTouchMove={e => {
                                  // Block scroll if we're in an active drag
                                  if (!isDragActiveRef.current && selectionMode && !isSelected) return;
                                  const t = e.touches[0];
                                  const start = touchStartPosRef.current;
                                  if (!start) return;
                                  const moved = Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y);
                                  if (!isDragActiveRef.current) {
                                    if (moved > 10 && longPressTimerRef.current) {
                                      clearTimeout(longPressTimerRef.current);
                                      longPressTimerRef.current = null;
                                    }
                                    return;
                                  }
                                  setTouchGhostPos({ x: t.clientX, y: t.clientY });
                                  const el = document.elementFromPoint(t.clientX, t.clientY);
                                  const cell = el?.closest("[data-date]") as HTMLElement | null;
                                  setTouchDragOverDate(cell?.dataset.date ?? null);
                                }}
                                onTouchEnd={e => {
                                  if (longPressTimerRef.current) {
                                    clearTimeout(longPressTimerRef.current);
                                    longPressTimerRef.current = null;
                                  }
                                  if (isDragActiveRef.current) {
                                    // Drop on target cell
                                    const t = e.changedTouches[0];
                                    const el = document.elementFromPoint(t.clientX, t.clientY);
                                    const cell = el?.closest("[data-date]") as HTMLElement | null;
                                    const dropDate = cell?.dataset.date;
                                    const item = touchDragRef.current;
                                    if (dropDate && item) {
                                      if (item.isGroupDrag && item.originalDate) {
                                        void moveGroupSessions(item.originalDate, dropDate);
                                      } else {
                                        moveSession(item.sessionId, item.programmeId, dropDate);
                                      }
                                    }
                                    touchDragRef.current = null;
                                    isDragActiveRef.current = false;
                                    setTouchDraggingActive(false);
                                    setTouchGhostPos(null);
                                    setTouchDragOverDate(null);
                                    return;
                                  }
                                  if (selectionMode) {
                                    // Short tap toggles selection
                                    const t = e.changedTouches[0];
                                    const start = touchStartPosRef.current;
                                    const moved = start ? Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y) : 0;
                                    if (moved < 10) {
                                      e.preventDefault();
                                      toggleSelectSession(session.id);
                                    }
                                    return;
                                  }
                                  // Short tap — open session
                                  const t = e.changedTouches[0];
                                  const start = touchStartPosRef.current;
                                  const moved = start ? Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y) : 0;
                                  if (moved < 10) {
                                    if (prog) {
                                      if (mode === "client") {
                                        setLocation(`/client/programmes/${prog.id}/sessions/${session.id}`);
                                      } else {
                                        sessionStorage.setItem("session_editor_returnTo", `/clients/${clientId}`);
                                        setLocation(`/programmes/${prog.id}/sessions/${session.id}`);
                                      }
                                    }
                                  }
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (pasteMode) {
                                    void pasteToDate(dateStr);
                                    return;
                                  }
                                  if (selectionMode) {
                                    toggleSelectSession(session.id);
                                    return;
                                  }
                                  if (isDragActiveRef.current) return;
                                  if (isPublished) return; // published team sessions are read-only
                                  if (prog) {
                                    if (mode === "client") {
                                      setLocation(`/client/programmes/${prog.id}/sessions/${session.id}`);
                                    } else {
                                      sessionStorage.setItem("session_editor_returnTo", `/clients/${clientId}`);
                                      setLocation(`/programmes/${prog.id}/sessions/${session.id}`);
                                    }
                                  }
                                }}
                                className={`calendar-item relative group w-full text-left select-none transition-all ${isPublished ? "cursor-default opacity-80" : "cursor-pointer"} ${calendarView === "week" ? `!whitespace-normal !px-2.5 !py-2 !text-[11px] !rounded-md !overflow-visible ${isPublished ? "!bg-emerald-500/15 !text-emerald-800 dark:!text-emerald-300 hover:!bg-emerald-500/20" : "!bg-primary/10 !text-primary hover:!bg-primary/20"}` : ""} ${isTouchPicked ? "opacity-50 scale-95 ring-2 ring-primary/50 ring-offset-1" : ""} ${isSelected ? "!ring-2 !ring-primary !ring-offset-1 !bg-primary/20" : ""}`}
                              >
                                {selectionMode && (
                                  <span className="absolute top-0.5 left-0.5 z-10 pointer-events-none">
                                    {isSelected
                                      ? <CheckSquare className="w-3 h-3 text-primary" />
                                      : <Square className="w-3 h-3 text-primary/40" />
                                    }
                                  </span>
                                )}
                                {!selectionMode && (
                                  <div
                                    className="absolute top-0.5 right-0.5 z-20"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                          tabIndex={-1}
                                        >
                                          <MoreVertical className="w-3 h-3" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-48" onClick={e => e.stopPropagation()}>
                                        {showPublishOpts && (
                                          <>
                                            {!isPublished ? (
                                              <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                                                <Globe className="w-3.5 h-3.5 mr-2" />Publish
                                              </DropdownMenuItem>
                                            ) : (
                                              <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                                                <EyeOff className="w-3.5 h-3.5 mr-2" />Unpublish
                                              </DropdownMenuItem>
                                            )}
                                            <DropdownMenuSeparator />
                                          </>
                                        )}
                                        <DropdownMenuItem onClick={() => {
                                          if (!prog) return;
                                          if (mode === "client") {
                                            setLocation(`/client/programmes/${prog.id}/sessions/${session.id}`);
                                          } else {
                                            sessionStorage.setItem("session_editor_returnTo", `/clients/${clientId}`);
                                            setLocation(`/programmes/${prog.id}/sessions/${session.id}`);
                                          }
                                        }}>
                                          <Pencil className="w-3.5 h-3.5 mr-2" />Edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                                          <RefreshCw className="w-3.5 h-3.5 mr-2" />Repeat
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                                          <TrendingUp className="w-3.5 h-3.5 mr-2" />Repeat with Progression
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                                          <BookMarked className="w-3.5 h-3.5 mr-2" />Save to Library
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => copyOneSession(session)}>
                                          <Copy className="w-3.5 h-3.5 mr-2" />Copy
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-red-600 focus:text-red-600"
                                          onClick={() => void deleteOneSession(session)}
                                        >
                                          <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                )}
                                {calendarView === "month" ? (
                                  <>
                                    {(() => {
                                      const badge = getSessionTypeBadge(session);
                                      return (
                                        <span className={`inline-block text-[8px] font-semibold leading-none px-1.5 py-0.5 rounded-full mb-2 ${badge.className} ${selectionMode ? "ml-4" : ""}`}>{badge.label}</span>
                                      );
                                    })()}
                                    <span className={`block truncate font-medium text-[10px] leading-snug ${selectionMode ? "pl-4" : "pr-1"}`}>{session.name || "Session"}</span>
                                    {isTeamMode && teamMeta && (
                                      <span className={`inline-block text-[7px] font-bold leading-none px-1 py-0.5 rounded-full ${isPublished ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                        {isPublished ? "PUBLISHED" : "DRAFT"}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className="block font-semibold pr-5 leading-snug mb-1 line-clamp-2">{session.name || "Session"}</span>
                                    {/* Team mode: Draft/Published badge + actions */}
                                    {isTeamMode && teamMeta && (
                                      <div className="flex items-center gap-1 mb-1.5">
                                        {isPublished ? (
                                          <>
                                            <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                              <Check className="w-2 h-2" />PUBLISHED
                                            </span>
                                            <button
                                              onClick={e => { e.stopPropagation(); void handleViewTeamCopies(teamMeta.dbId, session.name || "Session"); }}
                                              className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                            >
                                              <Eye className="w-2 h-2" />Copies
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                              <Pencil className="w-2 h-2" />DRAFT
                                            </span>
                                            <button
                                              onClick={e => {
                                                e.stopPropagation();
                                                setTeamPublishConfirm({ sessionId: session.id, dbId: teamMeta.dbId });
                                              }}
                                              className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                                            >
                                              <Send className="w-2 h-2" />Publish
                                            </button>
                                          </>
                                        )}
                                        {isPublished && <Lock className="w-2.5 h-2.5 opacity-50 shrink-0" />}
                                      </div>
                                    )}
                                    {(session.source === "wod_brain" || session.source === "run_brain" || session.source === "cycle_brain" || session.source === "swim_brain") && session.structure && (
                                      <p className={`text-[10px] leading-snug mb-1 line-clamp-2 ${isTouchPicked ? "opacity-90" : "opacity-70"}`}>{session.structure}</p>
                                    )}
                                    {(session.exercises ?? []).length > 0 && (
                                      <ul className="space-y-0.5">
                                        {(session.exercises ?? []).slice(0, 4).map(ex => (
                                          <li key={ex.id} className={`text-[10px] leading-snug truncate ${isTouchPicked ? "opacity-90" : "opacity-75"}`}>
                                            {ex.name}
                                          </li>
                                        ))}
                                        {(session.exercises ?? []).length > 4 && (
                                          <li className={`text-[10px] leading-snug ${isTouchPicked ? "opacity-60" : "opacity-40"}`}>+{(session.exercises ?? []).length - 4} more</li>
                                        )}
                                      </ul>
                                    )}
                                    {!isTeamMode && prog && (
                                      <p className={`mt-1.5 text-[9px] uppercase tracking-wide truncate ${isTouchPicked ? "opacity-60" : "opacity-40"}`}>{prog.title}</p>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {calendarView === "week" && !pasteMode && (
                          <button
                            onClick={e => { e.stopPropagation(); setQuickAddDate(dateStr); setQuickAddName(""); setQuickAddDesc(""); setQuickAddError(""); setQuickAddOpen(true); }}
                            className="mt-1.5 w-full flex items-center justify-center gap-1 py-1.5 rounded-lg border border-dashed border-primary/30 text-primary/60 hover:text-primary hover:bg-primary/8 hover:border-primary/50 active:bg-primary/15 transition-colors text-[11px]"
                            title="Add session"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </button>
                        )}
                        {pasteMode && (
                          <button
                            onClick={e => { e.stopPropagation(); void pasteToDate(dateStr); }}
                            className="mt-1.5 w-full flex items-center justify-center gap-1 py-2 rounded-lg border border-dashed border-emerald-400 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200 transition-colors text-[11px] font-medium"
                            title="Paste sessions here"
                          >
                            <Clipboard className="w-3 h-3" />
                            <span>Paste here</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Phil Chat Panel — global bottom drawer (all tabs) ────────────────── */}
      {(
        <div className={`shrink-0 overflow-hidden border-t bg-background transition-all duration-300 ease-in-out ${
          (activeTab === "training" || isTeamMode)
            ? (philOpen ? "h-[300px]" : "h-0")
            : (philExpanded ? "h-[300px]" : "h-14")
        }`}>

          {/* ── Slim bar (non-training, collapsed) ── */}
          {activeTab !== "training" && !isTeamMode && !philExpanded && (
            <div className="h-14 flex items-center gap-2.5 px-3">
              <button
                type="button"
                className="relative shrink-0"
                onClick={() => { setPhilExpanded(true); setPhilUnread(false); setTimeout(() => philInputRef.current?.focus(), 50); }}
                title="Open Phil"
              >
                <img src="/phil.png" alt="Phil" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                {philUnread && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-background" />
                )}
              </button>
              <input
                ref={philInputRef}
                value={philPanelInput}
                onChange={e => setPhilPanelInput(e.target.value)}
                onFocus={() => { setPhilExpanded(true); setPhilUnread(false); }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handlePhilPanelSubmit(); } }}
                placeholder="Message Phil…"
                className="flex-1 min-w-0 h-9 rounded-xl border bg-muted/30 px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => void handlePhilPanelSubmit()}
                disabled={!philPanelInput.trim() || cmdParsing}
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* ── Expanded panel (non-training expanded, or training open, or team mode) ── */}
          {(philExpanded || activeTab === "training" || isTeamMode) && (
            <div className="h-[300px] flex flex-col">
              {/* Header */}
              <div className="shrink-0 px-4 py-2.5 border-b flex items-center justify-between bg-muted/20">
                <div className="flex items-center gap-2">
                  <img src="/phil.png" alt="Phil" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                  <div>
                    <p className="text-sm font-semibold leading-none">Phil</p>
                    <p className="text-[11px] text-muted-foreground">MG Coaching</p>
                  </div>
                </div>
                {(activeTab === "training" || isTeamMode) ? (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPhilOpen(false)} title="Close">
                    <X className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPhilExpanded(false)} title="Minimise">
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                )}
              </div>
              {/* Messages */}
              <div ref={philScrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
                {philMessages.length === 0 && !cmdParsing && (
                  <p className="text-xs text-muted-foreground text-center mt-6">Ask Phil anything.</p>
                )}
                {philMessages.map(msg => (
                  <div key={msg.id} className={`flex gap-2 ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.sender === "phil" && (
                      <img src="/phil.png" alt="Phil" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, marginTop: 2 }} />
                    )}
                    <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${msg.sender === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                      {msg.text && <p className="whitespace-pre-wrap leading-snug">{msg.text}</p>}
                      {/* Build-this button when Phil has gathered enough plan context */}
                      {msg.coachParseData?.hasEnough && (
                        <Button
                          size="sm"
                          className="mt-2 h-7 px-3 text-xs w-full"
                          disabled={cmdParsing}
                          onClick={() => { setCoachParseResult(msg.coachParseData!); handleBuildFromParse(); }}
                        >
                          Build this
                        </Button>
                      )}
                      {/* Save a single generated session */}
                      {msg.action?.type === "save_session" && (
                        <Button
                          size="sm"
                          className="mt-2 h-7 px-3 text-xs w-full"
                          disabled={!!savingAiSession}
                          onClick={() => void saveSessionDirectly((msg.action as any).session, (msg.action as any).date)}
                        >
                          {savingAiSession ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                          Save to calendar. {format(parseISO((msg.action as any).date), "EEE d MMM")}
                        </Button>
                      )}
                      {/* WOD option picker */}
                      {msg.action?.type === "pick_wod" && (
                        <div className="mt-2 space-y-1.5">
                          {(msg.action as any).options.map((opt: any, i: number) => (
                            <button
                              key={i}
                              className="w-full text-left rounded-lg border bg-background px-2.5 py-2 text-xs hover:border-primary/40 transition-colors disabled:opacity-50"
                              disabled={!!savingAiSession}
                              onClick={() => void saveSessionDirectly(opt, (msg.action as any).date)}
                            >
                              <span className="font-semibold text-primary/70 mr-1.5">
                                {opt.format === "emom" ? "EMOM" : opt.format === "amrap" ? "AMRAP" : opt.format === "for_time" ? "For Time" : "WOD"}
                              </span>
                              <span>{opt.name || `Option ${i + 1}`}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {cmdParsing && (
                  <div className="flex gap-2 justify-start">
                    <img src="/phil.png" alt="Phil" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, marginTop: 2 }} />
                    <div className="bg-muted rounded-2xl px-3 py-2.5">
                      <div className="flex gap-1 items-center h-4">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Input */}
              <div className="shrink-0 px-3 py-2.5 border-t">
                <div className="flex gap-2">
                  <input
                    ref={philInputRef}
                    value={philPanelInput}
                    onChange={e => setPhilPanelInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handlePhilPanelSubmit(); } }}
                    placeholder="Message Phil…"
                    className="flex-1 min-w-0 h-8 rounded-lg border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => void handlePhilPanelSubmit()}
                    disabled={!philPanelInput.trim() || cmdParsing}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* Multi-select action bar — fixed bottom */}
      {selectionMode && (
        <div className="fixed bottom-0 inset-x-0 z-50 bg-card border-t shadow-xl px-4 py-3 flex items-center justify-between gap-3">
          {pasteMode ? (
            /* Paste mode — waiting for day tap */
            <>
              <div className="flex items-center gap-2 min-w-0">
                <Clipboard className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-sm font-medium truncate text-emerald-700">
                  Tap any day to paste {sessionClipboard?.sessions.length ?? 0} session{(sessionClipboard?.sessions.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-3 text-xs rounded-lg text-muted-foreground shrink-0"
                onClick={exitSelectionMode}
              >
                Cancel
              </Button>
            </>
          ) : (
            /* Selection mode — pick sessions, then shift or copy */
            <>
              <div className="flex items-center gap-2 min-w-0">
                <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">
                  {selectedSessionIds.size === 0
                    ? "Tap sessions to select"
                    : `${selectedSessionIds.size} session${selectedSessionIds.size > 1 ? "s" : ""} selected`}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs rounded-lg gap-1.5"
                      disabled={selectedSessionIds.size === 0}
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                      Actions
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {showPublishOpts && (
                      <>
                        <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                          <Globe className="w-3.5 h-3.5 mr-2" />Publish All
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                          <EyeOff className="w-3.5 h-3.5 mr-2" />Unpublish All
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                      <RefreshCw className="w-3.5 h-3.5 mr-2" />Repeat
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                      <TrendingUp className="w-3.5 h-3.5 mr-2" />Repeat with Progression
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toast({ title: "Coming soon" })}>
                      <BookMarked className="w-3.5 h-3.5 mr-2" />Save to Library
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={copySelectedSessions}>
                      <Copy className="w-3.5 h-3.5 mr-2" />Copy
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600 focus:text-red-600"
                      onClick={() => void deleteSelectedSessions()}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />Delete All
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-xs rounded-lg text-muted-foreground"
                  onClick={exitSelectionMode}
                >
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Touch drag ghost — fixed, follows finger */}
      {touchDraggingActive && touchGhostPos && (
        <div
          style={{
            position: "fixed",
            left: touchGhostPos.x - 60,
            top: touchGhostPos.y - 28,
            zIndex: 9999,
            pointerEvents: "none",
            transform: "rotate(-2deg) scale(1.08)",
          }}
          className="bg-primary text-primary-foreground text-[11px] font-semibold px-3 py-1.5 rounded-lg shadow-2xl max-w-[140px] truncate"
        >
          {touchGhostLabel}
        </div>
      )}

      {/* IRL Booking Confirmation Modal */}
      <Dialog open={!!pendingBookSlot} onOpenChange={open => { if (!open) setPendingBookSlot(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm your booking</DialogTitle>
          </DialogHeader>
          {pendingBookSlot && (
            <div className="space-y-1 py-1">
              <p className="text-sm font-medium">
                {new Date(pendingBookSlot.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} at {pendingBookSlot.startTime}
              </p>
              <p className="text-sm text-muted-foreground">
                {pendingBookSlot.credits} credit will be deducted from your account.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setPendingBookSlot(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={bookingLoading}
              onClick={async () => {
                if (!pendingBookSlot) return;
                setBookingLoading(true);
                setBookingSlotId(pendingBookSlot.id);
                setPendingBookSlot(null);
                try {
                  const r = await fetch("/api/irl-bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...getIrlHeaders() },
                    body: JSON.stringify({ slotId: pendingBookSlot.id }),
                  });
                  const data = await r.json();
                  if (!r.ok) { toast({ title: "Booking failed", description: data.error, variant: "destructive" }); }
                  else { toast({ title: "Booked!", description: "Your session has been confirmed." }); await fetchIrlData(); setIrlSubTab("my-bookings"); }
                } finally { setBookingLoading(false); setBookingSlotId(null); }
              }}
            >
              {bookingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirm booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Build Your Plan Dialog — removed; Phil handles all plan/session building conversationally */}
      {false && <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent className="max-w-md max-h-[92dvh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Build Your Plan
            </DialogTitle>
            <DialogDescription className="sr-only">Build a session or programme using AI for {client?.name ?? "this client"}</DialogDescription>
          </DialogHeader>

          {/* Mode toggle — Session vs Programme */}
          {!describeGenerating && !generatedPreview && (
            <div className="flex rounded-xl overflow-hidden border border-muted p-0.5 gap-0.5 bg-muted/30 shrink-0">
              {(["session", "programme"] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setAiMode(m); setQuickAddError(""); }}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${aiMode === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "session" ? "Single Session" : "Full Programme"}
                </button>
              ))}
            </div>
          )}

          {/* Scrollable content — footer is pinned below, never clipped */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 py-1 pb-6" style={{ WebkitOverflowScrolling: "touch" }}>

              {/* ── SINGLE SESSION MODE ── */}
              {aiMode === "session" && (
                <>
                  {/* Session type selector */}
                  <div className="flex rounded-xl overflow-hidden border border-muted p-0.5 gap-0.5 bg-muted/30">
                    {(["strength", "wod", "run"] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setQuickAddType(t)}
                        className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${quickAddType === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {t === "strength" ? "Strength" : t === "wod" ? "WOD" : "Run"}
                      </button>
                    ))}
                  </div>

                  {/* Optional name */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Session name <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <Input
                      placeholder={quickAddType === "wod" ? "e.g. Thursday Metcon" : quickAddType === "run" ? "e.g. Tuesday Tempo" : "e.g. Lower Body Day"}
                      value={quickAddName}
                      onChange={e => setQuickAddName(e.target.value)}
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      {quickAddType === "wod" ? "WOD description" : quickAddType === "run" ? "Run description" : "What are you working with?"}
                    </label>
                    <div className="relative">
                      <textarea
                        className={`w-full min-h-[110px] rounded-xl border bg-background px-3 py-2.5 pr-10 text-sm resize-none focus:outline-none focus:ring-2 placeholder:text-muted-foreground transition-all ${quickAddListening ? "ring-2 ring-red-400/50 border-red-300" : "focus:ring-primary/40"}`}
                        placeholder={
                          quickAddType === "wod"
                            ? "e.g. 30 min AMRAP: 10 burpees, 15 box jumps, 20 wall balls. I have a 24kg KB."
                            : quickAddType === "run"
                            ? "e.g. 45 min steady run, 4×500m with 90s rest, 5km time trial"
                            : "e.g. I have 30 mins, 22.5kg dumbbells, and can run 500m laps. Build me a full-body circuit."
                        }
                        value={quickAddListening ? (quickAddInterim || quickAddDesc) : quickAddDesc}
                        onChange={e => { if (!quickAddListening) setQuickAddDesc(e.target.value); }}
                        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleAiSession(); } }}
                        disabled={quickAddListening}
                      />
                      <button
                        type="button"
                        onClick={toggleQuickAddListening}
                        className={`absolute right-2.5 bottom-2.5 p-1.5 rounded-lg transition-colors ${quickAddListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                        title={quickAddListening ? "Stop recording" : "Speak your description"}
                      >
                        {quickAddListening
                          ? <><span className="absolute inset-0 rounded-lg bg-red-400/20 animate-ping" /><Square className="w-3.5 h-3.5 fill-current relative z-10" /></>
                          : <Mic className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {quickAddListening && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        Listening… describe your session, then tap stop
                      </p>
                    )}
                    {!quickAddListening && <p className="text-xs text-muted-foreground">Include available kit, duration, and any preferences. Cmd+Enter to generate.</p>}
                  </div>

                  {/* Date */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Session Date</label>
                    <Input type="date" value={assignStartDate} onChange={e => setAssignStartDate(e.target.value)} className="w-full" />
                  </div>

                  {quickAddError && <p className="text-sm text-red-500">{quickAddError}</p>}
                </>
              )}

              {/* ── FULL PROGRAMME MODE ── */}
              {aiMode === "programme" && <>
              {/* Monthly generation limit */}
              {(monthlyLimitHit || generationLimitError) && !generatedPreview && !describeGenerating ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 flex flex-col items-center text-center gap-3">
                  <div className="text-2xl">🔒</div>
                  <div>
                    <p className="font-semibold text-sm text-amber-900">Monthly limit reached</p>
                    <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                      You've used your 2 programme generations for this month. Get in touch with your coach to unlock more.
                    </p>
                  </div>
                  <a
                    href="https://wa.me/447928712251"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20bb5a] text-white text-xs font-semibold rounded-xl px-4 py-2.5 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    Message your coach
                  </a>
                </div>
              ) : null}

              {describeGenerating ? (
                /* Loading panel — shows rationale as it arrives */
                <div className="space-y-4 py-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    <p className="text-sm font-semibold text-foreground">
                      {rationaleReady ? "Building sessions…" : "Planning your programme…"}
                    </p>
                  </div>
                  {rationaleReady && rationaleText ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5 space-y-1">
                      <p className="text-[11px] font-semibold text-primary/60 uppercase tracking-wider mb-2">Coach's logic</p>
                      <p className="text-sm text-foreground/80 leading-relaxed">{rationaleText}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-muted bg-muted/30 px-4 py-3.5 space-y-2">
                      <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                      <div className="h-3 bg-muted rounded animate-pulse w-full" />
                      <div className="h-3 bg-muted rounded animate-pulse w-5/6" />
                    </div>
                  )}
                  {rationaleReady && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      Generating sessions, exercises & progressions — this usually takes 15–30 seconds
                    </p>
                  )}
                </div>
              ) : !generatedPreview ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Describe the programme</label>
                    <div className="relative">
                      <textarea
                        className={`w-full min-h-[110px] rounded-xl border bg-background px-3 py-2.5 pr-10 text-sm resize-none focus:outline-none focus:ring-2 placeholder:text-muted-foreground transition-all ${describeListening ? "ring-2 ring-red-400/50 border-red-300" : "focus:ring-primary/40"}`}
                        placeholder="e.g. 3 days strength per week (upper/lower split), 1 run and 1 WOD, 6 week block. Training in a commercial gym. Max 6 weeks. Include the environment (garage gym, CrossFit box, commercial gym) so the AI picks the right kit."
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
                  {describeText.trim() && isStrengthDescription(describeText) && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Progression style</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setStrengthStyle("straight")}
                          className={`rounded-xl border px-3 py-3 text-left text-sm transition-all ${strengthStyle === "straight" ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border hover:border-primary/40 hover:bg-muted/50"}`}
                        >
                          <p className="font-semibold">Strict Progression</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Same exercises every week. Progress through load, reps and sets. Best for most people.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStrengthStyle("variety")}
                          className={`rounded-xl border px-3 py-3 text-left text-sm transition-all ${strengthStyle === "variety" ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border hover:border-primary/40 hover:bg-muted/50"}`}
                        >
                          <p className="font-semibold">Intermediate+ Variation</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Primary lifts stay fixed, accessories can rotate. For more advanced athletes.</p>
                        </button>
                      </div>
                    </div>
                  )}
                  {describeText.trim() && isRunDescription(describeText) && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-sm font-medium">Running environment</label>
                        <p className="text-xs text-muted-foreground mt-0.5">Select what you have access to</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: "road", label: "Road" },
                          { id: "treadmill", label: "Treadmill" },
                          { id: "track", label: "Track" },
                          { id: "hills", label: "Hills" },
                        ].map(({ id, label }) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => toggleRunEnv(id)}
                            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${runEnv.includes(id) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {runEnv.includes("treadmill") && (
                        <p className="text-[11px] text-muted-foreground">Treadmill selected. Intervals and quality sessions will be built for treadmill use.</p>
                      )}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Start Date</label>
                    <Input type="date" value={assignStartDate} onChange={e => setAssignStartDate(e.target.value)} className="w-full" />
                  </div>
                </>
              ) : (
                <>
                  {(generatedPreview as any).rationale && (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                      <p className="text-[11px] font-semibold text-primary/60 uppercase tracking-wider mb-1.5">Coach's logic</p>
                      <p className="text-xs text-foreground/80 leading-relaxed">{(generatedPreview as any).rationale}</p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{generatedPreview.title}</p>
                      <span className="text-xs text-muted-foreground">Week 1 preview · {generatedPreview.sessions.length} sessions</span>
                    </div>
                    {generatedPreview.sessions.map((s: any) => {
                      const isWod = s.source === "wod_brain";
                      const isRun = s.source === "run_brain";
                      const isCycle = s.source === "cycle_brain";
                      const isSwim = s.source === "swim_brain";
                      const isConditioning = isWod || isRun || isCycle || isSwim;
                      const dotColor = isWod ? "bg-violet-500" : isRun ? "bg-emerald-500" : isCycle ? "bg-amber-500" : isSwim ? "bg-sky-500" : "bg-primary";
                      return (
                        <div key={s.id} className="rounded-xl border bg-background p-3 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                            <span className="text-[11px] text-muted-foreground">{format(parseISO(s.date), "EEE d MMM")}</span>
                            <span className="font-semibold text-sm">{s.name}</span>
                          </div>
                          {isConditioning ? (
                            <p className="text-xs text-muted-foreground leading-relaxed pl-4">{s.structure}</p>
                          ) : (
                            <div className="space-y-0.5 pl-4">
                              {(s.exercises ?? []).slice(0, 5).map((ex: any, i: number) => (
                                <div key={i} className="flex items-baseline justify-between gap-2">
                                  <span className="text-xs text-foreground/80 truncate">{ex.name}</span>
                                  <span className="text-xs text-muted-foreground shrink-0 font-mono tabular-nums">
                                    {ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ex.sets ? `${ex.sets} sets` : ""}
                                    {ex.rpe ? ` @RPE${ex.rpe}` : ""}
                                  </span>
                                </div>
                              ))}
                              {(s.exercises ?? []).length > 5 && (
                                <p className="text-[11px] text-muted-foreground">+{s.exercises.length - 5} more</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Tweak input */}
                  <div className="space-y-2 pt-1 border-t">
                    <p className="text-xs font-medium text-muted-foreground">Any changes to week 1?</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Swap an exercise", "Change a day", "Make it harder", "Remove a session"].map(chip => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setPreviewTweakInput(chip + ": ")}
                          className="text-xs px-2.5 py-1 rounded-full border bg-muted/30 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. Swap lat pulldown for seated row..."
                        value={previewTweakInput}
                        onChange={e => setPreviewTweakInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && previewTweakInput.trim()) { void handleTweakPreview(); } }}
                        className="text-sm flex-1"
                        disabled={previewTweakLoading}
                      />
                      <Button
                        size="sm"
                        onClick={() => void handleTweakPreview()}
                        disabled={!previewTweakInput.trim() || previewTweakLoading}
                        className="shrink-0 px-3"
                      >
                        {previewTweakLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                    {previewTweakMessage && (
                      <p className="text-xs text-emerald-600 leading-relaxed">{previewTweakMessage}</p>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Week 1 is your template. Confirming will build weeks 2–4 with automatic progression, and week 4 as a deload.
                  </p>
                </>
              )}
              </>}
            </div>

          {/* Pinned footer — always visible, never clipped */}
          {!describeGenerating && (
            <DialogFooter className="shrink-0 pt-3 border-t">
              {aiMode === "session" ? (
                quickAddWodOptions && !parsedAiSession ? (
                  /* WOD option picker */
                  <div className="w-full space-y-3">
                    <p className="text-xs text-muted-foreground text-center font-medium">Pick a workout option</p>
                    {quickAddWodOptions.map((opt: any, i: number) => (
                      <button
                        key={i}
                        className="w-full text-left rounded-xl border bg-primary/5 border-primary/20 px-3 py-3 hover:border-primary/50 hover:bg-primary/10 transition-colors"
                        onClick={() => { setParsedAiSession(opt); setQuickAddWodOptions(null); }}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-xs font-semibold text-primary/60 uppercase tracking-wider">
                            {opt.format === "emom" ? "EMOM" : opt.format === "amrap" ? "AMRAP" : opt.format === "for_time" ? "For Time" : "WOD"}
                          </p>
                          <p className="text-xs text-primary font-medium">Tap to select →</p>
                        </div>
                        <p className="text-sm font-bold leading-snug">{opt.name || "WOD"}</p>
                        {renderWodStructure(opt)}
                      </button>
                    ))}
                    <button
                      className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                      onClick={() => setQuickAddWodOptions(null)}
                    >
                      ← Edit description
                    </button>
                  </div>
                ) : parsedAiSession ? (
                  /* Preview step — choose where to save */
                  <div className="w-full space-y-3">
                    <div className="rounded-xl border bg-primary/5 border-primary/20 px-3 py-3 space-y-1.5">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs font-semibold text-primary/60 uppercase tracking-wider">AI generated</p>
                        <p className="text-xs text-emerald-600 font-medium">✓ Ready to add</p>
                      </div>
                      <p className="text-sm font-bold leading-snug">{parsedAiSession.name || "Session"}</p>
                      {parsedAiSession.source === "wod_brain"
                        ? renderWodStructure(parsedAiSession)
                        : (parsedAiSession.exercises ?? []).length > 0
                          ? (
                            <div className="space-y-1 max-h-32 overflow-y-auto mt-1">
                              {(parsedAiSession.exercises as any[]).map((e: any, i: number) => (
                                <div key={i} className="flex items-baseline justify-between gap-2">
                                  <span className="text-xs text-foreground/80 truncate">{e.name}</span>
                                  <span className="text-xs text-muted-foreground shrink-0 font-mono">
                                    {[e.sets && e.reps ? `${e.sets}×${e.reps}` : e.sets ? `${e.sets} sets` : null, e.weight, e.rpe ? `@RPE ${e.rpe}` : null].filter(Boolean).join(" ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )
                          : parsedAiSession.structure
                            ? <p className="text-xs text-muted-foreground leading-relaxed mt-1">{parsedAiSession.structure}</p>
                            : null
                      }
                    </div>
                    <p className="text-xs text-muted-foreground text-center font-medium">Where would you like to save this?</p>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        onClick={() => void confirmAiSession("private")}
                        disabled={!!savingAiSession}
                        className="gap-2 justify-start w-full"
                        variant="default"
                      >
                        {savingAiSession === "private" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookMarked className="w-4 h-4" />}
                        Save to My Sessions
                        <span className="ml-auto text-xs opacity-70 font-normal">+ add to calendar</span>
                      </Button>
                      <Button
                        onClick={() => void confirmAiSession("public")}
                        disabled={!!savingAiSession}
                        variant="outline"
                        className="gap-2 justify-start w-full border-violet-300 text-violet-700 hover:bg-violet-50"
                      >
                        {savingAiSession === "public" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                        Save to Public Library
                        <span className="ml-auto text-xs opacity-70 font-normal">+ add to calendar</span>
                      </Button>
                      <Button
                        onClick={() => void confirmAiSession("calendar")}
                        disabled={!!savingAiSession}
                        variant="ghost"
                        className="gap-2 justify-start w-full text-muted-foreground"
                      >
                        {savingAiSession === "calendar" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                        Just add to calendar
                      </Button>
                    </div>
                    <button
                      className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                      onClick={() => setParsedAiSession(null)}
                    >
                      ← Edit description
                    </button>
                  </div>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Close</Button>
                    <Button
                      onClick={() => void handleAiSession()}
                      disabled={!quickAddDesc.trim() || !assignStartDate || aiSessionGenerating}
                      className="gap-2"
                    >
                      {aiSessionGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      Generate Session
                    </Button>
                  </>
                )
              ) : !generatedPreview ? (
                <>
                  <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Close</Button>
                  {!(monthlyLimitHit || generationLimitError) && (
                    <Button
                      onClick={handleGenerateProgramme}
                      disabled={!describeText.trim() || !assignStartDate}
                      className="gap-2"
                    >
                      <Sparkles className="w-4 h-4" /> Generate
                    </Button>
                  )}
                </>
              ) : (
                <div className="w-full flex flex-col gap-2">
                  <Button onClick={handleConfirmGenerated} disabled={confirmingGenerated || previewTweakLoading} className="gap-2 w-full">
                    {confirmingGenerated ? <><Loader2 className="w-4 h-4 animate-spin" /> Building your programme…</> : <><Sparkles className="w-4 h-4" /> Confirm &amp; Build Full Programme</>}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setGeneratedPreview(null); setPreviewTweakInput(""); setPreviewTweakMessage(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                  >
                    ← Start over
                  </button>
                </div>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>}

      {/* Quick-add single session dialog */}
      <Dialog open={quickAddOpen} onOpenChange={o => { setQuickAddOpen(o); if (!o) { setQuickAddName(""); setQuickAddDesc(""); setQuickAddError(""); setQuickAddType("strength"); setParsedQuickSession(null); setQuickAddWodOptions(null); setSavingQuickSession(null); } }}>
        <DialogContent className="max-w-sm flex flex-col max-h-[92dvh] overflow-hidden p-0">
          <div className="px-6 pt-6 pb-3 shrink-0">
            <DialogHeader>
              <DialogTitle>Add Session: {quickAddDate ? format(parseISO(quickAddDate), "EEE d MMM") : ""}</DialogTitle>
              <DialogDescription>
                {quickAddType === "wod" ? "Describe your WOD in any format. The AI will structure it."
                  : quickAddType === "run" ? "Describe your run. The AI will structure it."
                  : "List your exercises in any format. The AI will structure them for you."}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-6 space-y-3" style={{ WebkitOverflowScrolling: "touch" }}>
            {/* Type toggle */}
            <div className="flex rounded-xl overflow-hidden border border-muted p-0.5 gap-0.5 bg-muted/30">
              {(["strength", "wod", "run"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setQuickAddType(t); setQuickAddDesc(""); setQuickAddError(""); }}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors ${quickAddType === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "strength" ? "Strength" : t === "wod" ? "WOD" : "Run"}
                </button>
              ))}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {quickAddType === "wod" ? "WOD name (optional)" : quickAddType === "run" ? "Run name (optional)" : "Session name (optional)"}
              </label>
              <input
                value={quickAddName}
                onChange={e => setQuickAddName(e.target.value)}
                placeholder={
                  quickAddType === "wod" ? "e.g. Thursday Metcon, Lunchtime WOD"
                  : quickAddType === "run" ? "e.g. Tuesday Tempo, Long Run"
                  : "e.g. Push Day, Leg Session"
                }
                className="input mt-1"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mt-0">
                <label className="text-xs font-medium text-muted-foreground">
                  {quickAddType === "wod" ? "WOD description" : quickAddType === "run" ? "Run description" : "Exercises"}
                </label>
                <button
                  type="button"
                  onClick={toggleQuickAddListening}
                  title={quickAddListening ? "Stop recording" : "Voice input"}
                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${quickAddListening ? "bg-red-500 border-red-500 text-white animate-pulse" : "border-muted text-muted-foreground hover:border-primary/40 hover:text-primary"}`}
                >
                  <Mic className="w-3 h-3" />
                  {quickAddListening ? "Stop" : "Voice"}
                </button>
              </div>
              <textarea
                value={quickAddListening ? (quickAddInterim || quickAddDesc) : quickAddDesc}
                onChange={e => setQuickAddDesc(e.target.value)}
                placeholder={
                  quickAddType === "wod"
                    ? "e.g. 30 min amrap, 15 press ups, 1km bike erg, 500m run\n\nor: EMOM 12 (min 1: 12 cal bike, min 2: 15 wall balls)\nor: 5 rounds for time: 400m run, 20 burpees"
                  : quickAddType === "run"
                    ? "e.g. 45 min steady run\n\nor: 5 × 1km at tempo pace, 90s jog recovery\nor: 8km steady state, hilly route\nor: 6 × 200m hill sprints"
                  : "Bench press 4x8\nSquat 3x5 @RPE 8\nRDL 3x10\nLateral raises 3x15\n\n…or speak naturally"
                }
                rows={6}
                autoFocus
                className="input mt-1 resize-none"
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleQuickAdd(); } }}
              />
              {quickAddListening && (
                <p className="text-[11px] text-red-500 mt-1 min-h-[1rem] italic">
                  {quickAddInterim || "Listening…"}
                </p>
              )}
              {!quickAddListening && (
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  {quickAddType === "wod" ? "Describe format, duration and movements. Cmd+Enter to save."
                    : quickAddType === "run" ? "Include distance, duration, intensity or structure. Cmd+Enter to save."
                    : "One exercise per line, comma-separated, or just speak. Cmd+Enter to save."}
                </p>
              )}
            </div>
            {quickAddError && <p className="text-sm text-red-500">{quickAddError}</p>}

          {quickAddWodOptions && !parsedQuickSession ? (
            <div className="space-y-3 pt-1">
              <p className="text-xs text-muted-foreground text-center font-medium">Pick a workout option</p>
              {quickAddWodOptions.map((opt, i) => (
                <button
                  key={i}
                  className="w-full text-left rounded-xl border bg-primary/5 border-primary/20 px-3 py-3 hover:border-primary/50 hover:bg-primary/10 transition-colors"
                  onClick={() => {
                    setParsedQuickSession(opt);
                    setEditableSession(parseWodToEditable(opt));
                    setQuickAddWodOptions(null);
                  }}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs font-semibold text-primary/60 uppercase tracking-wider">
                      {FORMAT_LABELS[opt.format] ?? "WOD"}
                    </p>
                    <p className="text-xs text-primary font-medium">Tap to select →</p>
                  </div>
                  <p className="text-sm font-bold leading-snug">{opt.name || "WOD"}</p>
                  {renderWodStructure(opt)}
                </button>
              ))}
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                onClick={() => setQuickAddWodOptions(null)}
              >
                ← Edit description
              </button>
            </div>
          ) : parsedQuickSession && editableSession ? (
            <div className="space-y-3 pt-1">
              <WorkoutPreviewEditorCard
                editableSession={editableSession}
                onChange={setEditableSession as (v: EditableSession) => void}
              />
              <p className="text-xs text-muted-foreground text-center font-medium">Where would you like to save this?</p>
              <div className="grid grid-cols-1 gap-2">
                <Button
                  onClick={() => void confirmQuickAdd("private")}
                  disabled={!!savingQuickSession}
                  className="gap-2 justify-start w-full"
                  variant="default"
                >
                  {savingQuickSession === "private" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookMarked className="w-4 h-4" />}
                  Save to My Sessions
                  <span className="ml-auto text-xs opacity-70 font-normal">+ add to calendar</span>
                </Button>
                <Button
                  onClick={() => void confirmQuickAdd("public")}
                  disabled={!!savingQuickSession}
                  variant="outline"
                  className="gap-2 justify-start w-full border-violet-300 text-violet-700 hover:bg-violet-50"
                >
                  {savingQuickSession === "public" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                  Save to Public Library
                  <span className="ml-auto text-xs opacity-70 font-normal">+ add to calendar</span>
                </Button>
                <Button
                  onClick={() => void confirmQuickAdd("calendar")}
                  disabled={!!savingQuickSession}
                  variant="ghost"
                  className="gap-2 justify-start w-full text-muted-foreground"
                >
                  {savingQuickSession === "calendar" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                  Just add to calendar
                </Button>
              </div>
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                onClick={() => { setParsedQuickSession(null); setEditableSession(null); }}
              >
                ← Edit description
              </button>
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setQuickAddOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => void handleQuickAdd()} disabled={!quickAddDesc.trim() || quickAddParsing}>
                {quickAddParsing
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Parsing…</>
                  : quickAddType === "wod" ? "Add WOD" : quickAddType === "run" ? "Add Run" : "Add Session"}
              </Button>
            </div>
          )}
          </div>{/* end scroll container */}
        </DialogContent>
      </Dialog>

      {/* Goals Dialog */}
      <Dialog open={goalsOpen} onOpenChange={setGoalsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Daily Goals: {client?.name}</DialogTitle>
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
                A cycle is a <strong>multi-week progressive programme</strong>. One session per week, each with a different duration or load. Inserting a cycle adds all sessions at once.
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
            <p className="text-sm text-muted-foreground">Search for a squat cycle. Describe the style, duration, or difficulty.</p>

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
                        <div className="flex items-center gap-2 flex-wrap mb-2">
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
              Build From Library
            </DialogTitle>
            <DialogDescription>
              Search our curated library of programmes, sessions, and blocks — WODs, runs, and strength. Pick one and drop it straight into your calendar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search input */}
            <div className="flex gap-2">
              <Input
                placeholder='e.g. "olympic lifting block" or "easy 10k" or "6 week squat cycle"'
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
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Browse the library:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "olympic weightlifting",
                    "squat strength block",
                    "Mikko's cycle",
                    "Hyrox run block",
                    "30 min conditioning",
                    "easy aerobic run",
                  ].map(s => (
                    <button
                      key={s}
                      onClick={() => { setBrainQuery(s); searchBrain(s); }}
                      className="text-xs rounded-full border border-violet-200 bg-violet-50 text-violet-700 px-3 py-1 hover:bg-violet-100 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bucket badge */}
            {brainIntent && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Library section:</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  brainIntent === "wod" ? "bg-purple-100 text-purple-700" :
                  brainIntent === "run" ? "bg-green-100 text-green-700" :
                  brainIntent === "strength" ? "bg-orange-100 text-orange-700" :
                  "bg-gray-100 text-gray-700"
                }`}>
                  {brainIntent === "all" ? "All sections" : brainIntent === "wod" ? "WODs" : brainIntent === "run" ? "Runs" : "Strength"}
                </span>
              </div>
            )}

            {/* Results */}
            {brainResults.length > 0 && (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {brainResults.map((result) => {
                  const bucket = result.bucket ?? result.category ?? "wod";
                  const catColor: Record<string, string> = {
                    wod:      "border-purple-100 bg-purple-50/40",
                    run:      "border-green-100 bg-green-50/40",
                    strength: "border-orange-100 bg-orange-50/40",
                  };
                  const badgeColor: Record<string, string> = {
                    wod:      "bg-purple-100 text-purple-700",
                    run:      "bg-green-100 text-green-700",
                    strength: "bg-orange-100 text-orange-700",
                  };
                  const btnColor: Record<string, string> = {
                    wod:      "bg-purple-600 hover:bg-purple-700",
                    run:      "bg-green-600 hover:bg-green-700",
                    strength: "bg-orange-600 hover:bg-orange-700",
                  };
                  const bucketLabel: Record<string, string> = {
                    wod:      result.isBlock ? "WOD Block" : "WOD",
                    run:      result.isBlock ? "Run Block" : "Run",
                    strength: result.isBlock ? "Strength Block" : "Strength",
                  };

                  return (
                    <div key={result.id} className={`rounded-xl border p-4 space-y-2 ${catColor[bucket] ?? ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeColor[bucket] ?? ""}`}>
                              {bucketLabel[bucket] ?? bucket}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">{result.subtitle}</span>
                          </div>
                          <p className="font-semibold text-sm">{result.name}</p>
                          {result.tags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {result.tags.slice(0, 5).map((tag: string) => (
                                <span key={tag} className="chip opacity-60 capitalize">{tag.replace(/_/g, " ")}</span>
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
                          className={`shrink-0 gap-1.5 rounded-lg text-white ${btnColor[bucket] ?? "bg-primary hover:bg-primary/90"}`}
                          onClick={() => brainAddItem(result)}
                          disabled={!brainDates[result.id] || brainAdding === result.id}
                        >
                          {brainAdding === result.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          {result.isBlock ? "Insert Block" : "Add Session"}
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

      {/* Team: Publish Confirmation Dialog */}
      {isTeamMode && (
        <Dialog open={!!teamPublishConfirm} onOpenChange={o => { if (!o) setTeamPublishConfirm(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Publish Session?</DialogTitle>
              <DialogDescription>
                This will push the session to all {teamMemberCount > 0 ? teamMemberCount : ""} team members' calendars. Once published, the template becomes read-only.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setTeamPublishConfirm(null)} disabled={teamPublishing}>Cancel</Button>
              <Button onClick={() => void handleTeamPublishSession()} disabled={teamPublishing} className="gap-1.5">
                {teamPublishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Publish to Team
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Team: View Client Copies Side Panel */}
      {isTeamMode && teamCopiesPanel && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 bg-background border-l shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div>
              <p className="font-semibold text-sm">Client Copies</p>
              <p className="text-xs text-muted-foreground truncate max-w-[220px]">{teamCopiesPanel.sessionName}</p>
            </div>
            <button onClick={() => setTeamCopiesPanel(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {teamCopiesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : teamCopies.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No copies yet</p>
            ) : (
              teamCopies.map((copy: any) => (
                <div key={copy.clientId} className="flex items-center gap-2.5 p-2.5 rounded-lg border bg-muted/30">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                    {(copy.clientName || "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{copy.clientName}</p>
                    <p className="text-xs text-muted-foreground">{copy.date ? format(parseISO(copy.date), "d MMM yyyy") : "—"}</p>
                  </div>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Added</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
