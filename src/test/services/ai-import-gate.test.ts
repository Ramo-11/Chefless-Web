import { describe, it, expect } from "vitest";
import {
  assertImportAllowed,
  recordImportUsage,
} from "../../services/ai-recipe-service";
import { createTestUser } from "../helpers";
import User from "../../models/User";

describe("ai import gating", () => {
  it("allows a free user's first import then blocks the second", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    // First import: allowed, flag not yet set.
    await expect(assertImportAllowed(userId)).resolves.toBeUndefined();

    // Recording flips the lifetime trial flag.
    await recordImportUsage(userId);
    const after = await User.findById(userId)
      .select("freeAiImportUsed aiLastUsedAt")
      .lean();
    expect(after?.freeAiImportUsed).toBe(true);
    expect(after?.aiLastUsedAt).toBeInstanceOf(Date);

    // Second import: blocked with the AI_TRIAL_USED 402.
    try {
      await assertImportAllowed(userId);
      expect.fail("Should have thrown after the free trial was spent");
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number; code?: string };
      expect(e.statusCode).toBe(402);
      expect(e.code).toBe("AI_TRIAL_USED");
    }
  });

  it("does not burn the free trial on a failed extraction (assert only)", async () => {
    const user = await createTestUser();
    const userId = user._id.toString();

    await assertImportAllowed(userId);
    // No recordImportUsage call (extraction failed) -> still allowed.
    await expect(assertImportAllowed(userId)).resolves.toBeUndefined();

    const stored = await User.findById(userId).select("freeAiImportUsed").lean();
    expect(stored?.freeAiImportUsed).toBe(false);
  });

  it("lets premium users import without flipping the free flag", async () => {
    const user = await createTestUser();
    await User.updateOne({ _id: user._id }, { $set: { isPremium: true } });
    const userId = user._id.toString();

    await assertImportAllowed(userId);
    await recordImportUsage(userId);

    const stored = await User.findById(userId)
      .select("freeAiImportUsed aiGenerateCount aiRecipeHelperUsageCount")
      .lean();
    // Premium path uses the daily quota counters, never the trial flag.
    expect(stored?.freeAiImportUsed).toBe(false);
    expect(stored?.aiGenerateCount).toBe(1);
    expect(stored?.aiRecipeHelperUsageCount).toBe(1);
  });
});
