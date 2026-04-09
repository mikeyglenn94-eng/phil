/**
 * Shared Workout Preview / Inline Editor
 * Used in: creation flow (client-area.tsx) + edit-saved-workout (client-session.tsx)
 */

// ── Types ──────────────────────────────────────────────────────────────────────
export interface EditableRow {
  id: string;
  label: string;    // "Minute 1", "Warm-up", exercise number etc.
  name: string;     // movement / exercise / segment description
  // strength
  sets: string; reps: string; weight: string; rpe: string; rest: string; tempo: string;
  // wod / run
  value: string;    // can be "35" or "12-18" for ranges
  unit: string;
  load: string;
  notes: string;
}

export interface EditableSession {
  title: string;
  type: "strength" | "wod" | "run";
  format: string;
  summary: string;
  durationMinutes: string;
  rows: EditableRow[];
  repeatNote: string;
  restNote: string;
  rounds: string;    // editable round count
  _raw: any;
}

// ── Constants ──────────────────────────────────────────────────────────────────
export const FORMAT_LABELS: Record<string, string> = {
  emom: "EMOM", amrap: "AMRAP", for_time: "For Time", chipper: "Chipper",
  intervals: "Intervals", interval: "Intervals", rounds_for_time: "Rounds For Time", custom: "Custom",
};

export function blankRow(id: string, label = ""): EditableRow {
  return { id, label, name: "", sets: "", reps: "", weight: "", rpe: "", rest: "", tempo: "", value: "", unit: "reps", load: "", notes: "" };
}

// ── Converters: session object → EditableSession ───────────────────────────────
export function parseStrengthToEditable(session: any): EditableSession {
  const rows: EditableRow[] = (session.exercises ?? []).map((ex: any, i: number) => ({
    id: ex.id || `row-${i}`,
    label: "",
    name: ex.name ?? "",
    sets: ex.sets != null ? String(ex.sets) : "",
    reps: ex.reps != null ? String(ex.reps) : "",
    weight: ex.weight ?? "",
    rpe: ex.rpe ?? "",
    rest: ex.rest ?? "",
    tempo: ex.tempo ?? "",
    value: "", unit: "reps", load: "",
    notes: ex.notes ?? "",
  }));
  const totalSets = rows.reduce((s, r) => s + (Number(r.sets) || 0), 0);
  return {
    title: session.name || "Strength Session",
    type: "strength", format: "",
    summary: rows.length ? `${rows.length} exercise${rows.length > 1 ? "s" : ""}${totalSets ? ` · ${totalSets} sets` : ""}` : "",
    durationMinutes: "", rows, repeatNote: "", restNote: "", rounds: "",
    _raw: session,
  };
}

export function parseWodToEditable(opt: any): EditableSession {
  const canonical = opt.wod;
  const rows: EditableRow[] = [];
  if (canonical?.blocks?.length) {
    for (const block of canonical.blocks) {
      for (const step of (block.steps ?? [])) {
        // Prefer targetText for ranges, otherwise numeric value
        const rawVal = step.target?.targetText
          ? step.target.targetText.replace(/[^\d\-–.]/g, "").replace("–", "-")
          : step.target?.valueRange
            ? `${step.target.valueRange[0]}-${step.target.valueRange[1]}`
            : step.target?.value != null ? String(step.target.value) : "";
        rows.push({
          id: step.id ?? `row-${rows.length}`,
          label: step.label ?? "",
          name: step.movement?.name ?? "",
          sets: "", reps: "", weight: "", rpe: "", rest: "", tempo: "",
          value: rawVal,
          unit: step.target?.unit ?? "reps",
          load: step.load?.display ?? "",
          notes: "",
        });
      }
    }
  } else {
    for (const ex of (opt.exercises ?? [])) {
      rows.push({ ...blankRow(ex.id || `row-${rows.length}`), name: ex.name ?? "" });
    }
  }
  const dur = canonical?.totalDurationSeconds ? String(Math.round(canonical.totalDurationSeconds / 60)) : "";
  const fmtLabel = FORMAT_LABELS[opt.format] ?? opt.format?.toUpperCase() ?? "WOD";
  const block0 = canonical?.blocks?.[0];
  return {
    title: opt.name || fmtLabel,
    type: "wod",
    format: opt.format ?? "amrap",
    summary: dur ? `${dur} min ${fmtLabel}` : fmtLabel,
    durationMinutes: dur,
    rows,
    repeatNote: opt.repeatNote ?? "",
    restNote: opt.restNote ?? "",
    rounds: block0?.rounds != null ? String(block0.rounds) : "",
    _raw: opt,
  };
}

