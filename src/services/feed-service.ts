import { Document, Types, PipelineStage } from "mongoose";
import Recipe, { IRecipe } from "../models/Recipe";
import User, { IUser } from "../models/User";
import Follow from "../models/Follow";
import Like from "../models/Like";
import SavedRecipe from "../models/SavedRecipe";
import SeasonalTag from "../models/SeasonalTag";
import { getBlockedUserIds } from "./block-service";
import { buildAccessiblePrivateIds } from "./visibility-service";

// ── Types ──────────────────────────────────────────────────────────────────────

interface FeedRecipe {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  title: string;
  description?: string;
  photos: string[];
  showSignature: boolean;
  labels: string[];
  dietaryTags: string[];
  cuisineTags: string[];
  difficulty?: string;
  ingredients: IRecipe["ingredients"];
  steps: IRecipe["steps"];
  prepTime?: number;
  cookTime?: number;
  totalTime?: number;
  servings?: number;
  calories?: number;
  costEstimate?: string;
  baseServings: number;
  forkedFrom?: IRecipe["forkedFrom"];
  isModifiedFork: boolean;
  isPrivate: boolean;
  likesCount: number;
  forksCount: number;
  commentsCount: number;
  createdAt: Date;
  updatedAt: Date;
  authorName: string;
  authorPhoto?: string;
  isLiked: boolean;
  isSaved: boolean;
}

