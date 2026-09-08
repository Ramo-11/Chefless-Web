import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import User from "../../models/User";
import Recipe from "../../models/Recipe";
import CookedPost from "../../models/CookedPost";
import { createTestUser } from "../helpers";
import { createCookedPost } from "../../services/cooked-post-service";

async function createRecipeWithCuisine(authorId: Types.ObjectId, cuisineTags: string[]) {
  return Recipe.create({
    authorId,
    title: "Test Recipe",
    baseServings: 4,
    cuisineTags,
    ingredients: [{ name: "Salt", quantity: 1, unit: "tsp" }],
    steps: [{ order: 1, instruction: "Cook it." }],
  });
}

describe("cooked-post-service unlockedCuisines denormalization", () => {
  it("seeds unlockedCuisines on a brand new account's first post", async () => {
    const chef = await createTestUser({ email: "chef1@test.com" });
    const recipe = await createRecipeWithCuisine(chef._id, ["Italian"]);

    const result = await createCookedPost({
      userId: chef._id.toString(),
      recipeId: recipe._id.toString(),
      photoUrl: "https://example.com/photo.jpg",
    });

    expect(result.newStamps).toEqual(["Italian"]);

    const updatedUser = await User.findById(chef._id).lean();
    expect(updatedUser?.unlockedCuisines).toEqual(["Italian"]);
  });

  it("does not re-flag an already-unlocked cuisine as new once denormalized", async () => {
    const chef = await createTestUser({ email: "chef2@test.com" });
    const recipeA = await createRecipeWithCuisine(chef._id, ["Italian"]);
    const recipeB = await createRecipeWithCuisine(chef._id, ["Italian"]);

    await createCookedPost({
      userId: chef._id.toString(),
      recipeId: recipeA._id.toString(),
      photoUrl: "https://example.com/photo-a.jpg",
    });

    const second = await createCookedPost({
      userId: chef._id.toString(),
      recipeId: recipeB._id.toString(),
      photoUrl: "https://example.com/photo-b.jpg",
    });

    expect(second.newStamps).toEqual([]);

    const updatedUser = await User.findById(chef._id).lean();
    expect(updatedUser?.unlockedCuisines).toEqual(["Italian"]);
  });

  it("falls back to scanning post history when unlockedCuisines is absent, then self-heals the field", async () => {
    const chef = await createTestUser({ email: "chef3@test.com" });
    const legacyRecipe = await createRecipeWithCuisine(chef._id, ["Italian"]);

    await CookedPost.create({
      userId: chef._id,
      recipeId: legacyRecipe._id,
      recipeTitle: legacyRecipe.title,
      recipeAuthorId: chef._id,
      photoUrl: "https://example.com/legacy.jpg",
      cuisineTags: ["Italian"],
    });

    const userBefore = await User.findById(chef._id).lean();
    expect(userBefore?.unlockedCuisines).toBeUndefined();

    const newRecipe = await createRecipeWithCuisine(chef._id, ["Thai"]);
    const result = await createCookedPost({
      userId: chef._id.toString(),
      recipeId: newRecipe._id.toString(),
      photoUrl: "https://example.com/new.jpg",
    });

    expect(result.newStamps).toEqual(["Thai"]);

    const userAfter = await User.findById(chef._id).lean();
    expect(userAfter?.unlockedCuisines?.sort()).toEqual(["Italian", "Thai"]);
  });
});
