import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User from "../models/User";
import {
  createReport,
  getReports,
  getReportById,
  reviewReport,
} from "../services/report-service";

const router = Router();

// ── User-facing: create a report ────────────────────────────────────

const createReportSchema = z.object({
  targetType: z.enum(["recipe", "user", "comment"]),
  targetId: z
    .string()
    .refine(mongoose.Types.ObjectId.isValid, { message: "Invalid target ID" }),
  reason: z.enum(["spam", "inappropriate", "copyright", "harassment", "other"]),
  description: z.string().max(500).optional(),
});

router.post(
  "/",
  requireAuth,
  validate({ body: createReportSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await User.findOne({ firebaseUid: req.user!.uid }).lean();
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      const report = await createReport({
        reporterId: user._id.toString(),
        ...req.body,
      });

      res.status(201).json({ report });
    } catch (error) {
      next(error);
    }
  }
);

// ── Admin-facing endpoints — require auth + admin session ──────────

/** Inline admin guard for API routes — returns 403 JSON instead of redirect. */
function requireAdminApi(req: Request, res: Response): boolean {
  if (!req.session?.adminId) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

const idParamSchema = z.object({
  id: z
    .string()
    .refine(mongoose.Types.ObjectId.isValid, { message: "Invalid ID" }),
});

const listReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "reviewed", "dismissed", "action_taken"]).optional(),
  targetType: z.enum(["recipe", "user", "comment"]).optional(),
});

router.get(
  "/",
  requireAuth,
  validate({ query: listReportsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAdminApi(req, res)) return;

      const { page, limit, status, targetType } =
        req.query as unknown as z.infer<typeof listReportsQuerySchema>;

      const result = await getReports({ page, limit, status, targetType });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:id",
  requireAuth,
  validate({ params: idParamSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAdminApi(req, res)) return;

      const { id } = req.params as z.infer<typeof idParamSchema>;
      const report = await getReportById(id);
      res.json({ report });
    } catch (error) {
      next(error);
    }
  }
);

const reviewSchema = z.object({
  status: z.enum(["reviewed", "dismissed", "action_taken"]),
  reviewNote: z.string().max(1000).optional(),
});

router.patch(
  "/:id",
  requireAuth,
  validate({ params: idParamSchema, body: reviewSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAdminApi(req, res)) return;

      const { id } = req.params as z.infer<typeof idParamSchema>;
      const adminUserId = req.session?.adminId ?? "system";
      const report = await reviewReport(
        id,
        adminUserId,
        req.body.status,
        req.body.reviewNote
      );

      res.json({ report });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
