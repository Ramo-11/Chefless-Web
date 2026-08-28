import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import User from "../../models/User";
import Recipe from "../../models/Recipe";
import { createTestUser } from "../helpers";
import { getPublicRecipe } from "../../services/public-recipe-service";

describe("public-recipe-service", () => {
  it("returns null for a recipe that does not exist", async () => {
    const result = await getPublicRecipe(new Types.ObjectId().toString());
    expect(result).toBeNull();
  });

  it("returns null for a malformed id", async () => {
    const result = await getPublicRecipe("not-an-object-id");
    expect(result).toBeNull();
  });

  it("returns null for a private recipe on a public account", async () => {
    const author = await createTestUser({ isPublic: true });
    const recipe = await Recipe.create({
      authorId: author._id,
      title: "Secret Family Recipe",
      baseServings: 4,
      isPrivate: true,
    });

    const result = await getPublicRecipe(recipe._id.toString());
    expect(result).toBeNull();
  });

  it("returns null for a shared recipe on a private account", async () => {
    const author = await createTestUser({ isPublic: false });
    const recipe = await Recipe.create({
      authorId: author._id,
      title: "Private Account Recipe",
      baseServings: 4,
      isPrivate: false,
    });

    const result = await getPublicRecipe(recipe._id.toString());
    expect(result).toBeNull();
  });

  it("returns null for a hidden recipe", async () => {
    const author = await createTestUser({ isPublic: true });
    const recipe = await Recipe.create({
      authorId: author._id,
      title: "Hidden Recipe",
      baseServings: 4,
      isPrivate: false,
      isHidden: true,
    });

    const result = await getPublicRecipe(recipe._id.toString());
    expect(result).toBeNull();
  });

  it("returns null when the author is banned", async () => {
    const author = await createTestUser({ isPublic: true, isBanned: true });
    const recipe = await Recipe.create({
      authorId: author._id,
      title: "Banned Author Recipe",
      baseServings: 4,
      isPrivate: false,
    });

    const result = await getPublicRecipe(recipe._id.toString());
    expect(result).toBeNull();
  });

  it("returns the documented shape for a genuinely public recipe", async () => {
    const author = await createTestUser({
      fullName: "Chef Amina",
      isPublic: true,
    });
    await User.updateOne(
      { _id: author._id },
      { $set: { profilePicture: "https://example.com/avatar.jpg" } }
    );

    const recipe = await Recipe.create({
      authorId: author._id,
      title: "Chicken Kabsa",
      description: "A spiced rice dish.",
      photos: ["https://example.com/kabsa-1.jpg", "https://example.com/kabsa-2.jpg"],
      isPrivate: false,
      difficulty: "medium",
      cuisineTags: ["Saudi"],
      dietaryTags: ["halal"],
      likesCount: 42,
      prepTime: 20,
      cookTime: 45,
      servings: 6,
      ingredients: [
        { name: "Rice", quantity: 2, unit: "cup" },
        { name: "Chicken", quantity: 1, unit: "kg" },
      ],
      steps: [
        { order: 1, instruction: "Season the chicken." },
        { order: 2, instruction: "Cook the rice." },
        { order: 3, instruction: "Combine and serve." },
      ],
    });

    const result = await getPublicRecipe(recipe._id.toString());

    expect(result).toEqual({
      id: recipe._id.toString(),
      title: "Chicken Kabsa",
      description: "A spiced rice dish.",
      photoUrl: "https://example.com/kabsa-1.jpg",
      authorName: "Chef Amina",
      authorAvatarUrl: "https://example.com/avatar.jpg",
      prepTimeMinutes: 20,
      cookTimeMinutes: 45,
      servings: 6,
      difficulty: "medium",
      cuisineTags: ["Saudi"],
      dietaryTags: ["halal"],
      likesCount: 42,
      ingredientsCount: 2,
      stepsCount: 3,
      createdAt: recipe.createdAt.toISOString(),
    });
  });

  it("nulls out optional fields that are absent instead of omitting them", async () => {
    const author = await createTestUser({ fullName: "Chef No Extras", isPublic: true });
    const recipe = await Recipe.create({
      authorId: author._id,
      title: "Bare Recipe",
      baseServings: 4,
      isPrivate: false,
    });

    const result = await getPublicRecipe(recipe._id.toString());

    expect(result?.description).toBeNull();
    expect(result?.photoUrl).toBeNull();
    expect(result?.authorAvatarUrl).toBeNull();
    expect(result?.prepTimeMinutes).toBeNull();
    expect(result?.cookTimeMinutes).toBeNull();
    expect(result?.servings).toBeNull();
    expect(result?.difficulty).toBeNull();
    expect(result?.cuisineTags).toEqual([]);
    expect(result?.dietaryTags).toEqual([]);
    expect(result?.ingredientsCount).toBe(0);
    expect(result?.stepsCount).toBe(0);
  });
});
