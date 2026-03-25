import { useState, useEffect, useRef } from "react";
import { Utensils, Loader2, Mic, Square, Plus, Trash2, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  useListNutritionEntries,
  useAddNutritionEntry,
  useDeleteNutritionEntry,
  useGetClient,
  getListNutritionEntriesQueryKey,
} from "@workspace/api-client-react";
import type { NutritionEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useClientContext } from "@/contexts/client-context";

export default function ClientNutrition() {
  const { client } = useClientContext();
  const CLIENT_ID = client?.id ?? 0;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: clientData } = useGetClient(CLIENT_ID, { query: { enabled: CLIENT_ID > 0 } });

  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const { data: entries, isLoading } = useListNutritionEntries(CLIENT_ID, { date: selectedDate });
  const addMutation = useAddNutritionEntry();
  const deleteMutation = useDeleteNutritionEntry();

  const [foodInput, setFoodInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const interimRef = useRef("");
  const recRef = useRef<any>(null);

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
      await addMutation.mutateAsync({ clientId: CLIENT_ID, data: { description: text, date: selectedDate } });
      queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(CLIENT_ID, { date: selectedDate }) });
      setFoodInput("");
      toast({ title: "Entry added" });
    } catch {
      toast({ title: "Error adding entry", variant: "destructive" });
    } finally { setIsAdding(false); }
  };

  const handleDelete = async (entryId: number) => {
    try {
      await deleteMutation.mutateAsync({ clientId: CLIENT_ID, entryId });
      queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(CLIENT_ID, { date: selectedDate }) });
    } catch {
      toast({ title: "Error deleting entry", variant: "destructive" });
    }
  };

  const totals = (entries || []).reduce(
    (acc: { calories: number; protein: number; carbs: number; fats: number }, e: NutritionEntry) => ({
      calories: acc.calories + (e.calories ?? 0),
      protein: acc.protein + parseFloat(e.protein ?? "0"),
      carbs: acc.carbs + parseFloat(e.carbs ?? "0"),
      fats: acc.fats + parseFloat(e.fats ?? "0"),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight">Nutrition Diary</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Log what you eat — AI tracks your macros</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="text-sm font-medium bg-transparent border-none outline-none cursor-pointer text-foreground"
          />
        </div>
      </div>

      <div className="px-6 py-5 max-w-2xl space-y-4">
        {/* Daily totals */}
        {(entries?.length ?? 0) > 0 && (() => {
          const goals = {
            calories: clientData?.dailyCalorieGoal ?? null,
            protein: clientData?.dailyProteinGoal ?? null,
            carbs: clientData?.dailyCarbGoal ?? null,
            fats: clientData?.dailyFatGoal ?? null,
          };
          const hasGoals = goals.calories !== null;
          const macros = [
            { label: "Calories", actual: Math.round(totals.calories), goal: goals.calories, unit: "kcal", color: "bg-orange-400", textColor: "text-orange-500" },
            { label: "Protein", actual: Math.round(totals.protein), goal: goals.protein, unit: "g", color: "bg-blue-400", textColor: "text-blue-500" },
            { label: "Carbs", actual: Math.round(totals.carbs), goal: goals.carbs, unit: "g", color: "bg-yellow-400", textColor: "text-yellow-600" },
            { label: "Fats", actual: Math.round(totals.fats), goal: goals.fats, unit: "g", color: "bg-pink-400", textColor: "text-pink-500" },
          ];
          return (
            <div className="bg-primary/5 border border-primary/15 rounded-2xl px-5 py-4">
              <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-3">Daily Totals</p>
              {hasGoals ? (
                <div className="space-y-3">
                  {macros.map(({ label, actual, goal, unit, color, textColor }) => {
                    const pct = goal ? Math.min((actual / goal) * 100, 100) : 0;
                    const over = goal !== null && actual > goal;
                    return (
                      <div key={label}>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-xs text-muted-foreground font-medium">{label}</span>
                          <span className={`text-sm font-bold ${over ? "text-red-500" : textColor}`}>
                            {actual}<span className="text-xs font-normal text-muted-foreground"> / {goal} {unit}</span>
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${over ? "bg-red-400" : color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3 text-center">
                  {macros.map(({ label, actual, unit, textColor }) => (
                    <div key={label}>
                      <p className={`text-xl font-bold ${textColor}`}>{actual}</p>
                      <p className="text-[10px] text-muted-foreground font-medium">{unit}</p>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

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
                placeholder={listening ? "Listening…" : 'e.g. "2 scrambled eggs with toast and butter"'}
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
          <p className="text-[11px] text-muted-foreground mt-2">AI will estimate calories, protein, carbs & fats</p>
        </div>

        {/* Entries */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !entries?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <Utensils className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Nothing logged yet today</p>
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
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <span className="text-xs font-semibold text-orange-500 bg-orange-50 rounded-lg px-2 py-0.5">{entry.calories} kcal</span>
                    {entry.protein && <span className="text-xs font-semibold text-blue-500 bg-blue-50 rounded-lg px-2 py-0.5">P: {parseFloat(entry.protein).toFixed(1)}g</span>}
                    {entry.carbs && <span className="text-xs font-semibold text-yellow-600 bg-yellow-50 rounded-lg px-2 py-0.5">C: {parseFloat(entry.carbs).toFixed(1)}g</span>}
                    {entry.fats && <span className="text-xs font-semibold text-pink-500 bg-pink-50 rounded-lg px-2 py-0.5">F: {parseFloat(entry.fats).toFixed(1)}g</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
