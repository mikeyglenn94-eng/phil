/**
 * POST /parse-session-from-image
 *
 * Vision-based parser for endurance session screenshots (Strava, Garmin,
 * Apple Fitness, Coros, treadmill consoles). Accepts 1+ base64-encoded images
 * of a single activity, returns the same shape as /parse-run-session so the
 * existing preview/save UI can consume it.
 *
 * Body shape: { imageBase64Array: string[], imageMimeTypes: string[], sport?: Sport, name?: string }
 */

import { Router, type IRouter } from "express";
import {
  adaptToRunSession,
  parseWorkoutFromImage,
  type ImageInput,
  type Sport,
} from "@workspace/workout-parser";
import { logApiCost } from "../lib/log-api-cost";

const router: IRouter = Router();

interface RequestBody {
  imageBase64Array?: string[];
  imageMimeTypes?: string[];
  sport?: Sport;
  name?: string;
}

router.post("/parse-session-from-image", async (req, res): Promise<void> => {
  const { imageBase64Array, imageMimeTypes, sport, name } = (req.body ?? {}) as RequestBody;

  if (!Array.isArray(imageBase64Array) || imageBase64Array.length === 0) {
    res.status(400).json({ error: "At least one image is required." });
    return;
  }
  if (imageBase64Array.length > 6) {
    res.status(400).json({ error: "Too many images. Upload up to 6 at once." });
    return;
  }

  const images: ImageInput[] = imageBase64Array.map((base64, i) => ({
    base64,
    mimeType: (imageMimeTypes ?? [])[i] ?? "image/jpeg",
  }));

  const result = await parseWorkoutFromImage(images, {
    sport: sport === "cycle" || sport === "swim" || sport === "run" ? sport : undefined,
    sessionName: name,
  });

  void logApiCost({
    userId: req.auth?.userId,
    endpoint: "parse-session-from-image",
    model: "gpt-4o-mini",
    usage: result.usage,
  });

  if (!result.ok) {
    const status =
      result.reason === "appears_to_be_strength_session" ||
      result.reason === "images_appear_to_be_different_activities" ||
      result.reason === "sport_unclear" ||
      result.reason === "no_exercises_found"
        ? 422
        : 500;
    res.status(status).json({
      error: result.message,
      reason: result.reason,
    });
    return;
  }

  // Adapt to LegacyRunSession (shared with /parse-run-session) so the existing
  // preview/save UI just works. Cycle/swim sessions get the run_brain shape;
  // the client stamps source: "cycle_brain" / "swim_brain" before saving.
  res.json(adaptToRunSession(result));
});

export default router;
