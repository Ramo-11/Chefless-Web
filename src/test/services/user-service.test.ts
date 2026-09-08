import { describe, expect, it } from "vitest";
import Follow from "../../models/Follow";
import Recipe from "../../models/Recipe";
import RecipeRating from "../../models/RecipeRating";
import { createTestUser, createTestRecipe } from "../helpers";
import { followUser, deleteAccount } from "../../services/user-service";

describe("user-service followUser races", () => {
  it("translates a concurrent duplicate follow into a friendly 409 instead of a raw duplicate-key error", async () => {
    await Follow.init();
    const follower = await createTestUser({ email: "follower@test.com" });
    const target = await createTestUser({ email: "target@test.com", isPublic: true });

    const results = await Promise.allSettled([
      followUser(follower._id.toString(), target._id.toString()),
      followUser(follower._id.toString(), target._id.toString()),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r) => r.status === "rejected"
    ) as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      statusCode: 409,
      message: "Already following this user",
    });

    const followCount = await Follow.countDocuments({
      followerId: follower._id,
      followingId: target._id,
    });
    expect(followCount).toBe(1);
  });
});

describe("user-service deleteAccount RecipeRating cascade", () => {
  it("removes the departed user's ratings on other people's recipes and recomputes the aggregate", async () => {
    const recipeOwner = await createTestUser({ email: "owner@test.com" });
    const departingRater = await createTestUser({ email: "departing@test.com" });
    const stayingRater = await createTestUser({ email: "staying@test.com" });
    const recipe = await createTestRecipe({ authorId: recipeOwner._id });

    await RecipeRating.create({
      recipeId: recipe._id,
      userId: departingRater._id,
      stars: 2,
      kitchenId: null,
    });
    await RecipeRating.create({
      recipeId: recipe._id,
      userId: stayingRater._id,
      stars: 4,
      kitchenId: null,
    });

    await deleteAccount(departingRater._id.toString());

    const remainingRatings = await RecipeRating.find({ recipeId: recipe._id }).lean();
    expect(remainingRatings).toHaveLength(1);
    expect(remainingRatings[0].userId.toString()).toBe(stayingRater._id.toString());

    const updatedRecipe = await Recipe.findById(recipe._id).lean();
    expect(updatedRecipe?.avgRating).toBe(4);
    expect(updatedRecipe?.ratingCount).toBe(1);
  });

  it("zeroes out the aggregate when the departed user's rating was the only one", async () => {
    const recipeOwner = await createTestUser({ email: "owner2@test.com" });
    const onlyRater = await createTestUser({ email: "only@test.com" });
    const recipe = await createTestRecipe({ authorId: recipeOwner._id });

    await RecipeRating.create({
      recipeId: recipe._id,
      userId: onlyRater._id,
      stars: 5,
      kitchenId: null,
    });

    await deleteAccount(onlyRater._id.toString());

    const remainingRatings = await RecipeRating.find({ recipeId: recipe._id }).lean();
    expect(remainingRatings).toHaveLength(0);

    const updatedRecipe = await Recipe.findById(recipe._id).lean();
    expect(updatedRecipe?.avgRating).toBe(0);
    expect(updatedRecipe?.ratingCount).toBe(0);
  });
});
