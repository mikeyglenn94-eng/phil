/**
 * Shared Workout Preview / Inline Editor
 * Used in: creation flow (client-area.tsx) + edit-saved-workout (client-session.tsx)
 *
 * Design: inline editable rows feel like editing a note, not a form.
 * WOD multi-segment: buy-in / rounds / cash-out render as labelled groups.
 */

import { useState, useRef, useEffect } from "react";
import { GripVertical, X, Plus, MoreHorizontal, ChevronDown } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface EditableRow {
  id: string;
  label: string;
  name: string;
  sets: string; reps: string; weight: string; rpe: string; rest: string; tempo: string;
  value: string;    // can be "35" or "12-18" for ranges
  unit: string;
  load: string;
  notes: string;
}

/** A labelled block of rows — used for both WOD segments and run blocks */
export interface WodSegment {
  id: string;
  type: "fixed" | "rounds" | "amrap" | "emom" | "interval" | "chipper" | "for_time"
      | "warmup" | "main" | "cooldown" | "recovery" | "strides" | "hills";
  label: string;   // "Buy-in", "4 rounds", "Warm-up", "Main Set", "Cool-down", etc.
  rounds: string;
  rows: EditableRow[];
}

export interface EditableSession {
  title: string;
  type: "strength" | "wod" | "run";
  format: string;
  summary: string;
  durationMinutes: string;
  rows: EditableRow[];           // flat — used for strength/run fallback
  segments?: WodSegment[];       // WOD multi-segment OR run block structure
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

// ── Converters: session → EditableSession ─────────────────────────────────────
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

function stepToRow(step: any, stepIndex: number, segIndex = 0): EditableRow {
  const rawVal = step.target?.targetText
    ? step.target.targetText.replace(/[^\d\-–.]/g, "").replace("–", "-")
    : step.target?.valueRange
      ? `${step.target.valueRange[0]}-${step.target.valueRange[1]}`
      : step.target?.value != null ? String(step.target.value) : "";
  return {
    id: step.id ?? `row-${segIndex}-${stepIndex}`,
    label: step.label ?? "",
    name: step.movement?.name ?? "",
    sets: "", reps: "", weight: "", rpe: "", rest: "", tempo: "",
    value: rawVal,
    unit: step.target?.unit ?? "reps",
    load: step.load?.display ?? "",
    notes: "",
  };
}

export function parseWodToEditable(opt: any): EditableSession {
  const canonical = opt.wod;
  const blocks: any[] = canonical?.blocks ?? [];
  const dur = canonical?.totalDurationSeconds
    ? String(Math.round(canonical.totalDurationSeconds / 60))
    : "";
  const fmtLabel = FORMAT_LABELS[opt.format] ?? opt.format?.toUpperCase() ?? "WOD";

  // Multi-segment: more than 1 block, or any block has a label
  const isMultiSegment = blocks.length > 1 || blocks.some((b: any) => b.label);

  if (isMultiSegment) {
    const segments: WodSegment[] = blocks.map((block: any, bi: number) => {
      const rows = (block.steps ?? []).map((step: any, si: number) => stepToRow(step, si, bi));
      return {
        id: block.id || `seg-${bi}`,
        type: block.type || "fixed",
        label: block.label || (block.rounds ? `${block.rounds} rounds` : ""),
        rounds: block.rounds != null ? String(block.rounds) : "",
        rows,
      };
    });
    const allRows = segments.flatMap(s => s.rows);
    return {
      title: opt.name || fmtLabel,
      type: "wod",
      format: opt.format ?? "for_time",
      summary: dur ? `${dur} min ${fmtLabel}` : fmtLabel,
      durationMinutes: dur,
      rows: allRows,
      segments,
      repeatNote: opt.repeatNote ?? "",
      restNote: opt.restNote ?? "",
      rounds: "",
      _raw: opt,
    };
  }

  // Single block — flat rows
  const rows: EditableRow[] = [];
  if (blocks.length) {
    for (const block of blocks) {
      for (const step of (block.steps ?? [])) {
        rows.push(stepToRow(step, rows.length));
      }
    }
  } else {
    for (const ex of (opt.exercises ?? [])) {
      rows.push({ ...blankRow(ex.id || `row-${rows.length}`), name: ex.name ?? "" });
    }
  }
  const block0 = blocks?.[0];
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
  const parts: string[] = [];
  if (session.duration) parts.push(`${session.duration} min`);
  if (session.distanceKm) parts.push(`${session.distanceKm} km`);
  if (session.intensity) parts.push(session.intensity);

  // ── New block-based structure from updated API ────────────────────────────
  const runBlocks: any[] = Array.isArray(session.runBlocks) ? session.runBlocks : [];
  if (runBlocks.length > 0) {
    const segments: WodSegment[] = runBlocks.map((block: any, bi: number) => ({
      id: `run-block-${bi}`,
      type: (block.blockType ?? "main") as WodSegment["type"],
      label: block.label ?? "",
      rounds: "",
      rows: (block.rows ?? []).map((row: any, ri: number): EditableRow => {
        if (row.rowType === "rest") {
          return {
            ...blankRow(`rb-${bi}-${ri}`, "Rest"),
            name: row.description ?? row.duration ?? "",
            notes: "rest",
          };
        }
        if (row.rowType === "interval") {
          return {
            ...blankRow(`rb-${bi}-${ri}`, String(row.repNumber ?? ri + 1)),
            value: row.distance ?? row.duration ?? "",
            name: row.pace ? `@ ${row.pace}` : (row.effort ?? ""),
            notes: !row.pace && row.effort ? "" : (row.effort ?? ""),
          };
        }
        // rowType === "run" (general block content)
        return {
          ...blankRow(`rb-${bi}-${ri}`),
          value: row.distance ?? row.duration ?? "",
          name: row.description ?? "",
          notes: row.effort ?? "",
        };
      }),
    }));
    return {
      title: session.name || "Run Session",
      type: "run", format: session.intensity ?? "Run",
      summary: parts.join(" · "),
      durationMinutes: session.duration ? String(session.duration) : "",
      rows: [], segments, repeatNote: "", restNote: "", rounds: "",
      _raw: session,
    };
  }

  // ── Legacy flat segments fallback ─────────────────────────────────────────
  const rows: EditableRow[] = (session.segments ?? []).map((seg: any, i: number) => ({
    id: `seg-${i}`,
    label: seg.label ?? "",
    name: seg.description ?? "",
    sets: "", reps: "", weight: "", rpe: "", rest: seg.rest ?? "", tempo: "",
    value: seg.distance ?? seg.duration ?? "", unit: "", load: "",
    notes: seg.effort ?? "",
  }));
  if (!rows.length && session.structure) {
    rows.push({ ...blankRow("seg-0"), name: session.structure, notes: session.intensity ?? "" });
  }
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
function buildWodStep(r: EditableRow, idx: number, segIdx = 0) {
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
    id: r.id || `step-${segIdx}-${idx}`,
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
}

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
    const allRows = es.segments?.length ? es.segments.flatMap(s => s.rows) : es.rows;

    // Build runBlocks for re-loading preview after save
    const runBlocks = es.segments?.length
      ? es.segments.map(seg => ({
          blockType: seg.type,
          label: seg.label,
          rows: seg.rows.map(r => {
            if (r.notes === "rest" || r.label.toLowerCase() === "rest") {
              return { rowType: "rest", description: r.name, duration: r.name };
            }
            const repNum = r.label && /^\d+$/.test(r.label) ? Number(r.label) : undefined;
            return {
              rowType: repNum != null ? "interval" : "run",
              ...(repNum != null ? { repNumber: repNum } : {}),
              distance: r.value || null,
              duration: null,
              pace: r.name?.startsWith("@") ? r.name.replace(/^@\s*/, "") : null,
              effort: r.notes && r.notes !== "rest" ? r.notes : null,
              description: !r.name?.startsWith("@") ? r.name : null,
            };
          }),
        }))
      : null;

    // Create one exercise per interval/run row for loggable pre-population
    const intervalRows = allRows.filter(r => r.notes !== "rest" && r.label.toLowerCase() !== "rest");
    const exercises = intervalRows.length > 0
      ? intervalRows.map((r, idx) => ({
          id: r.id || `ex-${now}-${idx}`,
          name: r.label && /^\d+$/.test(r.label) ? `Rep ${r.label}` : (r.name || es.title),
          sets: null, reps: r.value || null, rpe: null, rest: null, tempo: null,
          notes: r.name && !r.name.startsWith("@") ? r.name : (r.notes || null),
          rawText: [r.value, r.name].filter(Boolean).join(" "),
          weekProgression: [], clientComment: null,
          perSetReps: null, perSetRpe: null, setWeights: null, setReps: null, weight: null,
        }))
      : [{
          id: es._raw?.exercises?.[0]?.id || `ex-${now}-0`,
          name: es.title,
          sets: null, reps: null, rpe: null, rest: null, tempo: null,
          notes: es.summary,
          rawText: allRows.map(r => [r.value, r.name].filter(Boolean).join(" ")).join(" · "),
          weekProgression: [], clientComment: null,
          perSetReps: null, perSetRpe: null, setWeights: null, setReps: null, weight: null,
        }];

    const segments = allRows.map(r => ({
      label: r.label, description: r.name, distance: r.value || null, effort: r.notes || null,
      rest: r.rest || null, reps: null, rowType: r.notes === "rest" ? "rest" : "interval",
    }));

    return {
      ...es._raw, name: es.title || es._raw?.name, source: "run_brain",
      structure: intervalRows.map(r => [r.value, r.name].filter(Boolean).join(" ")).join(" · "),
      segments, exercises,
      ...(runBlocks ? { runBlocks } : {}),
    };
  }

