import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User from "../models/User";
import { getWrappedSummary } from "../services/wrapped-service";
import { getAppConfig, isWrappedAvailableFor } from "../lib/app-config";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

const yearSchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(2025)
    .max(new Date().getUTCFullYear())
    .default(new Date().getUTCFullYear()),
});

// GET /api/wrapped?year=2026 — current user's Wrapped for a given year
// Year defaults to current UTC year; capped at the current year so users can't
// request "future" wrappeds (which would return empty data).
router.get(
  "/",
  requireAuth,
  validate({ query: yearSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const user = await User.findOne({ firebaseUid }).select("_id").lean();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const config = await getAppConfig();
    if (!isWrappedAvailableFor(config, user._id)) {
      res.status(403).json({ error: "Wrapped is not available right now." });
      return;
    }
    const { year } = req.query as unknown as z.infer<typeof yearSchema>;
    const summary = await getWrappedSummary(user._id.toString(), year);
    res.status(200).json(summary);
  })
);

export default router;
