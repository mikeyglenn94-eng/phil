import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { X, ChevronUp } from "lucide-react";
import { formatMmSs } from "@/lib/parse-rest";

export interface NextSetInfo {
  label: string;
  scrollAndFocus: () => void;
}

interface StartOpts {
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  totalSets: number;
  restSeconds: number;
}

interface RestTimerContextValue {
  active: boolean;
  start: (opts: StartOpts) => void;
  dismiss: () => void;
  setNextSet: (info: NextSetInfo | null) => void;
  isRunningFor: (exerciseId: string, setIndex: number) => boolean;
}

const RestTimerContext = createContext<RestTimerContextValue | null>(null);

export function useRestTimer() {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error("useRestTimer must be used within RestTimerProvider");
  return ctx;
}

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [exerciseId, setExerciseId] = useState<string>("");
  const [exerciseName, setExerciseName] = useState("");
  const [setIndex, setSetIndex] = useState(0);
  const [totalSets, setTotalSets] = useState(0);
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [nextSet, setNextSetState] = useState<NextSetInfo | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endsAtRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Preload chime once.
  useEffect(() => {
    try {
      const a = new Audio(`${import.meta.env.BASE_URL}sounds/rest-done.mp3`);
      a.preload = "auto";
      a.volume = 0.4;
      audioRef.current = a;
    } catch {
      audioRef.current = null;
    }
  }, []);

  const playChime = useCallback(() => {
    const a = audioRef.current;
    const tryFile = a
      ? (() => {
          try {
            a.currentTime = 0;
            return a.play();
          } catch {
            return Promise.reject();
          }
        })()
      : Promise.reject();

    Promise.resolve(tryFile).catch(() => {
      // Synthesised fallback — soft 880Hz sine with a quick decay envelope.
      try {
        const Ctx: typeof AudioContext | undefined =
          (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.65);
        setTimeout(() => ctx.close().catch(() => {}), 800);
      } catch {
        /* silent */
      }
    });
  }, []);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    stopInterval();
    setActive(false);
    setMinimized(false);
    setPulsing(false);
    setNextSetState(null);
    finishedRef.current = false;
  }, [stopInterval]);

  const start = useCallback((opts: StartOpts) => {
    const sec = Math.max(0, Math.floor(opts.restSeconds || 0));
    if (sec <= 0) return; // nothing to time
    stopInterval();
    finishedRef.current = false;
    setExerciseId(opts.exerciseId);
    setExerciseName(opts.exerciseName);
    setSetIndex(opts.setIndex);
    setTotalSets(opts.totalSets);
    setTotal(sec);
    setRemaining(sec);
    setMinimized(false);
    setPulsing(false);
    setActive(true);
    endsAtRef.current = Date.now() + sec * 1000;

    intervalRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((endsAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !finishedRef.current) {
        finishedRef.current = true;
        stopInterval();
        playChime();
        // Pulse twice: 200ms × 2 = 400ms total.
        setPulsing(true);
        setTimeout(() => setPulsing(false), 420);
      }
    }, 250);
  }, [stopInterval, playChime]);

  const setNextSet = useCallback((info: NextSetInfo | null) => {
    setNextSetState(info);
  }, []);

  const isRunningFor = useCallback(
    (exId: string, idx: number) => active && exerciseId === exId && setIndex === idx,
    [active, exerciseId, setIndex],
  );

  useEffect(() => () => stopInterval(), [stopInterval]);

  return (
    <RestTimerContext.Provider value={{ active, start, dismiss, setNextSet, isRunningFor }}>
      {children}
      {active && (
        <RestTimerOverlay
          remaining={remaining}
          total={total}
          exerciseName={exerciseName}
          setIndex={setIndex}
          totalSets={totalSets}
          minimized={minimized}
          pulsing={pulsing}
          onDismiss={dismiss}
          onMinimize={() => setMinimized(true)}
          onExpand={() => setMinimized(false)}
          nextSet={nextSet}
        />
      )}
    </RestTimerContext.Provider>
  );
}

