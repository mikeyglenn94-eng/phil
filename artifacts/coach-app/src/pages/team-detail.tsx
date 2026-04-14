import { useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Users,
  CalendarDays,
  Plus,
  UserMinus,
  UserPlus,
  Lock,
  Send,
  Eye,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { format, addWeeks, startOfWeek, addDays, parseISO, isWithinInterval } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface TeamMemberRow {
  id: number;
  teamId: number;
  clientId: number;
  joinedAt: string;
  clientName: string;
}

interface TeamSession {
  id: number;
  teamId: number;
  sessionData: any;
  date: string;
  status: "draft" | "published";
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Team {
  id: number;
  name: string;
  coachId: number;
  createdAt: string;
  members: TeamMemberRow[];
  sessions: TeamSession[];
}

interface ClientBasic {
  id: number;
  name: string;
}

interface ClientCopy {
  id: number;
  clientId: number;
  clientName: string;
  sessionData: any;
  originalSessionData: any;
  updatedAt: string;
  diff: { exerciseId: string; type: "swapped" | "modified" | "unchanged"; original: any; current: any }[];
}

function getSessionColor(name?: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("run") || n.includes("cardio")) return "#22c55e";
  if (n.includes("wod") || n.includes("hyrox") || n.includes("metcon")) return "#f97316";
  if (n.includes("upper") || n.includes("push") || n.includes("pull") || n.includes("bench")) return "#3b82f6";
  if (n.includes("lower") || n.includes("squat") || n.includes("leg") || n.includes("dead")) return "#a855f7";
  return "#6366f1";
}

export default function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const [, setLocation] = useLocation();
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const id = parseInt(teamId, 10);
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [activeTab, setActiveTab] = useState<"programme" | "members">("programme");
  const [weekOffset, setWeekOffset] = useState(0);

  // ── Modals ──────────────────────────────────────────────────────────────────
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionDate, setNewSessionDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  const [publishConfirm, setPublishConfirm] = useState<TeamSession | null>(null);
  const [copiesPanel, setCopiesPanel] = useState<TeamSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TeamSession | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: team, isLoading } = useQuery<Team>({
    queryKey: ["team", id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/teams/${id}`, { headers: authHeaders });
      if (!r.ok) throw new Error("Failed to load team");
      return r.json();
    },
    enabled: !!token && !isNaN(id),
  });

  const { data: allClients = [] } = useQuery<ClientBasic[]>({
    queryKey: ["clients-basic"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/clients`, { headers: authHeaders });
      if (!r.ok) throw new Error("Failed to load clients");
      return r.json();
    },
    enabled: !!token && addMemberOpen,
  });

  const { data: clientCopies = [] } = useQuery<ClientCopy[]>({
    queryKey: ["team-session-copies", copiesPanel?.id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/teams/${id}/sessions/${copiesPanel!.id}/client-copies`, {
        headers: authHeaders,
      });
      if (!r.ok) throw new Error("Failed to load copies");
      return r.json();
    },
    enabled: !!copiesPanel,
  });

  // ── Week calendar logic ──────────────────────────────────────────────────────
  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);

  const sessionsThisWeek = useMemo(() => {
    if (!team) return [];
    return team.sessions.filter((s) => {
      try {
        const d = parseISO(s.date);
        return isWithinInterval(d, { start: weekStart, end: weekEnd });
      } catch {
        return false;
      }
    });
  }, [team, weekStart, weekEnd]);

  function getSessionsForDay(dayIndex: number): TeamSession[] {
    const day = format(addDays(weekStart, dayIndex), "yyyy-MM-dd");
    return sessionsThisWeek.filter((s) => s.date === day);
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const addSessionMutation = useMutation({
    mutationFn: async () => {
      const sessionData = {
        id: crypto.randomUUID(),
        date: newSessionDate,
        name: newSessionName.trim() || "Team Session",
        exercises: [],
      };
      const r = await fetch(`${BASE}/api/teams/${id}/sessions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ sessionData, date: newSessionDate }),
      });
      if (!r.ok) throw new Error("Failed to add session");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team", id] });
      setAddSessionOpen(false);
      setNewSessionName("");
      setNewSessionDate(format(new Date(), "yyyy-MM-dd"));
      toast({ title: "Session added" });
    },
    onError: () => toast({ title: "Could not add session", variant: "destructive" }),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: number) => {
      const r = await fetch(`${BASE}/api/teams/${id}/sessions/${sessionId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!r.ok) throw new Error("Failed to delete session");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team", id] });
      setDeleteConfirm(null);
      toast({ title: "Session deleted" });
    },
    onError: () => toast({ title: "Could not delete session", variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async (sessionId: number) => {
      const r = await fetch(`${BASE}/api/teams/${id}/sessions/${sessionId}/publish`, {
        method: "POST",
        headers: authHeaders,
      });
      if (!r.ok) throw new Error("Failed to publish");
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["team", id] });
      setPublishConfirm(null);
      toast({ title: `Published to ${data.distributedTo} member${data.distributedTo === 1 ? "" : "s"}` });
    },
    onError: () => toast({ title: "Could not publish session", variant: "destructive" }),
  });

  const addMemberMutation = useMutation({
    mutationFn: async (clientId: number) => {
      const r = await fetch(`${BASE}/api/teams/${id}/members`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!r.ok) throw new Error("Failed to add member");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team", id] });
      setAddMemberOpen(false);
      setMemberSearch("");
    },
    onError: () => toast({ title: "Could not add member", variant: "destructive" }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (clientId: number) => {
      const r = await fetch(`${BASE}/api/teams/${id}/members/${clientId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!r.ok) throw new Error("Failed to remove member");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team", id] }),
    onError: () => toast({ title: "Could not remove member", variant: "destructive" }),
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const memberClientIds = new Set(team?.members.map((m) => m.clientId) ?? []);
  const filteredClients = allClients.filter(
    (c) =>
      !memberClientIds.has(c.id) &&
      c.name.toLowerCase().includes(memberSearch.toLowerCase())
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  if (isLoading || !team) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0a0a0a]">
        <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-white/10 shrink-0">
        <button
          onClick={() => setLocation("/teams")}
          className="text-white/40 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-lg leading-tight truncate">{team.name}</h1>
          <p className="text-xs text-white/40 mt-0.5">
            {team.members.length} {team.members.length === 1 ? "member" : "members"} ·{" "}
            {team.sessions.length} sessions
          </p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => setActiveTab("programme")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
              activeTab === "programme"
                ? "bg-white text-black"
                : "text-white/50 hover:text-white"
            )}
          >
            <CalendarDays className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Programme
          </button>
          <button
            onClick={() => setActiveTab("members")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
              activeTab === "members"
                ? "bg-white text-black"
                : "text-white/50 hover:text-white"
            )}
          >
            <Users className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Members
          </button>
        </div>
      </div>

      {/* ── Programme tab ────────────────────────────────────────────────────── */}
      {activeTab === "programme" && (
        <div className="flex-1 overflow-y-auto">
          {/* Week nav */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 sticky top-0 bg-[#0a0a0a] z-10">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-sm font-medium text-white/70">
              {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM yyyy")}
            </div>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px bg-white/5 border-b border-white/5">
            {DAYS.map((day, i) => {
              const date = addDays(weekStart, i);
              const isToday = format(date, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
              const daySessions = getSessionsForDay(i);
              return (
                <div key={day} className="bg-[#0a0a0a] min-h-[140px] flex flex-col">
                  <div
                    className={cn(
                      "text-center py-2 text-xs font-medium border-b border-white/5",
                      isToday ? "text-white" : "text-white/30"
                    )}
                  >
                    <span className={cn("block", isToday && "text-primary font-bold")}>{day}</span>
                    <span className={cn("text-[11px]", isToday ? "text-white/70" : "text-white/20")}>
                      {format(date, "d")}
                    </span>
                  </div>
                  <div className="flex-1 p-1 flex flex-col gap-1">
                    {daySessions.map((s) => {
                      const color = getSessionColor(s.sessionData?.name);
                      const published = s.status === "published";
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            "rounded-lg p-1.5 text-[11px] leading-tight relative group",
                            published ? "opacity-80" : "cursor-default"
                          )}
                          style={{ background: `${color}18`, borderLeft: `2px solid ${color}` }}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="font-medium text-white/80 truncate flex-1">
                              {s.sessionData?.name || "Session"}
                            </span>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {published ? (
                                <>
                                  <span className="text-[9px] bg-green-500/20 text-green-400 px-1 py-0.5 rounded font-medium">
                                    Published
                                  </span>
                                  <button
                                    onClick={() => setCopiesPanel(s)}
                                    title="View client copies"
                                    className="text-white/30 hover:text-white/80 p-0.5 rounded"
                                  >
                                    <Eye className="w-3 h-3" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="text-[9px] bg-white/10 text-white/40 px-1 py-0.5 rounded font-medium">
                                    Draft
                                  </span>
                                  <button
                                    onClick={() => setPublishConfirm(s)}
                                    title="Publish session"
                                    className="text-white/30 hover:text-green-400 p-0.5 rounded"
                                  >
                                    <Send className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(s)}
                                    title="Delete session"
                                    className="text-white/30 hover:text-red-400 p-0.5 rounded"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {published && <Lock className="w-2.5 h-2.5 text-white/20 mt-0.5" />}
                        </div>
                      );
                    })}
                    {/* Add session shortcut */}
                    <button
                      onClick={() => {
                        setNewSessionDate(format(addDays(weekStart, i), "yyyy-MM-dd"));
                        setAddSessionOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-white/20 hover:text-white/50 transition-all text-left px-1"
                    >
                      <Plus className="w-3 h-3 inline" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add session button */}
          <div className="flex justify-center py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddSessionOpen(true)}
              className="text-white/40 hover:text-white/70 hover:bg-white/5 gap-1.5 text-sm"
            >
              <Plus className="w-4 h-4" />
              Add Session
            </Button>
          </div>
        </div>
      )}

      {/* ── Members tab ──────────────────────────────────────────────────────── */}
      {activeTab === "members" && (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-white/50">{team.members.length} member{team.members.length !== 1 ? "s" : ""}</p>
            <Button
              size="sm"
              onClick={() => setAddMemberOpen(true)}
              className="bg-white text-black hover:bg-white/90 rounded-xl h-8 px-3 text-sm gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add Member
            </Button>
          </div>

          {team.members.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-white/30 gap-3">
              <Users className="w-10 h-10" />
              <p className="text-sm">No members yet — add clients to this team</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {team.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                      {m.clientName?.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{m.clientName}</p>
                      <p className="text-xs text-white/30">
                        Joined {format(parseISO(m.joinedAt), "d MMM yyyy")}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeMemberMutation.mutate(m.clientId)}
                    className="text-white/20 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10"
                    title="Remove from team"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Add Session Modal ─────────────────────────────────────────────────── */}
      <Dialog open={addSessionOpen} onOpenChange={setAddSessionOpen}>
        <DialogContent className="bg-[#111] border-white/10 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Session</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            <div>
              <label className="text-xs text-white/40 mb-1 block">Session name</label>
              <Input
                placeholder="e.g. Strength — Upper Body"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                autoFocus
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              />
            </div>
            <div>
              <label className="text-xs text-white/40 mb-1 block">Date</label>
              <Input
                type="date"
                value={newSessionDate}
                onChange={(e) => setNewSessionDate(e.target.value)}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAddSessionOpen(false)}
              className="text-white/50 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={() => addSessionMutation.mutate()}
              disabled={addSessionMutation.isPending}
              className="bg-white text-black hover:bg-white/90"
            >
              {addSessionMutation.isPending ? "Adding…" : "Add Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Member Modal ──────────────────────────────────────────────────── */}
      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent className="bg-[#111] border-white/10 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="py-1">
            <Input
              placeholder="Search clients…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              autoFocus
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mb-3"
            />
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
              {filteredClients.length === 0 ? (
                <p className="text-sm text-white/30 text-center py-4">
                  {memberSearch ? "No matches" : "All clients already added"}
                </p>
              ) : (
                filteredClients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => addMemberMutation.mutate(c.id)}
                    className="flex items-center gap-3 text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                      {c.name.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-sm">{c.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Publish Confirm Modal ─────────────────────────────────────────────── */}
      <Dialog open={!!publishConfirm} onOpenChange={() => setPublishConfirm(null)}>
        <DialogContent className="bg-[#111] border-white/10 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Publish Session</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-white/60 leading-relaxed">
            This will send{" "}
            <span className="text-white font-medium">
              {publishConfirm?.sessionData?.name || "this session"}
            </span>{" "}
            to{" "}
            <span className="text-white font-medium">
              {team.members.length} member{team.members.length !== 1 ? "s" : ""}
            </span>
            . Published sessions cannot be unpublished.
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPublishConfirm(null)}
              className="text-white/50 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={() => publishConfirm && publishMutation.mutate(publishConfirm.id)}
              disabled={publishMutation.isPending}
              className="bg-green-600 hover:bg-green-500 text-white"
            >
              {publishMutation.isPending ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Modal ──────────────────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-[#111] border-white/10 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">
            Delete{" "}
            <span className="text-white font-medium">
              {deleteConfirm?.sessionData?.name || "this session"}
            </span>
            ? This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirm(null)}
              className="text-white/50 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deleteConfirm && deleteSessionMutation.mutate(deleteConfirm.id)}
              disabled={deleteSessionMutation.isPending}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              {deleteSessionMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Client Copies Side Panel ──────────────────────────────────────────── */}
      {copiesPanel && (
        <div className="fixed inset-y-0 right-0 w-80 bg-[#111] border-l border-white/10 z-50 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
            <div>
              <p className="font-semibold text-sm">Client Copies</p>
              <p className="text-xs text-white/40 mt-0.5">
                {copiesPanel.sessionData?.name || "Session"}
              </p>
            </div>
            <button
              onClick={() => setCopiesPanel(null)}
              className="text-white/40 hover:text-white/80 p-1 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {clientCopies.length === 0 ? (
              <p className="text-sm text-white/30 text-center py-8">No copies yet</p>
            ) : (
              clientCopies.map((copy) => {
                const changes = copy.diff.filter((d) => d.type !== "unchanged");
                return (
                  <div
                    key={copy.id}
                    className="bg-white/5 rounded-xl border border-white/10 p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                        {copy.clientName?.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">{copy.clientName}</span>
                      {changes.length === 0 ? (
                        <span className="text-[10px] text-white/30 ml-auto">Unchanged</span>
                      ) : (
                        <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded ml-auto">
                          {changes.length} change{changes.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {changes.map((d) => (
                      <div key={d.exerciseId} className="text-xs mt-1.5 pl-2 border-l-2 border-amber-500/40">
                        {d.type === "swapped" ? (
                          <span className="text-amber-400">
                            Swapped: <span className="line-through text-white/30">{d.original.name}</span> → {d.current.name}
                          </span>
                        ) : (
                          <span className="text-blue-400">
                            Modified: {d.current.name} ({d.original.sets}×{d.original.reps} → {d.current.sets}×{d.current.reps})
                          </span>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px] text-white/20 mt-2">
                      Updated {format(parseISO(copy.updatedAt), "d MMM HH:mm")}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
