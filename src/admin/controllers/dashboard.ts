import { Request, Response } from "express";
import User from "../../models/User";
import Recipe from "../../models/Recipe";
import Kitchen from "../../models/Kitchen";
import Report from "../../models/Report";
import { logger } from "../../lib/logger";

export async function dashboardPage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsersWeek,
      newUsersMonth,
      totalRecipes,
      totalKitchens,
      pendingReports,
      premiumUsers,
      recentUsers,
      bannedUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      User.countDocuments({ createdAt: { $gte: monthAgo } }),
      Recipe.countDocuments(),
      Kitchen.countDocuments(),
      Report.countDocuments({ status: "pending" }),
      User.countDocuments({ isPremium: true }),
      User.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select("fullName email isPremium createdAt profilePicture")
        .lean(),
      User.countDocuments({ isBanned: true }),
    ]);

    res.render("dashboard", {
      page: "dashboard",
      stats: {
        totalUsers,
        newUsersWeek,
        newUsersMonth,
        totalRecipes,
        totalKitchens,
        pendingReports,
        premiumUsers,
        bannedUsers,
      },
      recentUsers,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to load dashboard");
    res.status(500).send("Internal server error");
  }
}
