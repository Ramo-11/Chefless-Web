import { describe, it, expect } from "vitest";
import {
  assertImportAllowed,
  recordImportUsage,
} from "../../services/ai-recipe-service";
import { createTestUser } from "../helpers";
import User from "../../models/User";

describe("ai import gating", () => {
  it("lets a free user keep importing until the recipe cap is reached", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    // Under the cap: allowed, and each import advances the daily counter.
    await expect(assertImportAllowed(userId)).resolves.toBeUndefined();
    await recordImportUsage(userId);
    await expect(assertImportAllowed(userId)).resolves.toBeUndefined();
    await recordImportUsage(userId);

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
      await assertImportAllowed(userId);
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
      await assertImportAllowed(userId);
      await recordImportUsage(userId);
    }

    try {
      await assertImportAllowed(userId);
      expect.fail("Should have thrown after the daily import cap is spent");
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number; code?: string };
      expect(e.statusCode).toBe(429);
      expect(e.code).toBe("AI_QUOTA_EXCEEDED");
    }
  });

  it("does not burn the daily cap on a failed extraction (assert only)", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    await assertImportAllowed(userId);
    // No recordImportUsage call (extraction failed) -> still allowed.
    await expect(assertImportAllowed(userId)).resolves.toBeUndefined();

    const stored = await User.findById(userId)
      .select("aiRecipeHelperUsageCount")
      .lean();
    expect(stored?.aiRecipeHelperUsageCount ?? 0).toBe(0);
  });

  it("gates premium users by the daily AI quota, not the recipe cap", async () => {
    const user = await createTestUser();
    await User.updateOne(
      { _id: user._id },
      // Premium, and already past the free recipe cap.
      { $set: { isPremium: true, originalRecipesCount: 10 } }
    );
    const userId = user._id.toString();

    await assertImportAllowed(userId);
    await recordImportUsage(userId);

    const stored = await User.findById(userId)
      .select("aiGenerateCount aiRecipeHelperUsageCount")
      .lean();
    expect(stored?.aiGenerateCount).toBe(1);
    expect(stored?.aiRecipeHelperUsageCount).toBe(1);
  });
});
