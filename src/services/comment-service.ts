import mongoose, { Types } from "mongoose";
import Comment, { IComment, CommentTargetType } from "../models/Comment";
import Recipe from "../models/Recipe";
import CookedPost from "../models/CookedPost";
import User, { IUser } from "../models/User";
import { canViewRecipe, canViewProfile } from "./visibility-service";
import { isBlocked } from "./block-service";
import {
  notifyRecipeCommented,
  notifyCookedPostCommented,
  notifyCommentReplied,
} from "./notification-service";

interface AppError extends Error {
  statusCode: number;
  code?: string;
}

function createError(message: string, statusCode: number, code?: string): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

const MAX_TEXT_LENGTH = 1000;
const CONTROL_CHAR_REGEX = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
  "g"
);

function sanitizeCommentText(raw: string): string {
  return raw.replace(CONTROL_CHAR_REGEX, "").trim();
}

export interface CommentAuthorDTO {
  id: string;
  fullName: string;
  profilePicture: string | null;
}

export interface CommentDTO {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  parentId: string | null;
  text: string;
  author: CommentAuthorDTO | null;
  repliesCount: number;
  isDeleted: boolean;
  canDelete: boolean;
  createdAt: string;
}

export interface CreateCommentInput {
  authorId: string;
  targetType: CommentTargetType;
  targetId: string;
  text: string;
  parentId?: string;
}

interface ListCommentsResult {
  comments: CommentDTO[];
  nextCursor: string | null;
  total: number;
}

interface ListRepliesResult {
  replies: CommentDTO[];
  nextCursor: string | null;
  total: number;
}

interface DeleteCommentResult {
  deleted: true;
  commentsCount: number;
  repliesCount: number | null;
}

function targetModelFor(targetType: CommentTargetType): mongoose.Model<any> {
  return targetType === "recipe" ? Recipe : CookedPost;
}

async function resolveTarget(
  targetType: CommentTargetType,
  targetId: string,
  viewerId: string,
  mode: "read" | "write"
): Promise<{ ownerId: Types.ObjectId; commentsCount: number }> {
  const viewerOid = new Types.ObjectId(viewerId);

  function blockError(): AppError {
    if (mode === "write") {
      return createError(
        "You cannot interact with this content.",
        403,
        "BLOCKED"
      );
    }
    return createError("Not found", 404);
  }

  if (targetType === "recipe") {
    const recipe = await Recipe.findById(targetId)
      .select("authorId isPrivate commentsCount")
      .lean();
    if (!recipe) throw createError("Not found", 404);

    if (await isBlocked(viewerId, recipe.authorId.toString())) {
      throw blockError();
    }

    const author = await User.findById(recipe.authorId)
      .select("fullName isPublic kitchenId isBanned")
      .lean();
    if (!author) throw createError("Not found", 404);

    const canView = await canViewRecipe(
      viewerOid,
      recipe,
      author as unknown as IUser
    );
    if (!canView) throw createError("Not found", 404);

    return { ownerId: recipe.authorId, commentsCount: recipe.commentsCount ?? 0 };
  }

  const post = await CookedPost.findById(targetId)
    .select("userId recipeId removedAt commentsCount")
    .lean();
  if (!post || post.removedAt) throw createError("Not found", 404);

  if (await isBlocked(viewerId, post.userId.toString())) {
    throw blockError();
  }

  if (post.recipeId) {
    const recipe = await Recipe.findById(post.recipeId)
      .select("authorId isPrivate")
      .lean();
    const author = recipe
      ? await User.findById(recipe.authorId)
          .select("fullName isPublic kitchenId isBanned")
          .lean()
      : null;
    if (recipe && author) {
      const canView = await canViewRecipe(
        viewerOid,
        recipe,
        author as unknown as IUser
      );
      if (!canView) throw createError("Not found", 404);
      return { ownerId: post.userId, commentsCount: post.commentsCount ?? 0 };
    }
  }

  const postAuthor = await User.findById(post.userId)
    .select("isPublic isBanned")
    .lean();
  if (!postAuthor) throw createError("Not found", 404);

  const canView = await canViewProfile(viewerOid, postAuthor as unknown as IUser);
  if (!canView) throw createError("Not found", 404);

  return { ownerId: post.userId, commentsCount: post.commentsCount ?? 0 };
}

async function resolveOwnerId(
  targetType: CommentTargetType,
  targetId: Types.ObjectId
): Promise<Types.ObjectId | null> {
  if (targetType === "recipe") {
    const recipe = await Recipe.findById(targetId).select("authorId").lean();
    return recipe?.authorId ?? null;
  }
  const post = await CookedPost.findById(targetId).select("userId").lean();
  return post?.userId ?? null;
}

