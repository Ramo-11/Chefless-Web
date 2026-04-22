import { Router, Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User from "../models/User";
import { getPassportSummary } from "../services/passport-service";
import { ALL_BADGES, CUISINE_REGIONS } from "../lib/cuisines";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

const objectIdParam = z.object({
  id: z.string().refine(isValidObjectId, { message: "Invalid ID format" }),
});

// GET /api/passport/metadata — client catalog for regions + badges
// Surfaces the *entire* badge catalogue (earned or not) so the client can
// render progress states without needing a per-user request.
router.get(
  "/metadata",
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({
      regions: CUISINE_REGIONS.map((r) => ({ ...r, cuisines: [...r.cuisines] })),
      badges: ALL_BADGES.map((b) => ({ ...b })),
    });
  })
);

// GET /api/passport/me — current user's passport summary
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const user = await User.findOne({ firebaseUid }).select("_id").lean();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const summary = await getPassportSummary(user._id.toString());
    res.status(200).json(summary);
  })
);

// GET /api/passport/:id — another user's passport (requires account privacy check)
router.get(
  "/:id",
  requireAuth,
  validate({ params: objectIdParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof objectIdParam>;

    const [firebaseUid, targetUser] = [
      req.user!.uid,
      await User.findById(id).select("_id isPublic").lean(),
    ];
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Private accounts gate their passport behind the existing follow rules.
    if (!targetUser.isPublic) {
      const viewer = await User.findOne({ firebaseUid }).select("_id").lean();
      if (!viewer) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (viewer._id.toString() !== id) {
        const { canViewProfile } = await import(
          "../services/visibility-service"
        );
        // `canViewProfile` needs the full user doc for follow checks.
        const fullTarget = await User.findById(id);
        if (!fullTarget) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        const allowed = await canViewProfile(viewer._id, fullTarget);
        if (!allowed) {
          res.status(403).json({ error: "This passport is private." });
          return;
        }
      }
    }

    const summary = await getPassportSummary(id);
    res.status(200).json(summary);
  })
);

export default router;
