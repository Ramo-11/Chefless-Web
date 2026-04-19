import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User from "../models/User";
import {
  blockUser,
  unblockUser,
  listBlocked,
} from "../services/block-service";

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

const userIdParam = z.object({
  userId: z
    .string()
    .refine(isValidObjectId, { message: "Invalid user ID format" }),
});

// GET /api/blocks — list users the current user has blocked
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const currentUser = await User.findOne({ firebaseUid })
      .select("_id")
      .lean();

    if (!currentUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const blocked = await listBlocked(currentUser._id.toString());
    res.status(200).json({ blocked });
  })
);

// POST /api/blocks/:userId — block a user
router.post(
  "/:userId",
  requireAuth,
  validate({ params: userIdParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const currentUser = await User.findOne({ firebaseUid })
      .select("_id")
      .lean();

    if (!currentUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { userId } = req.params as z.infer<typeof userIdParam>;
    const block = await blockUser(currentUser._id.toString(), userId);

    res.status(201).json({ block });
  })
);

// DELETE /api/blocks/:userId — unblock a user
router.delete(
  "/:userId",
  requireAuth,
  validate({ params: userIdParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const currentUser = await User.findOne({ firebaseUid })
      .select("_id")
      .lean();

    if (!currentUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { userId } = req.params as z.infer<typeof userIdParam>;
    await unblockUser(currentUser._id.toString(), userId);

    res.status(200).json({ success: true });
  })
);

export default router;