async function buildDTOs(
  comments: IComment[],
  viewerId: string,
  ownerId: Types.ObjectId
): Promise<CommentDTO[]> {
  const authorIds = [
    ...new Set(
      comments.filter((c) => !c.isDeleted).map((c) => c.authorId.toString())
    ),
  ].map((id) => new Types.ObjectId(id));

  const authors = authorIds.length
    ? await User.find({ _id: { $in: authorIds } })
        .select("fullName profilePicture")
        .lean()
    : [];
  const authorMap = new Map<string, CommentAuthorDTO>(
    authors.map((a) => [
      a._id.toString(),
      {
        id: a._id.toString(),
        fullName: a.fullName,
        profilePicture: a.profilePicture ?? null,
      },
    ])
  );

  const ownerIdStr = ownerId.toString();

  return comments.map((c) => {
    const authorIdStr = c.authorId.toString();
    const isAuthorViewer = authorIdStr === viewerId;
    const isOwnerViewer = ownerIdStr === viewerId;
    return {
      id: c._id.toString(),
      targetType: c.targetType,
      targetId: c.targetId.toString(),
      parentId: c.parentId ? c.parentId.toString() : null,
      text: c.isDeleted ? "" : c.text,
      author: c.isDeleted ? null : authorMap.get(authorIdStr) ?? null,
      repliesCount: c.repliesCount,
      isDeleted: c.isDeleted,
      canDelete: !c.isDeleted && (isAuthorViewer || isOwnerViewer),
      createdAt: c.createdAt.toISOString(),
    };
  });
}

export async function listComments(
  targetType: CommentTargetType,
  targetId: string,
  viewerId: string,
  cursor: string | undefined,
  limit: number
): Promise<ListCommentsResult> {
  const { ownerId, commentsCount } = await resolveTarget(
    targetType,
    targetId,
    viewerId,
    "read"
  );

  const query: Record<string, unknown> = {
    targetType,
    targetId: new Types.ObjectId(targetId),
    parentId: null,
  };
  if (cursor) {
    query._id = { $lt: new Types.ObjectId(cursor) };
  }

  const rows = await Comment.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean<IComment[]>();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]._id.toString() : null;

  const comments = await buildDTOs(page, viewerId, ownerId);

  return { comments, nextCursor, total: commentsCount };
}

export async function listReplies(
  commentId: string,
  viewerId: string,
  cursor: string | undefined,
  limit: number
): Promise<ListRepliesResult> {
  const parent = await Comment.findById(commentId);
  if (!parent) throw createError("Comment not found", 404);

  const { ownerId } = await resolveTarget(
    parent.targetType,
    parent.targetId.toString(),
    viewerId,
    "read"
  );

  const query: Record<string, unknown> = { parentId: parent._id };
  if (cursor) {
    query._id = { $gt: new Types.ObjectId(cursor) };
  }

  const rows = await Comment.find(query)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean<IComment[]>();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]._id.toString() : null;

  const replies = await buildDTOs(page, viewerId, ownerId);

  return { replies, nextCursor, total: parent.repliesCount };
}