interface OverlayProps {
  remaining: number;
  total: number;
  exerciseName: string;
  setIndex: number;
  totalSets: number;
  minimized: boolean;
  pulsing: boolean;
  onDismiss: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  nextSet: NextSetInfo | null;
}

function RestTimerOverlay(p: OverlayProps) {
  const touchStartY = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartY.current;
    touchStartY.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientY ?? start;
    if (end - start > 30) p.onMinimize();
  };

  const pct = p.total > 0 ? Math.max(0, Math.min(1, p.remaining / p.total)) : 0;
  const mmss = formatMmSs(p.remaining);
  const done = p.remaining <= 0;

  // Mini pill — bottom-right, 40px, just shows MM:SS, tap to expand.
  if (p.minimized) {
    return (
      <button
        type="button"
        onClick={p.onExpand}
        aria-label={`Rest timer ${mmss} remaining, tap to expand`}
        className={`fixed z-50 right-4 bottom-4 h-10 px-3 rounded-full bg-neutral-900 text-white shadow-lg border border-white/10 inline-flex items-center gap-2 font-bold tabular-nums text-sm transition-transform active:scale-95 ${p.pulsing ? "animate-rest-pulse" : ""}`}
        style={{ fontFamily: '"Outfit", system-ui, sans-serif', fontWeight: 700 }}
      >
        <span className={`w-2 h-2 rounded-full ${done ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
        <span>{mmss}</span>
      </button>
    );
  }

  return (
    <>
      {/* Next-set floating pill — sits above the timer. Hidden when no next set. */}
      {p.nextSet && (
        <button
          type="button"
          onClick={() => p.nextSet?.scrollAndFocus()}
          aria-label={`Jump to ${p.nextSet.label}`}
          className="fixed z-40 left-1/2 -translate-x-1/2 h-10 px-4 rounded-full bg-white text-neutral-900 shadow-lg border border-neutral-200 inline-flex items-center gap-2 text-sm font-semibold active:scale-95 transition-transform"
          style={{ bottom: "96px" }}
        >
          <span>{p.nextSet.label}</span>
          <span aria-hidden>→</span>
        </button>
      )}

      <div
        role="region"
        aria-label="Rest timer"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={p.onDismiss}
        className={`fixed z-40 inset-x-0 bottom-0 h-20 bg-neutral-900 text-white border-t border-white/10 shadow-2xl select-none cursor-pointer ${p.pulsing ? "animate-rest-pulse" : ""}`}
      >
        {/* progress bar at top edge */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10">
          <div
            className={`h-full ${done ? "bg-emerald-400" : "bg-amber-400"} transition-[width] duration-200 ease-linear`}
            style={{ width: `${pct * 100}%` }}
          />
        </div>

        {/* drag handle */}
        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/20" />

        <div className="h-full flex items-center justify-between px-4 pt-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-white/50 font-semibold">
              {done ? "Rest done" : "Rest"}
            </div>
            <div className="text-xs text-white/80 truncate max-w-[58vw]">
              <span className="font-semibold">{p.exerciseName}</span>
              <span className="text-white/50"> · Set {p.setIndex + 1} of {p.totalSets}</span>
            </div>
          </div>

          <div
            className="text-3xl font-bold tabular-nums leading-none"
            style={{ fontFamily: '"Outfit", system-ui, sans-serif', fontWeight: 700 }}
            aria-live="polite"
          >
            {mmss}
          </div>

          <div className="flex items-center gap-1 ml-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); p.onMinimize(); }}
              aria-label="Minimise rest timer"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 inline-flex items-center justify-center"
            >
              <ChevronUp className="w-4 h-4 rotate-180" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); p.onDismiss(); }}
              aria-label="Dismiss rest timer"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 inline-flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
