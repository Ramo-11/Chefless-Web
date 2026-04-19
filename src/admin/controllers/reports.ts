import { Request, Response } from "express";
import Report from "../../models/Report";
import Recipe from "../../models/Recipe";
import User from "../../models/User";
import { logger } from "../../lib/logger";

export async function reportsPage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const status = (req.query.status as string) || "pending";
    const targetType = (req.query.targetType as string) || "";

    const query: Record<string, unknown> = {};
    if (status && status !== "all") query.status = status;
    if (targetType) query.targetType = targetType;

    const skip = (page - 1) * limit;

    const [reports, total, pendingCount] = await Promise.all([
      Report.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("reporterId", "fullName email profilePicture")
        .populate("reviewedBy", "fullName")
        .lean(),
      Report.countDocuments(query),
      Report.countDocuments({ status: "pending" }),
    ]);

    // Fetch target details for each report
    const enrichedReports = await Promise.all(
      reports.map(async (report) => {
        let targetName = "Unknown";
        if (report.targetType === "recipe") {
          const recipe = await Recipe.findById(report.targetId)
            .select("title")
            .lean();
          targetName = recipe?.title || "Deleted recipe";
        } else if (report.targetType === "user") {
          const user = await User.findById(report.targetId)
            .select("fullName")
            .lean();
          targetName = user?.fullName || "Deleted user";
        }
        return { ...report, targetName };
      })
    );

    const totalPages = Math.ceil(total / limit);

    res.render("reports", {
      page: "reports",
      reports: enrichedReports,
      pagination: { current: page, total: totalPages, totalItems: total },
      status,
      targetType,
      pendingCount,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to load reports page");
    res.status(500).send("Internal server error");
  }
}

export async function reviewReport(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { status, reviewNote } = req.body;

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        status,
        reviewedBy: req.session.adminId,
        reviewNote,
      },
      { new: true }
    ).lean();

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    res.json({ success: true, report });
  } catch (error) {
    logger.error({ err: error }, "Failed to review report");
    res.status(500).json({ error: "Failed to update report" });
  }
}

export async function dismissReport(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const report = await Report.findByIdAndUpdate(req.params.id, {
      status: "dismissed",
      reviewedBy: req.session.adminId,
    });

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to dismiss report");
    res.status(500).json({ error: "Failed to dismiss report" });
  }
}