  // WOD — multi-segment or flat
  const durationMin = es.durationMinutes ? Number(es.durationMinutes) : undefined;

  const wodBlocks = es.segments?.length
    ? es.segments.map((seg, si) => ({
        id: seg.id || `block-${si}`,
        type: seg.type || "for_time",
        ...(seg.label ? { label: seg.label } : {}),
        ...(seg.rounds ? { rounds: Number(seg.rounds) } : {}),
        steps: seg.rows.map((r, idx) => buildWodStep(r, idx, si)),
      }))
    : [{
        id: "block-0",
        type: es.format,
        steps: es.rows.map((r, idx) => buildWodStep(r, idx)),
        ...(durationMin != null ? { durationSeconds: durationMin * 60 } : {}),
        ...(es.rounds ? { rounds: Number(es.rounds) } : {}),
      }];

  const allRows = es.segments?.length ? es.segments.flatMap(s => s.rows) : es.rows;
  const exercises = allRows.map((r, idx) => {
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
      : row.reps ? ` · ${row.reps} reps` : "";
    const wt = row.weight ? ` @ ${row.weight}` : "";
    const rpe = row.rpe ? ` RPE ${row.rpe}` : "";
    return `${row.name}${scheme}${wt}${rpe}`.trim();
  }
  // Run type: clean rep-number · distance name format
  const label = row.label.trim();
  const dist = row.value.trim();
  // Combine name + effort notes (avoid repeating if already embedded in name)
  const detail = [row.name, row.notes && row.notes !== "rest" ? row.notes : ""].filter(Boolean).join(" ");
  if (label && dist) return `${label} · ${dist}${detail ? ` ${detail}` : ""}`.trim();
  if (label && !dist) return `${label}${detail ? ` · ${detail}` : ""}`.trim();
  return [dist, detail].filter(Boolean).join(" · ").trim();
}

function textToRow(text: string, type: EditableSession["type"], existing: EditableRow): EditableRow {
  const t = text.trim();
  if (!t) return { ...existing, name: "" };

  if (type === "wod") {
    let rest = t;
    let load = existing.load;
    const atIdx = t.lastIndexOf(" @ ");
    if (atIdx !== -1) { load = t.slice(atIdx + 3).trim(); rest = t.slice(0, atIdx).trim(); }
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
      if (am) return { ...existing, name: parts[0], value: am[1].replace("–", "-"), unit: am[2]?.trim() || existing.unit, load };
      return { ...existing, label: parts[0], name: parts[1], load };
    }
    return { ...existing, name: rest, load };
  }

