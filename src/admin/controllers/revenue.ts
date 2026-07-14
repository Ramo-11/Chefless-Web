import { Request, Response } from "express";
import { getRevenueAnalytics } from "../../services/revenue-service";
import { logger } from "../../lib/logger";

export async function revenuePage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const analytics = await getRevenueAnalytics();

    res.render("revenue", {
      page: "revenue",

      // Headline totals (all time)
      totals: analytics.totals,

      // Per-store breakdown (Apple, Google, etc.)
      byStore: analytics.byStore,

      // Recurring revenue and subscriber counts
      recurring: analytics.recurring,

      // Charts
      monthlyTrend: analytics.monthlyTrend,

      // Recent activity table
      recentTransactions: analytics.recentTransactions,

      // Context notes
      sandboxCount: analytics.sandboxCount,
      dataSince: analytics.dataSince,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to load revenue analytics");
    res.status(500).send("Internal server error");
  }
}
