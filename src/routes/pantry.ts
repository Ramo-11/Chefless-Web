import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requirePremium } from "../middleware/premium";
import { validate } from "../middleware/validate";
import { asyncHandler, isValidObjectId } from "../lib/route-helpers";
import {
  listPantryItems,
  addPantryItem,
  addPantryItemsBulk,
  updatePantryItem,
  deletePantryItem,
  clearPantry,
  addStaples,
  getPantryMatches,
} from "../services/pantry-service";

const router = Router();

const objectIdParam = z.object({
  id: z.string().refine(isValidObjectId, { message: "Invalid ID format" }),
});

const pantryItemBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(80, "Name must be 80 characters or fewer."),
  quantity: z.number().min(0).max(1000000).optional(),
  unit: z.string().trim().max(20, "Unit must be 20 characters or fewer.").optional(),
  category: z.string().trim().min(1).max(50).optional(),
});

const bulkPantrySchema = z.object({
  items: z.array(pantryItemBodySchema).min(1).max(100),
});

const updatePantryItemSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(80, "Name must be 80 characters or fewer.")
      .optional(),
    quantity: z.number().min(0).max(1000000).optional(),
    unit: z.string().trim().max(20, "Unit must be 20 characters or fewer.").optional(),
    category: z.string().trim().min(1).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

const matchesQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  maxMissing: z.coerce.number().int().min(0).max(5).default(2),
  cursor: z.string().refine(isValidObjectId, { message: "Invalid cursor" }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function resolveUserId(req: Request, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(404).json({ error: "User not found" });
    return null;
  }
  return userId;
}

router.get(
  "/matches",
  requireAuth,
  requirePremium,
  validate({ query: matchesQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const { scope, maxMissing, cursor, limit } = req.query as unknown as z.infer<
      typeof matchesQuerySchema
    >;

    const result = await getPantryMatches(userId, { scope, maxMissing, cursor, limit });

    res.status(200).json(result);
  })
);

router.get(
  "/",
  requireAuth,
  requirePremium,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const result = await listPantryItems(userId);

    res.status(200).json(result);
  })
);

router.post(
  "/bulk",
  requireAuth,
  requirePremium,
  validate({ body: bulkPantrySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const { items } = req.body as z.infer<typeof bulkPantrySchema>;
    const result = await addPantryItemsBulk(userId, items);

    res.status(201).json(result);
  })
);

router.post(
  "/staples",
  requireAuth,
  requirePremium,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const result = await addStaples(userId);

    res.status(201).json(result);
  })
);

router.post(
  "/",
  requireAuth,
  requirePremium,
  validate({ body: pantryItemBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const data = req.body as z.infer<typeof pantryItemBodySchema>;
    const result = await addPantryItem(userId, data);

    res.status(result.merged ? 200 : 201).json(result);
  })
);

router.patch(
  "/:id",
  requireAuth,
  requirePremium,
  validate({ params: objectIdParam, body: updatePantryItemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const { id } = req.params as z.infer<typeof objectIdParam>;
    const updates = req.body as z.infer<typeof updatePantryItemSchema>;
    const result = await updatePantryItem(userId, id, updates);

    res.status(200).json(result);
  })
);

router.delete(
  "/:id",
  requireAuth,
  requirePremium,
  validate({ params: objectIdParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const { id } = req.params as z.infer<typeof objectIdParam>;
    await deletePantryItem(userId, id);

    res.status(200).json({ deleted: true });
  })
);

router.delete(
  "/",
  requireAuth,
  requirePremium,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req, res);
    if (!userId) return;

    const deleted = await clearPantry(userId);

    res.status(200).json({ deleted });
  })
);

export default router;
