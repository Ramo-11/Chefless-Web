import { describe, expect, it } from "vitest";
import Cookbook from "../../models/Cookbook";
import Follow from "../../models/Follow";
import Kitchen from "../../models/Kitchen";
import User from "../../models/User";
import { createTestUser, createTestRecipe } from "../helpers";
import { getCookbook, listCookbookRecipes } from "../../services/cookbook-service";

describe("cookbook-service visibility parity", () => {
  it("hides a private recipe from a stranger but keeps the public one, for a public-account owner", async () => {
    const owner = await createTestUser({
      email: "cb-owner-public@test.com",
      isPublic: true,
    });
    const stranger = await createTestUser({ email: "cb-stranger@test.com" });

    const publicRecipe = await createTestRecipe({
      authorId: owner._id,
      title: "Public Recipe",
      isPrivate: false,
    });
    const privateRecipe = await createTestRecipe({
      authorId: owner._id,
      title: "Private Recipe",
      isPrivate: true,
    });

    const cookbook = await Cookbook.create({
      ownerId: owner._id,
      name: "Owner Cookbook",
      isPrivate: false,
      recipeIds: [publicRecipe._id, privateRecipe._id],
      recipesCount: 2,
    });

    const detail = await getCookbook(cookbook._id.toString(), stranger._id.toString());
    expect(detail.recipeIds.map((id) => id.toString())).toEqual([
      publicRecipe._id.toString(),
    ]);

    const list = await listCookbookRecipes(
      cookbook._id.toString(),
      stranger._id.toString(),
      1,
      20,
      {}
    );
    expect(list.data.map((r) => r._id.toString())).toEqual([
      publicRecipe._id.toString(),
    ]);
    expect(list.total).toBe(1);
  });

  it("shows the owner everything, including their own private recipes", async () => {
    const owner = await createTestUser({
      email: "cb-owner-self@test.com",
      isPublic: true,
    });
    const publicRecipe = await createTestRecipe({
      authorId: owner._id,
      title: "Public Recipe",
      isPrivate: false,
    });
    const privateRecipe = await createTestRecipe({
      authorId: owner._id,
      title: "Private Recipe",
      isPrivate: true,
    });
    const cookbook = await Cookbook.create({
      ownerId: owner._id,
      name: "Owner Cookbook",
      isPrivate: false,
      recipeIds: [publicRecipe._id, privateRecipe._id],
      recipesCount: 2,
    });

    const detail = await getCookbook(cookbook._id.toString(), owner._id.toString());
    expect(detail.recipeIds.map((id) => id.toString()).sort()).toEqual(
      [publicRecipe._id.toString(), privateRecipe._id.toString()].sort()
    );
  });

  it("only exposes a private-account owner's public recipes to an active follower, not a stranger", async () => {
    const owner = await createTestUser({
      email: "cb-owner-private@test.com",
      isPublic: false,
    });
    const follower = await createTestUser({ email: "cb-follower@test.com" });
    await Follow.create({
      followerId: follower._id,
      followingId: owner._id,
      status: "active",
    });
    const stranger = await createTestUser({ email: "cb-stranger-2@test.com" });

    const publicRecipe = await createTestRecipe({
      authorId: owner._id,
      title: "Public Recipe",
      isPrivate: false,
    });
    const privateRecipe = await createTestRecipe({
      authorId: owner._id,
      title: "Private Recipe",
      isPrivate: true,
    });
    const cookbook = await Cookbook.create({
      ownerId: owner._id,
      name: "Private Owner Cookbook",
      isPrivate: false,
      recipeIds: [publicRecipe._id, privateRecipe._id],
      recipesCount: 2,
    });

    const followerDetail = await getCookbook(
      cookbook._id.toString(),
      follower._id.toString()
    );
    expect(followerDetail.recipeIds.map((id) => id.toString())).toEqual([
      publicRecipe._id.toString(),
    ]);

    await expect(
      getCookbook(cookbook._id.toString(), stranger._id.toString())
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("still gates a private-account owner's cookbook behind profile visibility for a kitchen-only co-member", async () => {
    const owner = await createTestUser({
      email: "cb-owner-kitchen@test.com",
      isPublic: false,
    });
    const kitchenMate = await createTestUser({ email: "cb-kitchen-mate@test.com" });
    const kitchen = await Kitchen.create({
      name: "Cookbook Kitchen",
      leadId: owner._id,
      inviteCode: "CBKITCHEN",
      memberCount: 2,
    });
    await User.updateMany(
      { _id: { $in: [owner._id, kitchenMate._id] } },
      { $set: { kitchenId: kitchen._id } }
    );

    const publicRecipe = await createTestRecipe({
      authorId: owner._id,
      title: "Public Recipe",
      isPrivate: false,
    });
    const cookbook = await Cookbook.create({
      ownerId: owner._id,
      name: "Kitchen Owner Cookbook",
      isPrivate: false,
      recipeIds: [publicRecipe._id],
      recipesCount: 1,
    });

    await expect(
      listCookbookRecipes(cookbook._id.toString(), kitchenMate._id.toString(), 1, 20, {})
    ).rejects.toMatchObject({ statusCode: 403 });

    await Follow.create({
      followerId: kitchenMate._id,
      followingId: owner._id,
      status: "active",
    });

    const list = await listCookbookRecipes(
      cookbook._id.toString(),
      kitchenMate._id.toString(),
      1,
      20,
      {}
    );
    expect(list.data.map((r) => r._id.toString())).toEqual([
      publicRecipe._id.toString(),
    ]);
  });
});
