import { Request, Response } from "express";
import { Types } from "mongoose";
import { logger } from "../../lib/logger";
import { getAppConfig } from "../../lib/app-config";
import User from "../../models/User";

interface TestUserView {
  id: string;
  fullName: string;
  email: string;
  profilePicture?: string;
}

async function loadTestUsers(
  ids: Types.ObjectId[]
): Promise<TestUserView[]> {
  if (ids.length === 0) return [];
  const users = await User.find({ _id: { $in: ids } })
    .select("fullName email profilePicture")
    .lean();
  // Preserve the order admin added users in.
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return ids
    .map((id) => byId.get(id.toString()))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      id: u._id.toString(),
      fullName: u.fullName,
      email: u.email,
      profilePicture: u.profilePicture,
    }));
}

export async function appConfigPage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const config = await getAppConfig();
    const testUsers = await loadTestUsers(config.wrappedTestUserIds);
    res.render("app-config", {
      page: "app-config",
      wrappedEnabled: config.wrappedEnabled,
      wrappedYear: config.wrappedYear,
      wrappedRevision: config.wrappedRevision,
      wrappedTestUsers: testUsers,
      currentYear: new Date().getUTCFullYear(),
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to load app-config page");
    res.status(500).send("Internal server error");
  }
}

export async function updateAppConfig(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const config = await getAppConfig();
    const { wrappedEnabled, wrappedYear, bumpWrappedRevision } = req.body as {
      wrappedEnabled?: unknown;
      wrappedYear?: unknown;
      bumpWrappedRevision?: unknown;
    };

    if (wrappedEnabled !== undefined) {
      config.wrappedEnabled = Boolean(wrappedEnabled);
    }

    if (wrappedYear !== undefined) {
      if (wrappedYear === null || wrappedYear === "") {
        config.wrappedYear = null;
      } else {
        const parsed = Number(wrappedYear);
        // Cap at current UTC year — the wrapped endpoint refuses anything
        // beyond, and an admin-saved future year would silently break the
        // auto-launch with a 400 on every device.
        const maxYear = new Date().getUTCFullYear();
        if (!Number.isInteger(parsed) || parsed < 2025 || parsed > maxYear) {
          res.status(400).json({
            error: `Wrapped year must be an integer between 2025 and ${maxYear}.`,
          });
          return;
        }
        config.wrappedYear = parsed;
      }
    }

    if (bumpWrappedRevision) {
      config.wrappedRevision = (config.wrappedRevision ?? 0) + 1;
    }

    await config.save();
    res.json({
      success: true,
      wrappedEnabled: config.wrappedEnabled,
      wrappedYear: config.wrappedYear,
      wrappedRevision: config.wrappedRevision,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to update app config");
    res.status(500).json({ error: "Failed to update app config" });
  }
}

export async function addWrappedTestUser(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email } = req.body as { email?: unknown };
    if (typeof email !== "string" || email.trim().length === 0) {
      res.status(400).json({ error: "Email is required." });
      return;
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() })
      .select("_id fullName email profilePicture")
      .lean();
    if (!user) {
      res
        .status(404)
        .json({ error: "No user found with that email address." });
      return;
    }

    const config = await getAppConfig();
    const alreadyAdded = config.wrappedTestUserIds.some(
      (id) => id.toString() === user._id.toString()
    );
    if (alreadyAdded) {
      res
        .status(409)
        .json({ error: "That user is already on the test list." });
      return;
    }

    config.wrappedTestUserIds.push(user._id);
    await config.save();

    res.json({
      success: true,
      user: {
        id: user._id.toString(),
        fullName: user.fullName,
        email: user.email,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to add wrapped test user");
    res.status(500).json({ error: "Failed to add test user." });
  }
}

export async function removeWrappedTestUser(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const id = req.params.id;
    if (typeof id !== "string" || !Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid user id." });
      return;
    }
    const config = await getAppConfig();
    const before = config.wrappedTestUserIds.length;
    config.wrappedTestUserIds = config.wrappedTestUserIds.filter(
      (existing) => existing.toString() !== id
    );
    if (config.wrappedTestUserIds.length === before) {
      res.status(404).json({ error: "User is not on the test list." });
      return;
    }
    await config.save();
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to remove wrapped test user");
    res.status(500).json({ error: "Failed to remove test user." });
  }
}
