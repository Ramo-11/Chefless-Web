import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User from "../models/User";

const router = Router();

// --- Schemas ---

const registerSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(100),
  email: z.string().email("Invalid email address"),
});

const fcmTokenSchema = z.object({
  token: z.string().min(1, "FCM token is required"),
});

// --- Helpers ---

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// --- Routes ---

// POST /api/auth/register
router.post(
  "/register",
  requireAuth,
  validate({ body: registerSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { fullName, email } = req.body as z.infer<typeof registerSchema>;
    const firebaseUid = req.user!.uid;

    // Idempotent: return existing user if already registered
    const existingUser = await User.findOne({ firebaseUid });
    if (existingUser) {
      res.status(200).json({ user: existingUser });
      return;
    }

    const user = await User.create({
      firebaseUid,
      email,
      fullName,
      lastActiveAt: new Date(),
    });

    res.status(201).json({ user });
  })
);

// GET /api/auth/me
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const firebaseUid = req.user!.uid;

    const user = await User.findOne({ firebaseUid });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Update lastActiveAt
    user.lastActiveAt = new Date();
    await user.save();

    res.status(200).json({ user });
  })
);

// POST /api/auth/fcm-token
router.post(
  "/fcm-token",
  requireAuth,
  validate({ body: fcmTokenSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.body as z.infer<typeof fcmTokenSchema>;
    const firebaseUid = req.user!.uid;

    const user = await User.findOneAndUpdate(
      { firebaseUid },
      { fcmToken: token, lastActiveAt: new Date() },
      { new: true }
    );

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({ success: true });
  })
);

export default router;
