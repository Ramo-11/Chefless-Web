import { Types } from "mongoose";
import { randomInt } from "crypto";
import Kitchen, { IKitchen } from "../models/Kitchen";
import User, { IUser } from "../models/User";
import Recipe, { IRecipe } from "../models/Recipe";
import ScheduleEntry from "../models/ScheduleEntry";
import ShoppingList from "../models/ShoppingList";
import KitchenInvite, { IKitchenInvite } from "../models/KitchenInvite";
import {
  notifyKitchenInviteWelcome,
  notifyKitchenJoined,
  notifyKitchenRemoved,
  notifyKitchenInviteReceived,
  notifyKitchenInviteAccepted,
  notifyKitchenInviteDeclined,
} from "./notification-service";

const FREE_TIER_MAX_MEMBERS = 4;

/** Regex for validating invite codes. Shared with route validation. */
export const INVITE_CODE_REGEX = /^CHEF-[A-Z0-9]{6}$/;

/**
 * How long a newly minted invite code is accepted by `joinKitchen`. After this
 * window the lead must call `regenerateInviteCode` to mint a fresh one. This
 * caps long-lived codes from floating around in group chats or email threads
 * forever and limits the window for brute-force guessing.
 */
const INVITE_CODE_TTL_DAYS = 30;

function nextInviteCodeExpiry(): Date {
  return new Date(Date.now() + INVITE_CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

interface ServiceError extends Error {
  statusCode: number;
}

function createError(message: string, statusCode: number): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

function generateInviteCode(): string {
  // Use crypto.randomInt so codes cannot be predicted by an attacker observing
  // timing or other state. Math.random is not cryptographically secure and must
  // never be used for security-relevant tokens like invite codes.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "CHEF-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(randomInt(0, chars.length));
  }
  return code;
}

const MAX_INVITE_CODE_RETRIES = 10;

async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_INVITE_CODE_RETRIES; attempt++) {
    const code = generateInviteCode();
    const exists = await Kitchen.findOne({ inviteCode: code }).lean();
    if (!exists) return code;
  }
  throw createError("Failed to generate a unique invite code. Please try again.", 500);
}

interface KitchenMember {
  _id: Types.ObjectId;
  fullName: string;
  profilePicture?: string;
  recipesCount?: number;
}

interface KitchenWithMembers {
  kitchen: IKitchen;
  members: KitchenMember[];
}

