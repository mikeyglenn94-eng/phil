import { useState } from "react";
import { useLocation } from "wouter";
import { Users, Plus, ChevronRight, Loader2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useListClients, useCreateClient, getListClientsQueryKey } from "@workspace/api-client-react";
import type { Client } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ClientsList() {
  const [, setLocation] = useLocation();
  const { data: clients, isLoading } = useListClients();
  const createMutation = useCreateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createMutation.mutateAsync({ data: { name: newName.trim() } });
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      setNewName("");
      setAdding(false);
      toast({ title: "Client added" });
    } catch {
      toast({ title: "Error adding client", variant: "destructive" });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your clients and their programmes</p>
        </div>
        <Button onClick={() => setAdding(true)} size="sm" className="rounded-xl gap-1.5">
          <Plus className="w-4 h-4" /> Add Client
        </Button>
      </div>

      {adding && (
        <div className="bg-card border rounded-2xl p-4 mb-4 flex gap-2 items-center shadow-sm">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Client name…"
            autoFocus
            className="rounded-xl flex-1"
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
          />
          <Button size="icon" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }} className="rounded-xl text-muted-foreground">
            <X className="w-4 h-4" />
          </Button>
          <Button size="icon" onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending} className="rounded-xl">
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !clients?.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">Add your first client to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((client: Client) => (
            <button
              key={client.id}
              onClick={() => setLocation(`/clients/${client.id}`)}
              className="w-full bg-card border rounded-2xl px-5 py-4 flex items-center gap-4 text-left hover:border-primary/40 hover:shadow-sm transition-all group"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                {client.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{client.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Added {new Date(client.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
