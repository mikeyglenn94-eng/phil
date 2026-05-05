import { useState } from "react";
import { Loader2, Mic, Square, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";

type Sport = "strength" | "run" | "cycle" | "swim";

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string };
  }>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

interface ParseResult {
  ok: boolean;
  reason?: string;
  message?: string;
  name?: string;
  sport?: Sport;
  exercises?: Array<{
    name: string;
    sets: number;
    reps: string;
    weight: string | null;
    rpe: string | null;
    tempo: string | null;
    rest: string | null;
    notes: string | null;
    distance: string | null;
    duration: string | null;
    pace: string | null;
    effort: string | null;
    confidence: "high" | "low";
  }>;
  raw: string;
  rawModelOutput: string | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

const SPORTS: { value: Sport; label: string }[] = [
  { value: "strength", label: "Strength" },
  { value: "run", label: "Run" },
  { value: "cycle", label: "Cycle" },
  { value: "swim", label: "Swim" },
];

export default function DevParser() {
  const { token } = useAuth();
  const [input, setInput] = useState("");
  const [sport, setSport] = useState<Sport>("strength");
  const [sessionName, setSessionName] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isParsing, setIsParsing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recRef = useState<{ rec: { stop: () => void } | null }>({ rec: null })[0];

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  function startRecording() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setError("Speech recognition not supported in this browser.");
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    let acc = "";
    r.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (!res) continue;
        if (res.isFinal) acc += " " + res[0].transcript;
        else interim += res[0].transcript;
      }
      setInput((acc + " " + interim).trim());
    };
    r.onend = () => setIsRecording(false);
    r.onerror = (e: { error: string }) => {
      setError(`Voice error: ${e.error}`);
      setIsRecording(false);
    };
    r.start();
    recRef.rec = r;
    setIsRecording(true);
  }

  function stopRecording() {
    recRef.rec?.stop();
  }

  async function parse() {
    setError("");
    setResult(null);
    setIsParsing(true);
    setElapsedMs(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}/api/parse-workout-debug`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          input,
          sport,
          sessionName: sessionName.trim() || undefined,
        }),
      });
      const data = (await res.json()) as ParseResult;
      setResult(data);
      if (!res.ok && !data) setError(`HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setElapsedMs(Math.round(performance.now() - t0));
      setIsParsing(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Workout Parser — Dev Playground</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hits POST /api/parse-workout-debug. Same code path as /parse-session and /parse-run-session,
            but returns the full ParseResult including raw model output.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Input pane */}
          <div className="rounded-2xl border bg-card p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-medium text-muted-foreground mr-1">Sport</span>
              {SPORTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSport(s.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    sport === s.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/30 hover:bg-muted/60 text-foreground border-transparent"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Session name (optional)"
              className="text-sm bg-muted/30 border border-transparent hover:border-input focus:bg-background rounded-lg px-3 py-2"
            />

            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                sport === "strength"
                  ? "Describe the workout in plain language. e.g. 'Back squat 4x6 RPE 8, Romanian deadlift 3x10, leg press 3x15 rest 2 min, dumbbell row 4x12, bicep curl 3x12-15...'"
                  : "Describe the session in plain language. e.g. '4x1km at 4:30 pace, 90s rest, then 2km tempo'"
              }
              className="min-h-[180px] resize-y text-sm bg-muted/30 border-transparent hover:border-input focus:bg-background rounded-xl"
              disabled={isParsing}
            />

            <div className="flex flex-wrap gap-2 items-center">
              <Button
                size="sm"
                variant={isRecording ? "destructive" : "secondary"}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isParsing}
                className="gap-1.5"
              >
                {isRecording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
                {isRecording ? "Stop" : "Voice"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setInput("");
                  setResult(null);
                  setError("");
                  setElapsedMs(null);
                }}
                disabled={isParsing}
                className="gap-1.5"
              >
                <Type className="w-3.5 h-3.5" />
                Clear
              </Button>
              <div className="flex-1" />
              <Button onClick={parse} disabled={!input.trim() || isParsing} className="gap-1.5">
                {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isParsing ? "Parsing..." : "Parse"}
              </Button>
            </div>

            {error ? (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
                {error}
              </div>
            ) : null}
          </div>

          {/* Result pane */}
          <div className="rounded-2xl border bg-card p-4 flex flex-col gap-3 min-h-[300px]">
            {!result && !isParsing ? (
              <p className="text-sm text-muted-foreground italic">
                Output will appear here. Try a 12-exercise session, a voice transcript with corrections,
                or anything ambiguous.
              </p>
            ) : null}

            {isParsing ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Parsing...
              </div>
            ) : null}

            {result ? <ResultView result={result} elapsedMs={elapsedMs} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultView({ result, elapsedMs }: { result: ParseResult; elapsedMs: number | null }) {
  const exCount = result.exercises?.length ?? 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Pill ok={result.ok} label={result.ok ? "ok" : `failed: ${result.reason ?? "unknown"}`} />
        {result.name ? <span className="text-muted-foreground">{result.name}</span> : null}
        {result.sport ? <span className="text-muted-foreground">· {result.sport}</span> : null}
        {result.ok ? <span className="text-muted-foreground">· {exCount} exercise{exCount === 1 ? "" : "s"}</span> : null}
        {elapsedMs != null ? <span className="text-muted-foreground">· {elapsedMs} ms</span> : null}
        {result.usage?.total_tokens != null ? (
          <span className="text-muted-foreground">
            · {result.usage.prompt_tokens ?? 0} in / {result.usage.completion_tokens ?? 0} out
          </span>
        ) : null}
      </div>

      {result.message ? (
        <p className="text-sm text-muted-foreground italic">{result.message}</p>
      ) : null}

      {result.exercises && result.exercises.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1.5 pr-3 font-medium">#</th>
                <th className="py-1.5 pr-3 font-medium">Name</th>
                <th className="py-1.5 pr-3 font-medium">Sets</th>
                <th className="py-1.5 pr-3 font-medium">Reps</th>
                <th className="py-1.5 pr-3 font-medium">Detail</th>
                <th className="py-1.5 pr-3 font-medium">Notes</th>
                <th className="py-1.5 font-medium">Conf</th>
              </tr>
            </thead>
            <tbody>
              {result.exercises.map((ex, i) => {
                const detailParts = [
                  ex.weight,
                  ex.rpe ? `RPE ${ex.rpe}` : null,
                  ex.tempo ? `tempo ${ex.tempo}` : null,
                  ex.rest ? `rest ${ex.rest}` : null,
                  ex.distance,
                  ex.duration,
                  ex.pace,
                  ex.effort,
                ].filter(Boolean) as string[];
                return (
                  <tr key={i} className="border-b border-muted/30 align-top">
                    <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-3 font-medium">{ex.name}</td>
                    <td className="py-2 pr-3 tabular-nums">{ex.sets}</td>
                    <td className="py-2 pr-3 tabular-nums">{ex.reps || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{detailParts.join(" · ") || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{ex.notes ?? "—"}</td>
                    <td className="py-2">
                      {ex.confidence === "low" ? (
                        <span className="text-amber-600 font-medium">low</span>
                      ) : (
                        <span className="text-muted-foreground">high</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <details className="text-xs mt-2">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Raw model output
        </summary>
        <pre className="mt-2 p-3 bg-muted/30 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">
          {result.rawModelOutput ?? "(none)"}
        </pre>
      </details>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Full ParseResult JSON
        </summary>
        <pre className="mt-2 p-3 bg-muted/30 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium rounded-full px-2 py-0.5 ${
        ok
          ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
          : "bg-rose-100 text-rose-700 border border-rose-200"
      }`}
    >
      {label}
    </span>
  );
}
