/**
 * Shared Workout Preview / Inline Editor
 * Used in: creation flow (client-area.tsx) + edit-saved-workout (client-session.tsx)
 *
 * Design: each row is a single-line readable text. Tap to edit inline.
 * Progressive disclosure: advanced fields hidden behind "···" expand.
 */

import { useState, useRef, useEffect } from "react";
import { GripVertical, X, Plus, MoreHorizontal, ChevronDown } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface EditableRow {
  id: string;
  label: string;    // "Minute 1", "Warm-up", etc.
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
  rounds: string;
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

// ── Row text helpers ───────────────────────────────────────────────────────────

/** Render a row as a single human-readable line */
function rowToText(row: EditableRow, type: EditableSession["type"]): string {
  if (type === "wod") {
    const labelPart = row.label ? `${row.label} · ` : "";
    const unitStr = row.unit && row.unit !== "reps" ? ` ${row.unit}` : "";
    const amountPart = row.value ? ` · ${row.value}${unitStr}` : "";
    const loadPart = row.load ? ` @ ${row.load}` : "";
    return `${labelPart}${row.name}${amountPart}${loadPart}`.trim();
  }
  if (type === "strength") {
    const scheme = row.sets && row.reps
      ? ` · ${row.sets}×${row.reps}`
      : row.reps
      ? ` · ${row.reps} reps`
      : "";
    const wt = row.weight ? ` @ ${row.weight}` : "";
    const rpe = row.rpe ? ` RPE ${row.rpe}` : "";
    return `${row.name}${scheme}${wt}${rpe}`.trim();
  }
  // run
  const labelPart = row.label ? `${row.label} · ` : "";
  const repsPart = row.reps ? `${row.reps} × ` : "";
  const distPart = row.value ? `${row.value} · ` : "";
  const notesPart = row.notes ? ` · ${row.notes}` : "";
  return `${labelPart}${repsPart}${distPart}${row.name}${notesPart}`.trim();
}

/** Parse a natural-language line back to row fields */
function textToRow(text: string, type: EditableSession["type"], existing: EditableRow): EditableRow {
  const t = text.trim();
  if (!t) return { ...existing, name: "" };

  if (type === "wod") {
    // Extract load after last " @ "
    let rest = t;
    let load = existing.load;
    const atIdx = t.lastIndexOf(" @ ");
    if (atIdx !== -1) {
      load = t.slice(atIdx + 3).trim();
      rest = t.slice(0, atIdx).trim();
    }
    // Split on "·" or "•"
    const parts = rest.split(/\s*[·•]\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const amountStr = parts[parts.length - 1];
      const am = amountStr.match(/^([\d\-–]+(?:\.\d+)?)\s*(.*)$/);
      return {
        ...existing,
        label: parts.slice(0, parts.length - 2).join(" · "),
        name: parts[parts.length - 2],
        value: am ? am[1].replace("–", "-") : "",
        unit: am?.[2]?.trim() || existing.unit,
        load,
      };
    } else if (parts.length === 2) {
      const am = parts[1].match(/^([\d\-–]+(?:\.\d+)?)\s*(.*)$/);
      if (am) {
        return { ...existing, name: parts[0], value: am[1].replace("–", "-"), unit: am[2]?.trim() || existing.unit, load };
      }
      // label · movement (no amount detected)
      return { ...existing, label: parts[0], name: parts[1], load };
    }
    return { ...existing, name: rest, load };
  }

  if (type === "strength") {
    // Extract RPE suffix
    const rpeM = t.match(/\s+RPE\s+([\d.]+)\s*$/i);
    const rpe = rpeM ? rpeM[1] : existing.rpe;
    const withoutRpe = rpeM ? t.replace(/\s+RPE\s+[\d.]+\s*$/i, "").trim() : t;
    // Extract weight after "@"
    const wtM = withoutRpe.match(/\s*@\s*([\w/.\s]+)$/);
    const weight = wtM ? wtM[1].trim() : existing.weight;
    const withoutWt = wtM ? withoutRpe.slice(0, withoutRpe.lastIndexOf("@")).trim() : withoutRpe;
    // Split on "·"
    const parts = withoutWt.split(/\s*[·•]\s*/).map(s => s.trim()).filter(Boolean);
    const name = parts[0] || "";
    let sets = existing.sets;
    let reps = existing.reps;
    if (parts[1]) {
      const schemeM = parts[1].match(/^(\d+)\s*[×xX]\s*(\S+)$/);
      if (schemeM) { sets = schemeM[1]; reps = schemeM[2]; }
      else { reps = parts[1].replace(/\s*reps?\s*$/i, "").trim(); }
    }
    return { ...existing, name, sets, reps, weight, rpe };
  }

  // run
  const parts = t.split(/\s*[·•]\s*/).map(s => s.trim()).filter(Boolean);
  const repsM = parts[0]?.match(/^(\d+)\s*[×x]\s*$/);
  if (repsM && parts.length > 1) {
    const remainder = parts.slice(1).join(" · ");
    const distM = remainder.match(/^([\d.]+\s*(?:km|m|mi)?)\s*·?\s*(.*)$/i);
    if (distM) {
      return { ...existing, reps: repsM[1], value: distM[1].trim(), name: distM[2].trim() || existing.name };
    }
    return { ...existing, reps: repsM[1], name: remainder };
  }
  // value · description  or  just description
  if (parts.length >= 2) {
    const distM = parts[0].match(/^([\d.]+\s*(?:km|m|mi)?)$/i);
    if (distM) {
      return { ...existing, value: distM[1].trim(), name: parts.slice(1).join(" · ") };
    }
  }
  return { ...existing, name: parts.join(" · ") };
}

function rowPlaceholder(type: EditableSession["type"], index: number): string {
  if (type === "wod") return index === 0 ? "e.g. Min 1 · Bike Erg · 12 cal" : "Movement · amount";
  if (type === "strength") return "e.g. Back Squat · 5×5 @ 100kg";
  return "e.g. 5 × 1 km · tempo";
}

// ── PreviewRow component ───────────────────────────────────────────────────────
interface PreviewRowProps {
  row: EditableRow;
  type: EditableSession["type"];
  isActive: boolean;
  isExpanded: boolean;
  editingText: string;
  index: number;
  onActivate: () => void;
  onEditChange: (v: string) => void;
  onCommit: () => void;
  onDelete: () => void;
  onAddBelow: () => void;
  onToggleExpand: () => void;
  onChangeField: (patch: Partial<EditableRow>) => void;
}

function PreviewRow({
  row, type, isActive, isExpanded, editingText, index,
  onActivate, onEditChange, onCommit, onDelete, onAddBelow, onToggleExpand, onChangeField,
}: PreviewRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isActive) {
      // Small delay so the input is mounted
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        // Place cursor at end
        const len = inputRef.current?.value.length ?? 0;
        inputRef.current?.setSelectionRange(len, len);
      });
    }
  }, [isActive]);

  const displayText = rowToText(row, type);
  const hasContent = row.name.trim() !== "";

  return (
    <div className="group/row">
      <div className="flex items-center gap-1 min-h-[44px]">
        {/* Drag handle */}
        <span className="text-muted-foreground/15 group-hover/row:text-muted-foreground/35 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none transition-colors">
          <GripVertical className="w-3.5 h-3.5" />
        </span>

        {/* Main editable area */}
        <div className="flex-1 min-w-0 py-0.5">
          {isActive ? (
            <input
              ref={inputRef}
              className="w-full text-sm bg-transparent border-none outline-none focus:ring-0 leading-snug py-1 text-foreground"
              value={editingText}
              onChange={e => onEditChange(e.target.value)}
              onBlur={onCommit}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); onCommit(); }
                if (e.key === "Escape") { onCommit(); }
              }}
            />
          ) : (
            <button
              type="button"
              className={`w-full text-left text-sm leading-snug py-1 transition-colors ${
                hasContent
                  ? "text-foreground hover:text-foreground/80"
                  : "text-muted-foreground/30 italic"
              }`}
              onClick={onActivate}
            >
              {hasContent ? displayText : rowPlaceholder(type, index)}
            </button>
          )}
        </div>

        {/* Advanced expand */}
        <button
          type="button"
          className={`shrink-0 p-1.5 rounded-md transition-colors ${
            isExpanded
              ? "text-primary bg-primary/10"
              : "text-muted-foreground/20 hover:text-muted-foreground/50 group-hover/row:text-muted-foreground/40"
          }`}
          onClick={onToggleExpand}
          title="Advanced options"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {/* Delete */}
        <button
          type="button"
          className="shrink-0 p-1.5 rounded-md text-muted-foreground/20 hover:text-destructive group-hover/row:text-muted-foreground/40 transition-colors"
          onClick={onDelete}
          title="Remove line"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Advanced panel — progressive disclosure */}
      {isExpanded && (
        <div className="ml-5 mb-1 mt-0.5 grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 rounded-xl bg-muted/40 text-xs">
          {type === "wod" && (
            <>
              <label className="flex items-center gap-2 col-span-2 sm:col-span-1">
                <span className="text-muted-foreground/60 w-8 shrink-0">Load</span>
                <input
                  className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.load}
                  onChange={e => onChangeField({ load: e.target.value })}
                  placeholder="e.g. 20kg"
                />
              </label>
              <label className="flex items-center gap-2 col-span-2 sm:col-span-1">
                <span className="text-muted-foreground/60 w-8 shrink-0">Unit</span>
                <select
                  className="flex-1 bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-foreground font-medium"
                  value={row.unit}
                  onChange={e => onChangeField({ unit: e.target.value })}
                >
                  <option value="reps">reps</option>
                  <option value="seconds">seconds</option>
                  <option value="m">metres</option>
                  <option value="km">km</option>
                  <option value="cal">calories</option>
                </select>
              </label>
            </>
          )}
          {type === "strength" && (
            <>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-8 shrink-0">RPE</span>
                <input
                  className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.rpe}
                  onChange={e => onChangeField({ rpe: e.target.value })}
                  placeholder="e.g. 8"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-8 shrink-0">Rest</span>
                <input
                  className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.rest}
                  onChange={e => onChangeField({ rest: e.target.value })}
                  placeholder="e.g. 90s"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-8 shrink-0">Tempo</span>
                <input
                  className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.tempo}
                  onChange={e => onChangeField({ tempo: e.target.value })}
                  placeholder="e.g. 3-1-1"
                />
              </label>
            </>
          )}
          {type === "run" && (
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground/60 w-8 shrink-0">Rest</span>
              <input
                className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                value={row.rest}
                onChange={e => onChangeField({ rest: e.target.value })}
                placeholder="e.g. 90s jog"
              />
            </label>
          )}
          <label className="flex items-center gap-2 col-span-2">
            <span className="text-muted-foreground/60 w-8 shrink-0">Note</span>
            <input
              className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
              value={row.notes}
              onChange={e => onChangeField({ notes: e.target.value })}
              placeholder="Optional coaching note…"
            />
          </label>
        </div>
      )}
    </div>
  );
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
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [wodFooterOpen, setWodFooterOpen] = useState(false);

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

  function activateRow(ri: number) {
    const row = es.rows[ri];
    setEditingText(rowToText(row, es.type));
    setActiveRowId(row.id);
  }

  function commitEdit() {
    if (!activeRowId) return;
    const ri = es.rows.findIndex(r => r.id === activeRowId);
    if (ri !== -1) {
      const parsed = textToRow(editingText, es.type, es.rows[ri]);
      onChange(setRow(es, ri, parsed));
    }
    setActiveRowId(null);
  }

  function deleteRow(ri: number) {
    setActiveRowId(null);
    onChange({ ...es, rows: es.rows.filter((_, i) => i !== ri) });
  }

  function addRowBelow(ri: number) {
    const newRow = blankRow(`row-${Date.now()}`);
    const rows = [...es.rows];
    rows.splice(ri + 1, 0, newRow);
    onChange({ ...es, rows });
    setEditingText("");
    setActiveRowId(newRow.id);
  }

  function addRowAtEnd() {
    const newRow = blankRow(`row-${Date.now()}`);
    onChange({ ...es, rows: [...es.rows, newRow] });
    setEditingText("");
    setActiveRowId(newRow.id);
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm">

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 space-y-1.5">
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

        <input
          className="w-full text-lg font-bold bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground/40 leading-tight"
          value={es.title}
          onChange={e => onChange({ ...es, title: e.target.value })}
          placeholder="Workout title…"
        />

        {es.summary && (
          <p className="text-xs text-muted-foreground">{es.summary}</p>
        )}
      </div>

      <div className="border-t border-border/40" />

      {/* ── Rows ── */}
      <div className="px-3 py-1 pb-2">
        {es.rows.map((row, ri) => (
          <PreviewRow
            key={row.id}
            row={row}
            type={es.type}
            index={ri}
            isActive={activeRowId === row.id}
            isExpanded={expandedRowId === row.id}
            editingText={activeRowId === row.id ? editingText : ""}
            onActivate={() => activateRow(ri)}
            onEditChange={setEditingText}
            onCommit={commitEdit}
            onDelete={() => deleteRow(ri)}
            onAddBelow={() => addRowBelow(ri)}
            onToggleExpand={() => setExpandedRowId(expandedRowId === row.id ? null : row.id)}
            onChangeField={patch => onChange(setRow(es, ri, patch))}
          />
        ))}

        <button
          type="button"
          className="flex items-center gap-1.5 text-[11px] text-primary/40 hover:text-primary/70 transition-colors mt-1 ml-5 py-1.5 touch-manipulation"
          onClick={addRowAtEnd}
        >
          <Plus className="w-3 h-3" />
          Add line
        </button>
      </div>

      {/* ── WOD footer: rounds / repeat / rest (progressive disclosure) ── */}
      {es.type === "wod" && (es.rounds || es.repeatNote || es.restNote) && (
        <div className="border-t border-border/40">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setWodFooterOpen(o => !o)}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${wodFooterOpen ? "rotate-180" : ""}`} />
            <span className="font-medium">
              {es.rounds ? `× ${es.rounds} rounds` : ""}
              {es.repeatNote ? (es.rounds ? ` · ${es.repeatNote}` : es.repeatNote) : ""}
            </span>
            <span className="ml-auto text-muted-foreground/50">tap to edit</span>
          </button>
          {wodFooterOpen && (
            <div className="px-4 pb-3 space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground/60 w-16 shrink-0">Rounds</span>
                <input
                  type="number"
                  className="w-16 text-xs font-mono bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 tabular-nums"
                  value={es.rounds}
                  onChange={e => onChange({ ...es, rounds: e.target.value })}
                  placeholder="—"
                  min={1}
                />
              </label>
              {es.repeatNote && (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground/60 w-16 shrink-0">Repeat</span>
                  <input
                    className="flex-1 text-xs bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30"
                    value={es.repeatNote}
                    onChange={e => onChange({ ...es, repeatNote: e.target.value })}
                    placeholder="Repeat logic…"
                  />
                </label>
              )}
              {es.restNote && (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground/60 w-16 shrink-0">Rest</span>
                  <input
                    className="flex-1 text-xs bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30"
                    value={es.restNote}
                    onChange={e => onChange({ ...es, restNote: e.target.value })}
                    placeholder="Rest note…"
                  />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Strength/Run: no extra footer needed ── */}

      {/* ── Status bar ── */}
      {!compact && (
        <div className="border-t border-border/40 px-4 py-2 bg-emerald-50/60 dark:bg-emerald-950/20">
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
            ✓ Ready to save — tap any line to edit
          </p>
        </div>
      )}
    </div>
  );
}