interface PaginatedFeed {
  recipes: FeedRecipe[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export const FEED_POOL_SIZE = 2000;

export const TRENDING_HALF_LIFE_DAYS = 14;
export const TRENDING_DECAY_RATE = Math.LN2 / TRENDING_HALF_LIFE_DAYS;

const TRENDING_SCORE_STALE_MS = 4 * 24 * 60 * 60 * 1000;

function dedupeIds(
  docs: Array<{ _id: Types.ObjectId }>,
  limit: number
): Types.ObjectId[] {
  const seen = new Set<string>();
  const ids: Types.ObjectId[] = [];
  for (const doc of docs) {
    if (ids.length >= limit) break;
    const key = doc._id.toString();
    if (!seen.has(key)) {
      seen.add(key);
      ids.push(doc._id);
    }
  }
  return ids;
}

async function getRecencyPopularityPoolIds(
  baseMatch: Record<string, unknown>
): Promise<Types.ObjectId[]> {
  const [recent, popular] = await Promise.all([
    Recipe.find(baseMatch)
      .select("_id")
      .sort({ createdAt: -1 })
      .limit(FEED_POOL_SIZE)
      .lean(),
    Recipe.find(baseMatch)
      .select("_id")
      .sort({ likesCount: -1 })
      .limit(FEED_POOL_SIZE)
      .lean(),
  ]);
  return dedupeIds([...recent, ...popular], FEED_POOL_SIZE);
}

async function getForYouCandidateIds(
  baseMatch: Record<string, unknown>,
  userDietary: string[],
  userCuisine: string[]
): Promise<Types.ObjectId[]> {
  if (userDietary.length === 0 && userCuisine.length === 0) {
    return getRecencyPopularityPoolIds(baseMatch);
  }

  const preferenceMatch: Record<string, unknown> = {
    ...baseMatch,
    $or: [
      ...(userDietary.length > 0 ? [{ dietaryTags: { $in: userDietary } }] : []),
      ...(userCuisine.length > 0 ? [{ cuisineTags: { $in: userCuisine } }] : []),
    ],
  };

  const docs = await Recipe.find(preferenceMatch)
    .select("_id")
    .sort({ createdAt: -1 })
    .limit(FEED_POOL_SIZE)
    .lean();
  return docs.map((d) => d._id);
}

async function getTrendingCandidateIds(
  baseMatch: Record<string, unknown>
): Promise<{ ids: Types.ObjectId[]; materialized: boolean }> {
  const freshest = await Recipe.findOne({ trendingScore: { $gt: 0 } })
    .select("trendingScoreUpdatedAt")
    .sort({ trendingScore: -1 })
    .lean();

  const isStale =
    !freshest?.trendingScoreUpdatedAt ||
    Date.now() - freshest.trendingScoreUpdatedAt.getTime() > TRENDING_SCORE_STALE_MS;

  if (!freshest || isStale) {
    return { ids: await getRecencyPopularityPoolIds(baseMatch), materialized: false };
  }

  const docs = await Recipe.find(baseMatch)
    .select("_id")
    .sort({ trendingScore: -1 })
    .limit(FEED_POOL_SIZE)
    .lean();
  return { ids: docs.map((d) => d._id), materialized: true };
}

async function getSeasonalCandidateIds(
  baseMatch: Record<string, unknown>,
  activeSlugs: string[]
): Promise<Types.ObjectId[]> {
  if (activeSlugs.length === 0) {
    return getRecencyPopularityPoolIds(baseMatch);
  }

  const docs = await Recipe.find({
    ...baseMatch,
    seasonalTags: { $in: activeSlugs },
  })
    .select("_id")
    .sort({ likesCount: -1, createdAt: -1 })
    .limit(FEED_POOL_SIZE)
    .lean();
  return docs.map((d) => d._id);
}

function splitHasMore<T>(docs: T[], limit: number): { page: T[]; hasMore: boolean } {
  if (docs.length > limit) {
    return { page: docs.slice(0, limit), hasMore: true };
  }
  return { page: docs, hasMore: false };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns IDs of users the viewer actively follows.
 * Filters on `status: "active"` so pending follow requests on private accounts
 * do NOT count — a pending requester is not yet a follower.
 */
async function getFollowingIds(
  userId: Types.ObjectId
): Promise<Types.ObjectId[]> {
  const follows = await Follow.find({
    followerId: userId,
    status: "active",
  })
    .select("followingId")
    .lean();
  return follows.map((f) => f.followingId);
}

/**
 * Returns the bidirectional block exclusion set for the viewer. The
 * block-service's `getBlockedUserIds` is already bidirectional, so a single
 * call yields both "users I blocked" and "users who blocked me".
 */
async function getBlockExclusionIds(
  viewerId: Types.ObjectId
): Promise<Types.ObjectId[]> {
  return getBlockedUserIds(viewerId.toString());
}

/**
 * Returns aggregation pipeline stages that filter recipes to only those
 * visible to the viewer, using $lookup to check author.isPublic instead
 * of loading all public user IDs into memory.
 */
function buildVisibilityPipelineStages(
  userId: Types.ObjectId,
  accessiblePrivateIds: Types.ObjectId[]
): Record<string, unknown>[] {
  return [
    {
      $lookup: {
        from: "users",
        localField: "authorId",
        foreignField: "_id",
        as: "_author",
        pipeline: [{ $project: { isPublic: 1, isBanned: 1 } }],
      },
    },
    { $unwind: "$_author" },
    {
      $match: {
        "_author.isBanned": { $ne: true },
        $or: [
          { "_author.isPublic": true },
          ...(accessiblePrivateIds.length > 0
            ? [{ authorId: { $in: accessiblePrivateIds } }]
            : []),
        ],
      },
    },
    { $project: { _author: 0 } },
  ];
}

/** Lean recipe shape returned by Mongoose `.lean()`. */
type LeanRecipe = Omit<IRecipe, keyof Document> & { _id: Types.ObjectId };

/**
 * Enriches lean recipe documents with author info and isLiked status.
 */
async function enrichRecipes(
  recipes: LeanRecipe[],
  userId: Types.ObjectId
): Promise<FeedRecipe[]> {
  if (recipes.length === 0) return [];

  // Fetch authors
  const authorIds = [...new Set(recipes.map((r) => r.authorId.toString()))];
  const authors = await User.find({ _id: { $in: authorIds } })
    .select("fullName profilePicture")
    .lean();
  const authorMap = new Map(
    authors.map((a) => [a._id.toString(), a])
  );

  // Fetch user's likes + saves for these recipes in parallel
  const recipeIds = recipes.map((r) => r._id);
  const [likes, saves] = await Promise.all([
    Like.find({
      userId,
      recipeId: { $in: recipeIds },
    })
      .select("recipeId")
      .lean(),
    SavedRecipe.find({
      userId,
      recipeId: { $in: recipeIds },
    })
      .select("recipeId")
      .lean(),
  ]);
  const likedSet = new Set(likes.map((l) => l.recipeId.toString()));
  const savedSet = new Set(saves.map((s) => s.recipeId.toString()));

  return recipes.map((recipe) => {
    const author = authorMap.get(recipe.authorId.toString());
    const id = recipe._id.toString();
    return {
      _id: recipe._id,
      authorId: recipe.authorId,
      title: recipe.title,
      description: recipe.description,
      photos: recipe.photos,
      showSignature: recipe.showSignature,
      labels: recipe.labels,
      dietaryTags: recipe.dietaryTags,
      cuisineTags: recipe.cuisineTags,
      difficulty: recipe.difficulty,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      totalTime: recipe.totalTime,
      servings: recipe.servings,
      calories: recipe.calories,
      costEstimate: recipe.costEstimate,
      baseServings: recipe.baseServings,
      forkedFrom: recipe.forkedFrom,
      isModifiedFork: recipe.isModifiedFork,
      isPrivate: recipe.isPrivate,
      likesCount: recipe.likesCount,
      forksCount: recipe.forksCount,
      commentsCount: recipe.commentsCount ?? 0,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      authorName: author?.fullName ?? "Unknown",
      authorPhoto: author?.profilePicture,
      isLiked: likedSet.has(id),
      isSaved: savedSet.has(id),
    };
  });
}

/**
 * Returns the globally featured recipe enriched for the viewer, or null if
 * there is no active feature, if the feature is authored by the viewer, or if
 * the viewer cannot see the author (banned, or private account the viewer
 * does not follow / share a kitchen with).
 */
async function getFeaturedRecipeForViewer(
  userId: Types.ObjectId,
  accessiblePrivateIds: Types.ObjectId[],
  blockExclusionIds: Types.ObjectId[] = []
): Promise<FeedRecipe | null> {
  const featured = await Recipe.findOne({
    isFeatured: true,
    isHidden: { $ne: true },
    isPrivate: false,
  })
    .sort({ featuredAt: -1 })
    .lean<LeanRecipe | null>();

  if (!featured) return null;

  // Feeds always exclude the viewer's own recipes — keep parity here.
  if (featured.authorId.equals(userId)) return null;

  // Exclude any recipe whose author is on either side of a block.
  if (blockExclusionIds.some((id) => id.equals(featured.authorId))) {
    return null;
  }

  const author = await User.findById(featured.authorId)
    .select("isPublic isBanned")
    .lean<Pick<IUser, "isPublic" | "isBanned"> | null>();

  if (!author || author.isBanned) return null;

  const authorIsPublic = author.isPublic === true;
  const viewerHasAccess = accessiblePrivateIds.some((id) =>
    id.equals(featured.authorId)
  );
  if (!authorIsPublic && !viewerHasAccess) return null;

  const [enriched] = await enrichRecipes([featured], userId);
  return enriched ?? null;
}

/**
 * Prepends the featured recipe to a page-1 result set, deduplicating it from
 * the algorithmic result if it was already included. Adjusts `total` only
 * when the featured recipe was NOT already in the base list.
 */
function applyFeaturedToPage(
  recipes: FeedRecipe[],
  total: number,
  featured: FeedRecipe | null,
  page: number
): { recipes: FeedRecipe[]; total: number } {
  if (!featured || page !== 1) {
    return { recipes, total };
  }
  const featuredId = featured._id.toString();
  const existedInBase = recipes.some((r) => r._id.toString() === featuredId);
  const deduped = existedInBase
    ? recipes.filter((r) => r._id.toString() !== featuredId)
    : recipes;
  return {
    recipes: [featured, ...deduped],
    total: existedInBase ? total : total + 1,
  };
}

// ── Feed Algorithms ────────────────────────────────────────────────────────────

/**
 * Algorithmic "For You" feed.
 *
 * Scoring is performed in MongoDB aggregation to avoid loading large candidate
 * sets into memory. The score uses:
 * - recency (0.25): newer recipes score higher
 * - engagement (0.25): normalized likes + weighted forks
 * - relevance (0.30): dietary/cuisine/label match + followed-by-following
 * - premium boost (0.10): small bonus for premium authors
 * - diversity constant (0.10): simplified constant (stateful windowing not
 *   feasible in aggregation)
 */
export async function forYouFeed(
  userId: Types.ObjectId,
  page: number,
  limit: number
): Promise<PaginatedFeed> {
  // Load block exclusion set once at the top — same set is applied to the
  // base match AND the featured-recipe lookup.
  const blockExclusionIds = await getBlockExclusionIds(userId);
  const accessiblePrivateIds = await buildAccessiblePrivateIds(userId);
  const featuredPromise = getFeaturedRecipeForViewer(
    userId,
    accessiblePrivateIds,
    blockExclusionIds
  );

  // Fetch user preferences
  const currentUser = await User.findById(userId)
    .select("dietaryPreferences cuisinePreferences")
    .lean();
  const userDietary: string[] = currentUser?.dietaryPreferences ?? [];
  const userCuisine: string[] = currentUser?.cuisinePreferences ?? [];

  // Fetch who the user follows, and who *they* follow (2nd-degree)
  const followingIds = await getFollowingIds(userId);
  let followedByFollowingIds: Types.ObjectId[] = [];
  if (followingIds.length > 0) {
    const secondDegree = await Follow.find({
      followerId: { $in: followingIds },
      status: "active",
    })
      .select("followingId")
      .lean();
    followedByFollowingIds = secondDegree.map((f) => f.followingId);
  }

  const skip = (page - 1) * limit;

  // No hard recency cutoff: the whole visible catalog is eligible. Recency
  // still shapes ranking via `_recencyScore` below, but never hides a recipe.
  const baseMatch: Record<string, unknown> = {
    isPrivate: false,
    isHidden: { $ne: true },
    authorId:
      blockExclusionIds.length > 0
        ? { $ne: userId, $nin: blockExclusionIds }
        : { $ne: userId },
  };

  const candidateIds = await getForYouCandidateIds(
    baseMatch,
    userDietary,
    userCuisine
  );
  const poolMatch = { _id: { $in: candidateIds } };

  // First pass: get maxEngagement for normalization
  const maxResult = await Recipe.aggregate([
    { $match: poolMatch },
    ...buildVisibilityPipelineStages(userId, accessiblePrivateIds),
    {
      $group: {
        _id: null,
        max: {
          $max: { $add: ["$likesCount", { $multiply: ["$forksCount", 3] }] },
        },
      },
    },
  ] as unknown[] as PipelineStage[]).allowDiskUse(true);
  const maxEngagement = Math.max(1, (maxResult[0]?.max as number) ?? 0);

  // Second pass: score in aggregation and paginate
  const nowMs = Date.now();

  const pipeline = [
    { $match: poolMatch },
    ...buildVisibilityPipelineStages(userId, accessiblePrivateIds),
    // Join author for premium status
    {
      $lookup: {
        from: "users",
        localField: "authorId",
        foreignField: "_id",
        as: "_authorFull",
        pipeline: [{ $project: { isPremium: 1 } }],
      },
    },
    { $unwind: { path: "$_authorFull", preserveNullAndEmptyArrays: false } },
    // Compute scoring components
    {
      $addFields: {
        _daysSince: {
          $divide: [
            { $subtract: [new Date(nowMs), "$createdAt"] },
            1000 * 60 * 60 * 24,
          ],
        },
        _rawEngagement: {
          $add: ["$likesCount", { $multiply: ["$forksCount", 3] }],
        },
      },
    },
    {
      $addFields: {
        _recencyScore: {
          $max: [0, { $subtract: [1, { $divide: ["$_daysSince", 30] }] }],
        },
        _engagementScore: { $divide: ["$_rawEngagement", maxEngagement] },
        _relevanceScore: {
          $add: [
            // 0.3 if any dietaryTag matches user preferences
            {
              $cond: [
                userDietary.length > 0
                  ? {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: "$dietaryTags",
                              as: "t",
                              cond: { $in: ["$$t", userDietary] },
                            },
                          },
                        },
                        0,
                      ],
                    }
                  : false,
                0.3,
                0,
              ],
            },
            // 0.3 if any cuisineTag matches
            {
              $cond: [
                userCuisine.length > 0
                  ? {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: "$cuisineTags",
                              as: "t",
                              cond: { $in: ["$$t", userCuisine] },
                            },
                          },
                        },
                        0,
                      ],
                    }
                  : false,
                0.3,
                0,
              ],
            },
            // 0.2 if followed-by-following
            {
              $cond: [
                followedByFollowingIds.length > 0
                  ? { $in: ["$authorId", followedByFollowingIds] }
                  : false,
                0.2,
                0,
              ],
            },
            // 0.2 if any label matches dietary or cuisine prefs
            {
              $cond: [
                userDietary.length > 0 || userCuisine.length > 0
                  ? {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: "$labels",
                              as: "l",
                              cond: {
                                $or: [
                                  ...(userDietary.length > 0
                                    ? [{ $in: ["$$l", userDietary] }]
                                    : []),
                                  ...(userCuisine.length > 0
                                    ? [{ $in: ["$$l", userCuisine] }]
                                    : []),
                                ],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    }
                  : false,
                0.2,
                0,
              ],
            },
          ],
        },
        _premiumBoost: { $cond: ["$_authorFull.isPremium", 0.1, 0] },
      },
    },
    {
      $addFields: {
        _score: {
          $add: [
            { $multiply: ["$_recencyScore", 0.25] },
            { $multiply: ["$_engagementScore", 0.25] },
            { $multiply: ["$_relevanceScore", 0.3] },
            0.1, // diversity constant (simplified)
            { $multiply: ["$_premiumBoost", 0.1] },
          ],
        },
      },
    },
    // Real (non-seed) recipes rank ahead of seed recipes, then by score.
    // `isSeed` sorts ascending: missing/false (real) before true (seed).
    { $sort: { isSeed: 1, _score: -1 } },
    {
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limit + 1 },
          {
            $project: {
              _daysSince: 0,
              _rawEngagement: 0,
              _recencyScore: 0,
              _engagementScore: 0,
              _relevanceScore: 0,
              _premiumBoost: 0,
              _score: 0,
              _authorFull: 0,
            },
          },
        ],
        count: [{ $limit: 1000 }, { $count: "n" }],
      },
    },
  ];

  const [[result], featured] = await Promise.all([
    Recipe.aggregate(pipeline as unknown as PipelineStage[]).allowDiskUse(true),
    featuredPromise,
  ]);
  const rawData = (result?.data ?? []) as LeanRecipe[];
  const { page: recipes, hasMore: hasMoreRaw } = splitHasMore(rawData, limit);
  const baseTotal = (result?.count[0]?.n ?? 0) as number;

  const enrichedBase = await enrichRecipes(recipes, userId);
  const { recipes: finalRecipes, total } = applyFeaturedToPage(
    enrichedBase,
    baseTotal,
    featured,
    page
  );

  return {
    recipes: finalRecipes,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: hasMoreRaw,
  };
}

