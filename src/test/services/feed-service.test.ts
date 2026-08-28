import { describe, expect, it } from "vitest";
import Recipe from "../../models/Recipe";
import { createTestUser } from "../helpers";
import { trendingFeed } from "../../services/feed-service";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe("feed-service trending", () => {
  it("ranks a fresher, lower-engagement recipe above a stale high-engagement one once the decay outweighs the gap", async () => {
    const viewer = await createTestUser();
    const author = await createTestUser({ email: "author@test.com" });

    const stale = await Recipe.create({
      authorId: author._id,
      title: "Old Viral Recipe",
      baseServings: 4,
      isPrivate: false,
      likesCount: 100,
      forksCount: 0,
    });
    await Recipe.collection.updateOne(
      { _id: stale._id },
      { $set: { createdAt: daysAgo(90) } }
    );

    const fresh = await Recipe.create({
      authorId: author._id,
      title: "Fresh Recipe",
      baseServings: 4,
      isPrivate: false,
      likesCount: 20,
      forksCount: 0,
    });
    await Recipe.collection.updateOne(
      { _id: fresh._id },
      { $set: { createdAt: daysAgo(1) } }
    );

    const result = await trendingFeed(viewer._id, 1, 20);
    const titles = result.recipes.map((r) => r.title);
    const freshIndex = titles.indexOf("Fresh Recipe");
    const staleIndex = titles.indexOf("Old Viral Recipe");

    expect(freshIndex).toBeGreaterThanOrEqual(0);
    expect(staleIndex).toBeGreaterThanOrEqual(0);
    expect(freshIndex).toBeLessThan(staleIndex);
  });

  it("keeps two equally fresh recipes ordered by raw engagement", async () => {
    const viewer = await createTestUser();
    const author = await createTestUser({ email: "author2@test.com" });

    await Recipe.create({
      authorId: author._id,
      title: "Low Engagement",
      baseServings: 4,
      isPrivate: false,
      likesCount: 1,
      forksCount: 0,
    });
    await Recipe.create({
      authorId: author._id,
      title: "High Engagement",
      baseServings: 4,
      isPrivate: false,
      likesCount: 50,
      forksCount: 5,
    });

    const result = await trendingFeed(viewer._id, 1, 20);
    const titles = result.recipes.map((r) => r.title);

    expect(titles.indexOf("High Engagement")).toBeLessThan(
      titles.indexOf("Low Engagement")
    );
  });

  it("still ranks seed recipes after real recipes regardless of decayed score", async () => {
    const viewer = await createTestUser();
    const seedAuthor = await createTestUser({ email: "seed@test.com" });
    const realAuthor = await createTestUser({ email: "real@test.com" });

    await Recipe.create({
      authorId: seedAuthor._id,
      title: "Seed Recipe",
      baseServings: 4,
      isPrivate: false,
      isSeed: true,
      likesCount: 9999,
      forksCount: 999,
    });
    await Recipe.create({
      authorId: realAuthor._id,
      title: "Real Recipe",
      baseServings: 4,
      isPrivate: false,
      likesCount: 1,
      forksCount: 0,
    });

    const result = await trendingFeed(viewer._id, 1, 20);
    const titles = result.recipes.map((r) => r.title);

    expect(titles.indexOf("Real Recipe")).toBeLessThan(
      titles.indexOf("Seed Recipe")
    );
  });

  it("preserves the paginated response shape", async () => {
    const viewer = await createTestUser();
    const author = await createTestUser({ email: "shape@test.com" });

    await Recipe.create({
      authorId: author._id,
      title: "Shape Recipe",
      baseServings: 4,
      isPrivate: false,
      likesCount: 3,
    });

    const result = await trendingFeed(viewer._id, 1, 20);

    expect(result).toMatchObject({
      page: 1,
      limit: 20,
    });
    expect(result).toHaveProperty("recipes");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("totalPages");
    expect(Array.isArray(result.recipes)).toBe(true);
  });
});
