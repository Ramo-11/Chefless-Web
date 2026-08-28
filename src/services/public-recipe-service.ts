import { Types } from "mongoose";
import Recipe from "../models/Recipe";
import User, { IUser } from "../models/User";
import { canViewRecipe } from "./visibility-service";

export interface PublicRecipeView {
  id: string;
  title: string;
  description: string | null;
  photoUrl: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  cuisineTags: string[];
  dietaryTags: string[];
  likesCount: number;
  ingredientsCount: number;
  stepsCount: number;
  createdAt: string;
}

export async function getPublicRecipe(
  recipeId: string
): Promise<PublicRecipeView | null> {
  if (!Types.ObjectId.isValid(recipeId)) return null;

  const recipe = await Recipe.findById(recipeId)
    .select(
      "authorId title description photos isPrivate isHidden difficulty cuisineTags dietaryTags likesCount ingredients steps prepTime cookTime servings createdAt"
    )
    .lean();
  if (!recipe) return null;
  if (recipe.isHidden) return null;

  const author = await User.findById(recipe.authorId)
    .select("fullName profilePicture isPublic isBanned kitchenId")
    .lean();
  if (!author || author.isBanned) return null;

  const canView = await canViewRecipe(
    null,
    recipe,
    author as unknown as IUser
  );
  if (!canView) return null;

  return {
    id: recipe._id.toString(),
    title: recipe.title,
    description: recipe.description ?? null,
    photoUrl: recipe.photos?.[0] ?? null,
    authorName: author.fullName,
    authorAvatarUrl: author.profilePicture ?? null,
    prepTimeMinutes: recipe.prepTime ?? null,
    cookTimeMinutes: recipe.cookTime ?? null,
    servings: recipe.servings ?? null,
    difficulty: recipe.difficulty ?? null,
    cuisineTags: recipe.cuisineTags ?? [],
    dietaryTags: recipe.dietaryTags ?? [],
    likesCount: recipe.likesCount ?? 0,
    ingredientsCount: recipe.ingredients?.length ?? 0,
    stepsCount: recipe.steps?.length ?? 0,
    createdAt: recipe.createdAt.toISOString(),
  };
}
