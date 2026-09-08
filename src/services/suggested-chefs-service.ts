import { Types } from "mongoose";
import User from "../models/User";
import Follow from "../models/Follow";
import { getBlockedUserIds } from "./block-service";
import { hasActivePremium } from "../lib/premium";

const FOLLOWER_SMOOTHING_K = 20;
const EDITORIAL_WEIGHT = 0.3;
const CUISINE_WEIGHT = 0.3;
const POPULARITY_WEIGHT = 0.25;
const PUBLIC_ACCOUNT_WEIGHT = 0.15;
const CANDIDATE_POOL_MULTIPLIER = 6;
const MIN_CANDIDATE_POOL = 60;
const RECENT_RECIPE_SAMPLE = 8;
const THUMBNAIL_COUNT = 3;
const JITTER_SPREAD = 0.1;

export type SuggestionReason = "popular" | "cuisine" | "editorial";

export interface SuggestedChef {
  id: string;
  fullName: string;
  profilePictureUrl: string | null;
  isPremiumActive: boolean;
  recipesCount: number;
  followersCount: number;
  recentRecipePhotos: string[];
  reason: SuggestionReason;
  cuisineTag?: string;
}

interface CandidateAggregateRow {
  _id: Types.ObjectId;
  fullName: string;
  profilePicture?: string;
  isPremium: boolean;
  premiumExpiresAt?: Date;
  recipesCount: number;
  followersCount: number;
  isSeed?: boolean;
  _thumbnails: string[];
  _matchedCuisineTags: string[];
  _score: number;
}

function recentRecipesSubPipeline(projectFields: Record<string, 1>): any[] {
  return [
    {
      $match: {
        $expr: { $eq: ["$authorId", "$$authorId"] },
        isPrivate: false,
        isHidden: { $ne: true },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: RECENT_RECIPE_SAMPLE },
    { $project: projectFields },
  ];
}

function hashToUnitFloat(a: string, b: string): number {
  let hash = 2166136261;
  const input = `${a}:${b}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

export async function getSuggestedChefs(
  viewerId: Types.ObjectId,
  limit: number
): Promise<SuggestedChef[]> {
  const [viewer, followRows, blockedIds] = await Promise.all([
    User.findById(viewerId).select("cuisinePreferences").lean(),
    Follow.find({ followerId: viewerId }).select("followingId").lean(),
    getBlockedUserIds(viewerId.toString()),
  ]);

  const cuisinePreferences = viewer?.cuisinePreferences ?? [];
  const excludeIds: Types.ObjectId[] = [
    viewerId,
    ...followRows.map((f) => f.followingId),
    ...blockedIds,
  ];

  const poolSize = Math.max(MIN_CANDIDATE_POOL, limit * CANDIDATE_POOL_MULTIPLIER);

  const candidates = (await User.aggregate([
    {
      $match: {
        _id: { $nin: excludeIds },
        isBanned: { $ne: true },
      },
    },
    {
      $lookup: {
        from: "recipes",
        let: { authorId: "$_id" },
        pipeline: recentRecipesSubPipeline({ cuisineTags: 1 }),
        as: "_recentRecipes",
      },
    },
    {
      $addFields: {
        _allCuisineTags: {
          $reduce: {
            input: "$_recentRecipes.cuisineTags",
            initialValue: [],
            in: { $setUnion: ["$$value", "$$this"] },
          },
        },
      },
    },
    {
      $addFields: {
        _matchedCuisineTags:
          cuisinePreferences.length > 0
            ? { $setIntersection: ["$_allCuisineTags", cuisinePreferences] }
            : [],
        _isEditorial: { $eq: ["$isSeed", true] },
      },
    },
    {
      $addFields: {
        _hasCuisineMatch: { $gt: [{ $size: "$_matchedCuisineTags" }, 0] },
      },
    },
    {
      $addFields: {
        _score: {
          $add: [
            { $cond: ["$_isEditorial", EDITORIAL_WEIGHT, 0] },
            { $cond: ["$_hasCuisineMatch", CUISINE_WEIGHT, 0] },
            {
              $multiply: [
                POPULARITY_WEIGHT,
                {
                  $divide: [
                    "$followersCount",
                    { $add: ["$followersCount", FOLLOWER_SMOOTHING_K] },
                  ],
                },
              ],
            },
            { $cond: ["$isPublic", PUBLIC_ACCOUNT_WEIGHT, 0] },
          ],
        },
      },
    },
    { $sort: { _score: -1, followersCount: -1, _id: 1 } },
    { $limit: poolSize },
    {
      $lookup: {
        from: "recipes",
        let: { authorId: "$_id" },
        pipeline: recentRecipesSubPipeline({ photos: 1 }),
        as: "_thumbnailRecipes",
      },
    },
    {
      $addFields: {
        _thumbnails: {
          $slice: [
            {
              $filter: {
                input: {
                  $map: {
                    input: "$_thumbnailRecipes",
                    as: "r",
                    in: { $arrayElemAt: ["$$r.photos", 0] },
                  },
                },
                as: "photo",
                cond: { $ne: ["$$photo", null] },
              },
            },
            THUMBNAIL_COUNT,
          ],
        },
      },
    },
    {
      $project: {
        fullName: 1,
        profilePicture: 1,
        isPremium: 1,
        premiumExpiresAt: 1,
        recipesCount: 1,
        followersCount: 1,
        isSeed: 1,
        _thumbnails: 1,
        _matchedCuisineTags: 1,
        _score: 1,
      },
    },
  ])) as CandidateAggregateRow[];

  const ranked = candidates
    .map((c) => {
      const jitter =
        (hashToUnitFloat(viewerId.toString(), c._id.toString()) - 0.5) *
        JITTER_SPREAD;
      return { ...c, _finalScore: c._score + jitter };
    })
    .sort((a, b) => b._finalScore - a._finalScore)
    .slice(0, limit);

  return ranked.map((c) => {
    const isEditorial = c.isSeed === true;
    const cuisineTag = c._matchedCuisineTags?.[0];
    const reason: SuggestionReason = isEditorial
      ? "editorial"
      : cuisineTag
      ? "cuisine"
      : "popular";

    const chef: SuggestedChef = {
      id: c._id.toString(),
      fullName: c.fullName,
      profilePictureUrl: c.profilePicture ?? null,
      isPremiumActive: hasActivePremium({
        isPremium: c.isPremium,
        premiumExpiresAt: c.premiumExpiresAt,
      }),
      recipesCount: c.recipesCount ?? 0,
      followersCount: c.followersCount ?? 0,
      recentRecipePhotos: c._thumbnails ?? [],
      reason,
    };
    if (reason === "cuisine" && cuisineTag) {
      chef.cuisineTag = cuisineTag;
    }
    return chef;
  });
}
