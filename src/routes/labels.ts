import { Router, Request, Response } from "express";
import SystemLabel from "../models/SystemLabel";

const router = Router();

/**
 * GET /api/labels
 * Returns all system labels sorted by order.
 * Public endpoint — no auth required.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const labels = await SystemLabel.find().sort({ order: 1 }).lean();
    res.json({ labels });
  } catch (error) {
    console.error("Failed to fetch labels:", error);
    res.status(500).json({ message: "Failed to fetch labels" });
  }
});

export default router;