interface PaginatedRecipes {
  data: IRecipe[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function createKitchen(
  userId: string,
  name: string,
  photo?: string
): Promise<IKitchen> {
  const user = await User.findById(userId);
  if (!user) {
    throw createError("User not found", 404);
  }

  if (user.kitchenId) {
    throw createError("You are already in a kitchen", 400);
  }

  const inviteCode = await generateUniqueInviteCode();

  const kitchen = await Kitchen.create({
    name,
    leadId: new Types.ObjectId(userId),
    inviteCode,
    inviteCodeExpiresAt: nextInviteCodeExpiry(),
    photo,
    membersWithScheduleEdit: [],
    membersWithApprovalPower: [],
    memberCount: 1,
  });

  await User.updateOne(
    { _id: userId },
    { $set: { kitchenId: kitchen._id } }
  );

  return kitchen;
}

export async function getMyKitchen(
  userId: string
): Promise<KitchenWithMembers | null> {
  const user = await User.findById(userId).select("kitchenId").lean();
  if (!user || !user.kitchenId) {
    return null;
  }

  const kitchen = await Kitchen.findById(user.kitchenId);
  if (!kitchen) {
    return null;
  }

  const members = await User.find({ kitchenId: kitchen._id })
    .select("fullName profilePicture recipesCount")
    .lean<KitchenMember[]>();

  return { kitchen, members };
}

export async function updateKitchen(
  userId: string,
  updates: {
    name?: string;
    photo?: string;
    isPublic?: boolean;
    scheduleAddPolicy?: "lead_only" | "all";
  }
): Promise<IKitchen> {
  const user = await User.findById(userId).select("kitchenId").lean();
  if (!user || !user.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }

  const kitchen = await Kitchen.findById(user.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  if (!kitchen.leadId.equals(userId)) {
    throw createError("Only the kitchen lead can update the kitchen", 403);
  }

  const updateFields: Record<string, string | boolean> = {};
  if (updates.name !== undefined) updateFields.name = updates.name;
  if (updates.photo !== undefined) updateFields.photo = updates.photo;
  if (updates.isPublic !== undefined) updateFields.isPublic = updates.isPublic;
  if (updates.scheduleAddPolicy !== undefined) {
    updateFields.scheduleAddPolicy = updates.scheduleAddPolicy;
  }

  const updated = await Kitchen.findByIdAndUpdate(
    kitchen._id,
    { $set: updateFields },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw createError("Kitchen not found", 404);
  }

  return updated;
}

export async function deleteKitchen(userId: string): Promise<void> {
  const user = await User.findById(userId).select("kitchenId").lean();
  if (!user || !user.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }

  const kitchen = await Kitchen.findById(user.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  if (!kitchen.leadId.equals(userId)) {
    throw createError("Only the kitchen lead can delete the kitchen", 403);
  }

  // Clean up all kitchen-related data before deleting
  await Promise.all([
    ScheduleEntry.deleteMany({ kitchenId: kitchen._id }),
    ShoppingList.deleteMany({ kitchenId: kitchen._id }),
    KitchenInvite.deleteMany({
      kitchenId: kitchen._id,
      status: "pending",
    }),
  ]);

  // Clear kitchenId for all members
  await User.updateMany(
    { kitchenId: kitchen._id },
    { $unset: { kitchenId: 1 } }
  );

  await Kitchen.findByIdAndDelete(kitchen._id);
}

export async function joinKitchen(
  userId: string,
  inviteCode: string
): Promise<IKitchen> {
  const user = await User.findById(userId);
  if (!user) {
    throw createError("User not found", 404);
  }

  if (user.kitchenId) {
    throw createError("You must leave your current kitchen first", 400);
  }

  const kitchen = await Kitchen.findOne({ inviteCode });
  if (!kitchen) {
    throw createError("Invalid invite code", 404);
  }

  // Invite codes expire 30 days after issue. Legacy kitchens created before
  // the expiry feature shipped have `inviteCodeExpiresAt` undefined and are
  // grandfathered through as non-expiring; new and regenerated codes always
  // have a concrete expiry.
  if (
    kitchen.inviteCodeExpiresAt &&
    kitchen.inviteCodeExpiresAt.getTime() < Date.now()
  ) {
    throw createError(
      "This invite code has expired. Ask the kitchen lead to share a fresh one.",
      410
    );
  }

  // Check capacity based on lead's premium status
  const lead = await User.findById(kitchen.leadId).select("isPremium premiumExpiresAt").lean();
  if (!lead) {
    throw createError("Kitchen lead not found", 404);
  }

  const leadHasPremium = lead.isPremium && (!lead.premiumExpiresAt || new Date(lead.premiumExpiresAt) > new Date());
  if (!leadHasPremium && kitchen.memberCount >= FREE_TIER_MAX_MEMBERS) {
    throw createError(
      "This kitchen has reached its maximum capacity. The kitchen lead needs to upgrade to premium.",
      403
    );
  }

  await User.updateOne(
    { _id: userId },
    { $set: { kitchenId: kitchen._id } }
  );

  const updated = await Kitchen.findByIdAndUpdate(
    kitchen._id,
    { $inc: { memberCount: 1 } },
    { new: true }
  );

  if (!updated) {
    throw createError("Kitchen not found", 404);
  }

  // Passive cleanup: if the user had pending in-app invites to other kitchens
  // (or to this one), mark them as declined. No notifications are sent to the
  // original senders — the user chose a kitchen another way.
  await KitchenInvite.updateMany(
    {
      recipientId: new Types.ObjectId(userId),
      status: "pending",
    },
    { $set: { status: "declined" } }
  );

  notifyKitchenJoined(userId, kitchen._id.toString()).catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`Failed to send kitchen_joined notification: ${msg}`);
    }
  );

  notifyKitchenInviteWelcome(userId, kitchen._id.toString()).catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`Failed to send kitchen_invite notification: ${msg}`);
    }
  );

  return updated;
}

