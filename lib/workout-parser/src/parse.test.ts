import { describe, expect, it } from "vitest";
import { parseWorkout } from "./parse.js";
import { FIXTURES } from "./fixtures.js";

const HAS_KEY = Boolean(
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
);

const describeWithKey = HAS_KEY ? describe : describe.skip;

describeWithKey("parseWorkout — brief fixtures", () => {
  for (const f of FIXTURES) {
    it(`${f.id}: ${f.description}`, async () => {
      const result = await parseWorkout(f.input, { sport: f.sport });

      if (!result.ok) {
        throw new Error(`Expected ok, got failure: ${result.reason} — ${result.message}`);
      }

      expect(result.exercises.length).toBeGreaterThanOrEqual(f.expect.minExercises);
      if (f.expect.maxExercises != null) {
        expect(result.exercises.length).toBeLessThanOrEqual(f.expect.maxExercises);
      }

      const names = result.exercises.map((e) => e.name.toLowerCase());
      for (const want of f.expect.namesContain ?? []) {
        const found = names.some((n) => n.includes(want.toLowerCase()));
        expect(found, `expected an exercise containing "${want}". Got: ${names.join(", ")}`).toBe(true);
      }

      for (const want of f.expect.notesContain ?? []) {
        const matches = result.exercises.filter((e) =>
          e.name.toLowerCase().includes(want.exerciseName.toLowerCase()),
        );
        const hit = matches.some((e) =>
          (e.notes ?? "").toLowerCase().includes(want.substring.toLowerCase()),
        );
        expect(
          hit,
          `expected exercise containing "${want.exerciseName}" to have notes containing "${want.substring}". Notes: ${matches
            .map((m) => m.notes ?? "(none)")
            .join(" | ")}`,
        ).toBe(true);
      }

      for (const ex of result.exercises) {
        expect(ex.name.length).toBeGreaterThan(0);
        expect(ex.sets).toBeGreaterThan(0);
      }
    });
  }
});

describe("parseWorkout — failure paths", () => {
  it("returns empty_input failure for empty string", async () => {
    const r = await parseWorkout("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty_input");
  });

  it("returns empty_input failure for whitespace only", async () => {
    const r = await parseWorkout("   \n  ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty_input");
  });
});
