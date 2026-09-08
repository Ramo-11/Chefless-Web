import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import Comment from "../../models/Comment";
import CookedPost from "../../models/CookedPost";
import Recipe from "../../models/Recipe";
import Block from "../../models/Block";
import { createTestUser, createTestRecipe } from "../helpers";
import {
  createComment,
  deleteComment,
  listComments,
  listReplies,
} from "../../services/comment-service";

async function createTestCookedPost(opts: {
  userId: Types.ObjectId;
  recipeId?: Types.ObjectId | null;
  recipeAuthorId?: Types.ObjectId | null;
  recipeTitle?: string;
  removedAt?: Date | null;
}) {
  return CookedPost.create({
    userId: opts.userId,
    recipeId: opts.recipeId ?? null,
    recipeAuthorId: opts.recipeAuthorId ?? null,
    recipeTitle: opts.recipeTitle ?? "Test Dish",
    photoUrl: "https://example.com/photo.jpg",
    removedAt: opts.removedAt ?? null,
  });
}

describe("comment-service", () => {
  it("creates a top-level comment and increments the recipe's commentsCount", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const dto = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Looks delicious!",
    });

    expect(dto.parentId).toBeNull();
    expect(dto.text).toBe("Looks delicious!");
    expect(dto.author?.id).toBe(commenter._id.toString());
    expect(dto.canDelete).toBe(true);
    expect(dto.repliesCount).toBe(0);

    const updatedRecipe = await Recipe.findById(recipe._id).lean();
    expect(updatedRecipe?.commentsCount).toBe(1);
  });

  it("creates a reply attached to the top-level comment and increments repliesCount", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const replier = await createTestUser({ email: "replier@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const topLevel = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "First!",
    });

    const reply = await createComment({
      authorId: replier._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Totally agree.",
      parentId: topLevel.id,
    });

    expect(reply.parentId).toBe(topLevel.id);

    const parentDoc = await Comment.findById(topLevel.id).lean();
    expect(parentDoc?.repliesCount).toBe(1);

    const updatedRecipe = await Recipe.findById(recipe._id).lean();
    expect(updatedRecipe?.commentsCount).toBe(2);
  });

  it("flattens a reply-to-a-reply onto the original top-level comment", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const replier1 = await createTestUser({ email: "replier1@test.com" });
    const replier2 = await createTestUser({ email: "replier2@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const topLevel = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Top level",
    });

    const reply1 = await createComment({
      authorId: replier1._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "First reply",
      parentId: topLevel.id,
    });

    const reply2 = await createComment({
      authorId: replier2._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Reply to the reply",
      parentId: reply1.id,
    });

    expect(reply2.parentId).toBe(topLevel.id);

    const parentDoc = await Comment.findById(topLevel.id).lean();
    expect(parentDoc?.repliesCount).toBe(2);
  });

  it("blocks reading and writing in either direction between viewer and target owner", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const stranger = await createTestUser({ email: "stranger@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    await Block.create({ blockerId: author._id, blockedId: stranger._id });

    await expect(
      listComments("recipe", recipe._id.toString(), stranger._id.toString(), undefined, 20)
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      createComment({
        authorId: stranger._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        text: "Hello?",
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "BLOCKED" });

    await Block.deleteMany({});
    await Block.create({ blockerId: stranger._id, blockedId: author._id });

    await expect(
      listComments("recipe", recipe._id.toString(), stranger._id.toString(), undefined, 20)
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      createComment({
        authorId: stranger._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        text: "Hello?",
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "BLOCKED" });
  });

  it("returns 404 for a private recipe instead of leaking its existence", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const stranger = await createTestUser({ email: "stranger@test.com" });
    const recipe = await createTestRecipe({
      authorId: author._id,
      isPrivate: true,
    });

    await expect(
      listComments("recipe", recipe._id.toString(), stranger._id.toString(), undefined, 20)
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      createComment({
        authorId: stranger._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        text: "Can I see this?",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects comment creation from a banned user", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const banned = await createTestUser({
      email: "banned@test.com",
      isBanned: true,
    });
    const recipe = await createTestRecipe({ authorId: author._id });

    await expect(
      createComment({
        authorId: banned._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        text: "Let me in",
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "USER_BANNED" });
  });

  it("allows the comment author to delete their own comment", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const comment = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Deleting this later",
    });

    const result = await deleteComment(comment.id, commenter._id.toString());
    expect(result.deleted).toBe(true);
    expect(result.commentsCount).toBe(0);

    const doc = await Comment.findById(comment.id).lean();
    expect(doc).toBeNull();
  });

  it("allows the target owner to delete someone else's comment", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const comment = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "I'll be removed by the owner",
    });

    const result = await deleteComment(comment.id, author._id.toString());
    expect(result.deleted).toBe(true);
    expect(result.commentsCount).toBe(0);
  });

  it("forbids a stranger from deleting someone else's comment", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const stranger = await createTestUser({ email: "stranger@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const comment = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Not yours to delete",
    });

    await expect(
      deleteComment(comment.id, stranger._id.toString())
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("hard-deletes a reply and decrements both the parent and target counters", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const replier = await createTestUser({ email: "replier@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const topLevel = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Parent",
    });
    const reply = await createComment({
      authorId: replier._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Child",
      parentId: topLevel.id,
    });

    const result = await deleteComment(reply.id, replier._id.toString());

    expect(result.repliesCount).toBe(0);
    expect(result.commentsCount).toBe(1);

    const replyDoc = await Comment.findById(reply.id).lean();
    expect(replyDoc).toBeNull();

    const parentDoc = await Comment.findById(topLevel.id).lean();
    expect(parentDoc?.repliesCount).toBe(0);
    expect(parentDoc?.isDeleted).toBe(false);
  });

  it("tombstones a top-level comment with live replies and keeps the replies visible", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const replier = await createTestUser({ email: "replier@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const topLevel = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Parent with a reply",
    });
    await createComment({
      authorId: replier._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "A live reply",
      parentId: topLevel.id,
    });

    const result = await deleteComment(topLevel.id, commenter._id.toString());
    expect(result.commentsCount).toBe(1);
    expect(result.repliesCount).toBeNull();

    const tombstone = await Comment.findById(topLevel.id).lean();
    expect(tombstone?.isDeleted).toBe(true);
    expect(tombstone?.text).toBe("");

    const list = await listComments(
      "recipe",
      recipe._id.toString(),
      author._id.toString(),
      undefined,
      20
    );
    expect(list.total).toBe(1);
    expect(list.comments).toHaveLength(1);
    expect(list.comments[0].isDeleted).toBe(true);
    expect(list.comments[0].text).toBe("");
    expect(list.comments[0].author).toBeNull();

    const replies = await listReplies(
      topLevel.id,
      author._id.toString(),
      undefined,
      20
    );
    expect(replies.replies).toHaveLength(1);
    expect(replies.total).toBe(1);
  });

  it("hard-deletes the tombstone once its last live reply is removed", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const replier = await createTestUser({ email: "replier@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const topLevel = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Parent with a reply",
    });
    const reply = await createComment({
      authorId: replier._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "A live reply",
      parentId: topLevel.id,
    });

    await deleteComment(topLevel.id, commenter._id.toString());

    const deleteReplyResult = await deleteComment(
      reply.id,
      replier._id.toString()
    );
    expect(deleteReplyResult.repliesCount).toBe(0);
    expect(deleteReplyResult.commentsCount).toBe(0);

    const tombstoneAfter = await Comment.findById(topLevel.id).lean();
    expect(tombstoneAfter).toBeNull();

    const updatedRecipe = await Recipe.findById(recipe._id).lean();
    expect(updatedRecipe?.commentsCount).toBe(0);
  });

  it("does not drive counts negative on a double delete", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const comment = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Delete me once",
    });

    const first = await deleteComment(comment.id, commenter._id.toString());
    expect(first.commentsCount).toBe(0);

    await expect(
      deleteComment(comment.id, commenter._id.toString())
    ).rejects.toMatchObject({ statusCode: 404 });

    const updatedRecipe = await Recipe.findById(recipe._id).lean();
    expect(updatedRecipe?.commentsCount).toBe(0);
  });

  it("paginates comments so each one appears exactly once across pages and terminates", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const createdIds: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const doc = await Comment.create({
        targetType: "recipe",
        targetId: recipe._id,
        authorId: commenter._id,
        parentId: null,
        text: `Comment #${i}`,
      });
      createdIds.push(doc._id.toString());
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let iterations = 0;

    do {
      const page = await listComments(
        "recipe",
        recipe._id.toString(),
        author._id.toString(),
        cursor,
        10
      );
      for (const c of page.comments) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
      cursor = page.nextCursor ?? undefined;
      iterations += 1;
    } while (cursor && iterations < 10);

    expect(seen.size).toBe(25);
    expect(iterations).toBe(3);
    for (const id of createdIds) {
      expect(seen.has(id)).toBe(true);
    }
  });

  it("returns an empty page for a target with no comments", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const result = await listComments(
      "recipe",
      recipe._id.toString(),
      author._id.toString(),
      undefined,
      20
    );

    expect(result).toEqual({ comments: [], nextCursor: null, total: 0 });
  });

  it("rejects whitespace-only comment text", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    await expect(
      createComment({
        authorId: author._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        text: "    \n\t   ",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects text over 1000 characters and accepts exactly 1000", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    await expect(
      createComment({
        authorId: author._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        text: "a".repeat(1001),
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const dto = await createComment({
      authorId: author._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "a".repeat(1000),
    });
    expect(dto.text).toHaveLength(1000);
  });

  it("does not allow a reply on a tombstoned parent", async () => {
    const author = await createTestUser({ email: "author@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const replier = await createTestUser({ email: "replier@test.com" });
    const lateReplier = await createTestUser({ email: "late@test.com" });
    const recipe = await createTestRecipe({ authorId: author._id });

    const topLevel = await createComment({
      authorId: commenter._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Parent",
    });
    await createComment({
      authorId: replier._id.toString(),
      targetType: "recipe",
      targetId: recipe._id.toString(),
      text: "Keeps it alive",
      parentId: topLevel.id,
    });

    await deleteComment(topLevel.id, commenter._id.toString());

    await expect(
      createComment({
        authorId: lateReplier._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        text: "Too late",
        parentId: topLevel.id,
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "PARENT_DELETED" });
  });

  it("supports commenting on a cooked post and 404s once the post is removed", async () => {
    const poster = await createTestUser({ email: "poster@test.com" });
    const commenter = await createTestUser({ email: "commenter@test.com" });
    const post = await createTestCookedPost({ userId: poster._id });

    const dto = await createComment({
      authorId: commenter._id.toString(),
      targetType: "cooked_post",
      targetId: post._id.toString(),
      text: "Nice plating",
    });
    expect(dto.targetType).toBe("cooked_post");

    const updatedPost = await CookedPost.findById(post._id).lean();
    expect(updatedPost?.commentsCount).toBe(1);

    await CookedPost.updateOne({ _id: post._id }, { $set: { removedAt: new Date() } });

    await expect(
      listComments("cooked_post", post._id.toString(), commenter._id.toString(), undefined, 20)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