export async function leaveKitchen(userId: string): Promise<void> {
  const user = await User.findById(userId).select("kitchenId").lean();
  if (!user || !user.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }

  const kitchen = await Kitchen.findById(user.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  const isLead = kitchen.leadId.equals(userId);

  // Remove the user from the kitchen
  await User.updateOne(
    { _id: userId },
    { $unset: { kitchenId: 1 } }
  );

  // Remove user from permission arrays
  await Kitchen.updateOne(
    { _id: kitchen._id },
    {
      $pull: {
        membersWithScheduleEdit: new Types.ObjectId(userId),
        membersWithApprovalPower: new Types.ObjectId(userId),
      },
    }
  );

  // Cancel any pending invites this user sent — they can no longer vouch for a
  // kitchen they've left. Delete outright (not marked declined) because the
  // departure is a silent cancellation, not a recipient-side decision.
  await KitchenInvite.deleteMany({
    senderId: new Types.ObjectId(userId),
    kitchenId: kitchen._id,
    status: "pending",
  });

  // Silently drop any pending schedule suggestions this user left behind.
  // The suggester is no longer a member, so approving/denying would notify a
  // non-member — cleanest to delete and leave the approvers' queue clean.
  await ScheduleEntry.deleteMany({
    kitchenId: kitchen._id,
    suggestedBy: new Types.ObjectId(userId),
    status: "suggested",
  });

  if (kitchen.memberCount <= 1) {
    // Last member — delete the kitchen and drop any remaining pending invites.
    await KitchenInvite.deleteMany({
      kitchenId: kitchen._id,
      status: "pending",
    });
    await Kitchen.findByIdAndDelete(kitchen._id);
    return;
  }

  // Decrement member count
  await Kitchen.updateOne(
    { _id: kitchen._id },
    { $inc: { memberCount: -1 } }
  );

  // If lead is leaving, auto-transfer to the longest-tenured member
  if (isLead) {
    const nextLead = await User.findOne({
      kitchenId: kitchen._id,
      _id: { $ne: new Types.ObjectId(userId) },
    })
      .sort({ createdAt: 1 })
      .select("_id")
      .lean();

    if (nextLead) {
      await Kitchen.updateOne(
        { _id: kitchen._id },
        { $set: { leadId: nextLead._id } }
      );
    }
  }
}

export async function removeMember(
  leadId: string,
  memberId: string
): Promise<void> {
  const lead = await User.findById(leadId).select("kitchenId").lean();
  if (!lead || !lead.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }

  const kitchen = await Kitchen.findById(lead.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  if (!kitchen.leadId.equals(leadId)) {
    throw createError("Only the kitchen lead can remove members", 403);
  }

  if (leadId === memberId) {
    throw createError("Cannot remove yourself. Use leave instead.", 400);
  }

  const member = await User.findById(memberId).select("kitchenId").lean();
  if (!member || !member.kitchenId || !member.kitchenId.equals(kitchen._id)) {
    throw createError("User is not a member of this kitchen", 404);
  }

  await User.updateOne(
    { _id: memberId },
    { $unset: { kitchenId: 1 } }
  );

  await Kitchen.updateOne(
    { _id: kitchen._id },
    {
      $inc: { memberCount: -1 },
      $pull: {
        membersWithScheduleEdit: new Types.ObjectId(memberId),
        membersWithApprovalPower: new Types.ObjectId(memberId),
      },
    }
  );

  // Silently drop any pending schedule suggestions this member left behind.
  await ScheduleEntry.deleteMany({
    kitchenId: kitchen._id,
    suggestedBy: new Types.ObjectId(memberId),
    status: "suggested",
  });

  // Fire-and-forget notification
  notifyKitchenRemoved(memberId, kitchen._id.toString(), kitchen.name).catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`Failed to send kitchen_removed notification: ${msg}`);
    }
  );
}

