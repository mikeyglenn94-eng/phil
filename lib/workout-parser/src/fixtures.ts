import type { Sport } from "./types.js";

export interface Fixture {
  id: string;
  description: string;
  sport: Sport;
  input: string;
  expect: {
    minExercises: number;
    maxExercises?: number;
    namesContain?: string[];
    notesContain?: { exerciseName: string; substring: string }[];
  };
}

export const FIXTURES: Fixture[] = [
  {
    id: "full-body-12",
    description: "12-exercise full body session typed manually",
    sport: "strength",
    input:
      "Back squat 4 sets of 6 at RPE 8, rest 2 minutes. Romanian deadlift 4x10. Bench press 5 sets of 5. Barbell row 3x8-10. Overhead press 3x6 RPE 9. Lat pulldown 3x12. Pull ups 3 sets to failure. Dumbbell shoulder press 3x10. Bicep curls 3x10-12. Tricep pushdowns 3x12-15. Face pulls 3x15. Hanging leg raises 3 sets of 12.",
    expect: {
      minExercises: 12,
      maxExercises: 12,
      namesContain: [
        "squat",
        "romanian",
        "bench",
        "row",
        "overhead",
        "pulldown",
        "pull",
        "shoulder",
        "curl",
        "tricep",
        "face",
        "leg raise",
      ],
    },
  },
  {
    id: "voice-runon",
    description: "Voice-transcribed run-on session, no punctuation",
    sport: "strength",
    input:
      "did some squats then bench then rows then deadlifts then curls then push downs and finished with abs three sets each i think",
    expect: {
      minExercises: 6,
      namesContain: ["squat", "bench", "row", "deadlift", "curl"],
    },
  },
  {
    id: "warmup-stripped",
    description: "Session with warm-ups and working sets — warm-ups should be stripped",
    sport: "strength",
    input:
      "Warm up: 5 minutes bike, mobility drills, banded shoulder work. Working sets: bench press 4x6 RPE 8 rest 2 min, incline dumbbell press 3x10, cable fly 3x12-15. Cool down: 5 min walk and stretch.",
    expect: {
      minExercises: 3,
      maxExercises: 3,
      namesContain: ["bench", "incline", "fly"],
    },
  },
  {
    id: "rpe-tempo",
    description: "Session with RPE and tempo notes",
    sport: "strength",
    input:
      "Front squat 4 sets of 5 at RPE 8 with a 3-1-1-0 tempo, rest 3 minutes. Pause bench press 3 sets of 5 RPE 9 tempo 2-2-1-0. Romanian deadlift 3 sets of 8-10 RPE 8.",
    expect: {
      minExercises: 3,
      maxExercises: 3,
      namesContain: ["front squat", "bench", "romanian"],
    },
  },
  {
    id: "scrap-replace",
    description: "User mentions an exercise then says 'actually scrap that' — both kept, correction noted",
    sport: "strength",
    input:
      "Bench press 4x8. Then I was going to do dumbbell flys 3x12 but actually scrap that and replace it with cable crossovers 3x12-15. Then tricep pushdowns 3x15.",
    expect: {
      minExercises: 4,
      namesContain: ["bench", "fly", "crossover", "tricep"],
      notesContain: [{ exerciseName: "fly", substring: "scrap" }],
    },
  },
];
