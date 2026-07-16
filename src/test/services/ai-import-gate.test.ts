import { describe, it, expect } from "vitest";
import {
  reserveImportQuota,
  releaseAiQuota,
} from "../../services/ai-recipe-service";
import { createTestUser } from "../helpers";
import User from "../../models/User";

describe("ai import gating", () => {
  it("lets a free user keep importing until the recipe cap is reached", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    // Under the cap: allowed, and each reservation advances the daily counter.
    await expect(reserveImportQuota(userId)).resolves.toBeDefined();
    await expect(reserveImportQuota(userId)).resolves.toBeDefined();

    const after = await User.findById(userId)
      .select("aiRecipeHelperUsageCount aiLastUsedAt")
      .lean();
    expect(after?.aiRecipeHelperUsageCount).toBe(2);
    expect(after?.aiLastUsedAt).toBeInstanceOf(Date);
  });

  it("blocks a free user who is already at the 5-recipe cap", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();
    // Originals + saved already at the combined free cap.
    await User.updateOne(
      { _id: user._id },
      { $set: { originalRecipesCount: 3, savedRecipesCount: 2 } }
    );

    try {
      await reserveImportQuota(userId);
      expect.fail("Should have thrown once the recipe cap is reached");
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number; code?: string };
      expect(e.statusCode).toBe(403);
      expect(e.code).toBe("RECIPE_LIMIT_REACHED");
    }
  });

  it("caps free imports per day as an anti-abuse guard", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    // Spend the full daily allowance without ever saving a recipe.
    for (let i = 0; i < 10; i++) {
      await reserveImportQuota(userId);
    }

    try {
      await reserveImportQuota(userId);
      expect.fail("Should have thrown after the daily import cap is spent");
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number; code?: string };
      expect(e.statusCode).toBe(429);
      expect(e.code).toBe("AI_QUOTA_EXCEEDED");
    }
  });

  it("does not burn the daily cap on a failed extraction (reserve + release)", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    const reservation = await reserveImportQuota(userId);
    // Extraction failed -> the unit goes back and the counters roll back.
    await releaseAiQuota(userId, reservation);
    await expect(reserveImportQuota(userId)).resolves.toBeDefined();

    const stored = await User.findById(userId)
      .select("aiRecipeHelperUsageCount aiTotalMessagesSent aiGenerateCount")
      .lean();
    expect(stored?.aiRecipeHelperUsageCount).toBe(1);
    expect(stored?.aiTotalMessagesSent).toBe(1);
    expect(stored?.aiGenerateCount).toBe(1);
  });

  it("blocks concurrent requests from overshooting the daily cap", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    // 15 simultaneous reservations against a cap of 10: the guarded atomic
    // update must admit exactly 10, no matter how the requests interleave.
    const outcomes = await Promise.allSettled(
      Array.from({ length: 15 }, () => reserveImportQuota(userId))
    );
    const granted = outcomes.filter((o) => o.status === "fulfilled").length;
    expect(granted).toBe(10);

    const stored = await User.findById(userId)
      .select("aiRecipeHelperUsageCount")
      .lean();
    expect(stored?.aiRecipeHelperUsageCount).toBe(10);
  });

  it("gates premium users by the daily AI quota, not the recipe cap", async () => {
    const user = await createTestUser();
    await User.updateOne(
      { _id: user._id },
      // Premium, and already past the free recipe cap.
      { $set: { isPremium: true, originalRecipesCount: 10 } }
    );
    const userId = user._id.toString();

    await reserveImportQuota(userId);

    const stored = await User.findById(userId)
      .select("aiGenerateCount aiRecipeHelperUsageCount")
      .lean();
    expect(stored?.aiGenerateCount).toBe(1);
    expect(stored?.aiRecipeHelperUsageCount).toBe(1);
  });
});
