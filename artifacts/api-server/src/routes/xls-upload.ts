import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";
import { format, parse as parseDate, isValid } from "date-fns";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ------------------------------------------------------------------ */
/* GET /api/xls-template  — download a pre-filled example spreadsheet  */
/* ------------------------------------------------------------------ */
router.get("/xls-template", (_req, res) => {
  const wb = XLSX.utils.book_new();

  // Programme sheet
  const headers = ["Date (YYYY-MM-DD)", "Session Name", "Exercise", "Sets", "Reps", "Notes / RPE"];
  const examples = [
    ["2026-04-07", "Upper Body", "Bench Press", 4, "8", "RPE 7"],
    ["2026-04-07", "Upper Body", "Pull-Ups", 3, "10", "Bodyweight"],
    ["2026-04-07", "Upper Body", "DB Shoulder Press", 3, "12", ""],
    ["2026-04-09", "Lower Body", "Back Squat", 4, "6", "RPE 8"],
    ["2026-04-09", "Lower Body", "Romanian Deadlift", 3, "10", "Moderate weight"],
    ["2026-04-09", "Lower Body", "Walking Lunges", 3, "12 each", ""],
    ["2026-04-11", "Conditioning", "Row 500m", 5, "1 round", "90s rest between"],
    ["2026-04-11", "Conditioning", "Assault Bike 10 cal", 5, "1 round", "Into the row"],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);

  // Column widths
  ws["!cols"] = [
    { wch: 22 },  // Date
    { wch: 20 },  // Session Name
    { wch: 28 },  // Exercise
    { wch: 8 },   // Sets
    { wch: 12 },  // Reps
    { wch: 24 },  // Notes
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Programme");

  // Instructions sheet
  const infoHeaders = ["Instructions"];
  const infoRows = [
    ["Fill in the 'Programme' sheet. Each row is one exercise in one session."],
    [""],
    ["Date         — use YYYY-MM-DD format (e.g. 2026-04-07). All exercises on the same date with the same Session Name will be grouped into one session."],
    ["Session Name — the label shown on the calendar (e.g. 'Upper Body', 'Run', 'WOD')."],
    ["Exercise     — the movement name (e.g. 'Back Squat', 'Row 500m')."],
    ["Sets         — number of sets (e.g. 4)."],
    ["Reps         — reps or duration (e.g. '8', '10 each', '500m', '30s')."],
    ["Notes / RPE  — optional cues, RPE, or tempo (e.g. 'RPE 7', 'controlled tempo')."],
    [""],
    ["Tips:"],
    ["- Keep dates in Monday-Friday for best calendar display."],
    ["- You can have as many sessions per day as you like — just use different Session Names."],
    ["- Leave the header row as-is. Don't add extra sheets."],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet([infoHeaders, ...infoRows]);
  wsInfo["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, "Instructions");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="axis-programme-template.xlsx"');
  res.send(buf);
});

/* ------------------------------------------------------------------ */
/* POST /api/xls-upload  — parse an uploaded spreadsheet               */
/* ------------------------------------------------------------------ */
router.post("/xls-upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
  } catch {
    res.status(422).json({ error: "Could not read the file. Make sure it is a valid .xlsx or .xls file." });
    return;
  }

  // Use first sheet
  const sheetName = wb.SheetNames.find(n => n.toLowerCase() !== "instructions") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (rows.length < 2) {
    res.status(422).json({ error: "The spreadsheet appears to be empty. Add some sessions and try again." });
    return;
  }

  // Detect header row — find first row that has recognisable column names
  let headerRowIdx = 0;
  let colMap = { date: -1, name: -1, exercise: -1, sets: -1, reps: -1, notes: -1 };

  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i].map((c: any) => String(c).toLowerCase().trim());
    const d = row.findIndex(c => c.includes("date"));
    const n = row.findIndex(c => c.includes("session") || c.includes("name"));
    const e = row.findIndex(c => c.includes("exercise") || c.includes("movement"));
    const s = row.findIndex(c => c === "sets" || c.startsWith("set"));
    const r = row.findIndex(c => c === "reps" || c.startsWith("rep") || c.includes("duration"));
    const no = row.findIndex(c => c.includes("note") || c.includes("rpe") || c.includes("cue"));
    if (d !== -1 && (n !== -1 || e !== -1)) {
      headerRowIdx = i;
      colMap = { date: d, name: n, exercise: e, sets: s, reps: r, notes: no };
      break;
    }
  }

  if (colMap.date === -1 || colMap.exercise === -1) {
    res.status(422).json({
      error: "Couldn't find required columns. Make sure your spreadsheet has 'Date' and 'Exercise' columns. Download the template for the correct format.",
    });
    return;
  }

  // Parse data rows
  type SessionKey = string;
  const sessionMap = new Map<SessionKey, { date: string; name: string; exercises: any[] }>();
  const sessionOrder: SessionKey[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = row[colMap.date];
    const rawName = colMap.name !== -1 ? String(row[colMap.name] ?? "").trim() : "";
    const rawExercise = String(row[colMap.exercise] ?? "").trim();

    if (!rawDate && !rawExercise) continue; // blank row
    if (!rawExercise) continue;

    // Normalise date
    let dateStr = "";
    if (rawDate instanceof Date) {
      if (isValid(rawDate)) dateStr = format(rawDate, "yyyy-MM-dd");
    } else {
      const s = String(rawDate).trim();
      // Try ISO first
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        dateStr = s;
      } else {
        // Try common formats
        for (const fmt of ["dd/MM/yyyy", "MM/dd/yyyy", "d/M/yyyy", "dd-MM-yyyy", "dd MMM yyyy"]) {
          try {
            const d = parseDate(s, fmt, new Date());
            if (isValid(d)) { dateStr = format(d, "yyyy-MM-dd"); break; }
          } catch {}
        }
        // Excel serial number
        if (!dateStr && /^\d+$/.test(s)) {
          try {
            const d = XLSX.SSF.parse_date_code(Number(s));
            if (d) dateStr = `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
          } catch {}
        }
      }
    }

    if (!dateStr) continue; // skip rows with unparseable dates

    const sessionName = rawName || "Session";
    const key: SessionKey = `${dateStr}__${sessionName}`;

    if (!sessionMap.has(key)) {
      sessionMap.set(key, { date: dateStr, name: sessionName, exercises: [] });
      sessionOrder.push(key);
    }

    const sets = colMap.sets !== -1 ? Number(row[colMap.sets]) || undefined : undefined;
    const reps = colMap.reps !== -1 ? String(row[colMap.reps] ?? "").trim() || undefined : undefined;
    const notes = colMap.notes !== -1 ? String(row[colMap.notes] ?? "").trim() || undefined : undefined;

    sessionMap.get(key)!.exercises.push({
      id: randomUUID(),
      name: rawExercise,
      sets: sets ?? null,
      reps: reps ?? null,
      notes: notes ?? null,
      rpe: null,
      rest: null,
      tempo: null,
      weekProgression: [],
    });
  }

  if (sessionMap.size === 0) {
    res.status(422).json({ error: "No valid sessions found. Check your dates are in YYYY-MM-DD format and exercises are filled in." });
    return;
  }

  // Sort sessions by date
  const sessions = sessionOrder
    .map(key => sessionMap.get(key)!)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => ({
      id: randomUUID(),
      date: s.date,
      name: s.name,
      exercises: s.exercises,
      source: "uploaded" as const,
    }));

  // Derive a title from the date range
  const firstDate = sessions[0].date;
  const lastDate = sessions[sessions.length - 1].date;
  const title = `Uploaded Programme — from ${format(new Date(firstDate + "T12:00:00"), "d MMM yyyy")}`;

  res.json({ title, sessions, sessionCount: sessions.length, dateRange: { from: firstDate, to: lastDate } });
});

export default router;