export async function createComment(
  input: CreateCommentInput
): Promise<CommentDTO> {
  const { authorId, targetType, targetId, parentId } = input;

  const cleanedText = sanitizeCommentText(input.text);
  if (cleanedText.length === 0) {
    throw createError("Comment cannot be empty.", 400);
  }
  if (cleanedText.length > MAX_TEXT_LENGTH) {
    throw createError(
      `Comment must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      400
    );
  }

  const author = await User.findById(authorId)
    .select("fullName profilePicture isBanned")
    .lean();
  if (!author) throw createError("User not found", 404);
  if (author.isBanned) {
    throw createError(
      "Your account has been suspended. Contact support for assistance.",
      403,
      "USER_BANNED"
    );
  }

  const { ownerId } = await resolveTarget(targetType, targetId, authorId, "write");

  let resolvedParent: IComment | null = null;
  if (parentId) {
    const parentDoc = await Comment.findById(parentId);
    if (
      !parentDoc ||
      parentDoc.targetType !== targetType ||
      !parentDoc.targetId.equals(targetId)
    ) {
      throw createError("Comment not found", 404);
    }

    resolvedParent = parentDoc.parentId
      ? await Comment.findById(parentDoc.parentId)
      : parentDoc;
    if (!resolvedParent) {
      throw createError("Comment not found", 404);
    }
    if (resolvedParent.isDeleted) {
      throw createError(
        "You cannot reply to a deleted comment.",
        403,
        "PARENT_DELETED"
      );
    }
  }

  const comment = await Comment.create({
    targetType,
    targetId: new Types.ObjectId(targetId),
    authorId: new Types.ObjectId(authorId),
    parentId: resolvedParent ? resolvedParent._id : null,
    text: cleanedText,
  });

  const TargetModel = targetModelFor(targetType);
  await TargetModel.updateOne(
    { _id: targetId },
    { $inc: { commentsCount: 1 } }
  );

  if (resolvedParent) {
    await Comment.updateOne(
      { _id: resolvedParent._id },
      { $inc: { repliesCount: 1 } }
    );
  }

  if (resolvedParent) {
    notifyCommentReplied(
      authorId,
      resolvedParent._id.toString(),
      comment._id.toString()
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`notifyCommentReplied failed: ${msg}`);
    });

    if (resolvedParent.authorId.toString() !== ownerId.toString()) {
      notifyTargetOwner(targetType, targetId, authorId, comment._id.toString());
    }
  } else {
    notifyTargetOwner(targetType, targetId, authorId, comment._id.toString());
  }

  const authorDto: CommentAuthorDTO = {
    id: author._id.toString(),
    fullName: author.fullName,
    profilePicture: author.profilePicture ?? null,
  };

  return {
    id: comment._id.toString(),
    targetType: comment.targetType,
    targetId: comment.targetId.toString(),
    parentId: comment.parentId ? comment.parentId.toString() : null,
    text: comment.text,
    author: authorDto,
    repliesCount: comment.repliesCount,
    isDeleted: false,
    canDelete: true,
    createdAt: comment.createdAt.toISOString(),
  };
}

function notifyTargetOwner(
  targetType: CommentTargetType,
  targetId: string,
  authorId: string,
  commentId: string
): void {
  const notify =
    targetType === "recipe"
      ? notifyRecipeCommented(authorId, targetId, commentId)
      : notifyCookedPostCommented(authorId, targetId, commentId);

  notify.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`notifyTargetOwner (${targetType}) failed: ${msg}`);
  });
}

export async function deleteComment(
  commentId: string,
  viewerId: string
): Promise<DeleteCommentResult> {
  const comment = await Comment.findById(commentId);
  if (!comment || comment.isDeleted) {
    throw createError("Comment not found", 404);
  }

  const ownerId = await resolveOwnerId(comment.targetType, comment.targetId);
  const isAuthor = comment.authorId.toString() === viewerId;
  const isOwner = ownerId ? ownerId.toString() === viewerId : false;
  if (!isAuthor && !isOwner) {
    throw createError(
      "You do not have permission to delete this comment.",
      403
    );
  }

  const TargetModel = targetModelFor(comment.targetType);

  if (comment.parentId) {
    await Comment.deleteOne({ _id: comment._id });

    const [parentAfterUpdate, targetDoc] = await Promise.all([
      Comment.findOneAndUpdate(
        { _id: comment.parentId, repliesCount: { $gt: 0 } },
        { $inc: { repliesCount: -1 } },
        { new: true }
      ),
      TargetModel.findOneAndUpdate(
        { _id: comment.targetId, commentsCount: { $gt: 0 } },
        { $inc: { commentsCount: -1 } },
        { new: true }
      )
        .select("commentsCount")
        .lean<{ commentsCount: number } | null>(),
    ]);

    const repliesCount = parentAfterUpdate?.repliesCount ?? 0;

    if (
      parentAfterUpdate &&
      parentAfterUpdate.isDeleted &&
      repliesCount <= 0
    ) {
      await Comment.deleteOne({ _id: parentAfterUpdate._id });
    }

    return {
      deleted: true,
      commentsCount: targetDoc?.commentsCount ?? 0,
      repliesCount,
    };
  }

  if (comment.repliesCount > 0) {
    await Comment.updateOne(
      { _id: comment._id },
      { $set: { isDeleted: true, deletedAt: new Date(), text: "" } }
    );
  } else {
    await Comment.deleteOne({ _id: comment._id });
  }

  const targetDoc = await TargetModel.findOneAndUpdate(
    { _id: comment.targetId, commentsCount: { $gt: 0 } },
    { $inc: { commentsCount: -1 } },
    { new: true }
  )
    .select("commentsCount")
    .lean<{ commentsCount: number } | null>();

  return {
    deleted: true,
    commentsCount: targetDoc?.commentsCount ?? 0,
    repliesCount: null,
  };
}
