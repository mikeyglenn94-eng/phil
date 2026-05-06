/**
 * POST /parse-session-from-image
 *
 * Vision-based parser for endurance session screenshots (Strava, Garmin,
 * Apple Fitness, Coros, treadmill consoles). The user has already chosen
 * the sport via the modal tab they're on, so sport is required.
 *
 * Body shape: { imageBase64Array: string[], imageMimeTypes: string[], sport: "run"|"cycle"|"swim", name?: string }
 * Returns the same LegacyRunSession shape as /parse-run-session so the
 * existing preview/save UI can consume it unchanged.
 */

import { Router, type IRouter } from "express";
import {
  adaptToRunSession,
  parseWorkoutFromImage,
  type EnduranceSport,
  type ImageInput,
} from "@workspace/workout-parser";
import { logApiCost } from "../lib/log-api-cost";

const router: IRouter = Router();

interface RequestBody {
  imageBase64Array?: string[];
  imageMimeTypes?: string[];
  sport?: EnduranceSport;
  name?: string;
}

router.post("/parse-session-from-image", async (req, res): Promise<void> => {
  const { imageBase64Array, imageMimeTypes, sport, name } = (req.body ?? {}) as RequestBody;

  if (sport !== "run" && sport !== "cycle" && sport !== "swim") {
    res.status(400).json({ error: "sport must be one of run, cycle, swim." });
    return;
  }
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
    sport,
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
      result.reason === "images_appear_to_be_different_activities" ||
      result.reason === "no_exercises_found"
        ? 422
        : 500;
    res.status(status).json({
      error: result.message,
      reason: result.reason,
    });
    return;
  }

  const adapted = adaptToRunSession(result);
  // Debug: confirm pace survives adapt.ts. Visible in server stdout / pino.
  // Remove once pace extraction is confirmed working end-to-end.
  req.log.info(
    {
      avgPace: adapted.avgPace,
      distanceKm: adapted.distanceKm,
      firstRowPace: adapted.runBlocks?.[0]?.rows?.[0]?.pace ?? null,
    },
    "[parse-session-from-image] adapted",
  );
  res.json(adapted);
});

export default router;
