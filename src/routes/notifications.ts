import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User from "../models/User";
import {
  getNotifications,
  markAsRead,
  getUnreadCount,
} from "../services/notification-service";

const router = Router();

// --- Helpers ---

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

// --- Schemas ---

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const markReadSchema = z.object({
  ids: z
    .array(
      z.string().refine(isValidObjectId, { message: "Invalid notification ID" })
    )
    .min(1, "At least one notification ID is required")
    .max(100, "Cannot mark more than 100 notifications at once"),
});

// --- Routes ---

// GET /api/notifications — Get notifications (paginated)
router.get(
  "/",
  requireAuth,
  validate({ query: paginationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const currentUser = await User.findOne({ firebaseUid }).select("_id").lean();

    if (!currentUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { page, limit } = req.query as unknown as z.infer<
      typeof paginationSchema
    >;
    const result = await getNotifications(
      currentUser._id.toString(),
      page,
      limit
    );

    res.status(200).json(result);
  })
);

// GET /api/notifications/unread-count — Get unread count
router.get(
  "/unread-count",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const currentUser = await User.findOne({ firebaseUid }).select("_id").lean();

    if (!currentUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const count = await getUnreadCount(currentUser._id.toString());

    res.status(200).json({ count });
  })
);

// POST /api/notifications/read — Mark notifications as read
router.post(
  "/read",
  requireAuth,
  validate({ body: markReadSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;
    const currentUser = await User.findOne({ firebaseUid }).select("_id").lean();

    if (!currentUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { ids } = req.body as z.infer<typeof markReadSchema>;
    const modifiedCount = await markAsRead(currentUser._id.toString(), ids);

    res.status(200).json({ success: true, modifiedCount });
  })
);

// PATCH /api/notifications/preferences — Update notification preferences (stub)
router.patch(
  "/preferences",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    // Stubbed for future implementation
    res.status(200).json({
      success: true,
      message: "Notification preferences updated",
    });
  })
);

export default router;
