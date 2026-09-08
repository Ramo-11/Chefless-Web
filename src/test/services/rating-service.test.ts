import { describe, expect, it } from "vitest";
import Recipe from "../../models/Recipe";
import Kitchen from "../../models/Kitchen";
import User from "../../models/User";
import { createTestUser, createTestRecipe } from "../helpers";
import { upsertRating, deleteRating } from "../../services/rating-service";

async function rate(recipeId: string, userId: string, stars: number) {
  return upsertRating({ recipeId, userId, stars });
}

describe("rating-service recomputePublicAggregate", () => {
  it("counts a solo cook's rating (no kitchen) in the public aggregate", async () => {
    const author = await createTestUser({ email: "author-solo@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });
    const rater = await createTestUser({ email: "rater-solo@test.com" });

    await rate(recipe._id.toString(), rater._id.toString(), 4);

    const updated = await Recipe.findById(recipe._id).lean();
    expect(updated?.avgRating).toBe(4);
    expect(updated?.ratingCount).toBe(1);
  });

  it("counts a rating from a public-visibility kitchen in the public aggregate", async () => {
    const author = await createTestUser({ email: "author-pub@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });
    const rater = await createTestUser({ email: "rater-pub@test.com" });
    const kitchen = await Kitchen.create({
      name: "Public Kitchen",
      leadId: rater._id,
      inviteCode: "PUBKIT01",
      memberCount: 1,
      ratingsVisibility: "public",
    });
    await User.updateOne(
      { _id: rater._id },
      { $set: { kitchenId: kitchen._id } }
    );

    await rate(recipe._id.toString(), rater._id.toString(), 5);

    const updated = await Recipe.findById(recipe._id).lean();
    expect(updated?.avgRating).toBe(5);
    expect(updated?.ratingCount).toBe(1);
  });

  it("excludes a rating from a kitchen_only-visibility kitchen from the public aggregate", async () => {
    const author = await createTestUser({ email: "author-priv@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });
    const rater = await createTestUser({ email: "rater-priv@test.com" });
    const kitchen = await Kitchen.create({
      name: "Private Kitchen",
      leadId: rater._id,
      inviteCode: "PRIVKIT1",
      memberCount: 1,
      ratingsVisibility: "kitchen_only",
    });
    await User.updateOne(
      { _id: rater._id },
      { $set: { kitchenId: kitchen._id } }
    );

    await rate(recipe._id.toString(), rater._id.toString(), 1);

    const updated = await Recipe.findById(recipe._id).lean();
    expect(updated?.avgRating).toBe(0);
    expect(updated?.ratingCount).toBe(0);
  });

  it("mixes solo, public-kitchen, and kitchen_only raters, averaging only the visible ones", async () => {
    const author = await createTestUser({ email: "author-mix@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const solo = await createTestUser({ email: "solo-mix@test.com" });
    const publicRater = await createTestUser({ email: "public-mix@test.com" });
    const privateRater = await createTestUser({ email: "private-mix@test.com" });

    const publicKitchen = await Kitchen.create({
      name: "Mix Public Kitchen",
      leadId: publicRater._id,
      inviteCode: "MIXPUB01",
      memberCount: 1,
      ratingsVisibility: "public",
    });
    await User.updateOne(
      { _id: publicRater._id },
      { $set: { kitchenId: publicKitchen._id } }
    );

    const privateKitchen = await Kitchen.create({
      name: "Mix Private Kitchen",
      leadId: privateRater._id,
      inviteCode: "MIXPRIV1",
      memberCount: 1,
      ratingsVisibility: "kitchen_only",
    });
    await User.updateOne(
      { _id: privateRater._id },
      { $set: { kitchenId: privateKitchen._id } }
    );

    await rate(recipe._id.toString(), solo._id.toString(), 5);
    await rate(recipe._id.toString(), publicRater._id.toString(), 5);
    await rate(recipe._id.toString(), privateRater._id.toString(), 1);

    const updated = await Recipe.findById(recipe._id).lean();
    expect(updated?.avgRating).toBe(5);
    expect(updated?.ratingCount).toBe(2);
  });

  it("recomputes correctly after a rating is deleted", async () => {
    const author = await createTestUser({ email: "author-del@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });
    const rater = await createTestUser({ email: "rater-del@test.com" });

    await rate(recipe._id.toString(), rater._id.toString(), 3);
    await deleteRating(recipe._id.toString(), rater._id.toString());

    const updated = await Recipe.findById(recipe._id).lean();
    expect(updated?.avgRating).toBe(0);
    expect(updated?.ratingCount).toBe(0);
  });
});
