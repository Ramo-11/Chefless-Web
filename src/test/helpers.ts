import { Types } from "mongoose";
import User from "../models/User";
import Recipe from "../models/Recipe";
import Report from "../models/Report";
import type { ReportReason, ReportTargetType } from "../models/Report";

interface CreateTestUserOptions {
  firebaseUid?: string;
  email?: string;
  fullName?: string;
  isAdmin?: boolean;
  isBanned?: boolean;
  isPublic?: boolean;
}

export async function createTestUser(options: CreateTestUserOptions = {}) {
  const id = new Types.ObjectId();
  return User.create({
    _id: id,
    firebaseUid: options.firebaseUid ?? `firebase-${id.toString()}`,
    email: options.email ?? `user-${id.toString()}@test.com`,
    fullName: options.fullName ?? "Test User",
    isAdmin: options.isAdmin ?? false,
    isBanned: options.isBanned ?? false,
    isPublic: options.isPublic ?? true,
  });
}

interface CreateTestRecipeOptions {
  authorId: Types.ObjectId;
  title?: string;
  isPrivate?: boolean;
}

export async function createTestRecipe(options: CreateTestRecipeOptions) {
  return Recipe.create({
    authorId: options.authorId,
    title: options.title ?? "Test Recipe",
    baseServings: 4,
    isPrivate: options.isPrivate ?? false,
    ingredients: [
      { name: "Salt", quantity: 1, unit: "tsp" },
    ],
    steps: [
      { order: 1, instruction: "Mix ingredients" },
    ],
  });
}

interface CreateTestReportOptions {
  reporterId: Types.ObjectId;
  targetType?: ReportTargetType;
  targetId: Types.ObjectId;
  reason?: ReportReason;
  description?: string;
}

export async function createTestReport(options: CreateTestReportOptions) {
  return Report.create({
    reporterId: options.reporterId,
    targetType: options.targetType ?? "recipe",
    targetId: options.targetId,
    reason: options.reason ?? "spam",
    description: options.description,
  });
}

export function getAuthHeaders(token = "mock-firebase-token") {
  return {
    Authorization: `Bearer ${token}`,
  };
}