export function parseRunToEditable(session: any): EditableSession {
  const rows: EditableRow[] = (session.segments ?? []).map((seg: any, i: number) => ({
    id: `seg-${i}`,
    label: seg.label ?? "",
    name: seg.description ?? "",
    sets: "", reps: seg.reps != null ? String(seg.reps) : "", weight: "", rpe: "", rest: seg.rest ?? "", tempo: "",
    value: seg.distance ?? seg.duration ?? "", unit: "", load: "",
    notes: seg.effort ?? "",
  }));
  if (!rows.length && session.structure) {
    rows.push({ ...blankRow("seg-0", "Session"), name: session.structure, notes: session.intensity ?? "" });
  }
  const parts: string[] = [];
  if (session.duration) parts.push(`${session.duration} min`);
  if (session.distanceKm) parts.push(`${session.distanceKm} km`);
  if (session.intensity) parts.push(session.intensity);
  return {
    title: session.name || "Run Session",
    type: "run", format: session.intensity ?? "Run",
    summary: parts.join(" · "),
    durationMinutes: session.duration ? String(session.duration) : "",
    rows, repeatNote: "", restNote: "", rounds: "",
    _raw: session,
  };
}

export function sessionToEditable(session: any): EditableSession {
  const src = (session?.source ?? "").toLowerCase();
  if (src === "wod_brain") return parseWodToEditable(session);
  if (src === "run_brain" || src === "endurance_cycle") return parseRunToEditable(session);
  return parseStrengthToEditable(session);
}

