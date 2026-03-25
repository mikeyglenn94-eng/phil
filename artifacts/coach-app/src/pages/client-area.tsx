import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Dumbbell, Utensils, Loader2, Mic, Square, Plus, Trash2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import {
  useGetClient,
  useListProgrammes,
  useListNutritionEntries,
  useAddNutritionEntry,
  useDeleteNutritionEntry,
  getListNutritionEntriesQueryKey,
} from "@workspace/api-client-react";
import type { NutritionEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type Tab = "programmes" | "nutrition";

export default function ClientArea() {
  const [, params] = useRoute("/clients/:clientId");
  const [, setLocation] = useLocation();
  const clientId = parseInt(params?.clientId || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: client, isLoading: clientLoading } = useGetClient(clientId);
  const { data: programmes } = useListProgrammes();

  const [activeTab, setActiveTab] = useState<Tab>("nutrition");
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
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 bg-muted/50 rounded-xl p-1 w-fit">
          {(["nutrition", "programmes"] as Tab[]).map(tab => (
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
              {tab === "nutrition" ? "Nutrition" : "Programmes"}
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

      {/* Programmes Tab */}
      {activeTab === "programmes" && (
        <div className="px-6 py-6 max-w-2xl mx-auto space-y-3">
          {!programmes?.length ? (
            <div className="text-center py-16 text-muted-foreground">
              <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No programmes yet. Create one on the Coach Calendar.</p>
            </div>
          ) : (
            programmes.map(prog => (
              <div key={prog.id} className="bg-card border rounded-2xl px-5 py-4">
                <p className="font-semibold text-sm mb-3">{prog.title || "Untitled Programme"}</p>
                {(prog.sessions || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No sessions</p>
                ) : (
                  <div className="space-y-1.5">
                    {(prog.sessions || []).slice(0, 5).map(session => (
                      <button
                        key={session.id}
                        onClick={() => setLocation(`/client/programmes/${prog.id}/sessions/${session.id}`)}
                        className="w-full flex items-center justify-between text-left text-xs bg-muted/40 hover:bg-muted rounded-xl px-3 py-2 transition-colors"
                      >
                        <span className="font-medium">{session.name || "Session"}</span>
                        <span className="text-muted-foreground">{session.date}</span>
                      </button>
                    ))}
                    {(prog.sessions || []).length > 5 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">+{(prog.sessions || []).length - 5} more sessions</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
