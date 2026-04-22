import { Types } from "mongoose";
import CookedPost from "../models/CookedPost";
import Recipe from "../models/Recipe";
import ScheduleEntry from "../models/ScheduleEntry";
import User from "../models/User";
import Kitchen from "../models/Kitchen";
import Follow from "../models/Follow";
import Like from "../models/Like";
import {
  ALL_KNOWN_CUISINES,
  canonicalCuisine,
  regionForCuisine,
} from "../lib/cuisines";

interface AppError extends Error {
  statusCode: number;
}

function createError(message: string, statusCode: number): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  return error;
}

export interface WrappedTopRecipe {
  recipeId: string | null;
  title: string;
  photoUrl: string | null;
  cooks: number;
}

export interface WrappedTopCuisine {
  cuisine: string;
  regionId: string | null;
  cooks: number;
}

export interface WrappedKitchenStats {
  kitchenId: string | null;
  kitchenName: string | null;
  memberCount: number;
  /** Schedule entries scheduled in this kitchen during the window. */
  plannedMeals: number;
  /** Entries whose cookedAt falls in the window. */
  cookedMeals: number;
}

export interface WrappedSummary {
  userId: string;
  displayName: string;
  profilePicture: string | null;
  year: number;
  windowStart: Date;
  windowEnd: Date;

  totalCooks: number;
  uniqueRecipes: number;
  uniqueCuisines: number;
  totalCuisinesAvailable: number;

  plannedMeals: number;
  cookedPlans: number;

  recipesCreated: number;
  recipesRemixed: number;
  recipesLiked: number;

  followersGained: number;
  followingGained: number;

  topRecipes: WrappedTopRecipe[];
  topCuisines: WrappedTopCuisine[];

  /** Weekday with the most cooks (0=Sun .. 6=Sat). Null when no cooks. */
  favoriteWeekday: number | null;
  favoriteWeekdayCount: number;
  /** Hour of day with the most cooks (0-23). Null when no cooks. */
  favoriteHour: number | null;

  kitchen: WrappedKitchenStats | null;

  /** Three highlight moments, ordered chronologically. */
  highlights: Array<{
    date: Date;
    photoUrl: string;
    caption?: string;
    recipeTitle: string;
    recipeId: string | null;
  }>;
}

/**
 * Resolve the [start, end) window for a given year. When `year` is the
 * current year, the window ends at `now` so mid-year wrappeds remain useful
 * (e.g. a "My Chefless So Far" share during the year).
 */
export function windowForYear(year: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const nowYear = new Date().getUTCFullYear();
  const end =
    year < nowYear
      ? new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0))
      : new Date();
  return { start, end };
}

/**
 * Compile a user's Wrapped summary for a given calendar year. Expensive —
 * every field runs an independent aggregate, so all queries are dispatched
 * in parallel.
 */