/**
 * Trending feed — most-engaged recipes from the last 7 days.
 * Uses aggregation with $lookup to avoid loading all public user IDs.
 */
export async function trendingFeed(
  userId: Types.ObjectId,
  page: number,
  limit: number
): Promise<PaginatedFeed> {
  const blockExclusionIds = await getBlockExclusionIds(userId);
  const accessiblePrivateIds = await buildAccessiblePrivateIds(userId);
  const skip = (page - 1) * limit;
  const nowMs = Date.now();

  // Rank by engagement across the whole visible catalog rather than a fixed
  // recent window, so the feed is never emptied out as recipes age.
  const baseMatch: Record<string, unknown> = {
    isPrivate: false,
    isHidden: { $ne: true },
    authorId:
      blockExclusionIds.length > 0
        ? { $ne: userId, $nin: blockExclusionIds }
        : { $ne: userId },
  };

  const { ids: candidateIds, materialized } = await getTrendingCandidateIds(
    baseMatch
  );
  const poolMatch = { _id: { $in: candidateIds } };

  const scoringStages: Record<string, unknown>[] = materialized
    ? [{ $sort: { isSeed: 1, trendingScore: -1 } }]
    : [
        {
          $addFields: {
            _ageDays: {
              $divide: [
                { $subtract: [new Date(nowMs), "$createdAt"] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
        {
          $addFields: {
            _trendScore: {
              $multiply: [
                { $add: ["$likesCount", { $multiply: ["$forksCount", 3] }] },
                { $exp: { $multiply: ["$_ageDays", -TRENDING_DECAY_RATE] } },
              ],
            },
          },
        },
        // Real (non-seed) recipes rank ahead of seed recipes, then by engagement.
        { $sort: { isSeed: 1, _trendScore: -1 } },
      ];

  const dataStages: Record<string, unknown>[] = [
    { $skip: skip },
    { $limit: limit + 1 },
    ...(materialized
      ? []
      : [{ $project: { _ageDays: 0, _trendScore: 0 } }]),
  ];

  const [[result], featured] = await Promise.all([
    Recipe.aggregate([
      { $match: poolMatch },
      ...buildVisibilityPipelineStages(userId, accessiblePrivateIds),
      ...scoringStages,
      {
        $facet: {
          data: dataStages,
          count: [{ $limit: 1000 }, { $count: "n" }],
        },
      },
    ] as unknown as PipelineStage[]).allowDiskUse(true),
    getFeaturedRecipeForViewer(userId, accessiblePrivateIds, blockExclusionIds),
  ]);

  const rawData = (result?.data ?? []) as LeanRecipe[];
  const { page: recipes, hasMore: hasMoreRaw } = splitHasMore(rawData, limit);
  const baseTotal = (result?.count[0]?.n ?? 0) as number;

  const enrichedBase = await enrichRecipes(recipes, userId);
  const { recipes: finalRecipes, total } = applyFeaturedToPage(
    enrichedBase,
    baseTotal,
    featured,
    page
  );

  return {
    recipes: finalRecipes,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: hasMoreRaw,
  };
}

/**
 * Friends feed — recipes from users the current user follows, reverse chrono.
 */
export async function friendsFeed(
  userId: Types.ObjectId,
  page: number,
  limit: number
): Promise<PaginatedFeed> {
  const blockExclusionIds = await getBlockExclusionIds(userId);
  const accessiblePrivateIds = await buildAccessiblePrivateIds(userId);
  const featuredPromise = getFeaturedRecipeForViewer(
    userId,
    accessiblePrivateIds,
    blockExclusionIds
  );
  // `getFollowingIds` already filters on status: "active" — pending follow
  // requests do NOT populate this feed.
  const followingIds = await getFollowingIds(userId);
  const skip = (page - 1) * limit;

  // Remove blocked (either direction) authors from the followed-author set.
  const blockedKeys = new Set(
    blockExclusionIds.map((id) => id.toString())
  );
  const visibleFollowing = followingIds.filter(
    (id) => !blockedKeys.has(id.toString())
  );

  if (visibleFollowing.length === 0) {
    const featured = await featuredPromise;
    const { recipes, total } = applyFeaturedToPage([], 0, featured, page);
    return {
      recipes,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: false,
    };
  }

  const filter = {
    authorId: { $in: visibleFollowing },
    isPrivate: false,
    isHidden: { $ne: true },
  };

  const [recipes, baseTotal, featured] = await Promise.all([
    Recipe.find(filter)
      // Real (non-seed) recipes rank ahead of seed recipes, then newest first.
      .sort({ isSeed: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Recipe.countDocuments(filter),
    featuredPromise,
  ]);

  const enrichedBase = await enrichRecipes(
    recipes as LeanRecipe[],
    userId
  );
  const { recipes: finalRecipes, total } = applyFeaturedToPage(
    enrichedBase,
    baseTotal,
    featured,
    page
  );

  return {
    recipes: finalRecipes,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: skip + recipes.length < baseTotal,
  };
}

/**
 * Seasonal feed — recipes tagged with currently active seasonal tags.
 * Falls back to recent popular recipes if no active seasonal tags exist.
 */
export async function seasonalFeed(
  userId: Types.ObjectId,
  page: number,
  limit: number
): Promise<PaginatedFeed> {
  const blockExclusionIds = await getBlockExclusionIds(userId);
  const accessiblePrivateIds = await buildAccessiblePrivateIds(userId);
  const skip = (page - 1) * limit;

  // Find currently active seasonal tags
  const now = new Date();
  const activeTags = await SeasonalTag.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .select("slug")
    .lean();

  const baseMatch: Record<string, unknown> = {
    isPrivate: false,
    isHidden: { $ne: true },
    authorId:
      blockExclusionIds.length > 0
        ? { $ne: userId, $nin: blockExclusionIds }
        : { $ne: userId },
  };

  // No active seasonal tags: fall back to the full visible catalog rather than
  // an empty feed. The sort below still ranks user recipes ahead of seed.
  const activeSlugs = activeTags.map((t) => t.slug);
  const candidateIds = await getSeasonalCandidateIds(baseMatch, activeSlugs);
  const poolMatch = { _id: { $in: candidateIds } };

  const [[result], featured] = await Promise.all([
    Recipe.aggregate([
      { $match: poolMatch },
      ...buildVisibilityPipelineStages(userId, accessiblePrivateIds),
      // Real (non-seed) recipes rank ahead of seed recipes.
      { $sort: { isSeed: 1, likesCount: -1, createdAt: -1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit + 1 }],
          count: [{ $limit: 1000 }, { $count: "n" }],
        },
      },
    ] as unknown as PipelineStage[]).allowDiskUse(true),
    getFeaturedRecipeForViewer(userId, accessiblePrivateIds, blockExclusionIds),
  ]);

  const rawData = (result?.data ?? []) as LeanRecipe[];
  const { page: recipes, hasMore: hasMoreRaw } = splitHasMore(rawData, limit);
  const baseTotal = (result?.count[0]?.n ?? 0) as number;

  const enrichedBase = await enrichRecipes(recipes, userId);
  const { recipes: finalRecipes, total } = applyFeaturedToPage(
    enrichedBase,
    baseTotal,
    featured,
    page
  );

  return {
    recipes: finalRecipes,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: hasMoreRaw,
  };
}