// ── Converter: EditableSession → canonical save object ─────────────────────────
export function editableSessionToSession(es: EditableSession): any {
  const now = Date.now();

  if (es.type === "strength") {
    const exercises = es.rows.map((r, i) => ({
      id: r.id || `ex-${now}-${i}`,
      name: r.name,
      sets: r.sets ? Number(r.sets) : null,
      reps: r.reps || null,
      rpe: r.rpe || null,
      rest: r.rest || null,
      tempo: r.tempo || null,
      notes: r.notes || null,
      weight: r.weight || null,
      rawText: [r.sets && r.reps ? `${r.sets}×${r.reps}` : null, r.weight, r.name].filter(Boolean).join(" "),
      weekProgression: [], clientComment: null,
      perSetReps: null, perSetRpe: null, setWeights: null, setReps: null,
    }));
    return { ...es._raw, name: es.title || es._raw?.name, source: "strength_block", exercises };
  }

  if (es.type === "run") {
    const segments = es.rows.map((r) => ({
      label: r.label, description: r.name, distance: r.value || null, effort: r.notes || null,
      rest: r.rest || null, reps: r.reps ? Number(r.reps) : null,
    }));
    const exercises = [{
      id: es._raw?.exercises?.[0]?.id || `ex-${now}-0`,
      name: es.title,
      sets: null, reps: null, rpe: null, rest: null, tempo: null,
      notes: es.summary,
      rawText: es.rows.map(r => [r.reps ? `${r.reps}×` : "", r.value, r.name, r.notes].filter(Boolean).join(" ")).join(" · "),
      weekProgression: [], clientComment: null,
      perSetReps: null, perSetRpe: null, setWeights: null, setReps: null, weight: null,
    }];
    return {
      ...es._raw, name: es.title || es._raw?.name, source: "run_brain",
      structure: es.rows.map(r => [r.label, r.reps ? `${r.reps}×` : "", r.name, r.notes].filter(Boolean).join(" ")).join(" · "),
      segments, exercises,
    };
  }

  // WOD
  const durationMin = es.durationMinutes ? Number(es.durationMinutes) : undefined;
  const rounds = es.rounds ? Number(es.rounds) : undefined;
  const wodBlocks = [{
    id: "block-0", type: es.format,
    durationSeconds: durationMin != null ? durationMin * 60 : undefined,
    ...(rounds != null ? { rounds } : {}),
    steps: es.rows.map((r, idx) => {
      // Parse range strings like "12-18" or "10-12"
      const rawVal = r.value.trim();
      const rangeMatch = rawVal.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
      const numVal = rangeMatch ? null : (rawVal !== "" ? Number(rawVal) : undefined);
      const valueRange: [number, number] | undefined = rangeMatch
        ? [Number(rangeMatch[1]), Number(rangeMatch[2])]
        : undefined;
      const targetText = rangeMatch ? `${rangeMatch[1]}–${rangeMatch[2]} ${r.unit}` : undefined;
      const targetType = r.unit === "seconds" ? "seconds"
        : (r.unit === "m" || r.unit === "km") ? "distance"
        : r.unit === "cal" ? "calories" : "reps";
      return {
        id: r.id || `step-${idx}`,
        ...(r.label ? { label: r.label } : {}),
        movement: { name: r.name },
        target: {
          type: targetType,
          ...(numVal != null ? { value: numVal } : {}),
          ...(valueRange ? { valueRange } : {}),
          ...(targetText ? { targetText } : {}),
          unit: r.unit,
        },
        ...(r.load ? { load: { display: r.load } } : {}),
      };
    }),
  }];

  const exercises = es.rows.map((r, idx) => {
    const notes = r.value ? (r.load ? `${r.value} ${r.unit} (${r.load})` : `${r.value} ${r.unit}`) : (r.load || "");
    return {
      id: r.id || `ex-${now}-${idx}`,
      name: r.name,
      sets: null, reps: null, rpe: null, rest: null, tempo: null,
      notes, rawText: `${notes} ${r.name}`.trim(),
      weekProgression: [], clientComment: null,
      perSetReps: null, perSetRpe: null, setWeights: null, setReps: null, weight: null,
    };
  });

  return {
    ...es._raw,
    name: es.title || es._raw?.name || "WOD",
    format: es.format,
    structure: es._raw?.structure ?? "",
    repeatNote: es.repeatNote, restNote: es.restNote,
    wod: {
      format: es.format,
      totalDurationSeconds: durationMin != null ? durationMin * 60 : undefined,
      blocks: wodBlocks,
    },
    exercises,
  };
}

// ── WorkoutPreviewEditorCard component ─────────────────────────────────────────
interface Props {
  editableSession: EditableSession;
  onChange: (updated: EditableSession) => void;
  /** Optional: "compact" hides the footer status bar */
  compact?: boolean;
}

function setRow(es: EditableSession, ri: number, patch: Partial<EditableRow>): EditableSession {
  const rows = [...es.rows];
  rows[ri] = { ...rows[ri], ...patch };
  return { ...es, rows };
}

