import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import User, { IUser } from "../models/User";
import Recipe, { IRecipe } from "../models/Recipe";
import Follow from "../models/Follow";
import { computeSpatulaBadge } from "../services/user-service";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

const searchQuerySchema = z.object({
  q: z.string().min(1, "Search query is required").max(100),
  type: z.enum(["all", "recipes", "users"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type SearchQuery = z.infer<typeof searchQuerySchema>;

interface RecipeSearchResult {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  photos: string[];
  labels: string[];
  dietaryTags: string[];
  cuisineTags: string[];
  difficulty?: string;
  prepTime?: number;
  cookTime?: number;
  totalTime?: number;
  servings?: number;
  likesCount: number;
  forksCount: number;
  createdAt: Date;
  author: {
    _id: Types.ObjectId;
    fullName: string;
    profilePicture?: string;
  };
}

interface UserSearchResult {
  _id: Types.ObjectId;
  fullName: string;
  profilePicture?: string;
  bio?: string;
  isPublic: boolean;
  recipesCount: number;
  followersCount: number;
  spatulaBadge: string | null;
}

/**
 * Build a list of author IDs whose shared recipes the viewer can see.
 * Returns:
 * - All public account IDs (anyone can see their shared recipes)
 * - Private account IDs that the viewer actively follows
 * - Private account IDs that share a kitchen with the viewer
 */
async function getVisibleAuthorIds(
  viewerId: Types.ObjectId
): Promise<{
  publicUserIds: Types.ObjectId[];
  followedPrivateIds: Types.ObjectId[];
  kitchenMemberIds: Types.ObjectId[];
}> {
  // Get all users the viewer actively follows who are private
  const followedPrivateUsers = await Follow.find({
    followerId: viewerId,
    status: "active",
  })
    .select("followingId")
    .lean();

  const followedIds = followedPrivateUsers.map((f) => f.followingId);

  // Get viewer's kitchen to find kitchen members
  const viewer = await User.findById(viewerId).select("kitchenId").lean();
  let kitchenMemberIds: Types.ObjectId[] = [];

  if (viewer?.kitchenId) {
    const kitchenMembers = await User.find({
      kitchenId: viewer.kitchenId,
      _id: { $ne: viewerId },
    })
      .select("_id")
      .lean();
    kitchenMemberIds = kitchenMembers.map((m) => m._id);
  }

  return {
    publicUserIds: [], // We'll handle public accounts via the isPublic field in the query
    followedPrivateIds: followedIds,
    kitchenMemberIds,
  };
}

async function searchRecipes(
  query: string,
  viewerId: Types.ObjectId,
  page: number,
  limit: number
): Promise<{ recipes: RecipeSearchResult[]; total: number }> {
  const skip = (page - 1) * limit;

  const { followedPrivateIds, kitchenMemberIds } =
    await getVisibleAuthorIds(viewerId);

  // Combine followed + kitchen member IDs (these are private accounts whose shared recipes we can see)
  const accessiblePrivateAuthorIds = [
    ...followedPrivateIds,
    ...kitchenMemberIds,
  ];

  // Build the visibility filter:
  // 1. Own recipes (including private)
  // 2. Public accounts' shared (non-private) recipes
  // 3. Followed/kitchen private accounts' shared recipes
  const visibilityFilter = {
    $or: [
      // Own recipes (including private ones)
      { authorId: viewerId },
      // Shared recipes from public accounts
      {
        isPrivate: false,
        authorId: {
          $in: await User.find({ isPublic: true })
            .select("_id")
            .lean()
            .then((users) => users.map((u) => u._id)),
        },
      },
      // Shared recipes from accessible private accounts
      ...(accessiblePrivateAuthorIds.length > 0
        ? [
            {
              isPrivate: false,
              authorId: { $in: accessiblePrivateAuthorIds },
            },
          ]
        : []),
    ],
  };

  const filter = {
    $text: { $search: query },
    ...visibilityFilter,
  };

  const [recipes, total] = await Promise.all([
    Recipe.find(filter, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit)
      .lean(),
    Recipe.countDocuments(filter),
  ]);

  // Populate author info
  const authorIds = [...new Set(recipes.map((r) => r.authorId.toString()))];
  const authors = await User.find({ _id: { $in: authorIds } })
    .select("fullName profilePicture")
    .lean();

  const authorMap = new Map(authors.map((a) => [a._id.toString(), a]));

  const results: RecipeSearchResult[] = recipes.map((recipe) => {
    const author = authorMap.get(recipe.authorId.toString());
    return {
      _id: recipe._id,
      title: recipe.title,
      description: recipe.description,
      photos: recipe.photos,
      labels: recipe.labels,
      dietaryTags: recipe.dietaryTags,
      cuisineTags: recipe.cuisineTags,
      difficulty: recipe.difficulty,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      totalTime: recipe.totalTime,
      servings: recipe.servings,
      likesCount: recipe.likesCount,
      forksCount: recipe.forksCount,
      createdAt: recipe.createdAt,
      author: {
        _id: author?._id ?? recipe.authorId,
        fullName: author?.fullName ?? "Unknown",
        profilePicture: author?.profilePicture,
      },
    };
  });

  return { recipes: results, total };
}

async function searchUsers(
  query: string,
  viewerId: Types.ObjectId,
  page: number,
  limit: number
): Promise<{ users: UserSearchResult[]; total: number }> {
  const skip = (page - 1) * limit;

  const filter = {
    $text: { $search: query },
    _id: { $ne: viewerId },
  };

  const [users, total] = await Promise.all([
    User.find(filter, { score: { $meta: "textScore" } })
      .select(
        "fullName profilePicture bio isPublic recipesCount followersCount"
      )
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const results: UserSearchResult[] = users.map((user) => ({
    _id: user._id,
    fullName: user.fullName,
    profilePicture: user.profilePicture,
    bio: user.bio,
    isPublic: user.isPublic,
    recipesCount: user.recipesCount,
    followersCount: user.followersCount,
    spatulaBadge: computeSpatulaBadge(user.recipesCount),
  }));

  return { users: results, total };
}

// GET /api/search?q=&type=&page=&limit=
router.get(
  "/",
  requireAuth,
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { q, type, page, limit } = req.query as unknown as SearchQuery;

    const firebaseUid = req.user!.uid;
    const currentUser = await User.findOne({ firebaseUid })
      .select("_id")
      .lean();

    if (!currentUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const viewerId = currentUser._id;

    let recipes: RecipeSearchResult[] = [];
    let users: UserSearchResult[] = [];
    let recipesTotal = 0;
    let usersTotal = 0;

    if (type === "all") {
      const [recipeResults, userResults] = await Promise.all([
        searchRecipes(q, viewerId, page, limit),
        searchUsers(q, viewerId, page, limit),
      ]);
      recipes = recipeResults.recipes;
      recipesTotal = recipeResults.total;
      users = userResults.users;
      usersTotal = userResults.total;
    } else if (type === "recipes") {
      const recipeResults = await searchRecipes(q, viewerId, page, limit);
      recipes = recipeResults.recipes;
      recipesTotal = recipeResults.total;
    } else {
      const userResults = await searchUsers(q, viewerId, page, limit);
      users = userResults.users;
      usersTotal = userResults.total;
    }

    res.status(200).json({
      recipes,
      users,
      total: {
        recipes: recipesTotal,
        users: usersTotal,
      },
    });
  })
);

export default router;