  if (type === "strength") {
    const rpeM = t.match(/\s+RPE\s+([\d.]+)\s*$/i);
    const rpe = rpeM ? rpeM[1] : existing.rpe;
    const withoutRpe = rpeM ? t.replace(/\s+RPE\s+[\d.]+\s*$/i, "").trim() : t;
    const wtM = withoutRpe.match(/\s*@\s*([\w/.\s]+)$/);
    const weight = wtM ? wtM[1].trim() : existing.weight;
    const withoutWt = wtM ? withoutRpe.slice(0, withoutRpe.lastIndexOf("@")).trim() : withoutRpe;
    const parts = withoutWt.split(/\s*[·•]\s*/).map(s => s.trim()).filter(Boolean);
    const name = parts[0] || "";
    let sets = existing.sets; let reps = existing.reps;
    if (parts[1]) {
      const schemeM = parts[1].match(/^(\d+)\s*[×xX]\s*(\S+)$/);
      if (schemeM) { sets = schemeM[1]; reps = schemeM[2]; }
      else { reps = parts[1].replace(/\s*reps?\s*$/i, "").trim(); }
    }
    return { ...existing, name, sets, reps, weight, rpe };
  }

  // Run type: "label · dist name" or "label · description" or "dist · detail"
  const parts = t.split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const firstIsLabelOrNum = /^(\d+|rest|warm.?up|cool.?down|recovery|strides|hills)$/i.test(parts[0]);
    if (firstIsLabelOrNum) {
      const label = parts[0];
      const rest = parts.slice(1).join(" ");
      // Check if rest starts with a distance/duration token
      const distM = rest.match(/^([\d.]+\s*(?:km|m|mi|min|sec|s)\b)\s*(.*)$/i);
      if (distM) return { ...existing, label, value: distM[1].trim(), name: distM[2].trim() };
      return { ...existing, label, name: rest };
    }
    // "dist · detail" (no label)
    const distM = parts[0].match(/^([\d.]+\s*(?:km|m|mi|min|sec|s)\b)$/i);
    if (distM) return { ...existing, value: distM[1].trim(), name: parts.slice(1).join(" · ") };
  }
  // Single token: check if it looks like a distance
  const singleDistM = t.match(/^([\d.]+\s*(?:km|m|mi|min|sec|s)\b)\s*(.*)$/i);
  if (singleDistM) return { ...existing, value: singleDistM[1].trim(), name: singleDistM[2].trim() };
  return { ...existing, name: t };
}

