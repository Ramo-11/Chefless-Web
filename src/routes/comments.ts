import { Router, Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  listComments,
  listReplies,
  createComment,
  deleteComment,
} from "../services/comment-service";
import { createReport } from "../services/report-service";

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

const targetTypeSchema = z.enum(["recipe", "cooked_post"]);

const listQuerySchema = z.object({
  targetType: targetTypeSchema,
  targetId: z
    .string()
    .refine(isValidObjectId, { message: "Invalid target ID" }),
  cursor: z
    .string()
    .refine(isValidObjectId, { message: "Invalid cursor" })
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const repliesQuerySchema = z.object({
  cursor: z
    .string()
    .refine(isValidObjectId, { message: "Invalid cursor" })
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const createCommentSchema = z.object({
  targetType: targetTypeSchema,
  targetId: z
    .string()
    .refine(isValidObjectId, { message: "Invalid target ID" }),
  text: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty.")
    .max(1000, "Comment must be 1000 characters or fewer."),
  parentId: z
    .string()
    .refine(isValidObjectId, { message: "Invalid parent ID" })
    .optional(),
});

const reportCommentSchema = z.object({
  reason: z.enum([
    "spam",
    "inappropriate",
    "copyright",
    "harassment",
    "other",
  ]),
  details: z.string().trim().max(500).optional(),
});

const commentCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => `u:${req.user?.userId ?? req.ip ?? "unknown"}`,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: "You're commenting too quickly. Please slow down and try again.",
      code: "COMMENT_RATE_LIMITED",
    });
  },
});

router.get(
  "/",
  requireAuth,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { targetType, targetId, cursor, limit } = req.query as unknown as z.infer<
      typeof listQuerySchema
    >;
    const result = await listComments(targetType, targetId, userId, cursor, limit);
    res.status(200).json(result);
  })
);

router.get(
  "/:id/replies",
  requireAuth,
  validate({ params: objectIdParam, query: repliesQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { id } = req.params as z.infer<typeof objectIdParam>;
    const { cursor, limit } = req.query as unknown as z.infer<
      typeof repliesQuerySchema
    >;
    const result = await listReplies(id, userId, cursor, limit);
    res.status(200).json(result);
  })
);

router.post(
  "/",
  requireAuth,
  commentCreateLimiter,
  validate({ body: createCommentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const body = req.body as z.infer<typeof createCommentSchema>;
    const comment = await createComment({
      authorId: userId,
      targetType: body.targetType,
      targetId: body.targetId,
      text: body.text,
      parentId: body.parentId,
    });
    res.status(201).json(comment);
  })
);

router.delete(
  "/:id",
  requireAuth,
  validate({ params: objectIdParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { id } = req.params as z.infer<typeof objectIdParam>;
    const result = await deleteComment(id, userId);
    res.status(200).json(result);
  })
);

router.post(
  "/:id/report",
  requireAuth,
  validate({ params: objectIdParam, body: reportCommentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { id } = req.params as z.infer<typeof objectIdParam>;
    const { reason, details } = req.body as z.infer<typeof reportCommentSchema>;
    const report = await createReport({
      reporterId: userId,
      targetType: "comment",
      targetId: id,
      reason,
      description: details,
    });
    res.status(201).json({ report });
  })
);

export default router;
