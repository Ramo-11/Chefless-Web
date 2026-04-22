import { Types } from "mongoose";
import Recipe, { IRecipe } from "../models/Recipe";
import User from "../models/User";
import { canViewRecipe } from "./visibility-service";
import { IUser } from "../models/User";

interface AppError extends Error {
  statusCode: number;
}

function createError(message: string, statusCode: number): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  return error;
}

const MAX_ANCESTOR_DEPTH = 20;
const MAX_DESCENDANT_DEPTH = 5;
const MAX_DESCENDANT_NODES = 150;

export interface RemixTreeNode {
  recipeId: string | null;
  title: string;
  photoUrl: string | null;
  authorId: string | null;
  authorName: string;
  authorPhoto: string | null;
  /** Depth from the focus recipe: negative for ancestors, 0 for focus, positive for descendants. */
  depth: number;
  /** Post-time visibility hint — false when the original recipe was deleted. */
  isAvailable: boolean;
  /** Child remix ids — populated for focus + descendants only. */
  childIds: string[];
  /**
   * isHidden / isPrivate combined into a single boolean: does the viewer
   * actually have rights to open this node? When false, the UI should show
   * the node grayed-out but not navigable.
   */
  viewable: boolean;
  createdAt: Date | null;
  likesCount: number;
  forksCount: number;
}

export interface RemixTree {
  focusRecipeId: string;
  /** Ancestor chain, ordered oldest-first (root ancestor at index 0). */
  ancestors: RemixTreeNode[];
  focus: RemixTreeNode;
  descendants: RemixTreeNode[];
  /** True when any branch was truncated because of the depth/node cap. */
  truncated: boolean;
}

function viewForDeleted(
  authorName: string,
  depth: number
): RemixTreeNode {
  return {
    recipeId: null,
    title: "Deleted recipe",
    photoUrl: null,
    authorId: null,
    authorName,
    authorPhoto: null,
    depth,
    isAvailable: false,
    childIds: [],
    viewable: false,
    createdAt: null,
    likesCount: 0,
    forksCount: 0,
  };
}

function toNode(
  recipe: IRecipe,
  author: { fullName: string; profilePicture?: string | null } | null,
  depth: number,
  childIds: string[],
  viewable: boolean
): RemixTreeNode {
  return {
    recipeId: recipe._id.toString(),
    title: recipe.title,
    photoUrl: recipe.photos?.[0] ?? null,
    authorId: recipe.authorId?.toString() ?? null,
    authorName: author?.fullName ?? "Unknown chef",
    authorPhoto: author?.profilePicture ?? null,
    depth,
    isAvailable: true,
    childIds,
    viewable,
    createdAt: recipe.createdAt,
    likesCount: recipe.likesCount ?? 0,
    forksCount: recipe.forksCount ?? 0,
  };
}

/**
 * Build the remix lineage tree around a focus recipe.
 *
 * - Walks `forkedFrom.recipeId` upward for up to [MAX_ANCESTOR_DEPTH] hops.
 *   When the chain hits a deleted recipe we still surface a ghost node using
 *   the preserved `forkedFrom.authorName` so chefs stay credited.
 * - Walks descendants breadth-first up to [MAX_DESCENDANT_DEPTH] levels or
 *   [MAX_DESCENDANT_NODES] total, whichever hits first. Truncation is signaled
 *   via `tree.truncated` so the client can show a "view more" affordance.
 * - Per-node `viewable` is computed using the real `canViewRecipe` visibility
 *   rules — a node the viewer can't open is still shown grayed out so the
 *   tree shape remains intact.
 */
