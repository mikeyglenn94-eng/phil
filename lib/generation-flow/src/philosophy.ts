// MG COACHING PROGRAMMING PHILOSOPHY
// This is the load-bearing core of how Phil generates and modifies programmes.
// It captures Mikey's coaching philosophy from years of practice and gym ownership.
//
// DO NOT:
// - Summarise or "tidy up" this content
// - Move rules into a system prompt elsewhere
// - Remove specific examples (Big 4 exception, Olympic lifts exception, etc.)
// - Refactor without Mikey's explicit approval
//
// This constant is loaded into the GENERATOR and MODIFIER prompts only,
// not the question-writer or slot-parser prompts.
//
// Content below was extracted verbatim from:
//   - artifacts/api-server/src/routes/parse.ts /generate-programme system prompt
//   - artifacts/api-server/src/routes/run-brain.ts RUN_SESSION_DOCTRINE
// Do not paraphrase. If a rule needs to change, edit it here, not in a prompt downstream.

export const MG_PROGRAMMING_PHILOSOPHY = `## Coaching Philosophy (apply these principles to every programme, above all other defaults)

These are the non-negotiable guiding principles of this coach. They override generic programming defaults.

### 0. Rep ranges, not rep numbers — with two specific exceptions
- **Never programme a fixed rep number for hypertrophy or general strength work.** "3×10" is meaningless — it rewards counting, not effort. Always use a range.
- Hypertrophy bands:
  - **8–12:** moderate load, mechanical tension — primary hypertrophy driver
  - **12–18:** higher rep, metabolic stress — excellent for growth, especially isolation work
  - **15–25:** endurance-strength, pump, accessory and finishing work
- Strength work (intensification phase) uses lower ranges: 3–6, 2–4, or 1–3 — these can be tighter because load is the primary variable, not effort to failure.
- The purpose of a range is to demand intensity from the client. They stop when the reps are hard, not when they hit an arbitrary number. This brings out effort that a fixed number never would.
- Apply this everywhere: every hypertrophy exercise in every session must have a rep range, never a single number (e.g. "8-12" not "10").

**Exception 1 — Big 4 compound movements in a STRENGTH (not hypertrophy) context:**
When the primary goal is strength and the exercise is one of the Big 4 (Back Squat, Bench Press, Deadlift, Strict Press), a fixed rep number is appropriate because load progression is the variable, not proximity to failure. Classic formats like 5×5, 3×3, 5/3/1, or 1×5 are correct here. Use a specific number, not a range.

**Exception 2 — Olympic lifting movements always use a fixed rep number:**
Snatch, Clean & Jerk, Clean, Jerk, and their variations (Power Snatch, Hang Clean, etc.) must always have a specific rep number, never a range. These are skill-based movements where each rep is performed at high intent with full reset. Programme them as singles, doubles, or triples (e.g. 5×2, 6×1, 4×3) — never as "2-4" or "3-5". The load or percentage is the progression variable, not rep effort.

### 1. Progression drives consistency — overload, not novelty
- Clients who get stronger keep showing up. The most powerful motivator is measurable progress, not variety.
- Enjoyment comes from seeing numbers go up, hitting new rep PRs, and feeling the programme working — not from constantly changing exercises.
- By default, keep exercise selection stable across the full block. Progress through overload variables: more weight, more reps, more sets, less rest, harder effort (RPE), or more demanding tempo.
- The session style section below will specify whether exercise variation is permitted. Follow it strictly.

### 1b. Rest intervals — defaults
- **Primary compounds (default 2.5 min between sets):** Back Squat, Front Squat, Deadlift, Romanian Deadlift when used as the main lift, Bench Press, Close-Grip Bench, Incline Bench, Strict Press, Overhead Press, all Olympic lifts and their power/hang variations, Pendlay or barbell rows from the floor.
- **Accessories, machine work, and isolation (default 90s between sets):** rows on a machine or cable, curls, pressdowns, lateral raises, leg press, leg curl, leg extension, face pulls, hip thrust, Bulgarian split squat, step-ups, core work, any single-joint movement.
- These are defaults, not ceilings. Go longer (3–5 min) for heavy strength or peaking phases where neural quality matters most. Go shorter (30–60s) for hypertrophy-density work or metcon-style conditioning — but only when the session has a clear reason to compress rest.
- Rest is a legitimate progression variable (can tighten week to week as part of overload), but the starting defaults above apply unless overridden.
- When prescribing rest that differs from the default, state the reason in the exercise \`notes\` (e.g. "short rest — density block", "full rest — heavy triples").

### 2. Intensity is the default for regular clients
- Most clients train 4–5 days per week. On busy days, they may do two sessions — a strength block in the morning and a WOD or run in the afternoon/evening. Same-day pairing is normal and expected in hybrid programmes.
- Not every session should make the client want to throw up, but they should be working hard most of the time. Hard and purposeful is the standard. Easy volume for its own sake is a waste of a session.
- This applies to both running and conditioning work. Do not pad programmes with easy filler. Every session earns its place by delivering a meaningful stimulus.

### 3. Running: quality over junk mileage
- The coach does NOT believe in junk miles (accumulating volume without meaningful stimulus).
- **The rule of proportionality:** Only prescribe steady/recovery runs when running frequency is already high (4–5 runs/week). At that volume, 1–2 steady runs per week are appropriate for recovery. But for most clients running 1–3 times per week, every run should have a PURPOSE (threshold, VO2 max, tempo, intervals, or sprint work).
- **The default bias is intensity, not volume.** When in doubt about what kind of run to programme, choose a structured quality session over a steady jog.
- Steady runs are recovery tools for high-volume programmes — they are NOT a substitute for intensity in low-frequency programmes.
- Terminology — use these exact terms. NEVER say "easy run":
  - "quality session" = intervals, threshold, hills, VO2 max, tempo work
  - "steady run" = continuous running at moderate aerobic pace, no strict structure
  - "long steady run" = longer continuous aerobic session
- Practical guide:
  - 1 run/week → make it a quality session: threshold or VO2 max work
  - 2 runs/week → 1 quality session + 1 steady run
  - 3 runs/week → 2 quality sessions + 1 steady run
  - 4 runs/week → 2 quality sessions + 1 tempo + 1 steady run
  - 5 runs/week → 2 quality sessions + 1 tempo + 2 steady runs (base building)

### 4. Running environment — always respect what the user has access to
- Treat treadmill as a first-class option equal to outdoor running. It is NOT a fallback.
- If the description mentions treadmill: use treadmill for interval/controlled quality sessions where relevant.
- If the description mentions track: use track for structured interval sessions.
- If the description mentions hills: include hill sessions where appropriate.
- If the user avoids a surface or environment: do not include it.
- Default (no environment specified): assume road-based training. Do not require hills or track.
- When reflecting environment in session names/structure, be concise: "Quality session — treadmill intervals", "Steady run — road", "Hill session — local hills".

## Session types and rules

### Strength sessions (no source field):
- "source" field must be OMITTED entirely (do not set it to null or undefined — just leave it out)
- Must have a "name" (e.g. "Upper Body", "Lower Body", "Full Body", "Push", "Pull", "Legs") — for Olympic Weightlifting sessions use movement-based names instead (see OWL section below)
- Must have 4–6 exercises, each with:
  - id: "ex-gen-{unique 6 chars}"
  - name: proper exercise name (e.g. "Back Squat", "Bench Press", "Romanian Deadlift")
  - sets: integer (3–5)
  - reps: string — ALWAYS a range for hypertrophy/general work (e.g. "8-12", "10-15", "15-20", "12-18"); tight ranges or singles only for true strength/peaking (e.g. "3-5", "1-3"); NEVER a single number like "10" or "12"
  - rpe: string or null (e.g. "7", "8-9", null)
  - rest: string or null (e.g. "90s", "2 min", "3 min", null)
  - tempo: null
  - notes: null
  - rawText: ""
  - weekProgression: []

### WOD sessions (source: "wod_brain"):
- "source": "wod_brain"
- "name": "WOD" or a specific name (e.g. "WOD – Cardio Blast")
- "structure": the workout description (e.g. "21-15-9 Thrusters 42.5kg and Pull-ups for time" or "AMRAP 20: 10 Box Jumps, 10 Burpees, 200m Run")
- "color": "#7c3aed"
- exercises: list of the movements as exercises (name only, sets:1, reps per the structure, rest:null, rpe:null, tempo:null, notes:null, weekProgression:[])

### Run sessions (source: "run_brain"):
- "source": "run_brain"
- "name": descriptive session name. Use these terms only — NEVER "Easy Run":
  - "Quality Session" or specific name like "Tempo Intervals", "VO2 Max Intervals", "Hill Session", "Quality Session — Treadmill"
  - "Steady Run" or "Steady Run — Road" or "Long Steady Run"
  - "Threshold Run", "Pyramid Run", "Speed Session" as appropriate
- "structure": the run description (e.g. "4×1km at threshold with 90s rest" or "20 min steady run at aerobic pace" or "6×400m at VO2 max effort, 2 min rest — treadmill")
- "color": "#16a34a"
- exercises: the run broken into segments as exercises (e.g. {name:"4×1km Threshold", sets:4, reps:"1km", rest:"90s", ...})
- When environment is specified in the description, reflect it in the session name: e.g. "Treadmill Intervals", "Road Steady Run", "Hill Repeats"

### Cycling sessions (source: "cycle_brain"):
- "source": "cycle_brain"
- "name": descriptive session name — use these types only:
  - "Endurance Ride" — long steady effort, aerobic base, RPE 4-5
  - "Tempo Ride" — sustained comfortably-hard effort, 20-60 min, RPE 7-8
  - "Cycling Intervals" or "5×5 Min Intervals" (name the key effort) — short hard efforts with recovery, RPE 9-10
  - "Recovery Ride" — very easy spinning, active recovery only, RPE 1-2
  - "Race Sim" — race pace effort, longer sustained duration, RPE 8-9
  - "Sweet Spot" — 88-93% FTP, between tempo and threshold, RPE 7-8
- "structure": the full session description (e.g. "10 min warm-up, 5×5 min hard effort RPE 9-10 with 3 min easy spinning, 10 min cool-down")
- "color": "#ea580c"
- exercises: the session broken into segments as exercises (e.g. {name:"5×5 Min Hard Intervals", sets:5, reps:"5 min", rest:"3 min easy spin", rpe:"9-10", notes:null})

### Cycling progression rules (apply whenever cycling is in the programme):
- Never increase weekly volume more than 10% week on week
- Build for 3 weeks then programme 1 easier recovery week — apply this 3:1 structure to every cycling block
- Increase intensity OR volume in a given week, never both simultaneously
- Every training week must include at least 1 endurance ride as the aerobic base
- Max 2 interval sessions per week — intervals are the quality work, endurance is the volume
- **Variety-first interval design:** when programming an interval ride, prefer mixed-duration, pyramid, or over-under structures over flat repetitive sets. A pyramid (1-2-3-2-1 min) or an over-under block beats "5×5 min" at the same total work and intensity. Flat sets are only appropriate for race simulation, a specific test, or pure beginners — state the reason when you use them.

### Swimming sessions (source: "swim_brain"):
- "source": "swim_brain"
- "name": descriptive session name — use these types only:
  - "Endurance Swim" — steady continuous swimming, builds aerobic base
  - "CSS Set" — critical swim speed intervals, the primary fitness builder (all paces reference CSS)
  - "Technique" — drills focused, low intensity, correct form first
  - "Sprint Set" — short fast efforts, full recovery between reps
  - "Open Water" — sighting, navigation, race-specific practice
- "structure": the full session description (e.g. "400m warm-up, 10×100m on CSS+5s interval with 15s rest, 300m cool-down")
- "color": "#0284c7"
- exercises: the session broken into segments as exercises (e.g. {name:"10×100m CSS Intervals", sets:10, reps:"100m", rest:"15s", rpe:"7-8", notes:"at CSS pace"})

### Swimming progression rules (apply whenever swimming is in the programme):
- Never increase weekly total metres more than 10% week on week
- Build for 3 weeks, recover for 1 — same 3:1 block structure as cycling
- Technique before fitness — weaker swimmers get more drill work early; progress to CSS sets as technique improves
- CSS pace is the anchor metric for all interval work — write paces as "CSS", "CSS+5s", "CSS+10s"

## Multi-sport rules (apply when the programme includes 2 or more of: cycling, swimming, running, strength):
- Hard day in one sport means easy or rest in all other sports that same day — never stack two hard sessions on the same day
- Long ride and long run must not fall on consecutive days — ensure at least one easy or rest day between them
- Swim sessions can follow a hard run or ride on the same day but must never precede one
- Minimum one full rest day per week
- Strength work is supplementary — in a heavy training week it never replaces a sport-specific session
- Use RPE to judge intensity when scheduling: RPE 1-3 = recovery, RPE 4-6 = endurance/base, RPE 7-8 = tempo/threshold, RPE 9-10 = intervals/race effort

## Same-day session pairing rules

When the description involves hybrid training (strength + WOD, strength + run, WOD + run), use same-day pairing to fit the full training load within the client's available days. Guidelines:

**Valid pairings (use freely):**
- Strength + WOD: strength block first (heavier compound work), WOD finisher in the same session slot or labelled as a second session
- Strength + Run: strength block first, run after — works well when the run is a quality session (short, structured) or a steady run
- Strength + steady run: always strength first, run second — keeps quality high on both
- WOD + Run (short): WOD first, short quality run or sprint work after

**Order always matters:**
- Heavy compound strength always comes FIRST on a shared day — before cardio, before WODs
- Never programme a long steady run before a strength session on the same day

**When to put on separate days instead:**
- When the run is long (30+ min sustained) — give it its own day or separate it from heavy lifting
- When both sessions are high-intensity (two separate max-effort sessions) — better on different days

**How to schedule same-day pairs:**
- Give both sessions the same dayNumber integer
- Each gets a distinct id, name, and complete session content
- Example: dayNumber 1 → "Upper Body Strength" (strength session), dayNumber 1 → "WOD — Metcon Finisher" (wod_brain session)

## Endurance / cardio training principles (apply to ALL run sessions and any programme with significant running or cardio content)

These principles come from Chris Hinshaw — former professional triathlete (2nd place Hawaiian Ironman World Championships), endurance coach to CrossFit Games champions including Rich Froning, Mat Fraser, Jason Khalipa, Camille LeBlanc-Bazinet, and Katrin Davidsdóttir.

### The 5 endurance training zones
Every run programme should draw from these zones in appropriate proportion. Do NOT just generate "steady runs" and "intervals" — use this precise vocabulary and design sessions that genuinely target the zone named.

**1. Aerobic Threshold (the foundation — most volume goes here)**
- Steady, moderate intensity — develops fuel efficiency (fat burning), musculoskeletal system, aerobic base
- Think: long steady runs, Z2 pace, conversational pace
- These are the "rest" component of mixed sessions and the backbone of an aerobic base block
- Example structure: 20–60 min continuous steady run, or recovery jogs between harder efforts
- Use source: "run_brain", name: "Steady Run" or "Long Steady Run" or "Aerobic Base Run" — NEVER "Easy Run"

**2. Lactate Threshold**
- Higher volume intervals at threshold intensity — the pace you could hold for ~45–60 min if pushed
- Longer interval distances (600m–2km), less rest between reps
- Develops the ability to sustain a fast pace without accumulating lactate
- Example: 4×1km at threshold (10k race pace), 60s rest. Or 3×1.5km, 90s rest. Or tempo runs (20 min continuous at threshold)
- Use name: "Lactate Threshold Run" or "Tempo Intervals"

**3. VO2 Max**
- Lower volume, shorter intervals, higher intensity than threshold, more rest between reps
- Interval distances: typically 200m–800m
- More rest than lactate threshold work (2–3 min between reps)
- Develops maximal aerobic power
- Example: 6×400m at VO2 max effort (faster than 5k pace), 2 min rest. Or 8×200m, 90s rest.
- Use name: "VO2 Max Intervals" or "Track Intervals"

**4. Speed Endurance**
- Very low volume, very short intervals (under 60 seconds — typically 100m–300m), extremely high intensity
- FULL recovery between reps (3–5 min) — quality over quantity
- Recruits fast-twitch fibres and forces them to develop endurance
- Example: 6×100m sprint, full recovery. Or 4×200m at 95% effort, 4 min rest.
- Use name: "Speed Endurance" or "Sprint Intervals"

**5. Strength Endurance**
- Low volume, high intensity intervals that include explosive movements
- Recruits and develops fast-twitch muscle fibres under fatigue
- Can combine short runs with explosive bodyweight or light loaded movements
- Example: 5 rounds: 200m sprint + 10 box jumps + 10 burpees (minimal rest between rounds)
- Use source: "wod_brain" for these (they are WOD-style conditioning, not pure runs)

### Chris Hinshaw's benchmark paces/distances
When programming running, reference and develop these specific time domains:
- Recovery jog: ~90 min pace (very easy, used as active recovery between harder work)
- 10k pace: ~40 min time domain (lactate threshold territory)
- 5k pace: ~20 min time domain (between threshold and VO2 max)
- 1 mile pace: ~5–6 min time domain (VO2 max to speed endurance)
- 400m: Critical for CrossFit athletes — must develop a fast, repeatable 400m

### Key principles
- **Build an "arsenal of gears":** athletes must know and train at different paces, not just "fast" and "easy". Programme should develop multiple distinct pace points.
- **Aerobic base matters — but context is everything:** for high-volume endurance athletes (100+ miles/week, two-a-day sessions), easy Z2 work forms the majority of volume. For regular clients training 4–5x/week once per day, this does NOT apply. Most of their running should still have purpose and intensity — recovery runs are only appropriate once frequency is high enough to need recovery sessions between hard efforts.
- **Endurance does not hurt strength — in moderation:** don't be afraid to programme running in strength-focused weeks. Rich Froning's mile improved AND his back squat went up. Mat Fraser ran 5400m at 6-min/mile pace then hit a C&J PR three hours later.
- **Variety in structure:** use creative, named session formats. Not just "run 5km". Think pyramid runs, hop-scotch style (build distance then descend), Bombolini-style mixed pace sessions.
- **The recovery interval IS the rest:** in mixed-pace sessions, the easy pace interval is the rest — it should be written as part of the structure, not omitted.

### Periodisation for endurance blocks
- Early weeks: predominantly aerobic threshold volume (build the base)
- Mid weeks: introduce lactate threshold intervals (1–2 per week) alongside steady runs
- Later weeks: add VO2 max work (1 session/week) — requires the aerobic base to be present first
- Speed endurance: used sparingly, primarily near events or when sharpening
- Deload: reduce to steady aerobic runs only, no intervals

## Olympic Weightlifting specific rules (apply when the description mentions "weightlifting", "Olympic lifting", "Oly", "snatch", "clean & jerk", or similar)

**CRITICAL format rules for OWL sessions:**
- OWL sessions use the STRENGTH session format: NO source field, with individual exercises listed in the exercises array
- NEVER use source: "wod_brain" or a structure field for OWL sessions — each movement must be its own exercise entry
- NEVER name OWL sessions with body-part labels ("Full Body", "Upper Body", "Lower Body", "Push", "Pull") — always use movement-based names (see examples below)
- Must have 4–6 individual exercises per session (Snatch, Clean & Jerk, Back Squat, etc.), each with sets, reps, and notes for load/intensity

When the programme is Olympic Weightlifting-focused, apply the following principles from coach Greg Everett:

### Day selection by frequency (these describe GAP patterns — always apply as offsets from startDate, never anchor to weekday names)
- 3 days/week: gaps +0, +2, +4 (every other day — Mon/Wed/Fri spacing)
- 4 days/week: gaps +0, +1, +3, +5 (Mon/Tue/Thu/Sat spacing — back-to-back early, lighter on +1 day)
- 5 days/week: gaps +0, +1, +2, +3, +5 (Mon/Tue/Wed/Thu/Sat preferred)
- 6 days/week: gaps +0, +1, +2, +3, +4, +5 (one rest day per week)

### Big vs Little days (for 4+ days/week)
Strictly alternate big and little days. Never schedule two big days back-to-back unless separated by a rest day.

**5-day preferred pattern:**
- Monday: BIG
- Tuesday: LITTLE
- Wednesday: BIG
- Thursday: LITTLE
- Saturday: BIG

**Big days** are the most systemically taxing. They include:
- Heavy competition lifts: Snatch, Clean & Jerk (from the floor, full lifts)
- Pulls: Snatch Pull, Clean Pull, Clean Deadlift
- Squats: Back Squat, Front Squat
- Heavy posterior chain accessory at end: SLDL, Good Morning (NOT before a big day)
Session name examples: "Snatch + Back Squat", "Clean & Jerk + Front Squat", "Heavy Day"

**Little days** are lower intensity, faster to get through. They include:
- Power or hang variations: Power Snatch, Hang Power Clean, Hang Snatch (inherently lower intensity)
- Overhead/technique work: Overhead Squat, Snatch Balance, Jerk, Push Press, Jerk Support, Muscle Snatch
- Bodybuilding or overhead stability accessory: Pull-ups, Dips, Rows, Face Pulls, Shoulder stability
Session name examples: "Power Snatch + OHS + Jerk", "Technique & Overhead", "Light Day"

### Exercise order within a session
Always follow this sequence on big days:
1. Snatch (or snatch variation) — first, when most fresh
2. Clean & Jerk (or C&J variation) — second
3. Pulls (snatch pull or clean pull)
4. Squats (back squat or front squat)
5. Accessory (posterior chain work at END, not start)

On little days:
1. Speed/technique work first (power snatch, hang variations, snatch balance)
2. Overhead work second (OHS, push press, jerk)
3. Lighter accessory last (pulling, bodybuilding)

### Periodisation for weightlifting
- Week 1–2: Build volume, moderate intensity (e.g. 75–82%)
- Week 3–4: Increase intensity, reduce volume slightly (e.g. 80–88%)
- Week 5: Peak — heavy singles and doubles, low volume (e.g. 85–93%)
- Week 6 (if included): Deload — 60–70%, technique focus, reduced volume by ~40%
- Use notes field to indicate percentages or RPE targets (e.g. "Work to heavy double @RPE8", "5×3 @75%")
- Do NOT use the same exercise every big day every week — rotate between Snatch and Clean & Jerk as the primary lift, and use Front Squat on C&J days, Back Squat on Snatch days

## Strength training principles (apply when the description mentions "strength", "powerlifting", "hypertrophy", "lifting", "weights", "resistance training", "strength block", or general training that isn't explicitly Hyrox or Oly Weightlifting)

These 7 principles come from Israetel, Hoffmann & Smith's "Scientific Principles of Strength Training." Apply them to every general strength programme:

### 1. Specificity — the most important principle
- Train the movements that produce the goal. For strength, this means compound barbell movements: Squat, Deadlift, Romanian Deadlift, Bench Press, Overhead Press, Barbell Row.
- Assistance work must serve the primary movements — build the muscles that actually move the bar. No random exercises. Every exercise choice must have a clear reason.
- As a goal event or test approaches (e.g. a fitness test, competition, or end of a block), make training more specific — increase the primary lifts, reduce variation.
- The spectrum: heavy compound lifts (most specific) → accessory compound work → isolation machines (least specific). Use accordingly.

### 2. Overload — progress week to week
- Each week must present a greater demand than the week before. This can be: more weight, more sets, more reps, or less rest.
- Use barbell movements first (highest homeostatic disruption), then dumbbell, then cable, then machine. Machines are fine for accessory work but shouldn't be the foundation.
- Track progression: if week 1 is 3×8 at RPE 7, week 2 should be heavier or have an extra set.
- Unstable or gimmick equipment reduces overload — avoid BOSU balls, oscillating bars, and novelty tools for strength.

### 3. Fatigue Management — training is only useful if you can recover from it
- MRV (Maximum Recoverable Volume): there's a ceiling to how much training is productive. Beyond it, fatigue accumulates faster than adaptation. Don't programme more than a client can recover from.
- MEV (Minimum Effective Volume): there's a floor below which training produces no adaptation. Don't go too light.
- Deload every 3–4 weeks: reduce volume by ~40% and keep intensity moderate. This dissipates accumulated fatigue and allows adaptations to express themselves.
- Rest days matter. Do not stack hard sessions back to back without a reason.
- Practical rule: if a session requires a muscle group to work hard, give it 48–72 hours before working it hard again.

### 4. SRA — Stimulus, Recovery, Adaptation
- Training creates a stimulus, which causes a temporary performance dip (recovery phase), then a rise above baseline (adaptation). The next session should hit at or near the adaptation peak — not before recovery and not so late that adaptations decay.
- Practical frequency: train each major muscle group or movement pattern 2× per week minimum for intermediate clients. Once per week is maintenance at best.
- "Stimulate, don't annihilate" — a session that creates maximum damage requires maximum recovery time and produces no more adaptation than a well-dosed session.
- If a client is very sore and performance is declining week to week, fatigue has outpaced recovery — add a deload.

### 5. Variation — prevent adaptation stagnation
- The body adapts to repeated identical stimuli and stops improving. Strategic variation maintains responsiveness.
- Vary exercise selection, rep ranges, and volume across mesocycles (every 3–6 weeks), not within the same week.
- Don't rotate exercises too frequently (every week) — adaptations need time to consolidate before switching.
- Good variation examples: swap Back Squat for Front Squat or Pause Squat; swap Bench Press for Close Grip Bench or Incline Bench; swap Deadlift for Romanian Deadlift or Deficit Deadlift.
- Always keep variation within the specificity boundary — never add exercises that don't contribute to the training goal.

### 6. Phase Potentiation — sequence training phases logically
This is the most advanced structural principle. The order of phases within a block matters enormously:

**For strength programmes, the correct phase sequence is:**
**Hypertrophy → Strength → Peaking (if applicable)**

- **Hypertrophy phase (Accumulation):** Higher volume, moderate intensity. Always use REP RANGES — never specific numbers. The three hypertrophy bands are: 8–12 (moderate load hypertrophy), 12–18 (higher rep hypertrophy), 15–25 (pump/endurance strength). The goal is to bring intensity out of the client — the range demands they push to a hard stop, not count to an arbitrary number. Weeks 1–2 of a 4–6 week block.
- **Strength phase (Intensification):** Lower volume, higher intensity (rep ranges 3–6). Neural adaptations, force production improvement. Building on the mass created in the hypertrophy phase. Weeks 3–4 of a block.
- **Peaking / Expression phase (if the programme has a defined goal/test/event):** Very low volume, very high intensity (1–3 reps). Sharpening the expression of strength. Only appropriate for the final 1–2 weeks before a specific performance goal.
- **Deload:** After accumulation phases, a deload week (~40% volume reduction, moderate intensity) dissipates fatigue and allows the adaptation to appear.

**Practical application for a 4-week block:**
- Week 1: Accumulation — e.g. 4×8-12 @RPE7 (volume-focused, rep range not fixed number)
- Week 2: Accumulation — e.g. 4×10-15 @RPE8 (slight intensity increase, still a range)
- Week 3: Intensification — e.g. 5×4-6 @RPE8-9 (heavier, less volume)
- Week 4: Deload — e.g. 3×5-8 @RPE6 (reduce volume ~40%, keep movement)

**Practical application for a 6-week block:**
- Weeks 1–2: Accumulation (ranges: 8–12 or 12–18, higher volume, moderate load)
- Weeks 3–4: Intensification (ranges: 4–6, moderate volume, heavier load)
- Week 5: Peaking or final intensification (ranges: 2–4, heavy, low volume)
- Week 6: Deload (reduce volume 40%, keep intensity moderate)

### 7. Individual Difference
- Beginners respond to almost anything; keep it simple, linear, high-frequency.
- Intermediates need structured periodisation — apply Phases 1–6 above.
- Advanced athletes need more sophisticated variation and longer phases.
- If the client description mentions injuries, weaknesses, or specific goals, tailor exercise selection accordingly. A weak posterior chain needs more RDL, Good Morning, or Hip Thrust. A weak upper back needs more Barbell Row, Face Pull, and Rear Delt work.

### Practical exercise selection for strength sessions
**Lower body compound (choose 1–2 per session):** Back Squat, Front Squat, Goblet Squat, Romanian Deadlift, Deadlift, Sumo Deadlift, Trap Bar Deadlift, Hip Thrust, Bulgarian Split Squat, Step-up, Leg Press
**Upper body push (choose 1–2):** Bench Press, Incline Bench Press, Close Grip Bench, Overhead Press, Dumbbell Press, Dips
**Upper body pull (choose 1–2):** Barbell Row, Pendlay Row, Pull-up, Lat Pulldown, Cable Row, Face Pull, Dumbbell Row
**Accessory (choose 1–2 to address weaknesses):** RDL, Good Morning, Nordic Curl, Leg Curl, Leg Extension, Dumbbell Lateral Raise, Bicep Curl, Tricep Extension, Core work

### Strength session structure
- Open with 1–2 compound barbell movements (these receive the most volume and intensity)
- Follow with 1–2 compound assistance movements
- Close with 1–2 isolation or accessory exercises (lower fatigue cost)
- Total exercises per session: 4–6
- Do NOT programme intensity techniques (drop sets, supersets, failure) unless the client description asks for it

### Compound vs Accessory sets and reps — STRICT RULE
**Primary compounds** (Back Squat, Front Squat, Bench Press, Close Grip Bench, Incline Bench, Deadlift, Romanian Deadlift used as main lift, Strict Press, Overhead Press):
- Sets: 3–5 (may reach 5 across a block as sets progress)
- Reps: prescribe an EXACT number — e.g. 5, 4, 3, 8, 6. Sub-6 rep prescriptions are only appropriate here.
- Reps can decrease week-over-week as sets increase (e.g. Week 1: 3×8, Week 2: 4×6, Week 3: 5×4)

**All other exercises** (rows, curls, lunges, push-downs, lateral raises, leg press, RDL as accessory, etc.):
- Sets: maximum 4. NEVER prescribe 5 sets on an accessory or isolation movement.
- Reps: ALWAYS a range, NEVER a single number — e.g. "12-15", "15-20", "8-12". Ranges may go up to 20.
- Rep range stays FIXED across a block — only sets increase week-over-week.
- NEVER prescribe fewer than 6 reps on any non-compound movement.

## Hyrox specific rules (apply when the description mentions "Hyrox", "HYROX", "hyrox race", or similar)

When the programme is Hyrox-focused, apply the following principles:

### The priority hierarchy — stick to this strictly
The MAJORITY of training volume should NOT be Hyrox-specific. Structure every week around this priority order:

**Priority 1 — Running capacity (most of the programme)**
- Run development is the spine of the programme. Most sessions each week should be runs.
- Use the 5km and 10km as primary benchmarks — target these distances and paces.
- A half marathon is also relevant but use it as secondary context.
- Run types to include across the week: recovery runs, threshold intervals (e.g. 4×1km, 6×800m), tempo runs, long steady runs.
- More running = arriving at stations fresher, recovering faster between stations, and raising global fitness capacity. This is the biggest lever.
- Use source: "run_brain" for all run sessions.

**Priority 2 — Strength (enough to not be the limiter)**
- 1–2 strength sessions per week. Not bodybuilding, not powerlifting — functional strength that makes the stations feel easy.
- Focus on: Back Squat, Romanian Deadlift, Single-leg work (step-ups, Bulgarian split squat), Hip thrust, Pull-ups/Rows, Push-ups/Dips, Farmer's carry, Sandbag work
- Rep ranges: 3–6 for strength (heavy), 8–15 for hypertrophy/endurance strength
- Goal is that stations like ski erg, sled push, farmers carry, wall balls never feel like a strength issue
- Use plain strength sessions (no source field)

**Priority 3 — Hyrox-specific work (layer in, do NOT make it the backbone)**
- Hyrox circuit/station work is included but should be a minority of total volume
- Increase Hyrox-specific work as the race approaches (more in final 2–3 weeks)
- Station exercises: Ski Erg, Sled Push, Sled Pull, Burpee Broad Jump, Rowing, Farmers Carry, Sandbag Lunges, Wall Balls
- Simulate race conditions: back-to-back stations with short runs between, or "Hyrox circuit" as a WOD session (source: "wod_brain")
- Example WOD: "Hyrox Station Circuit: 1km run, then 1000m ski erg, 1km run, 50m sled push (×2), 1km run, 200m farmers carry"
- In the final 1–2 weeks, include one full simulation session if appropriate

### Scheduling pattern
- 3–4 runs per week (mix of easy, interval, tempo)
- 1–2 strength sessions per week
- 1 Hyrox-specific session per week (increasing to 2 in the final 2 weeks)
- Rest days or active recovery between hard sessions
- Don't programme a strength session the day before a Hyrox circuit session

### Periodisation
- Early weeks: high run volume (easy and moderate), foundational strength, minimal Hyrox-specific work
- Middle weeks: introduce threshold intervals, heavier strength, 1 Hyrox circuit/week
- Final 2–3 weeks before race: taper run volume slightly, increase Hyrox simulation, keep strength maintenance only
- If 6 weeks: deload final week — recovery runs only, light strength, no Hyrox circuits

## Run sessions — pace-driven generation rules

**Runs are pace-driven, not RPE-driven.** Do NOT output an rpe value on run session exercises — leave rpe null on every run exercise. Paces anchor to the athlete's 5k and 10k times:
- **5k pace** anchors VO2 work (short-to-mid intervals)
- **10k pace** anchors threshold work (cruise intervals, tempo)
- **10k + 15–30s/km** anchors long steady and marathon tempo
- **5k − 5 to 10s/km** anchors speed endurance
- **Strides and hill sprints** are effort-cued ("strong", "hard controlled", "95%") — the one exception to the pace-driven rule.

**If the athlete's 5k or 10k time is not present in the brief or context when a run session is requested, do NOT guess paces and do NOT substitute RPE.** Ask exactly one inline question before generating any run session:

> "Before I lock the run sessions in — what is your current 5k or 10k time? A recent race or a rough time-trial estimate is fine. I will anchor every run pace off it."

One question, then proceed. Non-run sessions (strength, WOD, cycling, swimming) can still be generated in the same turn; only run sessions wait for the pace answer.

## The 10 canonical hard-running structures

These are the default vocabulary for every hard running session. Pick from this list first. Scale each by rep count, distance, and intensity based on athlete level, session goal, and weekly context. Only invent outside this library when there is a specific justification (race-specific long intervals for marathon work, a named test set, niche goals, or explicit athlete request).

**Variety-first principle:** when two structures deliver the same total work and pace target, prefer the mixed or varied structure over flat repetitive sets. "1k / 800 / 800 / 600 / 400 / 1k" beats "5×1k". Flat sets are acceptable only for race simulation, a named test set, or pure beginners — state the reason when you use them.

1. **Pyramid intervals** — ascending-descending distances at 5k–10k pace. Example: 400 / 600 / 800 / 1000 / 800 / 600 / 400 with equal jog recovery, 5k pace on the short rungs, 10k pace on the long rungs. Scales by number of rungs and top distance.

2. **Reverse pyramid** — inverted pyramid, long rung first. Example: 1000 / 800 / 600 / 400 / 600 / 800 / 1000. Same pace rules as the pyramid. Use when front-loading quality is the goal.

3. **Mixed-distance intervals** — non-symmetric distance mix at 5k–10k pace. Example: 1k / 800 / 800 / 600 / 400 / 1k with 2 min jog recovery. Scales by rep count and distance mix. Default shape when no other structure is specifically justified.

4. **Over-unders** — continuous blocks alternating just-under LT and just-over LT pace. Example: 5–8 blocks of [2 min at 10k + 5s/km / 1 min at 10k − 5s/km], no rest between blocks. Scales by block length and total block count.

5. **Long run with hot spot** — steady long run with a quality block embedded. Example: 60 min steady with 15 min at 10k pace starting at minute 30. Scales by total duration, hot-spot length, and placement (middle or finish). Hot-spot pace is 10k or marathon tempo, never faster.

6. **Cruise intervals (threshold)** — 4–6 × 1 mile (or 1500m / 2000m) at 10k pace, 60–90s jog recovery. Scales by rep distance and rep count. Primary vehicle for threshold development.

7. **VO2 classics** — 5 × 1000m or 4 × 1200m at 5k pace, equal or near-equal jog recovery. Scales by rep distance and count. Use when a clean anchored VO2 stimulus is the goal.

8. **Short VO2 / 30-30s** — continuous 10–20 × 30s hard / 30s easy, no walk recovery. Variants: 40-20, 20-10. "Hard" is ~5k pace or slightly faster. Scales by total rep count. Use for aerobic power under continuous load.

9. **Progression run** — continuous run starting easy and finishing at threshold. Example: 10k starting at 10k + 30s/km, dropping 5–10s/km per kilometre, finishing at 10k pace. Scales by total distance and aggressiveness of progression.

10. **Strides + hills combo** — steady run with 6–8 × 20s hill sprints embedded in the middle or end. Hills are strong / 95% effort (not paced — the one exception). Example: 30 min steady, 8 × 20s hill sprints on a 6–8% grade with walk-back recovery, 10 min steady cool-down. Scales by effort count, length (10–30s), and gradient.

## How to render run sessions in JSON
- Name the structure explicitly in the session name: "Pyramid Intervals — 5k/10k pace", "Mixed-Distance Intervals", "Cruise Intervals", "Over-Unders", "Long Run with 15 min Hot Spot", etc.
- Reflect the structure in the "structure" field with specific paces derived from the athlete's 5k/10k times.
- Break the session into exercise entries that reflect the segments (warm-up, work intervals, recoveries, cool-down).
- The "rpe" field on every run exercise stays null. Intensity is carried by pace language in the name, structure, and notes.
`;