export async function transferLead(
  currentLeadId: string,
  newLeadId: string
): Promise<IKitchen> {
  if (currentLeadId === newLeadId) {
    throw createError("Cannot transfer leadership to yourself", 400);
  }

  const lead = await User.findById(currentLeadId).select("kitchenId").lean();
  if (!lead || !lead.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }

  const kitchen = await Kitchen.findById(lead.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  if (!kitchen.leadId.equals(currentLeadId)) {
    throw createError("Only the kitchen lead can transfer leadership", 403);
  }

  const newLead = await User.findById(newLeadId).select("kitchenId").lean();
  if (!newLead || !newLead.kitchenId || !newLead.kitchenId.equals(kitchen._id)) {
    throw createError("Target user is not a member of this kitchen", 404);
  }

  // Atomic conditional update: only transfer if `leadId` still equals the
  // pre-check value. If another request transferred or changed the lead in
  // the meantime, modifiedCount is 0 and we surface a 409 rather than
  // silently overwriting someone else's transfer.
  const result = await Kitchen.updateOne(
    { _id: kitchen._id, leadId: new Types.ObjectId(currentLeadId) },
    { $set: { leadId: new Types.ObjectId(newLeadId) } }
  );

  if (result.modifiedCount === 0) {
    throw createError("Lead changed concurrently. Please refresh and try again.", 409);
  }

  // The ex-lead's pending invites should no longer carry their authority. Keep
  // them out of the recipient's inbox by deleting silently — the new lead can
  // re-invite anyone they want.
  await KitchenInvite.deleteMany({
    kitchenId: kitchen._id,
    senderId: new Types.ObjectId(currentLeadId),
    status: "pending",
  });

  const updated = await Kitchen.findById(kitchen._id);
  if (!updated) {
    throw createError("Kitchen not found", 404);
  }

  return updated;
}

export async function updatePermissions(
  leadId: string,
  permissions: {
    membersWithScheduleEdit?: string[];
    membersWithApprovalPower?: string[];
  }
): Promise<IKitchen> {
  const lead = await User.findById(leadId).select("kitchenId").lean();
  if (!lead || !lead.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }

  const kitchen = await Kitchen.findById(lead.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  if (!kitchen.leadId.equals(leadId)) {
    throw createError("Only the kitchen lead can update permissions", 403);
  }

  // Verify all user IDs belong to actual kitchen members
  const allProvidedIds = [
    ...(permissions.membersWithScheduleEdit ?? []),
    ...(permissions.membersWithApprovalPower ?? []),
  ];

  if (allProvidedIds.length > 0) {
    const memberCount = await User.countDocuments({
      _id: { $in: allProvidedIds.map((id) => new Types.ObjectId(id)) },
      kitchenId: kitchen._id,
    });
    if (memberCount !== allProvidedIds.length) {
      throw createError("One or more users are not members of this kitchen", 400);
    }
  }

  const updateFields: Record<string, Types.ObjectId[]> = {};

  if (permissions.membersWithScheduleEdit !== undefined) {
    updateFields.membersWithScheduleEdit =
      permissions.membersWithScheduleEdit.map((id) => new Types.ObjectId(id));
  }

  if (permissions.membersWithApprovalPower !== undefined) {
    updateFields.membersWithApprovalPower =
      permissions.membersWithApprovalPower.map((id) => new Types.ObjectId(id));
  }

  const updated = await Kitchen.findByIdAndUpdate(
    kitchen._id,
    { $set: updateFields },
    { new: true }
  );

  if (!updated) {
    throw createError("Kitchen not found", 404);
  }

  return updated;
}

export async function regenerateInviteCode(
  userId: string
): Promise<IKitchen> {
  const user = await User.findById(userId).select("kitchenId").lean();
  if (!user || !user.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }

  const kitchen = await Kitchen.findById(user.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  if (!kitchen.leadId.equals(userId)) {
    throw createError("Only the kitchen lead can regenerate the invite code", 403);
  }

  const newCode = await generateUniqueInviteCode();

  const updated = await Kitchen.findByIdAndUpdate(
    kitchen._id,
    {
      $set: {
        inviteCode: newCode,
        inviteCodeExpiresAt: nextInviteCodeExpiry(),
      },
    },
    { new: true }
  );

  if (!updated) {
    throw createError("Kitchen not found", 404);
  }

  return updated;
}

// ─── Kitchen Invites (in-app) ────────────────────────────────────────────────

interface PopulatedKitchenInvite {
  _id: Types.ObjectId;
  kitchenId: Types.ObjectId;
  kitchenName: string;
  senderId: {
    _id: Types.ObjectId;
    fullName: string;
    profilePicture?: string;
  };
  recipientId: Types.ObjectId;
  status: "pending" | "accepted" | "declined";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Check whether the kitchen has capacity for another member, taking the
 * lead's premium status into account. Throws the same 403 error as
 * `joinKitchen` so the user-facing message stays consistent.
 */
async function assertKitchenHasCapacity(
  kitchen: IKitchen
): Promise<void> {
  const lead = await User.findById(kitchen.leadId)
    .select("isPremium premiumExpiresAt")
    .lean();
  if (!lead) {
    throw createError("Kitchen lead not found", 404);
  }

  const leadHasPremium =
    lead.isPremium &&
    (!lead.premiumExpiresAt ||
      new Date(lead.premiumExpiresAt) > new Date());

  if (!leadHasPremium && kitchen.memberCount >= FREE_TIER_MAX_MEMBERS) {
    throw createError(
      "This kitchen has reached its maximum capacity. The kitchen lead needs to upgrade to premium.",
      403
    );
  }
}

export async function sendKitchenInvite(
  senderId: string,
  recipientUserId: string
): Promise<IKitchenInvite> {
  if (senderId === recipientUserId) {
    throw createError("You can't invite yourself.", 400);
  }

  const sender = await User.findById(senderId)
    .select("kitchenId isBanned")
    .lean();
  if (!sender || !sender.kitchenId) {
    throw createError("You are not in a kitchen", 400);
  }
  if (sender.isBanned) {
    throw createError("Your account cannot send invites.", 403);
  }

  const kitchen = await Kitchen.findById(sender.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen not found", 404);
  }

  const recipient = await User.findById(recipientUserId)
    .select("kitchenId isBanned")
    .lean();
  if (!recipient) {
    throw createError("User not found", 404);
  }
  if (recipient.isBanned) {
    throw createError("This user cannot receive invites.", 400);
  }
  if (recipient.kitchenId) {
    if (recipient.kitchenId.equals(kitchen._id)) {
      throw createError("This user is already in your kitchen.", 400);
    }
    throw createError("This user is already in another kitchen.", 400);
  }

  await assertKitchenHasCapacity(kitchen);

  const existingPending = await KitchenInvite.findOne({
    kitchenId: kitchen._id,
    recipientId: new Types.ObjectId(recipientUserId),
    status: "pending",
  }).lean();
  if (existingPending) {
    throw createError("You've already sent this user an invite.", 409);
  }

  let invite: IKitchenInvite;
  try {
    invite = await KitchenInvite.create({
      kitchenId: kitchen._id,
      kitchenName: kitchen.name,
      senderId: new Types.ObjectId(senderId),
      recipientId: new Types.ObjectId(recipientUserId),
      status: "pending",
    });
  } catch (err: unknown) {
    // Race condition: the unique partial index on
    // `{kitchenId, recipientId, status:"pending"}` rejected a duplicate that
    // slipped past the pre-check above. Surface a friendly 409 instead of a
    // raw Mongo error.
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      throw createError("You've already sent this user an invite.", 409);
    }
    throw err;
  }

  // Fire-and-forget push + in-app notification.
  notifyKitchenInviteReceived(
    senderId,
    recipientUserId,
    kitchen._id.toString(),
    invite._id.toString()
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Failed to send kitchen_invite_received notification: ${msg}`);
  });

  return invite;
}

export async function acceptKitchenInvite(
  userId: string,
  inviteId: string
): Promise<{ kitchen: IKitchen }> {
  const invite = await KitchenInvite.findById(inviteId);
  if (!invite) {
    throw createError("Invite not found", 404);
  }

  if (!invite.recipientId.equals(userId)) {
    throw createError("This invite is not for you", 403);
  }

  if (invite.status !== "pending") {
    throw createError("This invite is no longer pending.", 409);
  }

  const user = await User.findById(userId).select("kitchenId").lean();
  if (!user) {
    throw createError("User not found", 404);
  }
  if (user.kitchenId) {
    throw createError("You must leave your current kitchen first", 400);
  }

  const kitchen = await Kitchen.findById(invite.kitchenId);
  if (!kitchen) {
    throw createError("Kitchen no longer exists", 404);
  }

  await assertKitchenHasCapacity(kitchen);

  // Move the user into the kitchen and mark the invite accepted.
  await User.updateOne(
    { _id: userId },
    { $set: { kitchenId: kitchen._id } }
  );

  const updatedKitchen = await Kitchen.findByIdAndUpdate(
    kitchen._id,
    { $inc: { memberCount: 1 } },
    { new: true }
  );
  if (!updatedKitchen) {
    throw createError("Kitchen not found", 404);
  }

  invite.status = "accepted";
  await invite.save();

  // Auto-decline any other pending invites for this recipient — they can
  // only be in one kitchen at a time.
  await KitchenInvite.updateMany(
    {
      recipientId: new Types.ObjectId(userId),
      status: "pending",
      _id: { $ne: invite._id },
    },
    { $set: { status: "declined" } }
  );

  // Notify the original sender.
  notifyKitchenInviteAccepted(
    userId,
    kitchen._id.toString(),
    invite.senderId.toString()
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `Failed to send kitchen_invite_accepted notification: ${msg}`
    );
  });

  // If the sender is the lead, the "invite accepted" receipt already informs
  // them. Skip the generic kitchen_joined duplicate in that case.
  if (!kitchen.leadId.equals(invite.senderId)) {
    notifyKitchenJoined(userId, kitchen._id.toString()).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Failed to send kitchen_joined notification: ${msg}`);
      }
    );
  }

  return { kitchen: updatedKitchen };
}