export async function getWrappedSummary(
  userId: string,
  year: number
): Promise<WrappedSummary> {
  const userOid = new Types.ObjectId(userId);
  const { start, end } = windowForYear(year);
  const dateWindow = { $gte: start, $lt: end };

  const user = await User.findById(userId)
    .select("fullName profilePicture kitchenId createdAt")
    .lean();
  if (!user) throw createError("User not found", 404);

  const [
    cookedPostAggregate,
    scheduleAggregate,
    recipesCreated,
    recipesRemixed,
    likesDelta,
    followersDelta,
    followingDelta,
    topRecipes,
    topCuisinesRaw,
    weekdayAggregate,
    hourAggregate,
    kitchen,
    highlightsRaw,
  ] = await Promise.all([
    CookedPost.aggregate<{
      _id: null;
      totalCooks: number;
      uniqueRecipes: string[];
      uniqueCuisines: string[];
    }>([
      { $match: { userId: userOid, createdAt: dateWindow } },
      {
        $group: {
          _id: null,
          totalCooks: { $sum: 1 },
          uniqueRecipes: { $addToSet: "$recipeId" },
          uniqueCuisines: { $addToSet: "$cuisineTags" },
        },
      },
    ]),

    ScheduleEntry.aggregate<{
      _id: null;
      plannedMeals: number;
      cookedPlans: number;
    }>([
      {
        $match: {
          userId: userOid,
          date: dateWindow,
          status: "confirmed",
        },
      },
      {
        $group: {
          _id: null,
          plannedMeals: { $sum: 1 },
          cookedPlans: {
            $sum: { $cond: [{ $ifNull: ["$cookedAt", false] }, 1, 0] },
          },
        },
      },
    ]),

    Recipe.countDocuments({
      authorId: userOid,
      createdAt: dateWindow,
      forkedFrom: { $exists: false },
    }),

    Recipe.countDocuments({
      authorId: userOid,
      createdAt: dateWindow,
      "forkedFrom.recipeId": { $exists: true },
    }),

    Like.countDocuments({
      userId: userOid,
      createdAt: dateWindow,
    }),

    Follow.countDocuments({
      followingId: userOid,
      createdAt: dateWindow,
      status: "active",
    }),

    Follow.countDocuments({
      followerId: userOid,
      createdAt: dateWindow,
      status: "active",
    }),

    CookedPost.aggregate<{
      _id: Types.ObjectId | null;
      recipeTitle: string;
      cooks: number;
      samplePhoto: string | null;
    }>([
      { $match: { userId: userOid, createdAt: dateWindow } },
      {
        $group: {
          _id: "$recipeId",
          recipeTitle: { $first: "$recipeTitle" },
          cooks: { $sum: 1 },
          samplePhoto: { $first: "$photoUrl" },
        },
      },
      { $sort: { cooks: -1 } },
      { $limit: 5 },
    ]),

    CookedPost.aggregate<{ _id: string; cooks: number }>([
      { $match: { userId: userOid, createdAt: dateWindow } },
      { $unwind: "$cuisineTags" },
      { $group: { _id: "$cuisineTags", cooks: { $sum: 1 } } },
      { $sort: { cooks: -1 } },
      { $limit: 5 },
    ]),

    CookedPost.aggregate<{ _id: number; cooks: number }>([
      { $match: { userId: userOid, createdAt: dateWindow } },
      { $group: { _id: { $dayOfWeek: "$createdAt" }, cooks: { $sum: 1 } } },
      { $sort: { cooks: -1 } },
      { $limit: 1 },
    ]),

    CookedPost.aggregate<{ _id: number; cooks: number }>([
      { $match: { userId: userOid, createdAt: dateWindow } },
      { $group: { _id: { $hour: "$createdAt" }, cooks: { $sum: 1 } } },
      { $sort: { cooks: -1 } },
      { $limit: 1 },
    ]),

    user.kitchenId
      ? Kitchen.findById(user.kitchenId).select("name memberCount").lean()
      : null,

    CookedPost.find({ userId: userOid, createdAt: dateWindow })
      .sort({ _id: 1 })
      .select("photoUrl caption recipeTitle recipeId createdAt")
      .limit(3)
      .lean(),
  ]);

  const cookedSummary = cookedPostAggregate[0];
  const scheduleSummary = scheduleAggregate[0];

  // `uniqueCuisines` comes out as an array-of-arrays (because cuisineTags is
  // itself an array). Flatten + canonicalize.
  const uniqueCuisineSet = new Set<string>();
  if (cookedSummary?.uniqueCuisines) {
    for (const entry of cookedSummary.uniqueCuisines) {
      if (Array.isArray(entry)) {
        for (const c of entry) {
          const canonical = canonicalCuisine(c);
          if (canonical) uniqueCuisineSet.add(canonical);
        }
      }
    }
  }

  const uniqueRecipeIds = new Set(
    (cookedSummary?.uniqueRecipes ?? [])
      .filter((r) => r !== null && r !== undefined)
      .map((r) => r!.toString())
  );

  const topRecipesView: WrappedTopRecipe[] = topRecipes.map((row) => ({
    recipeId: row._id ? row._id.toString() : null,
    title: row.recipeTitle ?? "Untitled",
    photoUrl: row.samplePhoto ?? null,
    cooks: row.cooks,
  }));

  const topCuisinesView: WrappedTopCuisine[] = topCuisinesRaw.map((row) => {
    const canonical = canonicalCuisine(row._id) ?? row._id;
    return {
      cuisine: canonical,
      regionId: regionForCuisine(canonical)?.id ?? null,
      cooks: row.cooks,
    };
  });

  let kitchenStats: WrappedKitchenStats | null = null;
  if (kitchen) {
    const kitchenScheduleAgg = await ScheduleEntry.aggregate<{
      planned: number;
      cooked: number;
    }>([
      {
        $match: {
          kitchenId: kitchen._id,
          date: dateWindow,
          status: "confirmed",
        },
      },
      {
        $group: {
          _id: null,
          planned: { $sum: 1 },
          cooked: {
            $sum: { $cond: [{ $ifNull: ["$cookedAt", false] }, 1, 0] },
          },
        },
      },
    ]);
    const ks = kitchenScheduleAgg[0];
    kitchenStats = {
      kitchenId: kitchen._id.toString(),
      kitchenName: kitchen.name,
      memberCount: kitchen.memberCount ?? 1,
      plannedMeals: ks?.planned ?? 0,
      cookedMeals: ks?.cooked ?? 0,
    };
  }

  // Mongo $dayOfWeek returns 1=Sunday..7=Saturday. Normalize to JS 0=Sun..6=Sat.
  const favoriteWeekday = weekdayAggregate[0]
    ? weekdayAggregate[0]._id - 1
    : null;
  const favoriteWeekdayCount = weekdayAggregate[0]?.cooks ?? 0;
  const favoriteHour = hourAggregate[0]?._id ?? null;

  return {
    userId,
    displayName: user.fullName,
    profilePicture: user.profilePicture ?? null,
    year,
    windowStart: start,
    windowEnd: end,

    totalCooks: cookedSummary?.totalCooks ?? 0,
    uniqueRecipes: uniqueRecipeIds.size,
    uniqueCuisines: uniqueCuisineSet.size,
    totalCuisinesAvailable: ALL_KNOWN_CUISINES.size,

    plannedMeals: scheduleSummary?.plannedMeals ?? 0,
    cookedPlans: scheduleSummary?.cookedPlans ?? 0,

    recipesCreated,
    recipesRemixed,
    recipesLiked: likesDelta,

    followersGained: followersDelta,
    followingGained: followingDelta,

    topRecipes: topRecipesView,
    topCuisines: topCuisinesView,

    favoriteWeekday,
    favoriteWeekdayCount,
    favoriteHour,

    kitchen: kitchenStats,

    highlights: highlightsRaw.map((h) => ({
      date: h.createdAt,
      photoUrl: h.photoUrl,
      caption: h.caption,
      recipeTitle: h.recipeTitle,
      recipeId: h.recipeId?.toString() ?? null,
    })),
  };
}
