import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import Recipe from "../../models/Recipe";
import Block from "../../models/Block";
import SeasonalTag from "../../models/SeasonalTag";
import { createTestUser } from "../helpers";
import { forYouFeed, trendingFeed, seasonalFeed } from "../../services/feed-service";
import { recomputeTrendingScores } from "../../scripts/recompute-trending-scores";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function createRecipeAt(
  authorId: Types.ObjectId,
  title: string,
  days: number,
  likesCount: number,
  forksCount = 0
) {
  const recipe = await Recipe.create({
    authorId,
    title,
    baseServings: 4,
    isPrivate: false,
    likesCount,
    forksCount,
  });
  await Recipe.collection.updateOne(
    { _id: recipe._id },
    { $set: { createdAt: daysAgo(days) } }
  );
  return recipe;
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
    expect(result).toHaveProperty("hasMore");
    expect(typeof result.hasMore).toBe("boolean");
    expect(Array.isArray(result.recipes)).toBe(true);
  });
});

describe("feed-service retrieval-then-rank parity below the pool size", () => {
  it("forYouFeed returns the same order as the pre-retrieval implementation when the catalog is under the pool size", async () => {
    const viewer = await createTestUser({ email: "foryou-viewer@test.com" });
    const author = await createTestUser({ email: "foryou-author@test.com" });

    await createRecipeAt(author._id, "A", 0, 5, 0);
    await createRecipeAt(author._id, "B", 5, 50, 2);
    await createRecipeAt(author._id, "C", 10, 3, 0);
    await createRecipeAt(author._id, "D", 20, 100, 10);
    await createRecipeAt(author._id, "E", 40, 1, 0);
    await createRecipeAt(author._id, "F", 2, 0, 0);

    const result = await forYouFeed(viewer._id, 1, 20);

    expect(result.recipes.map((r) => r.title)).toEqual([
      "D",
      "B",
      "A",
      "F",
      "C",
      "E",
    ]);
    expect(result.total).toBe(6);
    expect(result.totalPages).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("trendingFeed returns the same order as the pre-retrieval implementation when the catalog is under the pool size", async () => {
    const viewer = await createTestUser({ email: "trend-viewer@test.com" });
    const author = await createTestUser({ email: "trend-author@test.com" });

    await createRecipeAt(author._id, "T1", 1, 10, 1);
    await createRecipeAt(author._id, "T2", 3, 40, 0);
    await createRecipeAt(author._id, "T3", 15, 5, 0);
    await createRecipeAt(author._id, "T4", 0, 0, 0);
    await createRecipeAt(author._id, "T5", 30, 200, 20);

    const result = await trendingFeed(viewer._id, 1, 20);

    expect(result.recipes.map((r) => r.title)).toEqual([
      "T5",
      "T2",
      "T1",
      "T3",
      "T4",
    ]);
    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("seasonalFeed with no active tag returns the same order as the pre-retrieval implementation when the catalog is under the pool size", async () => {
    const viewer = await createTestUser({ email: "seasonal-viewer@test.com" });
    const author = await createTestUser({ email: "seasonal-author@test.com" });

    await createRecipeAt(author._id, "N1", 0, 5);
    await createRecipeAt(author._id, "N2", 5, 50);
    await createRecipeAt(author._id, "N3", 10, 3);

    const result = await seasonalFeed(viewer._id, 1, 20);

    expect(result.recipes.map((r) => r.title)).toEqual(["N2", "N1", "N3"]);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(1);
    expect(result.hasMore).toBe(false);
  });
});

describe("feed-service seasonal scoped retrieval", () => {
  it("scopes the pool to recipes carrying an active seasonal tag", async () => {
    const viewer = await createTestUser({ email: "seasonal-scoped-viewer@test.com" });
    const author = await createTestUser({ email: "seasonal-scoped-author@test.com" });

    await SeasonalTag.create({
      name: "Fall Favorites",
      slug: "fall-favorites",
      startDate: daysAgo(5),
      endDate: daysAgo(-5),
      isActive: true,
    });

    await Recipe.create({
      authorId: author._id,
      title: "Tagged Low",
      baseServings: 4,
      isPrivate: false,
      likesCount: 10,
      seasonalTags: ["fall-favorites"],
    });
    await Recipe.create({
      authorId: author._id,
      title: "Tagged High",
      baseServings: 4,
      isPrivate: false,
      likesCount: 50,
      seasonalTags: ["fall-favorites"],
    });
    await Recipe.create({
      authorId: author._id,
      title: "Untagged",
      baseServings: 4,
      isPrivate: false,
      likesCount: 999,
    });

    const result = await seasonalFeed(viewer._id, 1, 20);
    const titles = result.recipes.map((r) => r.title);

    expect(titles).toEqual(["Tagged High", "Tagged Low"]);
    expect(titles).not.toContain("Untagged");
  });
});

describe("feed-service trending materialization", () => {
  it("falls back to a live-computed pool before any trending score has been materialized", async () => {
    const viewer = await createTestUser({ email: "fallback-viewer@test.com" });
    const author = await createTestUser({ email: "fallback-author@test.com" });

    await createRecipeAt(author._id, "Hot Now", 0, 30, 0);
    await createRecipeAt(author._id, "Quiet", 0, 0, 0);

    const stored = await Recipe.find({ authorId: author._id })
      .select("trendingScore")
      .lean();
    expect(stored.every((r) => r.trendingScore === 0)).toBe(true);

    const result = await trendingFeed(viewer._id, 1, 20);

    expect(result.recipes.length).toBeGreaterThan(0);
    expect(result.recipes[0].title).toBe("Hot Now");
  });

  it("ranks by the stored trendingScore once it has been materialized recently, even when it disagrees with a live recompute", async () => {
    const viewer = await createTestUser({ email: "materialized-viewer@test.com" });
    const author = await createTestUser({ email: "materialized-author@test.com" });

    const staleHot = await Recipe.create({
      authorId: author._id,
      title: "StaleHot",
      baseServings: 4,
      isPrivate: false,
      likesCount: 0,
      forksCount: 0,
    });
    await Recipe.collection.updateOne(
      { _id: staleHot._id },
      { $set: { trendingScore: 500, trendingScoreUpdatedAt: new Date() } }
    );

    const freshEngaged = await Recipe.create({
      authorId: author._id,
      title: "FreshEngaged",
      baseServings: 4,
      isPrivate: false,
      likesCount: 1000,
      forksCount: 100,
    });
    await Recipe.collection.updateOne(
      { _id: freshEngaged._id },
      { $set: { trendingScore: 1, trendingScoreUpdatedAt: new Date() } }
    );

    const result = await trendingFeed(viewer._id, 1, 20);

    expect(result.recipes.map((r) => r.title)).toEqual([
      "StaleHot",
      "FreshEngaged",
    ]);
  });
});

describe("feed-service pagination", () => {
  it("reports hasMore true mid-catalog and false on the last page, keeping page/totalPages consistent", async () => {
    const viewer = await createTestUser({ email: "paginate-viewer@test.com" });
    const author = await createTestUser({ email: "paginate-author@test.com" });

    for (let i = 0; i < 25; i++) {
      await createRecipeAt(author._id, `Trend-${i}`, i % 10, 25 - i, 0);
    }

    const firstPage = await trendingFeed(viewer._id, 1, 20);
    expect(firstPage.recipes).toHaveLength(20);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.total).toBe(25);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.page).toBe(1);

    const secondPage = await trendingFeed(viewer._id, 2, 20);
    expect(secondPage.recipes).toHaveLength(5);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.page).toBe(2);
    expect(secondPage.totalPages).toBe(2);
  });

  it("reports hasMore for forYouFeed the same way", async () => {
    const viewer = await createTestUser({ email: "paginate-foryou-viewer@test.com" });
    const author = await createTestUser({ email: "paginate-foryou-author@test.com" });

    for (let i = 0; i < 25; i++) {
      await createRecipeAt(author._id, `ForYou-${i}`, i % 10, 25 - i, 0);
    }

    const firstPage = await forYouFeed(viewer._id, 1, 20);
    expect(firstPage.recipes).toHaveLength(20);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await forYouFeed(viewer._id, 2, 20);
    expect(secondPage.recipes).toHaveLength(5);
    expect(secondPage.hasMore).toBe(false);
  });
});

describe("feed-service visibility exclusions survive the retrieval rewrite", () => {
  it("never surfaces a private, hidden, blocked-author, or banned-author recipe in any of the three feeds", async () => {
    const viewer = await createTestUser({ email: "visibility-viewer@test.com" });
    const goodAuthor = await createTestUser({
      email: "visibility-good@test.com",
      isPublic: true,
    });
    const blockedAuthor = await createTestUser({
      email: "visibility-blocked@test.com",
      isPublic: true,
    });
    const bannedAuthor = await createTestUser({
      email: "visibility-banned@test.com",
      isPublic: true,
      isBanned: true,
    });

    await Block.create({ blockerId: viewer._id, blockedId: blockedAuthor._id });

    await Recipe.create({
      authorId: goodAuthor._id,
      title: "Good Visible",
      baseServings: 4,
      isPrivate: false,
      likesCount: 5,
    });
    await Recipe.create({
      authorId: goodAuthor._id,
      title: "Private Recipe",
      baseServings: 4,
      isPrivate: true,
      likesCount: 999,
    });
    await Recipe.create({
      authorId: goodAuthor._id,
      title: "Hidden Recipe",
      baseServings: 4,
      isPrivate: false,
      isHidden: true,
      likesCount: 999,
    });
    await Recipe.create({
      authorId: blockedAuthor._id,
      title: "Blocked Author Recipe",
      baseServings: 4,
      isPrivate: false,
      likesCount: 999,
    });
    await Recipe.create({
      authorId: bannedAuthor._id,
      title: "Banned Author Recipe",
      baseServings: 4,
      isPrivate: false,
      likesCount: 999,
    });

    const [forYou, trending, seasonal] = await Promise.all([
      forYouFeed(viewer._id, 1, 20),
      trendingFeed(viewer._id, 1, 20),
      seasonalFeed(viewer._id, 1, 20),
    ]);

    for (const result of [forYou, trending, seasonal]) {
      const titles = result.recipes.map((r) => r.title);
      expect(titles).toContain("Good Visible");
      expect(titles).not.toContain("Private Recipe");
      expect(titles).not.toContain("Hidden Recipe");
      expect(titles).not.toContain("Blocked Author Recipe");
      expect(titles).not.toContain("Banned Author Recipe");
    }
  });
});

describe("recompute-trending-scores script", () => {
  it("produces the same ordering as the live trending formula on a seeded set", async () => {
    const viewer = await createTestUser({ email: "recompute-viewer@test.com" });
    const author = await createTestUser({ email: "recompute-author@test.com" });

    await createRecipeAt(author._id, "R1", 2, 20, 1);
    await createRecipeAt(author._id, "R2", 10, 80, 3);
    await createRecipeAt(author._id, "R3", 1, 2, 0);
    await createRecipeAt(author._id, "R4", 25, 150, 10);

    const liveResult = await trendingFeed(viewer._id, 1, 20);
    const liveOrder = liveResult.recipes.map((r) => r.title);

    const now = new Date();
    const { scanned, updated } = await recomputeTrendingScores(now);
    expect(scanned).toBeGreaterThanOrEqual(4);
    expect(updated).toBeGreaterThanOrEqual(4);

    const stored = await Recipe.find({ authorId: author._id })
      .sort({ trendingScore: -1 })
      .select("title trendingScore trendingScoreUpdatedAt")
      .lean();

    expect(stored.map((r) => r.title)).toEqual(liveOrder);
    expect(stored.every((r) => r.trendingScoreUpdatedAt?.getTime() === now.getTime())).toBe(
      true
    );

    const rerun = await recomputeTrendingScores(new Date(now.getTime() + 1000));
    expect(rerun.scanned).toBe(scanned);
  });
});