export async function declineKitchenInvite(
  userId: string,
  inviteId: string
): Promise<{ success: true }> {
  const invite = await KitchenInvite.findById(inviteId);
  if (!invite) {
    throw createError("Invite not found", 404);
  }

  if (!invite.recipientId.equals(userId)) {
    throw createError("This invite is not for you", 403);
  }

  if (invite.status !== "pending") {
    throw createError("This invite is no longer pending.", 409);
  }

  invite.status = "declined";
  await invite.save();

  notifyKitchenInviteDeclined(
    userId,
    invite.kitchenId.toString(),
    invite.senderId.toString()
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `Failed to send kitchen_invite_declined notification: ${msg}`
    );
  });

  return { success: true };
}

export async function listPendingInvitesForRecipient(
  userId: string
): Promise<PopulatedKitchenInvite[]> {
  const invites = await KitchenInvite.find({
    recipientId: new Types.ObjectId(userId),
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .populate<{
      senderId: {
        _id: Types.ObjectId;
        fullName: string;
        profilePicture?: string;
      };
    }>("senderId", "fullName profilePicture")
    .lean<PopulatedKitchenInvite[]>();

  return invites;
}

export async function cancelKitchenInvite(
  senderId: string,
  inviteId: string
): Promise<void> {
  const invite = await KitchenInvite.findById(inviteId);
  if (!invite) {
    throw createError("Invite not found", 404);
  }

  if (!invite.senderId.equals(senderId)) {
    throw createError("Only the sender can cancel this invite", 403);
  }

  if (invite.status !== "pending") {
    throw createError("This invite is no longer pending.", 409);
  }

  await KitchenInvite.deleteOne({ _id: invite._id });
}

/**
 * Returns shared (non-private) recipes by active members of this kitchen.
 *
 * Visibility rules (per ARCHITECTURE.md):
 * - Co-members can see each other's **shared** recipes regardless of the
 *   author's account privacy (kitchen membership grants implicit recipe-level
 *   visibility).
 * - Private recipes are NEVER included — they remain invisible even to
 *   fellow kitchen members.
 * - Hidden recipes (moderated) and recipes by banned authors are excluded.
 * - When a specific `memberId` is requested, it must be a current member;
 *   otherwise the caller gets 400.
 */
export async function getKitchenRecipes(
  kitchenId: string,
  page: number,
  limit: number,
  memberId?: string
): Promise<PaginatedRecipes> {
  const skip = (page - 1) * limit;
  const kitchenObjectId = new Types.ObjectId(kitchenId);
  const memberObjectId = memberId ? new Types.ObjectId(memberId) : null;

  // Get all non-banned members of this kitchen. Banned members' recipes must
  // be filtered out: the existing recipe model has `isHidden` which admins use
  // to hide individual content, but a banned-author filter needs to happen at
  // the author layer.
  const activeMembers = await User.find({
    kitchenId: kitchenObjectId,
    isBanned: { $ne: true },
  })
    .select("_id")
    .lean();
  const memberIds = activeMembers.map((u) => u._id);

  if (
    memberObjectId &&
    !memberIds.some((id) => id.toString() === memberObjectId.toString())
  ) {
    throw createError("Selected user is not a member of this kitchen", 400);
  }

  const filter = {
    authorId: memberObjectId ? memberObjectId : { $in: memberIds },
    isPrivate: false,
    isHidden: { $ne: true },
  };

  const [data, total] = await Promise.all([
    Recipe.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<IRecipe[]>(),
    Recipe.countDocuments(filter),
  ]);

  return {
    data,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
