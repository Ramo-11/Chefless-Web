import { describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import Notification from "../../models/Notification";
import User from "../../models/User";
import { createTestRecipe, createTestUser } from "../helpers";
import {
  clearNotifications,
  createNotification,
  notifyRecipeShared,
} from "../../services/notification-service";

const { sendPushNotificationMock } = vi.hoisted(() => ({
  sendPushNotificationMock: vi.fn(),
}));

vi.mock("../../lib/fcm", () => ({
  sendPushNotification: sendPushNotificationMock,
}));

describe("notification-service", () => {
  it("does not create a notification when that type is disabled in preferences", async () => {
    const recipient = await createTestUser();
    await User.updateOne(
      { _id: recipient._id },
      { $set: { "notificationPreferences.recipe_shared": false } }
    );

    const result = await createNotification({
      userId: recipient._id,
      type: "recipe_shared",
      recipeId: new Types.ObjectId(),
      recipeTitle: "Kabsa",
      pushTitle: "Recipe Shared",
      pushBody: "Someone shared a recipe with you.",
    });

    expect(result).toBeNull();
    expect(await Notification.countDocuments()).toBe(0);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("stores the sender note inside a shared recipe notification", async () => {
    const sender = await createTestUser({ fullName: "Sarah" });
    const recipient = await createTestUser({
      fullName: "Omar",
      email: "omar@test.com",
    });
    const recipe = await createTestRecipe({
      authorId: sender._id,
      title: "Chicken Kabsa",
    });

    await notifyRecipeShared(
      sender._id.toString(),
      recipient._id.toString(),
      recipe._id.toString(),
      "You should try this on Friday."
    );

    const notification = await Notification.findOne({
      userId: recipient._id,
      type: "recipe_shared",
    }).lean();

    expect(notification).not.toBeNull();
    expect(notification?.recipeTitle).toBe("Chicken Kabsa");
    expect(notification?.shareMessage).toBe("You should try this on Friday.");
  });

  it("clears only the selected notifications when ids are provided", async () => {
    const user = await createTestUser();
    const first = await Notification.create({
      userId: user._id,
      type: "new_follower",
    });
    await Notification.create({
      userId: user._id,
      type: "recipe_liked",
    });

    const deletedCount = await clearNotifications(user._id.toString(), [
      first._id.toString(),
    ]);

    expect(deletedCount).toBe(1);
    expect(await Notification.countDocuments({ userId: user._id })).toBe(1);
  });

  it("clears all notifications only for the current user when no ids are provided", async () => {
    const currentUser = await createTestUser();
    const otherUser = await createTestUser({ email: "other@test.com" });

    await Notification.create([
      { userId: currentUser._id, type: "new_follower" },
      { userId: currentUser._id, type: "recipe_liked" },
      { userId: otherUser._id, type: "recipe_forked" },
    ]);

    const deletedCount = await clearNotifications(currentUser._id.toString());

    expect(deletedCount).toBe(2);
    expect(await Notification.countDocuments({ userId: currentUser._id })).toBe(0);
    expect(await Notification.countDocuments({ userId: otherUser._id })).toBe(1);
  });
});
