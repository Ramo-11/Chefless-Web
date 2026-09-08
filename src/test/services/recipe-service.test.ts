import { describe, expect, it } from "vitest";
import Recipe from "../../models/Recipe";
import Like from "../../models/Like";
import SavedRecipe from "../../models/SavedRecipe";
import RecipeShare from "../../models/RecipeShare";
import { createTestUser } from "../helpers";
import {
  listMyRecipes,
  listForkedRecipes,
  listLikedRecipes,
  listSavedRecipes,
  listSharedWithMe,
} from "../../services/recipe-service";

function expectCardFieldsOnly(recipe: Record<string, unknown>) {
  expect(recipe.ingredients).toBeUndefined();
  expect(recipe.steps).toBeUndefined();
  expect(recipe.description).toBeUndefined();
  expect(recipe.story).toBeUndefined();

  expect(recipe.title).toBeDefined();
  expect(recipe.photos).toBeDefined();
  expect(recipe.labels).toBeDefined();
  expect(recipe.dietaryTags).toBeDefined();
  expect(recipe.cuisineTags).toBeDefined();
  expect(recipe.isPrivate).toBeDefined();
  expect(recipe.likesCount).toBeDefined();
  expect(recipe.forksCount).toBeDefined();
  expect(recipe.commentsCount).toBeDefined();
  expect(recipe.avgRating).toBeDefined();
  expect(recipe.ratingCount).toBeDefined();
  expect(recipe.createdAt).toBeDefined();
  expect(recipe.authorName).toBeDefined();
}

async function createFullRecipe(authorId: unknown, overrides: Record<string, unknown> = {}) {
  return Recipe.create({
    authorId,
    title: "Full Recipe",
    baseServings: 4,
    isPrivate: false,
    ingredients: [{ name: "Salt", quantity: 1, unit: "tsp" }],
    steps: [{ order: 1, instruction: "Mix everything" }],
    description: "A long description",
    story: "A long story",
    commentsCount: 2,
    avgRating: 4.5,
    ratingCount: 3,
    ...overrides,
  });
}

describe("recipe-service list endpoint projections", () => {
  it("listMyRecipes trims to card fields but keeps forkedFrom for stats", async () => {
    const user = await createTestUser({ email: "list-my@test.com" });
    const origin = await createFullRecipe(user._id, { title: "Origin" });
    await createFullRecipe(user._id, {
      title: "My Remix",
      forkedFrom: {
        recipeId: origin._id,
        authorId: origin.authorId,
        authorName: "Origin Chef",
      },
    });

    const result = await listMyRecipes(user._id.toString(), 1, 20, {});
    expect(result.data.length).toBe(2);
    for (const recipe of result.data as unknown as Record<string, unknown>[]) {
      expectCardFieldsOnly(recipe);
    }
    const remix = result.data.find((r) => r.title === "My Remix") as unknown as {
      forkedFrom?: { recipeId: unknown };
    };
    expect(remix?.forkedFrom?.recipeId?.toString()).toBe(origin._id.toString());
  });

  it("listForkedRecipes trims to card fields", async () => {
    const user = await createTestUser({ email: "list-forked@test.com" });
    const origin = await createFullRecipe(user._id, { title: "Origin 2" });
    await createFullRecipe(user._id, {
      title: "Forked Remix",
      forkedFrom: {
        recipeId: origin._id,
        authorId: origin.authorId,
        authorName: "Origin Chef",
      },
    });

    const result = await listForkedRecipes(user._id.toString(), 1, 20);
    expect(result.data.length).toBe(1);
    expectCardFieldsOnly(result.data[0] as unknown as Record<string, unknown>);
  });

  it("listLikedRecipes trims to card fields", async () => {
    const user = await createTestUser({ email: "list-liked@test.com" });
    const author = await createTestUser({ email: "liked-author@test.com" });
    const recipe = await createFullRecipe(author._id);
    await Like.create({ userId: user._id, recipeId: recipe._id });

    const result = await listLikedRecipes(user._id.toString(), 1, 20);
    expect(result.data.length).toBe(1);
    expectCardFieldsOnly(result.data[0] as unknown as Record<string, unknown>);
  });

  it("listSavedRecipes trims to card fields", async () => {
    const user = await createTestUser({ email: "list-saved@test.com" });
    const author = await createTestUser({ email: "saved-author@test.com" });
    const recipe = await createFullRecipe(author._id);
    await SavedRecipe.create({ userId: user._id, recipeId: recipe._id });

    const result = await listSavedRecipes(user._id.toString(), 1, 20);
    expect(result.data.length).toBe(1);
    expectCardFieldsOnly(result.data[0] as unknown as Record<string, unknown>);
  });

  it("listSharedWithMe still cursor-paginates correctly after the recipientId+_id index change", async () => {
    const recipient = await createTestUser({ email: "shared-recipient@test.com" });
    const sender = await createTestUser({ email: "shared-sender@test.com" });
    const author = await createTestUser({ email: "shared-author@test.com" });

    for (let i = 0; i < 5; i++) {
      const recipe = await createFullRecipe(author._id, { title: `Shared ${i}` });
      await RecipeShare.create({
        senderId: sender._id,
        recipientId: recipient._id,
        recipeId: recipe._id,
        message: `share-${i}`,
      });
    }

    const firstPage = await listSharedWithMe(recipient._id.toString(), undefined, 2);
    expect(firstPage.items.length).toBe(2);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await listSharedWithMe(
      recipient._id.toString(),
      firstPage.nextCursor ?? undefined,
      2
    );
    expect(secondPage.items.length).toBe(2);

    const allIds = [...firstPage.items, ...secondPage.items].map((i) => i.shareId);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
