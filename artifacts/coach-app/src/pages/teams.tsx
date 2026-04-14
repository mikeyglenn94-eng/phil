import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UsersRound, Plus, ChevronRight, Users } from "lucide-react";
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

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface TeamSummary {
  id: number;
  name: string;
  coachId: number;
  createdAt: string;
  memberCount: number;
  sessionCount: number;
}

export default function Teams() {
  const [, setLocation] = useLocation();
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  const authHeaders = { Authorization: `Bearer ${token}` };

  const { data: teams = [], isLoading } = useQuery<TeamSummary[]>({
    queryKey: ["teams"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/teams`, { headers: authHeaders });
      if (!r.ok) throw new Error("Failed to load teams");
      return r.json();
    },
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: async (teamName: string) => {
      const r = await fetch(`${BASE}/api/teams`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName }),
      });
      if (!r.ok) throw new Error("Failed to create team");
      return r.json();
    },
    onSuccess: (team) => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      setCreateOpen(false);
      setName("");
      setLocation(`/teams/${team.id}`);
    },
    onError: () => toast({ title: "Could not create team", variant: "destructive" }),
  });

  function handleCreate() {
    if (!name.trim()) return;
    createMutation.mutate(name.trim());
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <UsersRound className="w-5 h-5 text-white/70" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Teams</h1>
            <p className="text-xs text-white/40 mt-0.5">Build and manage group programmes</p>
          </div>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-white text-black hover:bg-white/90 rounded-xl h-9 px-4 text-sm font-medium gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Team
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 px-8 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          </div>
        ) : teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-white/30">
            <UsersRound className="w-12 h-12" />
            <div className="text-center">
              <p className="font-medium text-white/50">No teams yet</p>
              <p className="text-sm mt-1">Create a team to build shared group programmes</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((team) => (
              <button
                key={team.id}
                onClick={() => setLocation(`/teams/${team.id}`)}
                className="group text-left bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-2xl p-5 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center mb-4">
                    <UsersRound className="w-5 h-5 text-primary" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors mt-1" />
                </div>
                <p className="font-semibold text-white text-base">{team.name}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
                  </span>
                  <span>{team.sessionCount} sessions</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-[#111] border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Team</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Team name e.g. Hyrox Group A"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => { setCreateOpen(false); setName(""); }}
              className="text-white/50 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || createMutation.isPending}
              className="bg-white text-black hover:bg-white/90"
            >
              {createMutation.isPending ? "Creating…" : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
