import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Users,
  CalendarDays,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ClientArea from "./client-area";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface TeamMemberRow {
  id: number;
  teamId: number;
  clientId: number;
  joinedAt: string;
  clientName: string;
}

interface Team {
  id: number;
  name: string;
  coachId: number;
  createdAt: string;
  members: TeamMemberRow[];
  sessions: any[];
}

interface ClientBasic {
  id: number;
  name: string;
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
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

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

  const memberClientIds = new Set(team?.members.map((m) => m.clientId) ?? []);
  const filteredClients = allClients.filter(
    (c) =>
      !memberClientIds.has(c.id) &&
      c.name.toLowerCase().includes(memberSearch.toLowerCase())
  );

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
            {team.members.length} {team.members.length === 1 ? "member" : "members"}
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
                : "text-white/40 hover:text-white/70"
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
                : "text-white/40 hover:text-white/70"
            )}
          >
            <Users className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Members
          </button>
        </div>
      </div>

      {/* Programme tab — full AI calendar via shared ClientArea component */}
      {activeTab === "programme" && (
        <div className="flex-1 overflow-hidden">
          <ClientArea
            calendarContext="team"
            teamId={id}
            teamMemberCount={team.members.length}
          />
        </div>
      )}

      {/* Members tab */}
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

      {/* Add Member Modal */}
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
    </div>
  );
}