function rowPlaceholder(type: EditableSession["type"], index: number): string {
  if (type === "wod") return index === 0 ? "e.g. Bike Erg · 12 cal" : "Movement · amount";
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
  onToggleExpand: () => void;
  onChangeField: (patch: Partial<EditableRow>) => void;
}

function PreviewRow({
  row, type, isActive, isExpanded, editingText, index,
  onActivate, onEditChange, onCommit, onDelete, onToggleExpand, onChangeField,
}: PreviewRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        if (!inputRef.current) return;
        inputRef.current.focus();
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      });
    }
  }, [isActive]);

  const displayText = rowToText(row, type);
  const hasContent = row.name.trim() !== "";

  return (
    <div className="group/row">
      <div className="flex items-center gap-1 min-h-[44px]">
        <span className="text-muted-foreground/15 group-hover/row:text-muted-foreground/35 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none transition-colors">
          <GripVertical className="w-3.5 h-3.5" />
        </span>
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
                hasContent ? "text-foreground hover:text-foreground/80" : "text-muted-foreground/30 italic"
              }`}
              onClick={onActivate}
            >
              {hasContent ? displayText : rowPlaceholder(type, index)}
            </button>
          )}
        </div>
        <button
          type="button"
          className={`shrink-0 p-1.5 rounded-md transition-colors ${
            isExpanded ? "text-primary bg-primary/10" : "text-muted-foreground/15 hover:text-muted-foreground/50 group-hover/row:text-muted-foreground/40"
          }`}
          onClick={onToggleExpand}
          title="Advanced options"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="shrink-0 p-1.5 rounded-md text-muted-foreground/15 hover:text-destructive group-hover/row:text-muted-foreground/40 transition-colors"
          onClick={onDelete}
          title="Remove line"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {isExpanded && (
        <div className="ml-5 mb-1 mt-0.5 grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 rounded-xl bg-muted/40 text-xs">
          {type === "wod" && (
            <>
              <label className="flex items-center gap-2 col-span-2 sm:col-span-1">
                <span className="text-muted-foreground/60 w-8 shrink-0">Load</span>
                <input className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.load} onChange={e => onChangeField({ load: e.target.value })} placeholder="e.g. 20kg" />
              </label>
              <label className="flex items-center gap-2 col-span-2 sm:col-span-1">
                <span className="text-muted-foreground/60 w-8 shrink-0">Unit</span>
                <select className="flex-1 bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-foreground font-medium"
                  value={row.unit} onChange={e => onChangeField({ unit: e.target.value })}>
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
                <input className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.rpe} onChange={e => onChangeField({ rpe: e.target.value })} placeholder="e.g. 8" />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-8 shrink-0">Rest</span>
                <input className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.rest} onChange={e => onChangeField({ rest: e.target.value })} placeholder="e.g. 90s" />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-8 shrink-0">Tempo</span>
                <input className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                  value={row.tempo} onChange={e => onChangeField({ tempo: e.target.value })} placeholder="e.g. 3-1-1" />
              </label>
            </>
          )}
          {type === "run" && (
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground/60 w-8 shrink-0">Rest</span>
              <input className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
                value={row.rest} onChange={e => onChangeField({ rest: e.target.value })} placeholder="e.g. 90s jog" />
            </label>
          )}
          <label className="flex items-center gap-2 col-span-2">
            <span className="text-muted-foreground/60 w-8 shrink-0">Note</span>
            <input className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 font-medium"
              value={row.notes} onChange={e => onChangeField({ notes: e.target.value })} placeholder="Optional coaching note…" />
          </label>
        </div>
      )}
    </div>
  );
}

// ── SessionBlockSection — renders one labelled block (WOD segment or run block) ─
interface WodSegmentBlockProps {
  segment: WodSegment;
  segIdx: number;
  sessionType: EditableSession["type"];
  activeRowId: string | null;
  editingText: string;
  expandedRowId: string | null;
  isFirst: boolean;
  isLast: boolean;
  onActivateRow: (rowId: string, text: string) => void;
  onEditChange: (v: string) => void;
  onCommitRow: (segIdx: number, rowIdx: number) => void;
  onDeleteRow: (segIdx: number, rowIdx: number) => void;
  onAddRow: (segIdx: number) => void;
  onToggleExpand: (rowId: string) => void;
  onChangeField: (segIdx: number, rowIdx: number, patch: Partial<EditableRow>) => void;
  onLabelChange: (segIdx: number, label: string) => void;
  onDeleteSegment: (segIdx: number) => void;
}

/** Colour hint for well-known segment / block labels */
function segmentLabelStyle(label: string, sessionType: EditableSession["type"]): string {
  const l = label.toLowerCase();
  if (sessionType === "run") {
    if (l.includes("warm")) return "text-amber-600 dark:text-amber-400";
    if (l.includes("cool") || l.includes("cool-down")) return "text-sky-600 dark:text-sky-400";
    if (l.includes("main") || l.includes("interval") || l.includes("set")) return "text-emerald-600 dark:text-emerald-400";
    if (l.includes("stride")) return "text-violet-600 dark:text-violet-400";
    if (l.includes("hill")) return "text-orange-600 dark:text-orange-400";
    return "text-muted-foreground";
  }
  if (l.includes("buy-in") || l.includes("buy in")) return "text-primary";
  if (l.includes("cash-out") || l.includes("cash out") || l.includes("buy-out") || l.includes("buy out") || l.includes("finisher")) return "text-violet-600 dark:text-violet-400";
  return "text-muted-foreground";
}

function WodSegmentBlock({
  segment, segIdx, sessionType, activeRowId, editingText, expandedRowId,
  isFirst,
  onActivateRow, onEditChange, onCommitRow, onDeleteRow, onAddRow,
  onToggleExpand, onChangeField, onLabelChange, onDeleteSegment,
}: WodSegmentBlockProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingLabel) {
      requestAnimationFrame(() => labelRef.current?.focus());
    }
  }, [editingLabel]);

  const hasLabel = segment.label.trim() !== "";
  const labelStyle = segmentLabelStyle(segment.label, sessionType);
  const isRun = sessionType === "run";

  return (
    <div className={`${!isFirst ? "mt-3 pt-3 border-t border-border/30" : ""}`}>
      {/* Block header */}
      <div className="flex items-center gap-1.5 mb-1 group/seg">
        {editingLabel ? (
          <input
            ref={labelRef}
            className="flex-1 text-xs font-semibold bg-transparent border-none outline-none focus:ring-0 text-foreground"
            value={segment.label}
            onChange={e => onLabelChange(segIdx, e.target.value)}
            onBlur={() => setEditingLabel(false)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingLabel(false); }}
          />
        ) : (
          <button
            type="button"
            className={`text-xs font-semibold flex-1 text-left transition-colors hover:opacity-80 uppercase tracking-widest ${hasLabel ? labelStyle : "text-muted-foreground/30 italic"}`}
            onClick={() => setEditingLabel(true)}
          >
            {hasLabel ? segment.label : (isRun ? "Block" : "Untitled segment")}
          </button>
        )}
        {!isRun && segment.rounds && (
          <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">×{segment.rounds}</span>
        )}
        <button
          type="button"
          className="shrink-0 p-1 text-muted-foreground/15 hover:text-destructive opacity-0 group-hover/seg:opacity-100 transition-all"
          onClick={() => onDeleteSegment(segIdx)}
          title="Remove block"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Rows */}
      {segment.rows.map((row, ri) => {
        const isRestRow = row.notes === "rest" || row.label.toLowerCase() === "rest";
        if (isRun && isRestRow) {
          // Rest rows render as a lightweight divider line, not an editable row
          return (
            <div key={row.id} className="flex items-center gap-2 py-0.5 ml-5 my-0.5 group/rest">
              <span className="text-[11px] text-muted-foreground/50 italic">
                Rest{row.name ? ` · ${row.name}` : ""}
              </span>
              <button
                type="button"
                className="opacity-0 group-hover/rest:opacity-100 p-0.5 text-muted-foreground/30 hover:text-destructive transition-all"
                onClick={() => onDeleteRow(segIdx, ri)}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        }
        return (
          <PreviewRow
            key={row.id}
            row={row}
            type={sessionType}
            index={ri}
            isActive={activeRowId === row.id}
            isExpanded={expandedRowId === row.id}
            editingText={activeRowId === row.id ? editingText : ""}
            onActivate={() => onActivateRow(row.id, rowToText(row, sessionType))}
            onEditChange={onEditChange}
            onCommit={() => onCommitRow(segIdx, ri)}
            onDelete={() => onDeleteRow(segIdx, ri)}
            onToggleExpand={() => onToggleExpand(row.id)}
            onChangeField={patch => onChangeField(segIdx, ri, patch)}
          />
        );
      })}

      <button
        type="button"
        className={`flex items-center gap-1.5 text-[11px] transition-colors mt-0.5 ml-5 py-1 touch-manipulation ${isRun ? "text-emerald-500/40 hover:text-emerald-600/70" : "text-primary/40 hover:text-primary/70"}`}
        onClick={() => onAddRow(segIdx)}
      >
        <Plus className="w-3 h-3" />
        Add line
      </button>
    </div>
  );
}

// ── WorkoutPreviewEditorCard ───────────────────────────────────────────────────
interface Props {
  editableSession: EditableSession;
  onChange: (updated: EditableSession) => void;
  compact?: boolean;
}

function setRow(es: EditableSession, ri: number, patch: Partial<EditableRow>): EditableSession {
  const rows = [...es.rows];
  rows[ri] = { ...rows[ri], ...patch };
  return { ...es, rows };
}

function setSegmentRow(es: EditableSession, si: number, ri: number, patch: Partial<EditableRow>): EditableSession {
  if (!es.segments) return setRow(es, ri, patch);
  const segs = [...es.segments];
  const rows = [...segs[si].rows];
  rows[ri] = { ...rows[ri], ...patch };
  segs[si] = { ...segs[si], rows };
  return { ...es, segments: segs, rows: segs.flatMap(s => s.rows) };
}

function findRow(es: EditableSession, rowId: string): { si: number; ri: number } | null {
  if (es.segments?.length) {
    for (let si = 0; si < es.segments.length; si++) {
      const ri = es.segments[si].rows.findIndex(r => r.id === rowId);
      if (ri !== -1) return { si, ri };
    }
    return null;
  }
  const ri = es.rows.findIndex(r => r.id === rowId);
  return ri !== -1 ? { si: -1, ri } : null;
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
    : es.type === "run" ? (es.format || "Run") : "Strength";

  // ── Row activation
  function activateRow(rowId: string, text: string) {
    setEditingText(text);
    setActiveRowId(rowId);
  }

  // ── Commit edit (flat rows)
  function commitFlatEdit() {
    if (!activeRowId) return;
    const ri = es.rows.findIndex(r => r.id === activeRowId);
    if (ri !== -1) onChange(setRow(es, ri, textToRow(editingText, es.type, es.rows[ri])));
    setActiveRowId(null);
  }

  // ── Commit edit (segment rows)
  function commitSegmentEdit(si: number, ri: number) {
    if (!activeRowId || !es.segments) return;
    const row = es.segments[si].rows[ri];
    onChange(setSegmentRow(es, si, ri, textToRow(editingText, es.type, row)));
    setActiveRowId(null);
  }

  // ── Flat row ops
  function deleteFlatRow(ri: number) {
    setActiveRowId(null);
    onChange({ ...es, rows: es.rows.filter((_, i) => i !== ri) });
  }
  function addFlatRow() {
    const nr = blankRow(`row-${Date.now()}`);
    onChange({ ...es, rows: [...es.rows, nr] });
    activateRow(nr.id, "");
  }

  // ── Segment ops
  function deleteSegmentRow(si: number, ri: number) {
    setActiveRowId(null);
    if (!es.segments) return;
    const segs = [...es.segments];
    segs[si] = { ...segs[si], rows: segs[si].rows.filter((_, i) => i !== ri) };
    onChange({ ...es, segments: segs, rows: segs.flatMap(s => s.rows) });
  }
  function addSegmentRow(si: number) {
    if (!es.segments) return;
    const nr = blankRow(`row-${Date.now()}`);
    const segs = [...es.segments];
    segs[si] = { ...segs[si], rows: [...segs[si].rows, nr] };
    onChange({ ...es, segments: segs, rows: segs.flatMap(s => s.rows) });
    activateRow(nr.id, "");
  }
  function updateSegmentLabel(si: number, label: string) {
    if (!es.segments) return;
    const segs = [...es.segments];
    segs[si] = { ...segs[si], label };
    onChange({ ...es, segments: segs });
  }
  function deleteSegment(si: number) {
    if (!es.segments) return;
    const segs = es.segments.filter((_, i) => i !== si);
    onChange({ ...es, segments: segs.length ? segs : undefined, rows: segs.flatMap(s => s.rows) });
  }
  function addSegment() {
    const nr = blankRow(`row-${Date.now()}`);
    const newSeg: WodSegment = {
      id: `seg-${Date.now()}`,
      type: es.type === "run" ? "main" : "fixed",
      label: "",
      rounds: "",
      rows: [nr],
    };
    const segs = [...(es.segments ?? []), newSeg];
    onChange({ ...es, segments: segs, rows: segs.flatMap(s => s.rows) });
    activateRow(nr.id, "");
  }

  const useSegments = !!(es.segments?.length) && (es.type === "wod" || es.type === "run");

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
        {es.summary && <p className="text-xs text-muted-foreground">{es.summary}</p>}
      </div>

      <div className="border-t border-border/40" />

      {/* ── Content ── */}
      <div className="px-3 py-1 pb-2">
        {useSegments ? (
          // Multi-segment WOD or run blocks
          <>
            {es.segments!.map((seg, si) => (
              <WodSegmentBlock
                key={seg.id}
                segment={seg}
                segIdx={si}
                sessionType={es.type}
                isFirst={si === 0}
                isLast={si === es.segments!.length - 1}
                activeRowId={activeRowId}
                editingText={editingText}
                expandedRowId={expandedRowId}
                onActivateRow={activateRow}
                onEditChange={setEditingText}
                onCommitRow={commitSegmentEdit}
                onDeleteRow={deleteSegmentRow}
                onAddRow={addSegmentRow}
                onToggleExpand={id => setExpandedRowId(expandedRowId === id ? null : id)}
                onChangeField={(si2, ri, patch) => onChange(setSegmentRow(es, si2, ri, patch))}
                onLabelChange={updateSegmentLabel}
                onDeleteSegment={deleteSegment}
              />
            ))}
            <button
              type="button"
              className={`flex items-center gap-1.5 text-[11px] transition-colors mt-3 ml-0 py-1 touch-manipulation ${es.type === "run" ? "text-emerald-500/40 hover:text-emerald-600/70" : "text-primary/40 hover:text-primary/70"}`}
              onClick={addSegment}
            >
              <Plus className="w-3 h-3" />
              {es.type === "run" ? "Add block" : "Add segment"}
            </button>
          </>
        ) : (
          // Flat rows (strength, run, or simple WOD)
          <>
            {es.rows.map((row, ri) => (
              <PreviewRow
                key={row.id}
                row={row}
                type={es.type}
                index={ri}
                isActive={activeRowId === row.id}
                isExpanded={expandedRowId === row.id}
                editingText={activeRowId === row.id ? editingText : ""}
                onActivate={() => activateRow(row.id, rowToText(row, es.type))}
                onEditChange={setEditingText}
                onCommit={commitFlatEdit}
                onDelete={() => deleteFlatRow(ri)}
                onToggleExpand={() => setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                onChangeField={patch => onChange(setRow(es, ri, patch))}
              />
            ))}
            <button
              type="button"
              className="flex items-center gap-1.5 text-[11px] text-primary/40 hover:text-primary/70 transition-colors mt-1 ml-5 py-1.5 touch-manipulation"
              onClick={addFlatRow}
            >
              <Plus className="w-3 h-3" />
              Add line
            </button>
          </>
        )}
      </div>

      {/* ── WOD footer: rounds / repeat / rest (flat WOD only) ── */}
      {es.type === "wod" && !useSegments && (es.rounds || es.repeatNote || es.restNote) && (
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
                <input type="number" className="w-16 text-xs font-mono bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30 tabular-nums"
                  value={es.rounds} onChange={e => onChange({ ...es, rounds: e.target.value })} placeholder="—" min={1} />
              </label>
              {es.repeatNote && (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground/60 w-16 shrink-0">Repeat</span>
                  <input className="flex-1 text-xs bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30"
                    value={es.repeatNote} onChange={e => onChange({ ...es, repeatNote: e.target.value })} placeholder="Repeat logic…" />
                </label>
              )}
              {es.restNote && (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground/60 w-16 shrink-0">Rest</span>
                  <input className="flex-1 text-xs bg-transparent border-none outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/30"
                    value={es.restNote} onChange={e => onChange({ ...es, restNote: e.target.value })} placeholder="Rest note…" />
                </label>
              )}
            </div>
          )}
        </div>
      )}

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
