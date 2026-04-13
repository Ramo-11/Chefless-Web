import { Request, Response } from "express";
import { PromoCode, PromoRedemption } from "../../models/PromoCode";
import AuditLog from "../../models/AuditLog";

async function audit(
  req: Request,
  action: string,
  targetType: string,
  targetId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  AuditLog.create({
    adminId: req.session.adminId ?? "unknown",
    adminEmail: req.session.adminEmail ?? "unknown",
    action,
    targetType,
    targetId,
    details,
    ipAddress: req.ip,
  }).catch((err: unknown) => {
    console.error("Audit log failed:", err instanceof Error ? err.message : err);
  });
}

export async function promoCodesPage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const promoCodes = await PromoCode.find()
      .sort({ createdAt: -1 })
      .lean();

    res.render("promo-codes", { page: "promo-codes", promoCodes });
  } catch (error) {
    console.error("Failed to load promo codes page:", error);
    res.status(500).send("Internal server error");
  }
}

export async function createPromoCode(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { code, description, durationDays, maxRedemptions, validFrom, validUntil } =
      req.body;

    if (!code || !description || !durationDays || !validFrom || !validUntil) {
      res
        .status(400)
        .json({ error: "Code, description, duration, and date range are required" });
      return;
    }

    const normalizedCode = String(code).toUpperCase().trim();
    if (normalizedCode.length < 3 || normalizedCode.length > 20) {
      res.status(400).json({ error: "Code must be between 3 and 20 characters" });
      return;
    }

    const duration = parseInt(String(durationDays));
    if (isNaN(duration) || duration < 1) {
      res.status(400).json({ error: "Duration must be at least 1 day" });
      return;
    }

    const maxRedeem = parseInt(String(maxRedemptions)) || 0;
    if (maxRedeem < 0) {
      res.status(400).json({ error: "Max redemptions cannot be negative" });
      return;
    }

    const from = new Date(validFrom);
    const until = new Date(validUntil);
    if (isNaN(from.getTime()) || isNaN(until.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }
    if (until <= from) {
      res.status(400).json({ error: "End date must be after start date" });
      return;
    }

    const existing = await PromoCode.findOne({ code: normalizedCode }).lean();
    if (existing) {
      res.status(409).json({ error: "A promo code with this code already exists" });
      return;
    }

    const promoCode = await PromoCode.create({
      code: normalizedCode,
      description: String(description).trim(),
      durationDays: duration,
      maxRedemptions: maxRedeem,
      isActive: true,
      validFrom: from,
      validUntil: until,
      createdBy: req.session.adminId,
    });

    await audit(req, "create_promo_code", "promo_code", promoCode._id.toString(), {
      code: normalizedCode,
      durationDays: duration,
      maxRedemptions: maxRedeem,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to create promo code:", error);
    res.status(500).json({ error: "Failed to create promo code" });
  }
}

export async function updatePromoCode(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { description, durationDays, maxRedemptions, isActive, validFrom, validUntil } =
      req.body;

    const updates: Record<string, unknown> = {};

    if (description !== undefined) {
      updates.description = String(description).trim();
    }

    if (durationDays !== undefined) {
      const duration = parseInt(String(durationDays));
      if (isNaN(duration) || duration < 1) {
        res.status(400).json({ error: "Duration must be at least 1 day" });
        return;
      }
      updates.durationDays = duration;
    }

    if (maxRedemptions !== undefined) {
      const maxRedeem = parseInt(String(maxRedemptions));
      if (isNaN(maxRedeem) || maxRedeem < 0) {
        res.status(400).json({ error: "Max redemptions cannot be negative" });
        return;
      }
      updates.maxRedemptions = maxRedeem;
    }

    if (isActive !== undefined) {
      updates.isActive = Boolean(isActive);
    }

    if (validFrom !== undefined) {
      const from = new Date(validFrom);
      if (isNaN(from.getTime())) {
        res.status(400).json({ error: "Invalid start date" });
        return;
      }
      updates.validFrom = from;
    }

    if (validUntil !== undefined) {
      const until = new Date(validUntil);
      if (isNaN(until.getTime())) {
        res.status(400).json({ error: "Invalid end date" });
        return;
      }
      updates.validUntil = until;
    }

    const promoCode = await PromoCode.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!promoCode) {
      res.status(404).json({ error: "Promo code not found" });
      return;
    }

    await audit(req, "update_promo_code", "promo_code", req.params.id as string, updates);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to update promo code:", error);
    res.status(500).json({ error: "Failed to update promo code" });
  }
}

export async function deletePromoCode(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const promoCode = await PromoCode.findById(req.params.id);
    if (!promoCode) {
      res.status(404).json({ error: "Promo code not found" });
      return;
    }

    // Cascade delete: remove all redemption records for this code
    await PromoRedemption.deleteMany({ promoCodeId: promoCode._id });
    await PromoCode.findByIdAndDelete(req.params.id);

    await audit(req, "delete_promo_code", "promo_code", req.params.id as string, {
      code: promoCode.code,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete promo code:", error);
    res.status(500).json({ error: "Failed to delete promo code" });
  }
}

export async function promoCodeDetail(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const promoCode = await PromoCode.findById(req.params.id).lean();
    if (!promoCode) {
      res.status(404).json({ error: "Promo code not found" });
      return;
    }

    const redemptions = await PromoRedemption.find({
      promoCodeId: promoCode._id,
    })
      .populate("userId", "fullName email")
      .sort({ redeemedAt: -1 })
      .lean();

    res.json({ promoCode, redemptions });
  } catch (error) {
    console.error("Failed to get promo code detail:", error);
    res.status(500).json({ error: "Failed to load promo code details" });
  }
}
