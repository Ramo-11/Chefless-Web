import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requirePremium } from "../middleware/premium";
import { validate } from "../middleware/validate";
import User from "../models/User";
import {
  assertAiQuota,
  recordAiUsage,
  getAiUsage,
  aiGenerateFromIngredients,
  aiSuggestSubstitutions,
  aiFormatRoughNotes,
} from "../services/ai-recipe-service";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

async function resolveMongoUserId(req: Request): Promise<string | null> {
  const firebaseUid = req.user?.uid;
  if (!firebaseUid) return null;
  const u = await User.findOne({ firebaseUid }).select("_id").lean();
  return u?._id.toString() ?? null;
}

/**
 * Minutes east of UTC (Dart's `DateTime.timeZoneOffset.inMinutes`). Clients
 * send it on every AI call so the daily quota resets at the user's local
 * midnight instead of UTC midnight. Clipped on the server to ±14h to catch
 * garbage input, and stored to the User doc for admin visibility.
 */
const timezoneOffsetField = z
  .number()
  .int()
  .min(-840)
  .max(840)
  .optional();

const generateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  timezoneOffsetMinutes: timezoneOffsetField,
});

const substituteSchema = z.object({
  ingredients: z.string().min(1).max(8000),
  dietaryNeed: z.string().min(1).max(500),
  timezoneOffsetMinutes: timezoneOffsetField,
});

const formatSchema = z.object({
  notes: z.string().min(1).max(12000),
  timezoneOffsetMinutes: timezoneOffsetField,
});

function offsetFromQuery(req: Request): number | undefined {
  const raw = req.query.timezoneOffsetMinutes;
  if (typeof raw !== "string") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

router.get(
  "/usage",
  requireAuth,
  requirePremium,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveMongoUserId(req);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const usage = await getAiUsage(userId, offsetFromQuery(req));
    res.status(200).json(usage);
  })
);

router.post(
  "/generate-recipe",
  requireAuth,
  requirePremium,
  validate({ body: generateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveMongoUserId(req);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { prompt, timezoneOffsetMinutes: tz } =
      req.body as z.infer<typeof generateSchema>;
    await assertAiQuota(userId, tz);
    const recipe = await aiGenerateFromIngredients(prompt);
    await recordAiUsage(userId, "generate", tz);
    const usage = await getAiUsage(userId, tz);
    res.status(200).json({ recipe, usage });
  })
);

router.post(
  "/suggest-substitutions",
  requireAuth,
  requirePremium,
  validate({ body: substituteSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveMongoUserId(req);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const body = req.body as z.infer<typeof substituteSchema>;
    const tz = body.timezoneOffsetMinutes;
    await assertAiQuota(userId, tz);
    const result = await aiSuggestSubstitutions(body.ingredients, body.dietaryNeed);
    await recordAiUsage(userId, "substitutions", tz);
    const usage = await getAiUsage(userId, tz);
    res.status(200).json({ ...result, usage });
  })
);

router.post(
  "/format-recipe",
  requireAuth,
  requirePremium,
  validate({ body: formatSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveMongoUserId(req);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { notes, timezoneOffsetMinutes: tz } =
      req.body as z.infer<typeof formatSchema>;
    await assertAiQuota(userId, tz);
    const recipe = await aiFormatRoughNotes(notes);
    await recordAiUsage(userId, "format", tz);
    const usage = await getAiUsage(userId, tz);
    res.status(200).json({ recipe, usage });
  })
);

export default router;
