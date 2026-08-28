import { describe, expect, it } from "vitest";
import User from "../../models/User";
import Follow from "../../models/Follow";
import Block from "../../models/Block";
import Recipe from "../../models/Recipe";
import { createTestUser } from "../helpers";
import { getSuggestedChefs } from "../../services/suggested-chefs-service";

describe("suggested-chefs-service", () => {
  it("excludes the caller, already-followed, pending requests, blocked users (either direction), and banned users", async () => {
    const viewer = await createTestUser({ fullName: "Viewer" });

    const alreadyFollowed = await createTestUser({ fullName: "Followed" });
    await Follow.create({
      followerId: viewer._id,
      followingId: alreadyFollowed._id,
      status: "active",
    });

    const pendingRequest = await createTestUser({ fullName: "Pending" });
    await Follow.create({
      followerId: viewer._id,
      followingId: pendingRequest._id,
      status: "pending",
    });

    const iBlocked = await createTestUser({ fullName: "IBlocked" });
    await Block.create({ blockerId: viewer._id, blockedId: iBlocked._id });

    const blockedMe = await createTestUser({ fullName: "BlockedMe" });
    await Block.create({ blockerId: blockedMe._id, blockedId: viewer._id });

    const banned = await createTestUser({ fullName: "Banned", isBanned: true });

    const eligible = await createTestUser({ fullName: "Eligible" });

    const chefs = await getSuggestedChefs(viewer._id, 12);
    const ids = chefs.map((c) => c.id);

    expect(ids).not.toContain(viewer._id.toString());
    expect(ids).not.toContain(alreadyFollowed._id.toString());
    expect(ids).not.toContain(pendingRequest._id.toString());
    expect(ids).not.toContain(iBlocked._id.toString());
    expect(ids).not.toContain(blockedMe._id.toString());
    expect(ids).not.toContain(banned._id.toString());
    expect(ids).toContain(eligible._id.toString());
  });

  it("labels seed accounts as editorial", async () => {
    const viewer = await createTestUser({ fullName: "Viewer" });
    const seedChef = await createTestUser({ fullName: "Seed Chef" });
    await User.updateOne({ _id: seedChef._id }, { $set: { isSeed: true } });

    const chefs = await getSuggestedChefs(viewer._id, 12);
    const found = chefs.find((c) => c.id === seedChef._id.toString());

    expect(found).toBeDefined();
    expect(found?.reason).toBe("editorial");
  });

  it("labels a cuisine-preference overlap as cuisine, with the matching cuisineTag", async () => {
    const viewer = await createTestUser({ fullName: "Viewer" });
    await User.updateOne(
      { _id: viewer._id },
      { $set: { cuisinePreferences: ["Lebanese"] } }
    );

    const cuisineChef = await createTestUser({ fullName: "Cuisine Chef" });
    await Recipe.create({
      authorId: cuisineChef._id,
      title: "Kibbeh",
      baseServings: 4,
      cuisineTags: ["Lebanese"],
      isPrivate: false,
    });

    const chefs = await getSuggestedChefs(viewer._id, 12);
    const found = chefs.find((c) => c.id === cuisineChef._id.toString());

    expect(found).toBeDefined();
    expect(found?.reason).toBe("cuisine");
    expect(found?.cuisineTag).toBe("Lebanese");
  });

  it("labels a high-follower account with no editorial or cuisine signal as popular", async () => {
    const viewer = await createTestUser({ fullName: "Viewer" });
    const popularChef = await createTestUser({ fullName: "Popular Chef" });
    await User.updateOne(
      { _id: popularChef._id },
      { $set: { followersCount: 5000 } }
    );

    const chefs = await getSuggestedChefs(viewer._id, 12);
    const found = chefs.find((c) => c.id === popularChef._id.toString());

    expect(found).toBeDefined();
    expect(found?.reason).toBe("popular");
    expect(found?.cuisineTag).toBeUndefined();
  });

  it("returns the documented response shape with recent public recipe thumbnails", async () => {
    const viewer = await createTestUser({ fullName: "Viewer" });
    const chef = await createTestUser({ fullName: "Chef With Photos" });
    await Recipe.create([
      {
        authorId: chef._id,
        title: "Photo Recipe 1",
        baseServings: 4,
        photos: ["https://example.com/1.jpg"],
        isPrivate: false,
      },
      {
        authorId: chef._id,
        title: "Photo Recipe 2",
        baseServings: 4,
        photos: ["https://example.com/2.jpg"],
        isPrivate: false,
      },
      {
        authorId: chef._id,
        title: "Private Recipe",
        baseServings: 4,
        photos: ["https://example.com/private.jpg"],
        isPrivate: true,
      },
    ]);

    const chefs = await getSuggestedChefs(viewer._id, 12);
    const found = chefs.find((c) => c.id === chef._id.toString());

    expect(found).toMatchObject({
      id: chef._id.toString(),
      fullName: "Chef With Photos",
    });
    expect(found).toHaveProperty("profilePictureUrl");
    expect(found).toHaveProperty("isPremiumActive");
    expect(found).toHaveProperty("recipesCount");
    expect(found).toHaveProperty("followersCount");
    expect(found?.recentRecipePhotos).toEqual(
      expect.arrayContaining([
        "https://example.com/1.jpg",
        "https://example.com/2.jpg",
      ])
    );
    expect(found?.recentRecipePhotos).not.toContain(
      "https://example.com/private.jpg"
    );
    expect(found?.recentRecipePhotos.length).toBeLessThanOrEqual(3);
  });

  it("is stable across repeated calls for the same viewer", async () => {
    const viewer = await createTestUser({ fullName: "Viewer" });
    for (let i = 0; i < 5; i++) {
      await createTestUser({ fullName: `Chef ${i}`, email: `chef${i}@test.com` });
    }

    const first = await getSuggestedChefs(viewer._id, 12);
    const second = await getSuggestedChefs(viewer._id, 12);

    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
  });

  it("respects the limit parameter", async () => {
    const viewer = await createTestUser({ fullName: "Viewer" });
    for (let i = 0; i < 8; i++) {
      await createTestUser({ fullName: `Chef ${i}`, email: `chef-limit-${i}@test.com` });
    }

    const chefs = await getSuggestedChefs(viewer._id, 3);
    expect(chefs.length).toBeLessThanOrEqual(3);
  });
});
