import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { validate } from "../middleware/validate";
import { getPublicRecipe } from "../services/public-recipe-service";

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

router.get(
  "/recipes/:id",
  validate({ params: objectIdParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as z.infer<typeof objectIdParam>;

    const recipe = await getPublicRecipe(id);

    if (!recipe) {
      res.status(404).json({ error: "Recipe not found" });
      return;
    }

    res.status(200).json({ recipe });
  })
);

export default router;
