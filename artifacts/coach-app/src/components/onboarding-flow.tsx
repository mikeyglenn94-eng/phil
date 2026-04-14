import React, { useState, useRef, type MutableRefObject } from "react";
import { format, addDays, parseISO, differenceInDays } from "date-fns";
import { Sparkles, Loader2, Send, ChevronRight, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { getListProgrammesQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";

interface OnboardingAnswers {
  name: string;
  goal: string;
  experience: string;
  days: string;
  duration: string;
  equipment: string;
  equipmentList: string;
  focus: string[];
  startDate: string;
}

type OnboardingStep =
  | "coach-check"
  | "name" | "goal" | "experience" | "days" | "duration"
  | "equipment" | "equipment-list" | "focus" | "start-date"
  | "generating" | "preview" | "done";

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

function buildDescription(a: OnboardingAnswers): string {
  const goalMap: Record<string, string> = {
    "lose-fat": "fat loss", "build-muscle": "muscle building",
    "get-stronger": "strength", "improve-fitness": "general fitness", "event": "event preparation",
  };
  const expMap: Record<string, string> = {
    "beginner": "beginner (under 1 year training)", "intermediate": "intermediate (1–3 years training)",
    "advanced": "advanced (3+ years training)",
  };
  const equipMap: Record<string, string> = {
    "full-gym": "training in a commercial gym with full equipment access",
    "home-kit": `training at home with: ${a.equipmentList || "various kit"}`,
    "bodyweight": "bodyweight only, no equipment",
  };
  const focusText = a.focus.length > 0 ? a.focus.join(", ") : "general fitness";
  const daysText = a.days === "5+" ? "5" : a.days;
  return `1 week preview only. ${goalMap[a.goal] || a.goal} programme for a ${expMap[a.experience] || a.experience} athlete. ${daysText} training days per week, ${a.duration}-minute sessions. ${equipMap[a.equipment] || a.equipment}. Focus: ${focusText}.`;
}

const COACH_MARKS = [
  { title: "Your training calendar", body: "Tap any session to log it, see the exercises, and track your progress." },
  { title: "Ask your AI coach anything", body: "Use the command bar to swap exercises, adjust the plan, reschedule sessions, or add something new." },
  { title: "Log how it felt", body: "After each session, tell us how it went. We'll adapt future sessions to match your recovery and progress." },
];

interface Props {
  clientId: number;
  clientName: string;
  onComplete: () => void;
}

export function OnboardingFlow({ clientId, clientName, onComplete }: Props) {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [step, setStep] = useState<OnboardingStep>("coach-check");
  const [animating, setAnimating] = useState(false);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    name: clientName || "",
    goal: "", experience: "", days: "", duration: "",
    equipment: "", equipmentList: "", focus: [],
    startDate: format(new Date(), "yyyy-MM-dd"),
  });

  const [generatingText, setGeneratingText] = useState("Planning your programme…");
  const [previewSessions, setPreviewSessions] = useState<any[]>([]);
  const [previewTitle, setPreviewTitle] = useState("");
  const [tweakInput, setTweakInput] = useState("");
  const [tweakLoading, setTweakLoading] = useState(false);
  const [tweakMessage, setTweakMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [coachMark, setCoachMark] = useState(0);

  const [equipListening, setEquipListening] = useState(false);
  const [tweakListening, setTweakListening] = useState(false);
  const equipRecRef = useRef<any>(null);
  const tweakRecRef = useRef<any>(null);

  function goNext(newStep: OnboardingStep) {
    setAnimating(true);
    setTimeout(() => { setStep(newStep); setAnimating(false); }, 200);
  }

  function patch(field: keyof OnboardingAnswers, value: string | string[]) {
    setAnswers(prev => ({ ...prev, [field]: value }));
  }

  function toggleFocus(f: string) {
    setAnswers(prev => ({
      ...prev,
      focus: prev.focus.includes(f) ? prev.focus.filter(x => x !== f) : [...prev.focus, f],
    }));
  }

  async function saveOnboarding(completed: boolean) {
    try {
      await fetch(`${BASE}/api/clients/${clientId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          onboardingCompleted: completed,
          equipmentList: answers.equipmentList || undefined,
          onboardingData: {
            goal: answers.goal, experience: answers.experience, days: answers.days,
            duration: answers.duration, equipment: answers.equipment,
            focus: answers.focus, startDate: answers.startDate,
          },
        }),
      });
    } catch {}
  }

  async function generatePreview() {
    goNext("generating");
    setGeneratingText("Planning your programme…");
    try {
      const desc = buildDescription(answers);
      const rationaleRes = await fetch(`${BASE}/api/generate-rationale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: desc, startDate: answers.startDate, strengthStyle: "straight" }),
      });
      if (rationaleRes.ok) setGeneratingText("Building your sessions…");

      const res = await fetch(`${BASE}/api/generate-programme`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          description: desc, startDate: answers.startDate,
          strengthStyle: "straight", weekOnly: true, clientId,
        }),
      });
      if (!res.ok) throw new Error("Generation failed");
      const data = await res.json();
      setPreviewSessions(data.sessions ?? []);
      setPreviewTitle(data.title || "Your Programme");
      void saveOnboarding(false);
      goNext("preview");
    } catch (err: any) {
      toast({ title: "Couldn't generate preview", description: "Please try again.", variant: "destructive" });
      goNext("start-date");
    }
  }

  async function handleTweak() {
    if (!tweakInput.trim() || tweakLoading) return;
    setTweakLoading(true);
    setTweakMessage("");
    try {
      const res = await fetch(`${BASE}/api/tweak-programme-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sessions: previewSessions,
          instruction: tweakInput.trim(),
          equipmentList: answers.equipmentList || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPreviewSessions(data.sessions ?? previewSessions);
      setTweakMessage(data.message ?? "Preview updated.");
      setTweakInput("");
    } catch {
      setTweakMessage("Couldn't apply that change — try rephrasing.");
    } finally {
      setTweakLoading(false);
    }
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      const allSessions = expandWeeks(previewSessions, 4);
      const saveRes = await fetch(`${BASE}/api/programmes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: previewTitle, sessions: allSessions, clientId, blockLength: 4 }),
      });
      if (!saveRes.ok) throw new Error("Save failed");
      await queryClient.invalidateQueries({ queryKey: getListProgrammesQueryKey({ clientId }) });
      await saveOnboarding(true);
      setCoachMark(1);
      goNext("done");
    } catch {
      toast({ title: "Couldn't save programme", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function startVoice(
    recRef: MutableRefObject<any>,
    setListening: (v: boolean) => void,
    onResult: (text: string) => void
  ) {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";
    rec.onresult = (ev: any) => {
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
      }
      if (final) onResult(final);
    };
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  function stopVoice(recRef: React.MutableRefObject<any>, setListening: (v: boolean) => void) {
    recRef.current?.stop();
    setListening(false);
  }

  const QUIZ_STEPS: OnboardingStep[] = [
    "name", "goal", "experience", "days", "duration", "equipment",
    ...(answers.equipment === "home-kit" ? ["equipment-list" as OnboardingStep] : []),
    "focus", "start-date",
  ];
  const quizStepIndex = QUIZ_STEPS.indexOf(step);
  const isQuizStep = quizStepIndex >= 0;
  const quizProgress = isQuizStep ? (quizStepIndex + 1) / QUIZ_STEPS.length : 0;

  function nextQuizStep() {
    const current = QUIZ_STEPS.indexOf(step);
    if (current < QUIZ_STEPS.length - 1) goNext(QUIZ_STEPS[current + 1]);
    else void generatePreview();
  }

  function skip() {
    localStorage.setItem(`onboarding_skip_${clientId}`, "1");
    void saveOnboarding(true);
    onComplete();
  }

  const overlayClass = `fixed inset-0 z-[100] bg-background flex flex-col transition-opacity duration-200 ${animating ? "opacity-0" : "opacity-100"}`;

  if (step === "done") {
    if (coachMark > COACH_MARKS.length) {
      onComplete();
      return null;
    }
    const mark = COACH_MARKS[coachMark - 1];
    return (
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-end justify-center p-6">
        <div className="bg-background rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary">{coachMark}</span>
            </div>
            <button onClick={() => { localStorage.setItem(`onboarding_marks_${clientId}`, "done"); onComplete(); }} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <p className="font-semibold text-base">{mark.title}</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{mark.body}</p>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {COACH_MARKS.map((_, i) => (
                <span key={i} className={`w-1.5 h-1.5 rounded-full ${i + 1 === coachMark ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
            <Button size="sm" onClick={() => {
              if (coachMark >= COACH_MARKS.length) {
                localStorage.setItem(`onboarding_marks_${clientId}`, "done");
                onComplete();
              } else {
                setCoachMark(c => c + 1);
              }
            }}>
              {coachMark >= COACH_MARKS.length ? "Let's go" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "generating") {
    return (
      <div className={overlayClass}>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary animate-pulse" />
          </div>
          <div className="text-center space-y-2">
            <p className="font-semibold text-lg">{generatingText}</p>
            <p className="text-sm text-muted-foreground">Designing your week 1 preview…</p>
          </div>
          <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "60%" }} />
          </div>
        </div>
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div className={overlayClass}>
        <div className="flex flex-col h-full max-w-lg mx-auto w-full">
          <div className="px-6 pt-8 pb-4 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-primary/60 uppercase tracking-wider">Week 1 Preview</p>
              <button onClick={skip} className="text-xs text-muted-foreground hover:text-foreground">Skip</button>
            </div>
            <p className="font-bold text-xl leading-snug">{previewTitle}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{previewSessions.length} sessions · {answers.days} days/week · {answers.duration} min</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-2 pb-4">
            {previewSessions.map((s: any) => {
              const isWod = s.source === "wod_brain";
              const isRun = s.source === "run_brain";
              return (
                <div key={s.id} className="rounded-xl border bg-card p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isWod ? "bg-violet-500" : isRun ? "bg-emerald-500" : "bg-primary"}`} />
                    <span className="text-[11px] text-muted-foreground">{format(parseISO(s.date), "EEE d MMM")}</span>
                    <span className="font-semibold text-sm">{s.name}</span>
                  </div>
                  {isWod || isRun ? (
                    <p className="text-xs text-muted-foreground leading-relaxed pl-4">{s.structure}</p>
                  ) : (
                    <div className="space-y-0.5 pl-4">
                      {(s.exercises ?? []).slice(0, 5).map((ex: any, i: number) => (
                        <div key={i} className="flex items-baseline justify-between gap-2">
                          <span className="text-xs text-foreground/80 truncate">{ex.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0 font-mono">
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

            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground">Any changes?</p>
              <div className="flex flex-wrap gap-1.5">
                {["Swap an exercise", "Change a day", "Make it harder", "Remove a session"].map(chip => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setTweakInput(chip + " — ")}
                    className="text-xs px-2.5 py-1 rounded-full border bg-muted/30 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Swap lat pulldown for seated row…"
                  value={tweakInput}
                  onChange={e => setTweakInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && tweakInput.trim()) void handleTweak(); }}
                  className="text-sm flex-1"
                  disabled={tweakLoading}
                />
                <button
                  type="button"
                  onClick={() => tweakListening
                    ? stopVoice(tweakRecRef, setTweakListening)
                    : startVoice(tweakRecRef, setTweakListening, t => setTweakInput(prev => prev + t))
                  }
                  className={`shrink-0 p-2 rounded-lg transition-colors ${tweakListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                >
                  {tweakListening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
                <Button
                  size="sm"
                  onClick={() => void handleTweak()}
                  disabled={!tweakInput.trim() || tweakLoading}
                  className="shrink-0 px-3"
                >
                  {tweakLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
              {tweakMessage && <p className="text-xs text-emerald-600 leading-relaxed">{tweakMessage}</p>}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed pb-2">
              Confirming will build weeks 2–4 with automatic progression. Week 4 is a deload.
            </p>
          </div>

          <div className="px-6 pb-8 pt-3 border-t shrink-0 space-y-2">
            <Button
              onClick={() => void handleConfirm()}
              disabled={saving || tweakLoading}
              className="w-full gap-2"
              size="lg"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Building your programme…</>
                : <><Sparkles className="w-4 h-4" /> Confirm &amp; Build Full Programme</>
              }
            </Button>
            <button
              type="button"
              onClick={() => goNext("start-date")}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              ← Start over
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "coach-check") {
    return (
      <div className={overlayClass}>
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8 max-w-sm mx-auto w-full">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <p className="font-bold text-2xl">Welcome{clientName ? `, ${clientName.split(" ")[0]}` : ""}!</p>
            <p className="text-muted-foreground text-base leading-relaxed">Do you have a coach programming for you?</p>
          </div>
          <div className="w-full space-y-3">
            <Button
              variant="outline"
              className="w-full h-14 text-base"
              onClick={() => {
                localStorage.setItem(`onboarding_skip_${clientId}`, "1");
                void saveOnboarding(true);
                onComplete();
              }}
            >
              Yes, I have a coach
            </Button>
            <Button
              className="w-full h-14 text-base gap-2"
              onClick={() => goNext("name")}
            >
              No, I'll build my own <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-xs">
            If you have a coach, they'll set up your programme and you'll see sessions here when they're ready.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={overlayClass}>
      <div className="flex flex-col h-full max-w-sm mx-auto w-full">
        <div className="px-6 pt-8 pb-2 shrink-0 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden mr-4">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${quizProgress * 100}%` }}
              />
            </div>
            <button onClick={skip} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Skip for now</button>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center px-6 pb-4">
          {step === "name" && (
            <QuizStep
              question="What should we call you?"
              hint="We'll use this throughout your programme."
            >
              <Input
                value={answers.name}
                onChange={e => patch("name", e.target.value)}
                placeholder="Your name"
                className="text-lg h-12"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && answers.name.trim()) nextQuizStep(); }}
              />
              <Button
                onClick={nextQuizStep}
                disabled={!answers.name.trim()}
                className="w-full gap-2"
                size="lg"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </Button>
            </QuizStep>
          )}

          {step === "goal" && (
            <QuizStep question="What's your main goal?">
              <OptionGrid
                options={[
                  { id: "lose-fat", label: "Lose fat" },
                  { id: "build-muscle", label: "Build muscle" },
                  { id: "get-stronger", label: "Get stronger" },
                  { id: "improve-fitness", label: "Improve fitness" },
                  { id: "event", label: "Train for an event" },
                ]}
                selected={answers.goal}
                onSelect={v => { patch("goal", v); setTimeout(nextQuizStep, 200); }}
              />
            </QuizStep>
          )}

          {step === "experience" && (
            <QuizStep question="How long have you been training?">
              <OptionGrid
                options={[
                  { id: "beginner", label: "Beginner", sub: "Under 1 year" },
                  { id: "intermediate", label: "Intermediate", sub: "1–3 years" },
                  { id: "advanced", label: "Advanced", sub: "3+ years" },
                ]}
                selected={answers.experience}
                onSelect={v => { patch("experience", v); setTimeout(nextQuizStep, 200); }}
              />
            </QuizStep>
          )}

          {step === "days" && (
            <QuizStep question="How many days per week can you train?">
              <OptionGrid
                options={[
                  { id: "2", label: "2 days" }, { id: "3", label: "3 days" },
                  { id: "4", label: "4 days" }, { id: "5+", label: "5+ days" },
                ]}
                cols={2}
                selected={answers.days}
                onSelect={v => { patch("days", v); setTimeout(nextQuizStep, 200); }}
              />
            </QuizStep>
          )}

          {step === "duration" && (
            <QuizStep question="How long are your sessions?">
              <OptionGrid
                options={[
                  { id: "30", label: "30 min" }, { id: "45", label: "45 min" },
                  { id: "60", label: "60 min" }, { id: "90", label: "90 min" },
                ]}
                cols={2}
                selected={answers.duration}
                onSelect={v => { patch("duration", v); setTimeout(nextQuizStep, 200); }}
              />
            </QuizStep>
          )}

          {step === "equipment" && (
            <QuizStep question="What equipment do you have access to?">
              <OptionGrid
                options={[
                  { id: "full-gym", label: "Full gym", sub: "Commercial gym" },
                  { id: "home-kit", label: "Home with kit", sub: "Some equipment at home" },
                  { id: "bodyweight", label: "Bodyweight only", sub: "No equipment" },
                ]}
                selected={answers.equipment}
                onSelect={v => {
                  patch("equipment", v);
                  setTimeout(() => {
                    if (v === "home-kit") goNext("equipment-list");
                    else nextQuizStep();
                  }, 200);
                }}
              />
            </QuizStep>
          )}

          {step === "equipment-list" && (
            <QuizStep
              question="What equipment do you have at home?"
              hint="Describe exactly what you have. The AI will only prescribe exercises using your equipment."
            >
              <div className="relative">
                <textarea
                  className="w-full min-h-[100px] rounded-xl border bg-background px-3 py-2.5 pr-10 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
                  placeholder="e.g. Barbell, squat rack, dumbbells up to 40kg, pull-up bar, resistance bands"
                  value={answers.equipmentList}
                  onChange={e => patch("equipmentList", e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => equipListening
                    ? stopVoice(equipRecRef, setEquipListening)
                    : startVoice(equipRecRef, setEquipListening, t => patch("equipmentList", answers.equipmentList + (answers.equipmentList ? ", " : "") + t))
                  }
                  className={`absolute right-2.5 bottom-2.5 p-1.5 rounded-lg transition-colors ${equipListening ? "text-red-500 bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                >
                  {equipListening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              </div>
              <Button
                onClick={nextQuizStep}
                disabled={!answers.equipmentList.trim()}
                className="w-full gap-2"
                size="lg"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </Button>
            </QuizStep>
          )}

          {step === "focus" && (
            <QuizStep question="What's your training focus?" hint="Select all that apply.">
              <div className="flex flex-wrap gap-2">
                {["Powerlifting", "Hyrox", "General fitness", "Running", "Hybrid"].map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFocus(f)}
                    className={`px-3 py-2 rounded-xl border text-sm font-medium transition-all ${answers.focus.includes(f) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <Button
                onClick={nextQuizStep}
                disabled={answers.focus.length === 0}
                className="w-full gap-2"
                size="lg"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </Button>
            </QuizStep>
          )}

          {step === "start-date" && (
            <QuizStep question="When do you want to start?" hint="We'll schedule week 1 from this date.">
              <Input
                type="date"
                value={answers.startDate}
                min={format(new Date(), "yyyy-MM-dd")}
                onChange={e => patch("startDate", e.target.value)}
                className="text-base h-12"
              />
              <Button
                onClick={() => void generatePreview()}
                disabled={!answers.startDate}
                className="w-full gap-2"
                size="lg"
              >
                <Sparkles className="w-4 h-4" /> Preview my programme
              </Button>
            </QuizStep>
          )}
        </div>
      </div>
    </div>
  );
}

function QuizStep({ question, hint, children }: { question: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <p className="text-2xl font-bold leading-snug">{question}</p>
        {hint && <p className="text-sm text-muted-foreground leading-relaxed">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function OptionGrid({
  options, selected, onSelect, cols = 1,
}: {
  options: { id: string; label: string; sub?: string }[];
  selected: string;
  onSelect: (v: string) => void;
  cols?: 1 | 2;
}) {
  return (
    <div className={`grid gap-2 ${cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onSelect(opt.id)}
          className={`rounded-xl border px-4 py-3.5 text-left transition-all ${
            selected === opt.id
              ? "border-primary bg-primary/10 ring-2 ring-primary/30"
              : "border-border hover:border-primary/40 hover:bg-muted/40"
          }`}
        >
          <p className="font-semibold text-sm">{opt.label}</p>
          {opt.sub && <p className="text-xs text-muted-foreground mt-0.5">{opt.sub}</p>}
        </button>
      ))}
    </div>
  );
}
