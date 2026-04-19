import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { strictLimiter } from "../middleware/rateLimit";
import { PromoCode, PromoRedemption } from "../models/PromoCode";
import User from "../models/User";

const router = Router();

// --- Schemas ---

const redeemSchema = z.object({
  code: z
    .string()
    .min(1, "Promo code is required")
    .max(20, "Promo code is too long")
    .transform((val) => val.toUpperCase().trim()),
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

/**
 * POST /api/promo-codes/redeem
 * Redeems a promo code, granting the user premium access for N days.
 */
router.post(
  "/redeem",
  // Tight rate limit — promo redemption is a high-value write that can grant
  // paid-tier access; no legitimate user needs to fire it repeatedly.
  strictLimiter,
  requireAuth,
  validate({ body: redeemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.body as z.infer<typeof redeemSchema>;
    const firebaseUid = req.user!.uid;

    // Find the user
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Find the promo code
    const promoCode = await PromoCode.findOne({ code });
    if (!promoCode) {
      res.status(404).json({ error: "Invalid promo code" });
      return;
    }

    // Check if active
    if (!promoCode.isActive) {
      res.status(400).json({ error: "This promo code is no longer active" });
      return;
    }

    // Check date range
    const now = new Date();
    if (now < promoCode.validFrom) {
      res.status(400).json({ error: "This promo code is not yet valid" });
      return;
    }
    if (now > promoCode.validUntil) {
      res.status(400).json({ error: "This promo code has expired" });
      return;
    }

    // Check max redemptions (0 = unlimited)
    if (
      promoCode.maxRedemptions > 0 &&
      promoCode.redemptionCount >= promoCode.maxRedemptions
    ) {
      res
        .status(400)
        .json({ error: "This promo code has reached its redemption limit" });
      return;
    }

    // Check if user already redeemed this code
    const existingRedemption = await PromoRedemption.findOne({
      promoCodeId: promoCode._id,
      userId: user._id,
    }).lean();

    if (existingRedemption) {
      res
        .status(409)
        .json({ error: "You have already redeemed this promo code" });
      return;
    }

    // Extend premium from whichever is later — now, or the existing expiry.
    // This prevents a downgrade when a user with paid premium redeems a short promo.
    const baseline = Math.max(
      now.getTime(),
      user.premiumExpiresAt ? new Date(user.premiumExpiresAt).getTime() : 0
    );
    const premiumExpiresAt = new Date(
      baseline + promoCode.durationDays * 24 * 60 * 60 * 1000
    );

    // Grant premium to user — preserve an existing paid plan label so a promo
    // top-up doesn't downgrade a "monthly"/"annual" subscriber to "promo".
    const isPaidPlan =
      user.premiumPlan === "monthly" || user.premiumPlan === "annual";
    const nextPlan = isPaidPlan ? user.premiumPlan : "promo";
    await User.findByIdAndUpdate(user._id, {
      isPremium: true,
      premiumPlan: nextPlan,
      premiumExpiresAt,
    });

    // Increment redemption count
    await PromoCode.findByIdAndUpdate(promoCode._id, {
      $inc: { redemptionCount: 1 },
    });

    // Create redemption record
    await PromoRedemption.create({
      promoCodeId: promoCode._id,
      userId: user._id,
      redeemedAt: now,
      premiumGrantedUntil: premiumExpiresAt,
    });

    res.json({
      success: true,
      premiumExpiresAt: premiumExpiresAt.toISOString(),
    });
  })
);

export default router;