export function WorkoutPreviewEditorCard({ editableSession: es, onChange, compact }: Props) {
  const TYPE_BADGE: Record<string, string> = {
    strength: "bg-amber-100 text-amber-700",
    run: "bg-emerald-100 text-emerald-700",
    wod: "bg-violet-100 text-violet-700",
  };

  const badgeLabel = es.type === "wod"
    ? (FORMAT_LABELS[es.format] ?? (es.format ? es.format.toUpperCase() : "WOD"))
    : es.type === "run"
    ? (es.format || "Run")
    : "Strength";

  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm">

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 space-y-1.5">
        {/* Badge + Duration row */}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0 ${TYPE_BADGE[es.type] ?? "bg-primary/10 text-primary/70"}`}>
            {badgeLabel}
          </span>
          <div className="flex-1" />
          {(es.type === "wod" || es.type === "run") && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                className="w-10 text-xs text-right bg-transparent border-none outline-none focus:ring-0 text-muted-foreground font-mono tabular-nums"
                value={es.durationMinutes}
                onChange={e => onChange({ ...es, durationMinutes: e.target.value })}
                placeholder="—"
                min={1}
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          )}
        </div>

        {/* Title */}
        <input
          className="w-full text-lg font-bold bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/40 leading-tight"
          value={es.title}
          onChange={e => onChange({ ...es, title: e.target.value })}
          placeholder="Workout title…"
        />

        {/* Summary */}
        {es.summary && (
          <p className="text-xs text-muted-foreground">{es.summary}</p>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="border-t border-border/40" />

      {/* ── Rows ── */}
      <div className="px-4 py-3 space-y-2">
        {es.rows.map((row, ri) => (
          <div key={row.id} className="flex items-start gap-2">
            {/* Bullet */}
            <span className="w-1.5 h-1.5 rounded-full bg-primary/30 shrink-0 mt-[7px]" />

            <div className="flex-1 min-w-0">
              {/* Label on its own line when present */}
              {row.label && (
                <input
                  className="w-full text-[11px] text-muted-foreground/60 italic bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/25 mb-0.5 leading-none"
                  value={row.label}
                  onChange={e => onChange(setRow(es, ri, { label: e.target.value }))}
                  placeholder="label…"
                />
              )}
              {!row.label && es.type !== "strength" && (
                <input
                  className="w-0 h-0 p-0 border-none outline-none opacity-0 absolute"
                  value={row.label}
                  onChange={e => onChange(setRow(es, ri, { label: e.target.value }))}
                  aria-hidden
                />
              )}

              {/* Name (primary) */}
              <input
                className="w-full text-sm font-semibold bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/40 leading-snug"
                value={row.name}
                onChange={e => onChange(setRow(es, ri, { name: e.target.value }))}
                placeholder={es.type === "strength" ? "Exercise name…" : es.type === "run" ? "Describe this segment…" : "Movement…"}
              />

              {/* Type-specific fields */}
              {es.type === "strength" && (
                <div className="flex items-center gap-1.5 mt-0.5 text-xs font-mono text-muted-foreground flex-wrap">
                  <input className="w-8 bg-transparent border-none outline-none focus:ring-0 tabular-nums text-right placeholder:text-muted-foreground/30"
                    value={row.sets} placeholder="—"
                    onChange={e => onChange(setRow(es, ri, { sets: e.target.value }))}
                  />
                  <span className="text-muted-foreground/40">×</span>
                  <input className="w-10 bg-transparent border-none outline-none focus:ring-0 tabular-nums placeholder:text-muted-foreground/30"
                    value={row.reps} placeholder="reps"
                    onChange={e => onChange(setRow(es, ri, { reps: e.target.value }))}
                  />
                  <input className="w-16 bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/30"
                    value={row.weight} placeholder="kg/lb…"
                    onChange={e => onChange(setRow(es, ri, { weight: e.target.value }))}
                  />
                  {(row.rpe || row.rest) && (
                    <>
                      {row.rpe !== "" && (
                        <span className="flex items-center gap-0.5">
                          <span className="text-muted-foreground/40">RPE</span>
                          <input className="w-8 bg-transparent border-none outline-none focus:ring-0 tabular-nums placeholder:text-muted-foreground/25"
                            value={row.rpe} placeholder="—"
                            onChange={e => onChange(setRow(es, ri, { rpe: e.target.value }))}
                          />
                        </span>
                      )}
                    </>
                  )}
                  {row.rest && (
                    <input className="w-16 bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/25"
                      value={row.rest} placeholder="rest…"
                      onChange={e => onChange(setRow(es, ri, { rest: e.target.value }))}
                    />
                  )}
                </div>
              )}

              {es.type === "wod" && (
                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                  <input
                    className="w-16 font-mono tabular-nums bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/30"
                    value={row.value} placeholder="amount…"
                    onChange={e => onChange(setRow(es, ri, { value: e.target.value }))}
                    title="Enter a number (35) or range (12-18)"
                  />
                  <select
                    className="text-[11px] bg-transparent border-none outline-none focus:ring-0 cursor-pointer"
                    value={row.unit}
                    onChange={e => onChange(setRow(es, ri, { unit: e.target.value }))}
                  >
                    <option value="reps">reps</option>
                    <option value="seconds">sec</option>
                    <option value="m">m</option>
                    <option value="km">km</option>
                    <option value="cal">cal</option>
                  </select>
                  {(row.load !== undefined) && (
                    <input
                      className="w-16 font-mono bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/25"
                      value={row.load} placeholder="load…"
                      onChange={e => onChange(setRow(es, ri, { load: e.target.value }))}
                    />
                  )}
                </div>
              )}

              {es.type === "run" && (
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                  <input className="w-16 font-mono bg-transparent border-none outline-none focus:ring-0 tabular-nums placeholder:text-muted-foreground/25"
                    value={row.value} placeholder="dist…"
                    onChange={e => onChange(setRow(es, ri, { value: e.target.value }))}
                  />
                  <input className="w-20 italic bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/25"
                    value={row.notes} placeholder="effort…"
                    onChange={e => onChange(setRow(es, ri, { notes: e.target.value }))}
                  />
                  {(row.reps || row.rest) && (
                    <input className="w-16 bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/25"
                      value={row.rest} placeholder="rest…"
                      onChange={e => onChange(setRow(es, ri, { rest: e.target.value }))}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Label add trigger for rows without labels */}
            {!row.label && es.type !== "strength" && (
              <button
                className="text-[10px] text-muted-foreground/30 hover:text-muted-foreground/60 shrink-0 mt-1 transition-colors"
                onClick={() => onChange(setRow(es, ri, { label: es.type === "wod" ? `Minute ${ri + 1}` : "Segment" }))}
                title="Add label"
              >
                +lbl
              </button>
            )}
          </div>
        ))}

        {/* Add row button */}
        <button
          className="text-[11px] text-primary/50 hover:text-primary transition-colors mt-1 ml-3.5"
          onClick={() => onChange({ ...es, rows: [...es.rows, blankRow(`row-new-${Date.now()}`)] })}
        >
          {es.type === "strength" ? "+ Add exercise" : es.type === "run" ? "+ Add segment" : "+ Add movement"}
        </button>
      </div>

      {/* ── Repeat / Rest / Rounds (WOD + Run) ── */}
      {(es.repeatNote || es.restNote || es.rounds || es.type === "wod") && (
        <div className="border-t border-border/40 px-4 py-2.5 space-y-1.5">
          {(es.type === "wod") && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/50 w-3.5 shrink-0">×</span>
              <span className="text-xs text-muted-foreground shrink-0">Rounds:</span>
              <input
                className="w-10 text-xs font-mono bg-transparent border-none outline-none focus:ring-0 tabular-nums placeholder:text-muted-foreground/30"
                value={es.rounds}
                onChange={e => onChange({ ...es, rounds: e.target.value })}
                placeholder="—"
                type="number"
                min={1}
              />
              {es.durationMinutes && es.rows.length > 0 && es.rounds && (
                <span className="text-[10px] text-muted-foreground/50 ml-1">
                  ({es.durationMinutes} min ÷ {es.rows.length} mvt = {Math.round(Number(es.durationMinutes) / es.rows.length)} min/set)
                </span>
              )}
            </div>
          )}
          {es.repeatNote && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/50 w-3.5 shrink-0">↻</span>
              <input
                className="flex-1 text-xs text-muted-foreground bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/25"
                value={es.repeatNote}
                onChange={e => onChange({ ...es, repeatNote: e.target.value })}
                placeholder="Repeat logic…"
              />
            </div>
          )}
          {es.restNote && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/50 w-3.5 shrink-0">⏸</span>
              <input
                className="flex-1 text-xs text-muted-foreground bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/25"
                value={es.restNote}
                onChange={e => onChange({ ...es, restNote: e.target.value })}
                placeholder="Rest note…"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      {!compact && (
        <div className="border-t border-border/40 px-4 py-2 bg-emerald-50/60 dark:bg-emerald-950/20">
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
            ✓ Ready to save — tap any field to edit
          </p>
        </div>
      )}
    </div>
  );
}
