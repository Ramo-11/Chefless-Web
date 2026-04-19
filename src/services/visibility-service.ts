import { Types } from "mongoose";
import Follow from "../models/Follow";
import { IUser } from "../models/User";

export async function canViewProfile(
  viewerId: Types.ObjectId | string | null,
  targetUser: IUser
): Promise<boolean> {
  // Same user can always view their own profile
  if (viewerId && targetUser._id.equals(viewerId)) {
    return true;
  }

  // Public accounts are always viewable
  if (targetUser.isPublic) {
    return true;
  }

  // No viewer means no access to private profiles
  if (!viewerId) {
    return false;
  }

  // Check if viewer actively follows the target
  const follow = await Follow.findOne({
    followerId: viewerId,
    followingId: targetUser._id,
    status: "active",
  });

  if (follow) {
    return true;
  }

  // NOTE: Kitchen co-membership does NOT grant profile visibility.
  // Per ARCHITECTURE.md's privacy rules, joining a kitchen grants implicit
  // *recipe* visibility only — profiles remain gated by account privacy and
  // follow status. (See `canViewRecipe` below for the recipe-side rule.)
  return false;
}

export async function canViewRecipe(
  viewerId: Types.ObjectId | string | null,
  recipe: { authorId: Types.ObjectId; isPrivate: boolean },
  author: IUser
): Promise<boolean> {
  // Author can always view their own recipes
  if (viewerId && recipe.authorId.equals(viewerId)) {
    return true;
  }

  // Private recipes: only the author can see
  if (recipe.isPrivate) {
    return false;
  }

  // Shared (non-private) recipe on a public account: anyone can view
  if (author.isPublic) {
    return true;
  }

  // Shared recipe on a private account: only followers + kitchen members
  if (!viewerId) {
    return false;
  }

  // Check if viewer actively follows the author
  const follow = await Follow.findOne({
    followerId: viewerId,
    followingId: author._id,
    status: "active",
  });

  if (follow) {
    return true;
  }

  // Check if they share a kitchen
  if (author.kitchenId) {
    const User = (await import("../models/User")).default;
    const viewer = await User.findById(viewerId).select("kitchenId").lean();
    if (
      viewer &&
      viewer.kitchenId &&
      author.kitchenId.equals(viewer.kitchenId)
    ) {
      return true;
    }
  }

  return false;
}