export async function getRemixTree(
  focusRecipeId: string,
  viewerId: string
): Promise<RemixTree> {
  const focus = await Recipe.findById(focusRecipeId);
  if (!focus) throw createError("Recipe not found", 404);

  const viewerOid = new Types.ObjectId(viewerId);

  // ── Ancestors ──────────────────────────────────────────────────────
  const ancestorNodes: RemixTreeNode[] = [];
  let currentFork = focus.forkedFrom;
  let depth = -1;
  let truncated = false;
  const visited = new Set<string>([focus._id.toString()]);

  while (currentFork && depth >= -MAX_ANCESTOR_DEPTH) {
    // If the parent recipe is deleted, surface a ghost node preserving the
    // attribution name — then stop walking (chain is broken).
    if (!currentFork.recipeId) {
      ancestorNodes.push(viewForDeleted(currentFork.authorName, depth));
      break;
    }
    const parentId = currentFork.recipeId.toString();
    if (visited.has(parentId)) break; // defensive guard against cycles
    visited.add(parentId);

    const parent = await Recipe.findById(currentFork.recipeId);
    if (!parent) {
      ancestorNodes.push(viewForDeleted(currentFork.authorName, depth));
      break;
    }

    const parentAuthor = await User.findById(parent.authorId)
      .select("fullName profilePicture isPublic kitchenId isBanned")
      .lean();
    const viewable = parentAuthor
      ? !parent.isHidden &&
        !parentAuthor.isBanned &&
        (await canViewRecipe(
          viewerOid,
          parent,
          parentAuthor as unknown as IUser
        ))
      : false;

    ancestorNodes.push(
      toNode(parent, parentAuthor ?? null, depth, [], viewable)
    );

    currentFork = parent.forkedFrom ?? undefined;
    depth -= 1;
  }
  if (currentFork && depth < -MAX_ANCESTOR_DEPTH) truncated = true;
  ancestorNodes.reverse(); // root first

  // ── Focus ──────────────────────────────────────────────────────────
  const focusAuthor = await User.findById(focus.authorId)
    .select("fullName profilePicture isPublic kitchenId isBanned")
    .lean();
  const focusViewable = focusAuthor
    ? !focus.isHidden &&
      !focusAuthor.isBanned &&
      (await canViewRecipe(
        viewerOid,
        focus,
        focusAuthor as unknown as IUser
      ))
    : false;

  // ── Descendants (BFS) ──────────────────────────────────────────────
  interface QueueEntry {
    recipeId: Types.ObjectId;
    depth: number;
  }
  const queue: QueueEntry[] = [{ recipeId: focus._id, depth: 0 }];
  const descendants: RemixTreeNode[] = [];
  const descendantNodeMap = new Map<string, RemixTreeNode>();
  let nodeCount = 0;

  // childIds for the focus node collected as we discover forks.
  const focusChildIds: string[] = [];

  while (queue.length > 0 && nodeCount < MAX_DESCENDANT_NODES) {
    const { recipeId: parentRecipeId, depth: parentDepth } = queue.shift()!;
    if (parentDepth + 1 > MAX_DESCENDANT_DEPTH) {
      truncated = true;
      continue;
    }

    const children = await Recipe.find({
      "forkedFrom.recipeId": parentRecipeId,
    })
      .select(
        "title photos authorId createdAt likesCount forksCount isHidden isPrivate forkedFrom"
      )
      .lean<IRecipe[]>();

    if (children.length === 0) continue;

    const authorIds = [
      ...new Set(children.map((c) => c.authorId.toString())),
    ].map((id) => new Types.ObjectId(id));
    const authors = await User.find({ _id: { $in: authorIds } })
      .select("fullName profilePicture isPublic kitchenId isBanned")
      .lean();
    const authorMap = new Map(authors.map((a) => [a._id.toString(), a]));

    for (const child of children) {
      if (nodeCount >= MAX_DESCENDANT_NODES) {
        truncated = true;
        break;
      }
      if (visited.has(child._id.toString())) continue; // already visited (cycle guard)
      visited.add(child._id.toString());

      const childAuthor = authorMap.get(child.authorId.toString());
      const viewable = childAuthor
        ? !child.isHidden &&
          !childAuthor.isBanned &&
          (await canViewRecipe(
            viewerOid,
            child,
            childAuthor as unknown as IUser
          ))
        : false;

      const node = toNode(
        child,
        childAuthor ?? null,
        parentDepth + 1,
        [],
        viewable
      );
      descendants.push(node);
      descendantNodeMap.set(node.recipeId as string, node);
      nodeCount += 1;

      // Append this child to its parent's childIds list.
      const parentIdStr = parentRecipeId.toString();
      if (parentIdStr === focus._id.toString()) {
        focusChildIds.push(node.recipeId as string);
      } else {
        const parentNode = descendantNodeMap.get(parentIdStr);
        if (parentNode) parentNode.childIds.push(node.recipeId as string);
      }

      queue.push({ recipeId: child._id, depth: parentDepth + 1 });
    }
  }

  const focusNode = toNode(
    focus,
    focusAuthor ?? null,
    0,
    focusChildIds,
    focusViewable
  );

  return {
    focusRecipeId: focus._id.toString(),
    ancestors: ancestorNodes,
    focus: focusNode,
    descendants,
    truncated,
  };
}
