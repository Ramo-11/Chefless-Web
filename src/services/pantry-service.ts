import { PipelineStage, Types } from "mongoose";
import PantryItem from "../models/PantryItem";
import Recipe, { IIngredient } from "../models/Recipe";
import User from "../models/User";
import SavedRecipe from "../models/SavedRecipe";
import Follow from "../models/Follow";
import { getBlockedUserIds } from "./block-service";
import {
  ALWAYS_AVAILABLE_INGREDIENTS,
  PANTRY_STAPLES,
  categorizeIngredient,
  normalizeIngredientName,
} from "../lib/ingredients";

interface ServiceError extends Error {
  statusCode: number;
}

function createError(message: string, statusCode: number): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

const MAX_BULK_ITEMS = 100;
const MAX_MISSING_INGREDIENTS_SHOWN = 8;

export interface PantryItemDTO {
  id: string;
  name: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  category: string;
  createdAt: string;
  updatedAt: string;
}

interface PantryItemLike {
  _id: Types.ObjectId;
  name: string;
  normalizedName: string;
  quantity?: number;
  unit?: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(item: PantryItemLike): PantryItemDTO {
  return {
    id: item._id.toString(),
    name: item.name,
    normalizedName: item.normalizedName,
    quantity: typeof item.quantity === "number" ? item.quantity : null,
    unit: item.unit ?? null,
    category: item.category,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function normalizedUnitOrNull(unit?: string | null): string | null {
  const trimmed = unit?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function sameUnitValue(a?: string | null, b?: string | null): boolean {
  const normalizedA = normalizedUnitOrNull(a);
  const normalizedB = normalizedUnitOrNull(b);
  return normalizedA !== null && normalizedB !== null && normalizedA === normalizedB;
}

function titleCaseStaple(raw: string): string {
  return raw
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitEqualityFilter(unit: string): { $regex: string; $options: string } {
  return { $regex: `^${escapeRegex(unit)}$`, $options: "i" };
}

export async function listPantryItems(
  userId: string
): Promise<{ items: PantryItemDTO[]; total: number }> {
  const items = await PantryItem.find({ userId: new Types.ObjectId(userId) })
    .sort({ category: 1, name: 1 })
    .lean();

  return { items: items.map(toDTO), total: items.length };
}

export interface PantryItemInput {
  name: string;
  quantity?: number;
  unit?: string;
  category?: string;
}

export interface AddPantryItemResult {
  item: PantryItemDTO;
  merged: boolean;
}

export async function addPantryItem(
  userId: string,
  data: PantryItemInput
): Promise<AddPantryItemResult> {
  const userOid = new Types.ObjectId(userId);
  const name = data.name.trim();
  const normalizedName = normalizeIngredientName(name);
  const unit = data.unit?.trim() || undefined;
  const category = data.category?.trim() || categorizeIngredient(name);
  const hasIncomingQuantity = typeof data.quantity === "number";

  if (normalizedUnitOrNull(unit) !== null) {
    const mergeFilter: Record<string, unknown> = {
      userId: userOid,
      normalizedName,
      unit: unitEqualityFilter(unit as string),
    };
    if (!hasIncomingQuantity) {
      mergeFilter.quantity = { $type: "number" };
    }

    const merged = await PantryItem.findOneAndUpdate(
      mergeFilter,
      { $inc: { quantity: data.quantity ?? 0 } },
      { new: true }
    );
    if (merged) {
      return { item: toDTO(merged), merged: true };
    }
  }

  const insertFields: Record<string, unknown> = {
    userId: userOid,
    name,
    normalizedName,
    category,
  };
  if (hasIncomingQuantity) {
    insertFields.quantity = data.quantity;
  }
  if (unit !== undefined) {
    insertFields.unit = unit;
  }

  const result = await PantryItem.findOneAndUpdate(
    { userId: userOid, normalizedName },
    { $setOnInsert: insertFields },
    { upsert: true, new: true, runValidators: true, includeResultMetadata: true }
  );

  if (!result.value) {
    throw createError("Failed to add pantry item", 500);
  }

  const wasExisting =
    (result.lastErrorObject as { updatedExisting?: boolean } | undefined)
      ?.updatedExisting === true;

  return { item: toDTO(result.value), merged: wasExisting };
}

export interface BulkPantryResult {
  items: PantryItemDTO[];
  added: number;
  merged: number;
}

export async function addPantryItemsBulk(
  userId: string,
  items: PantryItemInput[]
): Promise<BulkPantryResult> {
  if (items.length === 0) {
    return { items: [], added: 0, merged: 0 };
  }
  if (items.length > MAX_BULK_ITEMS) {
    throw createError(
      `You can add at most ${MAX_BULK_ITEMS} pantry items at once.`,
      400
    );
  }

  const userOid = new Types.ObjectId(userId);

  interface Draft {
    name: string;
    normalizedName: string;
    quantity?: number;
    unit?: string;
    category: string;
  }

  const drafts = new Map<string, Draft>();

  for (const raw of items) {
    const name = raw.name.trim();
    const normalizedName = normalizeIngredientName(name);
    const unit = raw.unit?.trim() || undefined;
    const category = raw.category?.trim() || categorizeIngredient(name);

    const existingDraft = drafts.get(normalizedName);
    if (!existingDraft) {
      drafts.set(normalizedName, {
        name,
        normalizedName,
        quantity: raw.quantity,
        unit,
        category,
      });
      continue;
    }

    if (
      sameUnitValue(existingDraft.unit, unit) &&
      (typeof raw.quantity === "number" || typeof existingDraft.quantity === "number")
    ) {
      existingDraft.quantity = (existingDraft.quantity ?? 0) + (raw.quantity ?? 0);
    }
  }

  const draftList = Array.from(drafts.values());

  for (const draft of draftList) {
    const insertFields: Record<string, unknown> = {
      userId: userOid,
      name: draft.name,
      normalizedName: draft.normalizedName,
      category: draft.category,
    };
    if (typeof draft.quantity === "number") {
      insertFields.quantity = draft.quantity;
    }
    if (draft.unit !== undefined) {
      insertFields.unit = draft.unit;
    }
    const validationError = new PantryItem(insertFields).validateSync();
    if (validationError) {
      throw createError(validationError.message, 400);
    }
  }

  const unitMatchOps = draftList
    .filter((draft) => normalizedUnitOrNull(draft.unit) !== null)
    .map((draft) => {
      const filter: Record<string, unknown> = {
        userId: userOid,
        normalizedName: draft.normalizedName,
        unit: unitEqualityFilter(draft.unit as string),
      };
      if (typeof draft.quantity !== "number") {
        filter.quantity = { $type: "number" };
      }
      return {
        updateOne: {
          filter,
          update: { $inc: { quantity: draft.quantity ?? 0 } },
        },
      };
    });

  if (unitMatchOps.length > 0) {
    await PantryItem.bulkWrite(unitMatchOps, { ordered: false });
  }

  const upsertOps = draftList.map((draft) => {
    const insertFields: Record<string, unknown> = {
      userId: userOid,
      name: draft.name,
      normalizedName: draft.normalizedName,
      category: draft.category,
    };
    if (typeof draft.quantity === "number") {
      insertFields.quantity = draft.quantity;
    }
    if (draft.unit !== undefined) {
      insertFields.unit = draft.unit;
    }
    return {
      updateOne: {
        filter: { userId: userOid, normalizedName: draft.normalizedName },
        update: { $setOnInsert: insertFields },
        upsert: true,
      },
    };
  });

  const upsertResult = await PantryItem.bulkWrite(upsertOps, { ordered: false });

  const addedIndexes = new Set(
    Object.keys(upsertResult.upsertedIds ?? {}).map((index) => Number(index))
  );

  const finalDocs = await PantryItem.find({
    userId: userOid,
    normalizedName: { $in: draftList.map((draft) => draft.normalizedName) },
  }).lean();
  const docsByName = new Map(finalDocs.map((doc) => [doc.normalizedName, doc]));

  let added = 0;
  let merged = 0;
  const resultItems: PantryItemDTO[] = [];

  draftList.forEach((draft, index) => {
    const doc = docsByName.get(draft.normalizedName);
    if (!doc) return;
    resultItems.push(toDTO(doc));
    if (addedIndexes.has(index)) {
      added++;
    } else {
      merged++;
    }
  });

  return { items: resultItems, added, merged };
}

export interface UpdatePantryItemInput {
  name?: string;
  quantity?: number;
  unit?: string;
  category?: string;
}

export async function updatePantryItem(
  userId: string,
  itemId: string,
  updates: UpdatePantryItemInput
): Promise<{ item: PantryItemDTO }> {
  const userOid = new Types.ObjectId(userId);
  const item = await PantryItem.findOne({ _id: itemId, userId: userOid });
  if (!item) {
    throw createError("Pantry item not found", 404);
  }

  const nextName = updates.name !== undefined ? updates.name.trim() : item.name;
  const nextNormalizedName =
    updates.name !== undefined ? normalizeIngredientName(nextName) : item.normalizedName;
  const nextUnit =
    updates.unit !== undefined ? updates.unit.trim() || undefined : item.unit;
  const nextQuantity = updates.quantity !== undefined ? updates.quantity : item.quantity;
  const nextCategory =
    updates.category !== undefined ? updates.category.trim() : item.category;

  if (nextNormalizedName !== item.normalizedName) {
    const collision = await PantryItem.findOne({
      userId: userOid,
      normalizedName: nextNormalizedName,
      _id: { $ne: item._id },
    });

    if (collision) {
      if (
        sameUnitValue(collision.unit, nextUnit) &&
        (typeof nextQuantity === "number" || typeof collision.quantity === "number")
      ) {
        collision.quantity = (collision.quantity ?? 0) + (nextQuantity ?? 0);
        await collision.save();
      }
      await PantryItem.deleteOne({ _id: item._id });
      return { item: toDTO(collision) };
    }
  }

  item.name = nextName;
  item.normalizedName = nextNormalizedName;
  item.unit = nextUnit;
  item.quantity = nextQuantity;
  item.category = nextCategory;
  await item.save();

  return { item: toDTO(item) };
}

export async function deletePantryItem(userId: string, itemId: string): Promise<void> {
  const result = await PantryItem.deleteOne({
    _id: itemId,
    userId: new Types.ObjectId(userId),
  });
  if (result.deletedCount === 0) {
    throw createError("Pantry item not found", 404);
  }
}

export async function clearPantry(userId: string): Promise<number> {
  const result = await PantryItem.deleteMany({ userId: new Types.ObjectId(userId) });
  return result.deletedCount ?? 0;
}

export interface StaplesResult {
  items: PantryItemDTO[];
  added: number;
}

export async function addStaples(userId: string): Promise<StaplesResult> {
  const userOid = new Types.ObjectId(userId);
  const normalizedStaples = PANTRY_STAPLES.map((staple) => normalizeIngredientName(staple));

  const existing = await PantryItem.find({
    userId: userOid,
    normalizedName: { $in: normalizedStaples },
  }).lean();
  const existingSet = new Set(existing.map((item) => item.normalizedName));

  const toCreate = PANTRY_STAPLES.filter(
    (staple) => !existingSet.has(normalizeIngredientName(staple))
  );

  if (toCreate.length > 0) {
    await PantryItem.insertMany(
      toCreate.map((staple) => ({
        userId: userOid,
        name: titleCaseStaple(staple),
        normalizedName: normalizeIngredientName(staple),
        category: categorizeIngredient(staple),
      })),
      { ordered: false }
    );
  }

  const finalItems = await PantryItem.find({
    userId: userOid,
    normalizedName: { $in: normalizedStaples },
  }).lean();

  return { items: finalItems.map(toDTO), added: toCreate.length };
}

export interface PantryMatchAuthor {
  id: string;
  fullName: string;
  profilePicture: string | null;
}

export interface PantryMatchRecipe {
  id: string;
  title: string;
  photos: string[];
  author: PantryMatchAuthor;
  cuisineTags: string[];
  dietaryTags: string[];
  difficulty: string | null;
  totalTime: number | null;
  servings: number | null;
  likesCount: number;
  avgRating: number;
  ratingCount: number;
}

export interface PantryMatch {
  recipe: PantryMatchRecipe;
  haveCount: number;
  totalCount: number;
  matchPercent: number;
  missingCount: number;
  missingIngredients: string[];
}

export interface PantryMatchesResult {
  matches: PantryMatch[];
  nextCursor: string | null;
  total: number;
}

export interface PantryMatchesOptions {
  scope: "mine" | "all";
  maxMissing: number;
  cursor?: string;
  limit: number;
}

interface MatchPageDoc {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  title: string;
  photos: string[];
  cuisineTags: string[];
  dietaryTags: string[];
  difficulty?: string;
  totalTime?: number;
  servings?: number;
  likesCount: number;
  avgRating: number;
  ratingCount: number;
  ingredients: IIngredient[];
}

interface CursorAnchor {
  missingCount: number;
  matchPercent: number;
  likesCount: number;
  _id: Types.ObjectId;
}

const MATCH_RANK_SORT: Record<string, 1 | -1> = {
  missingCount: 1,
  matchPercent: -1,
  likesCount: -1,
  _id: 1,
};

function matchPercentExpr(haveExpr: unknown, totalExpr: unknown) {
  return {
    $floor: {
      $add: [
        { $multiply: [{ $divide: [haveExpr, totalExpr] }, 100] },
        0.5,
      ],
    },
  };
}

function buildBaseAndConditions(
  userOid: Types.ObjectId,
  scope: "mine" | "all",
  savedRecipeIds: Types.ObjectId[],
  blockedIds: Types.ObjectId[]
): Record<string, unknown>[] {
  const membershipOr =
    scope === "mine"
      ? [
          { authorId: userOid },
          { _id: { $in: savedRecipeIds }, isPrivate: { $ne: true } },
        ]
      : [{ authorId: userOid }, { isPrivate: { $ne: true } }];

  return [
    { $or: membershipOr },
    { isHidden: { $ne: true } },
    { authorId: { $nin: blockedIds } },
    { "normalizedIngredients.0": { $exists: true } },
  ];
}

async function resolveCursorAnchor(
  cursor: string,
  baseAndConditions: Record<string, unknown>[],
  pantrySet: Set<string>
): Promise<CursorAnchor | null> {
  if (!Types.ObjectId.isValid(cursor)) return null;
  const cursorOid = new Types.ObjectId(cursor);

  const [anchor] = await Recipe.aggregate([
    { $match: { $and: [{ _id: cursorOid }, ...baseAndConditions] } },
    { $project: { normalizedIngredients: 1, likesCount: 1 } },
    { $limit: 1 },
  ]);

  if (!anchor) return null;

  const normalizedIngredients: string[] = anchor.normalizedIngredients ?? [];
  const totalCount = normalizedIngredients.length;
  if (totalCount === 0) return null;

  const missingCount = normalizedIngredients.filter(
    (name) => !pantrySet.has(name)
  ).length;
  const haveCount = totalCount - missingCount;
  const matchPercent = Math.floor((haveCount / totalCount) * 100 + 0.5);

  return {
    missingCount,
    matchPercent,
    likesCount: anchor.likesCount ?? 0,
    _id: anchor._id,
  };
}

function cursorSeekMatch(anchor: CursorAnchor): Record<string, unknown> {
  return {
    $or: [
      { missingCount: { $gt: anchor.missingCount } },
      {
        missingCount: anchor.missingCount,
        matchPercent: { $lt: anchor.matchPercent },
      },
      {
        missingCount: anchor.missingCount,
        matchPercent: anchor.matchPercent,
        likesCount: { $lt: anchor.likesCount },
      },
      {
        missingCount: anchor.missingCount,
        matchPercent: anchor.matchPercent,
        likesCount: anchor.likesCount,
        _id: { $gt: anchor._id },
      },
    ],
  };
}

export async function getPantryMatches(
  userId: string,
  options: PantryMatchesOptions
): Promise<PantryMatchesResult> {
  const userOid = new Types.ObjectId(userId);

  const pantryItems = await PantryItem.find({ userId: userOid })
    .select("normalizedName")
    .lean();

  if (pantryItems.length === 0) {
    return { matches: [], nextCursor: null, total: 0 };
  }

  const pantrySet = new Set<string>(pantryItems.map((item) => item.normalizedName));
  for (const alwaysAvailable of ALWAYS_AVAILABLE_INGREDIENTS) {
    pantrySet.add(alwaysAvailable);
  }
  const pantryArray = Array.from(pantrySet);

  const [savedRecipeIds, blockedIds] = await Promise.all([
    SavedRecipe.find({ userId: userOid }).distinct("recipeId"),
    getBlockedUserIds(userId),
  ]);

  const baseAndConditions = buildBaseAndConditions(
    userOid,
    options.scope,
    savedRecipeIds,
    blockedIds
  );

  let cursorAnchor: CursorAnchor | null = null;
  if (options.cursor) {
    cursorAnchor = await resolveCursorAnchor(
      options.cursor,
      baseAndConditions,
      pantrySet
    );
    if (!cursorAnchor) {
      throw createError("Invalid cursor", 400);
    }
  }

  const rankingStages: PipelineStage[] = [
    { $match: { $and: baseAndConditions } },
    {
      $addFields: {
        totalCount: { $size: "$normalizedIngredients" },
        missingCount: {
          $size: { $setDifference: ["$normalizedIngredients", pantryArray] },
        },
      },
    },
    {
      $addFields: {
        matchPercent: matchPercentExpr(
          { $subtract: ["$totalCount", "$missingCount"] },
          "$totalCount"
        ),
      },
    },
    { $match: { missingCount: { $lte: options.maxMissing } } },
  ];

  const pagePipeline: PipelineStage.FacetPipelineStage[] = [
    ...(cursorAnchor
      ? [{ $match: cursorSeekMatch(cursorAnchor) } as PipelineStage.FacetPipelineStage]
      : []),
    { $sort: MATCH_RANK_SORT },
    { $limit: options.limit + 1 },
    {
      $project: {
        authorId: 1,
        title: 1,
        photos: 1,
        cuisineTags: 1,
        dietaryTags: 1,
        difficulty: 1,
        totalTime: 1,
        servings: 1,
        likesCount: 1,
        avgRating: 1,
        ratingCount: 1,
        ingredients: 1,
      },
    },
  ];

  const [{ total: totalFacet, page: pageDocsRaw }] = (await Recipe.aggregate([
    ...rankingStages,
    {
      $facet: {
        total: [{ $count: "count" }],
        page: pagePipeline,
      },
    },
  ])) as [{ total: Array<{ count: number }>; page: MatchPageDoc[] }];

  const total = totalFacet[0]?.count ?? 0;

  if (pageDocsRaw.length === 0) {
    return { matches: [], nextCursor: null, total };
  }

  const hasMore = pageDocsRaw.length > options.limit;
  const pageDocs = pageDocsRaw.slice(0, options.limit);
  const nextCursor = hasMore ? pageDocs[pageDocs.length - 1]._id.toString() : null;

  const nonOwnAuthorIds = new Set<string>();
  for (const doc of pageDocs) {
    if (!doc.authorId.equals(userOid)) {
      nonOwnAuthorIds.add(doc.authorId.toString());
    }
  }

  const authorLookupIds = [userId, ...nonOwnAuthorIds].map(
    (id) => new Types.ObjectId(id)
  );
  const authors = await User.find({ _id: { $in: authorLookupIds } })
    .select("fullName profilePicture isPublic isBanned kitchenId")
    .lean();
  const authorMap = new Map(authors.map((author) => [author._id.toString(), author]));

  const viewer = authorMap.get(userId);
  const viewerKitchenId = viewer?.kitchenId ?? null;

  const privateAuthorIds = Array.from(nonOwnAuthorIds).filter((id) => {
    const author = authorMap.get(id);
    return author && !author.isPublic;
  });

  const followingSet = new Set<string>();
  if (privateAuthorIds.length > 0) {
    const activeFollows = await Follow.find({
      followerId: userOid,
      followingId: { $in: privateAuthorIds.map((id) => new Types.ObjectId(id)) },
      status: "active",
    })
      .select("followingId")
      .lean();
    for (const follow of activeFollows) {
      followingSet.add(follow.followingId.toString());
    }
  }

  function isVisible(doc: MatchPageDoc): boolean {
    if (doc.authorId.equals(userOid)) return true;

    const author = authorMap.get(doc.authorId.toString());
    if (!author) return false;
    if (author.isBanned) return false;
    if (author.isPublic) return true;
    if (followingSet.has(doc.authorId.toString())) return true;
    if (
      viewerKitchenId &&
      author.kitchenId &&
      viewerKitchenId.equals(author.kitchenId)
    ) {
      return true;
    }
    return false;
  }

  const matches: PantryMatch[] = [];

  for (const doc of pageDocs) {
    if (!isVisible(doc)) continue;

    let haveCount = 0;
    const missingIngredients: string[] = [];
    for (const ingredient of doc.ingredients) {
      const normalized = normalizeIngredientName(ingredient.name);
      if (pantrySet.has(normalized)) {
        haveCount++;
      } else {
        missingIngredients.push(ingredient.name.trim());
      }
    }

    const totalCount = doc.ingredients.length;
    const missingCount = totalCount - haveCount;
    const matchPercent = Math.round((haveCount / totalCount) * 100);

    const author = authorMap.get(doc.authorId.toString());
    const authorDTO: PantryMatchAuthor = {
      id: doc.authorId.toString(),
      fullName: author?.fullName ?? "",
      profilePicture: author?.profilePicture ?? null,
    };

    matches.push({
      recipe: {
        id: doc._id.toString(),
        title: doc.title,
        photos: doc.photos ?? [],
        author: authorDTO,
        cuisineTags: doc.cuisineTags ?? [],
        dietaryTags: doc.dietaryTags ?? [],
        difficulty: doc.difficulty ?? null,
        totalTime: doc.totalTime ?? null,
        servings: doc.servings ?? null,
        likesCount: doc.likesCount ?? 0,
        avgRating: doc.avgRating ?? 0,
        ratingCount: doc.ratingCount ?? 0,
      },
      haveCount,
      totalCount,
      matchPercent,
      missingCount,
      missingIngredients: missingIngredients.slice(0, MAX_MISSING_INGREDIENTS_SHOWN),
    });
  }

  return { matches, nextCursor, total };
}
