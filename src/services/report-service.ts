import { Types } from "mongoose";
import Report, { ReportReason, ReportStatus } from "../models/Report";
import Recipe from "../models/Recipe";
import User from "../models/User";

interface CreateReportInput {
  reporterId: string;
  targetType: "recipe" | "user";
  targetId: string;
  reason: ReportReason;
  description?: string;
}

interface ReportFilters {
  status?: ReportStatus;
  targetType?: "recipe" | "user";
  page: number;
  limit: number;
}

export async function createReport(input: CreateReportInput) {
  const { reporterId, targetType, targetId, reason, description } = input;

  // Validate target exists
  if (targetType === "recipe") {
    const recipe = await Recipe.findById(targetId).lean();
    if (!recipe) throw Object.assign(new Error("Recipe not found"), { statusCode: 404 });
    if (recipe.authorId.toString() === reporterId) {
      throw Object.assign(new Error("You cannot report your own recipe"), { statusCode: 400 });
    }
  } else if (targetType === "user") {
    const user = await User.findById(targetId).lean();
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    if (user._id.toString() === reporterId) {
      throw Object.assign(new Error("You cannot report yourself"), { statusCode: 400 });
    }
  }

  // Check for duplicate
  const existing = await Report.findOne({
    reporterId: new Types.ObjectId(reporterId),
    targetType,
    targetId: new Types.ObjectId(targetId),
  }).lean();

  if (existing) {
    throw Object.assign(
      new Error("You have already reported this content"),
      { statusCode: 409 }
    );
  }

  const report = await Report.create({
    reporterId: new Types.ObjectId(reporterId),
    targetType,
    targetId: new Types.ObjectId(targetId),
    reason,
    description,
  });

  // Increment reports count on recipe
  if (targetType === "recipe") {
    await Recipe.findByIdAndUpdate(targetId, { $inc: { reportsCount: 1 } });
  }

  return report;
}

export async function getReports(filters: ReportFilters) {
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.targetType) query.targetType = filters.targetType;

  const skip = (filters.page - 1) * filters.limit;

  const [reports, total] = await Promise.all([
    Report.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(filters.limit)
      .populate("reporterId", "fullName email profilePicture")
      .populate("reviewedBy", "fullName email")
      .lean(),
    Report.countDocuments(query),
  ]);

  return { reports, total, page: filters.page, totalPages: Math.ceil(total / filters.limit) };
}

export async function getReportById(id: string): Promise<Record<string, unknown>> {
  const report = await Report.findById(id)
    .populate("reporterId", "fullName email profilePicture")
    .populate("reviewedBy", "fullName email")
    .lean();

  if (!report) throw Object.assign(new Error("Report not found"), { statusCode: 404 });

  // Fetch the target details
  let target: Record<string, unknown> | null = null;
  if (report.targetType === "recipe") {
    target = await Recipe.findById(report.targetId)
      .populate("authorId", "fullName email")
      .lean();
  } else if (report.targetType === "user") {
    target = await User.findById(report.targetId)
      .select("fullName email profilePicture isBanned")
      .lean();
  }

  return { ...report, target };
}

export async function reviewReport(
  reportId: string,
  adminUserId: string,
  status: ReportStatus,
  reviewNote?: string
) {
  const report = await Report.findByIdAndUpdate(
    reportId,
    {
      status,
      reviewedBy: new Types.ObjectId(adminUserId),
      reviewNote,
    },
    { new: true }
  )
    .populate("reporterId", "fullName email")
    .lean();

  if (!report) throw Object.assign(new Error("Report not found"), { statusCode: 404 });

  return report;
}

export async function getReportStats() {
  const [pending, reviewed, dismissed, actionTaken, total] = await Promise.all([
    Report.countDocuments({ status: "pending" }),
    Report.countDocuments({ status: "reviewed" }),
    Report.countDocuments({ status: "dismissed" }),
    Report.countDocuments({ status: "action_taken" }),
    Report.countDocuments(),
  ]);

  return { pending, reviewed, dismissed, actionTaken, total };
}
