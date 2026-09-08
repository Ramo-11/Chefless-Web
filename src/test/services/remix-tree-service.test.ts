import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import Recipe, { IRecipe } from "../../models/Recipe";
import Follow from "../../models/Follow";
import Kitchen from "../../models/Kitchen";
import User from "../../models/User";
import { createTestUser, createTestRecipe } from "../helpers";
import { getRemixTree } from "../../services/remix-tree-service";

async function forkOf(
  parent: IRecipe,
  authorId: Types.ObjectId,
  title: string
) {
  return Recipe.create({
    authorId,
    title,
    baseServings: 4,
    isPrivate: false,
    forkedFrom: {
      recipeId: parent._id,
      authorId: parent.authorId,
      authorName: "Origin Chef",
    },
  });
}

describe("remix-tree-service getRemixTree", () => {
  it("orders ancestors root-first and groups descendants by level in discovery order", async () => {
    const author = await createTestUser({ email: "tree-author@test.com" });
    const viewer = await createTestUser({ email: "tree-viewer@test.com" });

    const root = await createTestRecipe({ authorId: author._id, title: "Root" });
    const focus = await forkOf(root, author._id, "Focus");
    const c1 = await forkOf(focus, author._id, "Child One");
    const c2 = await forkOf(focus, author._id, "Child Two");
    await forkOf(c1, author._id, "Grandchild One");
    await forkOf(c2, author._id, "Grandchild Two");

    const tree = await getRemixTree(focus._id.toString(), viewer._id.toString());

    expect(tree.ancestors.map((n) => n.title)).toEqual(["Root"]);
    expect(tree.focus.title).toBe("Focus");
    expect(tree.descendants.map((n) => n.title)).toEqual([
      "Child One",
      "Child Two",
      "Grandchild One",
      "Grandchild Two",
    ]);
    expect(tree.descendants.map((n) => n.depth)).toEqual([1, 1, 2, 2]);
    expect(tree.truncated).toBe(false);
  });

  it("redacts a descendant on a private, unfollowed account but preserves tree shape via real ids", async () => {
    const publicAuthor = await createTestUser({
      email: "pub-author@test.com",
      isPublic: true,
    });
    const privateAuthor = await createTestUser({
      email: "priv-author@test.com",
      isPublic: false,
    });
    const viewer = await createTestUser({ email: "viewer-redact@test.com" });

    const focus = await createTestRecipe({
      authorId: publicAuthor._id,
      title: "Focus Public",
    });
    const hiddenChild = await forkOf(focus, privateAuthor._id, "Hidden Remix");
    const grandchild = await forkOf(
      hiddenChild,
      privateAuthor._id,
      "Grandchild Of Hidden"
    );

    const tree = await getRemixTree(focus._id.toString(), viewer._id.toString());

    const redacted = tree.descendants.find((n) => n.depth === 1)!;
    expect(redacted.viewable).toBe(false);
    expect(redacted.recipeId).toBeNull();
    expect(redacted.title).toBe("Private recipe");
    expect(redacted.childIds).toEqual([grandchild._id.toString()]);

    const redactedGrandchild = tree.descendants.find((n) => n.depth === 2)!;
    expect(redactedGrandchild.viewable).toBe(false);
    expect(redactedGrandchild.recipeId).toBeNull();
  });

  it("grants visibility to an active follower but not a pending one", async () => {
    const privateAuthor = await createTestUser({
      email: "priv-author-2@test.com",
      isPublic: false,
    });
    const focus = await createTestRecipe({
      authorId: privateAuthor._id,
      title: "Focus Private",
    });
    const child = await forkOf(focus, privateAuthor._id, "Remix By Origin");

    const followerViewer = await createTestUser({ email: "follower@test.com" });
    await Follow.create({
      followerId: followerViewer._id,
      followingId: privateAuthor._id,
      status: "active",
    });

    const pendingViewer = await createTestUser({ email: "pending@test.com" });
    await Follow.create({
      followerId: pendingViewer._id,
      followingId: privateAuthor._id,
      status: "pending",
    });

    const followerTree = await getRemixTree(
      focus._id.toString(),
      followerViewer._id.toString()
    );
    expect(followerTree.focus.viewable).toBe(true);
    expect(followerTree.descendants[0].viewable).toBe(true);
    expect(followerTree.descendants[0].recipeId).toBe(child._id.toString());

    const pendingTree = await getRemixTree(
      focus._id.toString(),
      pendingViewer._id.toString()
    );
    expect(pendingTree.focus.viewable).toBe(false);
    expect(pendingTree.descendants[0].viewable).toBe(false);
  });

  it("grants visibility to a kitchen co-member of a private author", async () => {
    const privateAuthor = await createTestUser({
      email: "priv-author-3@test.com",
      isPublic: false,
    });
    const kitchenMate = await createTestUser({ email: "kitchen-mate@test.com" });
    const kitchen = await Kitchen.create({
      name: "Shared Kitchen",
      leadId: privateAuthor._id,
      inviteCode: "REMIXKIT",
      memberCount: 2,
    });
    await User.updateMany(
      { _id: { $in: [privateAuthor._id, kitchenMate._id] } },
      { $set: { kitchenId: kitchen._id } }
    );

    const focus = await createTestRecipe({
      authorId: privateAuthor._id,
      title: "Kitchen Focus",
    });

    const tree = await getRemixTree(
      focus._id.toString(),
      kitchenMate._id.toString()
    );
    expect(tree.focus.viewable).toBe(true);
  });

  it("caps descendants at MAX_DESCENDANT_NODES and reports truncated", async () => {
    const author = await createTestUser({ email: "cap-author@test.com" });
    const viewer = await createTestUser({ email: "cap-viewer@test.com" });
    const focus = await createTestRecipe({ authorId: author._id, title: "Cap Focus" });

    const extraChildren = Array.from({ length: 155 }, (_, i) => ({
      authorId: author._id,
      title: `Cap Child ${i}`,
      baseServings: 4,
      isPrivate: false,
      forkedFrom: {
        recipeId: focus._id,
        authorId: focus.authorId,
        authorName: "Origin Chef",
      },
    }));
    await Recipe.insertMany(extraChildren);

    const tree = await getRemixTree(focus._id.toString(), viewer._id.toString());

    expect(tree.descendants.length).toBe(150);
    expect(tree.truncated).toBe(true);
    expect(tree.descendants.every((n) => n.depth === 1)).toBe(true);
  });

  it("caps descendants at MAX_DESCENDANT_DEPTH and reports truncated", async () => {
    const author = await createTestUser({ email: "depth-author@test.com" });
    const viewer = await createTestUser({ email: "depth-viewer@test.com" });

    let current = await createTestRecipe({ authorId: author._id, title: "Depth Focus" });
    const focus = current;
    for (let i = 1; i <= 6; i++) {
      current = await forkOf(current, author._id, `Depth ${i}`);
    }

    const tree = await getRemixTree(focus._id.toString(), viewer._id.toString());

    expect(tree.truncated).toBe(true);
    expect(tree.descendants.length).toBe(5);
    expect(Math.max(...tree.descendants.map((n) => n.depth))).toBe(5);
    expect(tree.descendants.map((n) => n.title)).toEqual([
      "Depth 1",
      "Depth 2",
      "Depth 3",
      "Depth 4",
      "Depth 5",
    ]);
  });
});
