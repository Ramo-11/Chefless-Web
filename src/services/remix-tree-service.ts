import { Types } from "mongoose";
import Recipe, { IRecipe } from "../models/Recipe";
import User from "../models/User";
import { buildAccessiblePrivateIds, resolveRecipeVisibility } from "./visibility-service";

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

/**
 * Redacted node for a recipe the viewer is not allowed to open. Preserves the
 * tree shape (depth + child links) but strips every piece of content the
 * viewer has no right to see, and nulls `recipeId` so the client cannot
 * navigate to it.
 */
function viewForRedacted(depth: number, childIds: string[]): RemixTreeNode {
  return {
    recipeId: null,
    title: "Private recipe",
    photoUrl: null,
    authorId: null,
    authorName: "Private chef",
    authorPhoto: null,
    depth,
    isAvailable: true,
    childIds,
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
  // Redact content for nodes the viewer cannot open — keep only the tree shape.
  if (!viewable) {
    return viewForRedacted(depth, childIds);
  }
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
interface RecipeAuthorFields {
  _id: Types.ObjectId;
  fullName: string;
  profilePicture?: string | null;
  isPublic: boolean;
  isBanned?: boolean;
}

export async function getRemixTree(
  focusRecipeId: string,
  viewerId: string
): Promise<RemixTree> {
  const focus = await Recipe.findById(focusRecipeId);
  if (!focus) throw createError("Recipe not found", 404);

  const viewerOid = new Types.ObjectId(viewerId);
  const accessiblePrivateIds = await buildAccessiblePrivateIds(viewerOid);

  interface AncestorEntry {
    depth: number;
    recipe?: IRecipe;
    deletedAuthorName?: string;
  }
  const ancestorEntries: AncestorEntry[] = [];
  let currentFork = focus.forkedFrom;
  let depth = -1;
  let truncated = false;
  const visited = new Set<string>([focus._id.toString()]);

  while (currentFork && depth >= -MAX_ANCESTOR_DEPTH) {
    if (!currentFork.recipeId) {
      ancestorEntries.push({ depth, deletedAuthorName: currentFork.authorName });
      break;
    }
    const parentId = currentFork.recipeId.toString();
    if (visited.has(parentId)) break;
    visited.add(parentId);

    const parent = await Recipe.findById(currentFork.recipeId);
    if (!parent) {
      ancestorEntries.push({ depth, deletedAuthorName: currentFork.authorName });
      break;
    }

    ancestorEntries.push({ depth, recipe: parent });
    currentFork = parent.forkedFrom ?? undefined;
    depth -= 1;
  }
  if (currentFork && depth < -MAX_ANCESTOR_DEPTH) truncated = true;

  const ancestorAuthorIds = ancestorEntries
    .map((entry) => entry.recipe?.authorId)
    .filter((id): id is Types.ObjectId => !!id);
  const earlyAuthorIds = [
    ...new Set(
      [...ancestorAuthorIds, focus.authorId].map((id) => id.toString())
    ),
  ].map((id) => new Types.ObjectId(id));
  const earlyAuthors = await User.find({ _id: { $in: earlyAuthorIds } })
    .select("fullName profilePicture isPublic isBanned")
    .lean<RecipeAuthorFields[]>();
  const earlyAuthorMap = new Map(
    earlyAuthors.map((a) => [a._id.toString(), a])
  );

  const ancestorNodes: RemixTreeNode[] = ancestorEntries.map((entry) => {
    if (entry.deletedAuthorName !== undefined) {
      return viewForDeleted(entry.deletedAuthorName, entry.depth);
    }
    const recipe = entry.recipe!;
    const author = earlyAuthorMap.get(recipe.authorId.toString());
    const viewable = author
      ? !recipe.isHidden &&
        !author.isBanned &&
        resolveRecipeVisibility(viewerOid, recipe, author, accessiblePrivateIds)
      : false;
    return toNode(recipe, author ?? null, entry.depth, [], viewable);
  });
  ancestorNodes.reverse();

  const focusAuthor = earlyAuthorMap.get(focus.authorId.toString()) ?? null;
  const focusViewable = focusAuthor
    ? !focus.isHidden &&
      !focusAuthor.isBanned &&
      resolveRecipeVisibility(viewerOid, focus, focusAuthor, accessiblePrivateIds)
    : false;

  const descendants: RemixTreeNode[] = [];
  const descendantNodeMap = new Map<string, RemixTreeNode>();
  const focusChildIds: string[] = [];
  let nodeCount = 0;
  let capped = false;

  let currentLevelIds: Types.ObjectId[] = [focus._id];
  let currentDepth = 0;

  while (currentLevelIds.length > 0 && !capped) {
    const nextDepth = currentDepth + 1;
    if (nextDepth > MAX_DESCENDANT_DEPTH) {
      truncated = true;
      break;
    }

    const children = await Recipe.find({
      "forkedFrom.recipeId": { $in: currentLevelIds },
    })
      .select(
        "title photos authorId createdAt likesCount forksCount isHidden isPrivate forkedFrom"
      )
      .lean<IRecipe[]>();

    if (children.length === 0) break;

    const byParent = new Map<string, IRecipe[]>();
    for (const child of children) {
      const parentIdStr = child.forkedFrom?.recipeId?.toString();
      if (!parentIdStr) continue;
      const bucket = byParent.get(parentIdStr);
      if (bucket) bucket.push(child);
      else byParent.set(parentIdStr, [child]);
    }

    const orderedChildren: IRecipe[] = [];
    for (const parentId of currentLevelIds) {
      const bucket = byParent.get(parentId.toString());
      if (bucket) orderedChildren.push(...bucket);
    }

    const authorIds = [
      ...new Set(orderedChildren.map((c) => c.authorId.toString())),
    ].map((id) => new Types.ObjectId(id));
    const authors = await User.find({ _id: { $in: authorIds } })
      .select("fullName profilePicture isPublic isBanned")
      .lean<RecipeAuthorFields[]>();
    const authorMap = new Map(authors.map((a) => [a._id.toString(), a]));

    const nextLevelIds: Types.ObjectId[] = [];

    for (const child of orderedChildren) {
      if (nodeCount >= MAX_DESCENDANT_NODES) {
        truncated = true;
        capped = true;
        break;
      }
      const childIdStr = child._id.toString();
      if (visited.has(childIdStr)) continue;
      visited.add(childIdStr);

      const childAuthor = authorMap.get(child.authorId.toString());
      const viewable = childAuthor
        ? !child.isHidden &&
          !childAuthor.isBanned &&
          resolveRecipeVisibility(
            viewerOid,
            child,
            childAuthor,
            accessiblePrivateIds
          )
        : false;

      const node = toNode(child, childAuthor ?? null, nextDepth, [], viewable);
      descendants.push(node);
      descendantNodeMap.set(childIdStr, node);
      nodeCount += 1;

      const parentIdStr = child.forkedFrom!.recipeId!.toString();
      if (parentIdStr === focus._id.toString()) {
        focusChildIds.push(childIdStr);
      } else {
        const parentNode = descendantNodeMap.get(parentIdStr);
        if (parentNode) parentNode.childIds.push(childIdStr);
      }

      nextLevelIds.push(child._id);
    }

    currentLevelIds = nextLevelIds;
    currentDepth = nextDepth;
  }

  const focusNode = toNode(
    focus,
    focusAuthor,
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
