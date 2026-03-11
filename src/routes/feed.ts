import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User from "../models/User";
import {
  forYouFeed,
  trendingFeed,
  friendsFeed,
  seasonalFeed,
} from "../services/feed-service";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type PaginationQuery = z.infer<typeof paginationSchema>;

/**
 * Resolves the current user's MongoDB ObjectId from their Firebase UID.
 */
async function resolveUserId(
  req: Request,
  res: Response
): Promise<Types.ObjectId | null> {
  const firebaseUid = req.user!.uid;
  const user = await User.findOne({ firebaseUid }).select("_id").lean();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return null;
  }
  return user._id;
}

// GET /api/feed/for-you
router.get(
  "/for-you",
  requireAuth,
  validate({ query: paginationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveUserId(req, res);
    if (!userId) return;

    const { page, limit } = req.query as unknown as PaginationQuery;
    const result = await forYouFeed(userId, page, limit);

    res.status(200).json(result);
  })
);

// GET /api/feed/trending
router.get(
  "/trending",
  requireAuth,
  validate({ query: paginationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveUserId(req, res);
    if (!userId) return;

    const { page, limit } = req.query as unknown as PaginationQuery;
    const result = await trendingFeed(userId, page, limit);

    res.status(200).json(result);
  })
);

// GET /api/feed/friends
router.get(
  "/friends",
  requireAuth,
  validate({ query: paginationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveUserId(req, res);
    if (!userId) return;

    const { page, limit } = req.query as unknown as PaginationQuery;
    const result = await friendsFeed(userId, page, limit);

    res.status(200).json(result);
  })
);

// GET /api/feed/seasonal
router.get(
  "/seasonal",
  requireAuth,
  validate({ query: paginationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveUserId(req, res);
    if (!userId) return;

    const { page, limit } = req.query as unknown as PaginationQuery;
    const result = await seasonalFeed(userId, page, limit);

    res.status(200).json(result);
  })
);

export default router;
