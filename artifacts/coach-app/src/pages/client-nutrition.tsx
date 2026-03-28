import { useState, useEffect, useRef } from "react";
import { Utensils, Loader2, Mic, Square, Plus, Trash2, CalendarDays, Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  useListNutritionEntries,
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
  const deleteMutation = useDeleteNutritionEntry();

  const [foodInput, setFoodInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const interimRef = useRef("");
  const recRef = useRef<any>(null);

  // Photo state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

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

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    // Reset so same file can be re-selected
    e.target.value = "";
  }

  function clearPhoto() {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
  }

  const handleAdd = async () => {
    const text = foodInput.trim();
    if (!text && !imageFile) return;
    setIsAdding(true);
    try {
      let body: Record<string, any>;

      if (imageFile) {
        // Convert to base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Strip the data URL prefix, keep only the base64 part
            resolve(result.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(imageFile);
        });
        body = {
          date: selectedDate,
          imageBase64: base64,
          imageMimeType: imageFile.type || "image/jpeg",
          ...(text ? { description: text } : { description: "Nutrition label scan" }),
        };
      } else {
        body = { description: text, date: selectedDate };
      }

      const res = await fetch(`/api/clients/${CLIENT_ID}/nutrition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to add entry");
      }
      await queryClient.invalidateQueries({ queryKey: getListNutritionEntriesQueryKey(CLIENT_ID, { date: selectedDate }) });
      setFoodInput("");
      clearPhoto();
      toast({ title: "Entry added" });
    } catch (e: any) {
      toast({ title: "Error adding entry", description: e?.message, variant: "destructive" });
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

  const canAdd = (!!foodInput.trim() || !!imageFile) && !isAdding && !listening;

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
        {/* Daily goals tracker */}
        {(() => {
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

          if (hasGoals) {
            return (
              <div className="bg-primary/5 border border-primary/15 rounded-2xl px-5 py-4">
                <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-3">Daily Goals</p>
                <div className="space-y-3">
                  {macros.map(({ label, actual, goal, unit, color, textColor }) => {
                    const remaining = goal !== null ? goal - actual : null;
                    const pct = goal ? Math.min((actual / goal) * 100, 100) : 0;
                    const over = remaining !== null && remaining < 0;
                    return (
                      <div key={label}>
                        <div className="flex justify-between items-baseline mb-1.5">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-sm font-semibold text-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground">
                              {actual} / {goal} {unit}
                            </span>
                          </div>
                          <span className={`text-xs font-bold tabular-nums ${over ? "text-red-500" : "text-muted-foreground"}`}>
                            {over
                              ? `${Math.abs(remaining!)} ${unit} over`
                              : `${remaining} ${unit} left`}
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${over ? "bg-red-400" : color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          if ((entries?.length ?? 0) > 0) {
            return (
              <div className="bg-primary/5 border border-primary/15 rounded-2xl px-5 py-4">
                <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-3">Daily Totals</p>
                <div className="grid grid-cols-4 gap-3 text-center">
                  {macros.map(({ label, actual, unit, textColor }) => (
                    <div key={label}>
                      <p className={`text-xl font-bold ${textColor}`}>{actual}</p>
                      <p className="text-[10px] text-muted-foreground font-medium">{unit}</p>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return null;
        })()}

        {/* Add food input */}
        <div className="bg-card border rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Plus className="w-3 h-3" /> Add Food / Meal
          </p>

          {/* Label photo preview */}
          {imagePreview && (
            <div className="relative mb-3 inline-block">
              <img
                src={imagePreview}
                alt="Nutrition label"
                className="h-28 w-auto rounded-xl border object-cover shadow-sm"
              />
              <button
                onClick={clearPhoto}
                className="absolute -top-2 -right-2 bg-background border rounded-full p-0.5 shadow-sm text-muted-foreground hover:text-red-500 transition-colors"
                title="Remove photo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[10px] font-medium rounded-md px-1.5 py-0.5">
                Label scan
              </div>
            </div>
          )}

          <div className="relative">
            <textarea
              value={listening ? (interim || foodInput) : foodInput}
              onChange={e => setFoodInput(e.target.value)}
              placeholder={
                imageFile
                  ? 'Add a note (optional) — e.g. "2 servings" or "half a pack"'
                  : listening
                  ? "Listening…"
                  : 'e.g. "2 scrambled eggs with toast and butter"'
              }
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

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition-colors flex-shrink-0 ${
                imageFile
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-muted bg-muted/40 text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5"
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              {imageFile ? "Label attached" : "Scan label"}
            </button>
            <Button
              onClick={handleAdd}
              disabled={!canAdd}
              className="rounded-xl h-9 px-4 flex-1"
            >
              {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground mt-1.5">
            {imageFile
              ? "AI will read the label exactly — add a note if it's more than 1 serving"
              : "AI estimates macros from your description, or scan a nutrition label for exact values"}
          </p>

          {/* Hidden file input */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoChange}
          />
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
                {entry.aiNote && (
                  <p className="text-[11px] text-muted-foreground mt-1 italic">{entry.aiNote}</p>
                )}
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
