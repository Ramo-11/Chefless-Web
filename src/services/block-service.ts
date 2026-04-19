import { Types } from "mongoose";
import Block, { IBlock } from "../models/Block";
import User from "../models/User";
import Follow from "../models/Follow";

interface ServiceError extends Error {
  statusCode: number;
}

function createError(message: string, statusCode: number): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

/** Block a user — removes any existing follows in either direction. */
export async function blockUser(
  blockerId: string,
  blockedId: string
): Promise<IBlock> {
  if (blockerId === blockedId) {
    throw createError("You cannot block yourself", 400);
  }

  // Verify the target user exists before creating the block
  const target = await User.findById(blockedId).select("_id").lean();
  if (!target) {
    throw createError("User not found", 404);
  }

  const blockerOid = new Types.ObjectId(blockerId);
  const blockedOid = new Types.ObjectId(blockedId);

  // Upsert keeps the call idempotent — blocking the same user twice returns the existing row.
  const block = await Block.findOneAndUpdate(
    { blockerId: blockerOid, blockedId: blockedOid },
    { $setOnInsert: { blockerId: blockerOid, blockedId: blockedOid } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Tear down any active follow relationships in either direction — blocking implies no social link.
  const existingFollows = await Follow.find({
    $or: [
      { followerId: blockerOid, followingId: blockedOid },
      { followerId: blockedOid, followingId: blockerOid },
    ],
  }).lean();

  if (existingFollows.length > 0) {
    // Adjust follower/following counts based on the active follows we're about to remove
    for (const follow of existingFollows) {
      if (follow.status === "active") {
        await Promise.all([
          User.updateOne(
            { _id: follow.followerId },
            { $inc: { followingCount: -1 } }
          ),
          User.updateOne(
            { _id: follow.followingId },
            { $inc: { followersCount: -1 } }
          ),
        ]);
      }
    }
    await Follow.deleteMany({
      $or: [
        { followerId: blockerOid, followingId: blockedOid },
        { followerId: blockedOid, followingId: blockerOid },
      ],
    });
  }

  return block;
}

/** Unblock a previously blocked user. Idempotent — no error if not blocked. */
export async function unblockUser(
  blockerId: string,
  blockedId: string
): Promise<void> {
  await Block.deleteOne({
    blockerId: new Types.ObjectId(blockerId),
    blockedId: new Types.ObjectId(blockedId),
  });
}

export interface BlockedUserRow {
  _id: Types.ObjectId;
  fullName: string;
  profilePicture?: string;
  blockedAt: Date;
}

/** List users blocked by the given user (with basic profile info). */
export async function listBlocked(userId: string): Promise<BlockedUserRow[]> {
  const blocks = await Block.find({ blockerId: new Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();

  if (blocks.length === 0) return [];

  const blockedIds = blocks.map((b) => b.blockedId);
  const users = await User.find({ _id: { $in: blockedIds } })
    .select("_id fullName profilePicture")
    .lean();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const rows: BlockedUserRow[] = [];
  for (const b of blocks) {
    const u = userMap.get(b.blockedId.toString());
    if (!u) continue;
    rows.push({
      _id: u._id,
      fullName: u.fullName,
      profilePicture: u.profilePicture,
      blockedAt: b.createdAt,
    });
  }
  return rows;
}

/**
 * Returns the union of user IDs the viewer has blocked and user IDs who blocked the viewer.
 * Any content authored by these users should be excluded from feeds shown to the viewer.
 */
export async function getBlockedUserIds(
  userId: string
): Promise<Types.ObjectId[]> {
  const oid = new Types.ObjectId(userId);
  const [iBlocked, blockedMe] = await Promise.all([
    Block.find({ blockerId: oid }).select("blockedId").lean(),
    Block.find({ blockedId: oid }).select("blockerId").lean(),
  ]);

  const set = new Map<string, Types.ObjectId>();
  for (const b of iBlocked) set.set(b.blockedId.toString(), b.blockedId);
  for (const b of blockedMe) set.set(b.blockerId.toString(), b.blockerId);
  return Array.from(set.values());
}

/** Bidirectional check: true if either user has blocked the other. */
export async function isBlocked(a: string, b: string): Promise<boolean> {
  const aOid = new Types.ObjectId(a);
  const bOid = new Types.ObjectId(b);
  const existing = await Block.findOne({
    $or: [
      { blockerId: aOid, blockedId: bOid },
      { blockerId: bOid, blockedId: aOid },
    ],
  })
    .select("_id")
    .lean();
  return existing !== null;
}
