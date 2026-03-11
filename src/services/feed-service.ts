import { Document, Types } from "mongoose";
import Recipe, { IRecipe } from "../models/Recipe";
import User, { IUser } from "../models/User";
import Follow from "../models/Follow";
import Like from "../models/Like";

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
  createdAt: Date;
  updatedAt: Date;
  authorName: string;
  authorPhoto?: string;
  isLiked: boolean;
}

interface PaginatedFeed {
  recipes: FeedRecipe[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns IDs of users the viewer actively follows.
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
 * Builds a MongoDB filter for recipes that are visible to the viewer:
 * - Non-private recipes from public accounts
 * - Non-private recipes from private accounts the viewer follows
 * - Non-private recipes from kitchen members
 * Excludes the viewer's own recipes.
 */
async function buildVisibilityFilter(
  userId: Types.ObjectId
): Promise<Record<string, unknown>> {
  const followingIds = await getFollowingIds(userId);

  // Get viewer's kitchen members
  const viewer = await User.findById(userId).select("kitchenId").lean();
  let kitchenMemberIds: Types.ObjectId[] = [];
  if (viewer?.kitchenId) {
    const members = await User.find({
      kitchenId: viewer.kitchenId,
      _id: { $ne: userId },
    })
      .select("_id")
      .lean();
    kitchenMemberIds = members.map((m) => m._id);
  }

  // All private account IDs accessible to the viewer
  const accessiblePrivateIds = [...followingIds, ...kitchenMemberIds];

  // Public account IDs
  const publicAccountIds = await User.find({ isPublic: true })
    .select("_id")
    .lean()
    .then((users) => users.map((u) => u._id));

  const allVisibleAuthorIds = [
    ...publicAccountIds,
    ...accessiblePrivateIds,
  ];

  return {
    isPrivate: false,
    authorId: { $ne: userId, $in: allVisibleAuthorIds },
  };
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

  // Fetch user's likes for these recipes
  const recipeIds = recipes.map((r) => r._id);
  const likes = await Like.find({
    userId,
    recipeId: { $in: recipeIds },
  })
    .select("recipeId")
    .lean();
  const likedSet = new Set(likes.map((l) => l.recipeId.toString()));

  return recipes.map((recipe) => {
    const author = authorMap.get(recipe.authorId.toString());
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
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      authorName: author?.fullName ?? "Unknown",
      authorPhoto: author?.profilePicture,
      isLiked: likedSet.has(recipe._id.toString()),
    };
  });
}

// ── Feed Algorithms ────────────────────────────────────────────────────────────

/**
 * Algorithmic "For You" feed.
 *
 * Scores each candidate recipe using a weighted formula:
 * - recency (0.25): newer recipes score higher
 * - engagement (0.25): normalized likes + weighted forks
 * - relevance (0.30): dietary/cuisine/label match + followed-by-following
 * - diversity (0.10): penalty for repeated author/cuisine
 * - premium boost (0.10): small bonus for premium authors
 */
export async function forYouFeed(
  userId: Types.ObjectId,
  page: number,
  limit: number
): Promise<PaginatedFeed> {
  const visibilityFilter = await buildVisibilityFilter(userId);

  // Fetch user preferences
  const currentUser = await User.findById(userId)
    .select("dietaryPreferences cuisinePreferences")
    .lean();
  const userDietary = new Set(currentUser?.dietaryPreferences ?? []);
  const userCuisine = new Set(currentUser?.cuisinePreferences ?? []);

  // Fetch who the user follows, and who *they* follow (2nd-degree)
  const followingIds = await getFollowingIds(userId);
  const followingIdSet = new Set(followingIds.map((id) => id.toString()));

  let followedByFollowingSet = new Set<string>();
  if (followingIds.length > 0) {
    const secondDegree = await Follow.find({
      followerId: { $in: followingIds },
      status: "active",
    })
      .select("followingId")
      .lean();
    followedByFollowingSet = new Set(
      secondDegree.map((f) => f.followingId.toString())
    );
  }

  // Fetch candidate recipes (last 30 days for scoring, cap at 200 for perf)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const candidates = await Recipe.find({
    ...visibilityFilter,
    createdAt: { $gte: thirtyDaysAgo },
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  if (candidates.length === 0) {
    return { recipes: [], page, limit, total: 0, totalPages: 0 };
  }

  // Find max engagement in batch for normalization
  const maxEngagement = Math.max(
    1,
    ...candidates.map((r) => r.likesCount + r.forksCount * 3)
  );

  // Fetch premium status for all candidate authors
  const candidateAuthorIds = [
    ...new Set(candidates.map((r) => r.authorId.toString())),
  ];
  const premiumAuthors = await User.find({
    _id: { $in: candidateAuthorIds },
    isPremium: true,
  })
    .select("_id")
    .lean();
  const premiumSet = new Set(premiumAuthors.map((a) => a._id.toString()));

  // Score each recipe
  const now = Date.now();
  interface ScoredCandidate {
    recipe: LeanRecipe;
    score: number;
  }
  const scored: ScoredCandidate[] = [];
  const recentAuthors: string[] = [];
  const recentCuisines: string[] = [];

  // Pre-sort by raw engagement to have a stable order before scoring diversity
  const sortedCandidates = [...candidates].sort(
    (a, b) =>
      b.likesCount + b.forksCount * 3 - (a.likesCount + a.forksCount * 3)
  );

  for (const recipe of sortedCandidates) {
    const daysSince =
      (now - new Date(recipe.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 1 - daysSince / 30);

    const rawEngagement = recipe.likesCount + recipe.forksCount * 3;
    const engagementScore = rawEngagement / maxEngagement;

    // Relevance: dietary match, cuisine match, followed-by-following, label match
    let relevanceScore = 0;
    if (recipe.dietaryTags.some((t) => userDietary.has(t))) {
      relevanceScore += 0.3;
    }
    if (recipe.cuisineTags.some((t) => userCuisine.has(t))) {
      relevanceScore += 0.3;
    }
    if (followedByFollowingSet.has(recipe.authorId.toString())) {
      relevanceScore += 0.2;
    }
    // Label match — check if any recipe label overlaps with user's preferences
    if (
      recipe.labels.some(
        (l) => userDietary.has(l) || userCuisine.has(l)
      )
    ) {
      relevanceScore += 0.2;
    }

    // Diversity: penalty for same author or cuisine in recent picks
    let diversityBonus = 0.1;
    const lastFiveAuthors = recentAuthors.slice(-5);
    const lastFiveCuisines = recentCuisines.slice(-5);
    if (lastFiveAuthors.includes(recipe.authorId.toString())) {
      diversityBonus -= 0.1;
    }
    if (
      recipe.cuisineTags.some((c) => lastFiveCuisines.includes(c))
    ) {
      diversityBonus = Math.max(0, diversityBonus - 0.05);
    }

    const premiumBoost = premiumSet.has(recipe.authorId.toString()) ? 0.1 : 0;

    const score =
      recencyScore * 0.25 +
      engagementScore * 0.25 +
      relevanceScore * 0.3 +
      diversityBonus * 0.1 +
      premiumBoost * 0.1;

    scored.push({
      recipe: recipe as LeanRecipe,
      score,
    });
    recentAuthors.push(recipe.authorId.toString());
    if (recipe.cuisineTags.length > 0) {
      recentCuisines.push(recipe.cuisineTags[0]);
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const total = scored.length;
  const start = (page - 1) * limit;
  const paged = scored.slice(start, start + limit).map((s) => s.recipe);

  const enriched = await enrichRecipes(paged, userId);

  return {
    recipes: enriched,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Trending feed — most-engaged recipes from the last 7 days.
 */
export async function trendingFeed(
  userId: Types.ObjectId,
  page: number,
  limit: number
): Promise<PaginatedFeed> {
  const visibilityFilter = await buildVisibilityFilter(userId);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const skip = (page - 1) * limit;

  const filter = {
    ...visibilityFilter,
    createdAt: { $gte: sevenDaysAgo },
  };

  const [recipes, total] = await Promise.all([
    Recipe.find(filter)
      .sort({ likesCount: -1, forksCount: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Recipe.countDocuments(filter),
  ]);

  const enriched = await enrichRecipes(
    recipes as LeanRecipe[],
    userId
  );

  return {
    recipes: enriched,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
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
  const followingIds = await getFollowingIds(userId);
  const skip = (page - 1) * limit;

  if (followingIds.length === 0) {
    return { recipes: [], page, limit, total: 0, totalPages: 0 };
  }

  const filter = {
    authorId: { $in: followingIds },
    isPrivate: false,
  };

  const [recipes, total] = await Promise.all([
    Recipe.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Recipe.countDocuments(filter),
  ]);

  const enriched = await enrichRecipes(
    recipes as LeanRecipe[],
    userId
  );

  return {
    recipes: enriched,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Seasonal feed — for now, returns recent popular recipes as a simple
 * implementation. Future: tag-based seasonal detection.
 */
export async function seasonalFeed(
  userId: Types.ObjectId,
  page: number,
  limit: number
): Promise<PaginatedFeed> {
  const visibilityFilter = await buildVisibilityFilter(userId);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const skip = (page - 1) * limit;

  const filter = {
    ...visibilityFilter,
    createdAt: { $gte: fourteenDaysAgo },
  };

  const [recipes, total] = await Promise.all([
    Recipe.find(filter)
      .sort({ likesCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Recipe.countDocuments(filter),
  ]);

  const enriched = await enrichRecipes(
    recipes as LeanRecipe[],
    userId
  );

  return {
    recipes: enriched,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
