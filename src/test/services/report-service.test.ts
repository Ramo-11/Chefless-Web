import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { createReport, getReports, reviewReport } from "../../services/report-service";
import { createTestUser, createTestRecipe, createTestReport } from "../helpers";
import Report from "../../models/Report";

describe("report-service", () => {
  describe("createReport", () => {
    it("creates a report for a recipe", async () => {
      const reporter = await createTestUser();
      const author = await createTestUser();
      const recipe = await createTestRecipe({ authorId: author._id });

      const report = await createReport({
        reporterId: reporter._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        reason: "spam",
        description: "This is spam",
      });

      expect(report.reporterId.toString()).toBe(reporter._id.toString());
      expect(report.targetType).toBe("recipe");
      expect(report.targetId.toString()).toBe(recipe._id.toString());
      expect(report.reason).toBe("spam");
      expect(report.description).toBe("This is spam");
      expect(report.status).toBe("pending");
    });

    it("creates a report for a user", async () => {
      const reporter = await createTestUser();
      const target = await createTestUser();

      const report = await createReport({
        reporterId: reporter._id.toString(),
        targetType: "user",
        targetId: target._id.toString(),
        reason: "harassment",
      });

      expect(report.targetType).toBe("user");
      expect(report.targetId.toString()).toBe(target._id.toString());
    });

    it("increments reportsCount on the recipe", async () => {
      const reporter = await createTestUser();
      const author = await createTestUser();
      const recipe = await createTestRecipe({ authorId: author._id });

      await createReport({
        reporterId: reporter._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        reason: "spam",
      });

      const { default: Recipe } = await import("../../models/Recipe");
      const updated = await Recipe.findById(recipe._id).lean();
      expect(updated?.reportsCount).toBe(1);
    });

    it("prevents duplicate reports from same user on same target", async () => {
      const reporter = await createTestUser();
      const author = await createTestUser();
      const recipe = await createTestRecipe({ authorId: author._id });

      await createReport({
        reporterId: reporter._id.toString(),
        targetType: "recipe",
        targetId: recipe._id.toString(),
        reason: "spam",
      });

      await expect(
        createReport({
          reporterId: reporter._id.toString(),
          targetType: "recipe",
          targetId: recipe._id.toString(),
          reason: "inappropriate",
        })
      ).rejects.toThrow("You have already reported this content");
    });

    it("prevents self-reporting own recipe", async () => {
      const user = await createTestUser();
      const recipe = await createTestRecipe({ authorId: user._id });

      await expect(
        createReport({
          reporterId: user._id.toString(),
          targetType: "recipe",
          targetId: recipe._id.toString(),
          reason: "spam",
        })
      ).rejects.toThrow("You cannot report your own recipe");
    });

    it("prevents self-reporting own user profile", async () => {
      const user = await createTestUser();

      await expect(
        createReport({
          reporterId: user._id.toString(),
          targetType: "user",
          targetId: user._id.toString(),
          reason: "spam",
        })
      ).rejects.toThrow("You cannot report yourself");
    });

    it("throws 404 when recipe target does not exist", async () => {
      const reporter = await createTestUser();
      const fakeId = new Types.ObjectId();

      try {
        await createReport({
          reporterId: reporter._id.toString(),
          targetType: "recipe",
          targetId: fakeId.toString(),
          reason: "spam",
        });
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as Error & { statusCode?: number };
        expect(error.message).toBe("Recipe not found");
        expect(error.statusCode).toBe(404);
      }
    });

    it("throws 404 when user target does not exist", async () => {
      const reporter = await createTestUser();
      const fakeId = new Types.ObjectId();

      try {
        await createReport({
          reporterId: reporter._id.toString(),
          targetType: "user",
          targetId: fakeId.toString(),
          reason: "harassment",
        });
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as Error & { statusCode?: number };
        expect(error.message).toBe("User not found");
        expect(error.statusCode).toBe(404);
      }
    });
  });

  describe("getReports", () => {
    it("returns paginated reports sorted by createdAt descending", async () => {
      const reporter = await createTestUser();
      const author = await createTestUser();

      // Create 3 reports with different targets
      for (let i = 0; i < 3; i++) {
        const recipe = await createTestRecipe({ authorId: author._id, title: `Recipe ${i}` });
        await createTestReport({
          reporterId: reporter._id,
          targetId: recipe._id,
          targetType: "recipe",
        });
      }

      const result = await getReports({ page: 1, limit: 2 });

      expect(result.reports).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(2);

      // Verify descending order
      const dates = result.reports.map((r) => new Date(r.createdAt as string).getTime());
      expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
    });

    it("filters by status", async () => {
      const reporter = await createTestUser();
      const author = await createTestUser();
      const recipe1 = await createTestRecipe({ authorId: author._id, title: "Recipe 1" });
      const recipe2 = await createTestRecipe({ authorId: author._id, title: "Recipe 2" });

      const report1 = await createTestReport({
        reporterId: reporter._id,
        targetId: recipe1._id,
      });
      await createTestReport({
        reporterId: reporter._id,
        targetId: recipe2._id,
      });

      // Update one report's status
      await Report.findByIdAndUpdate(report1._id, { status: "reviewed" });

      const pendingResult = await getReports({ status: "pending", page: 1, limit: 10 });
      expect(pendingResult.total).toBe(1);

      const reviewedResult = await getReports({ status: "reviewed", page: 1, limit: 10 });
      expect(reviewedResult.total).toBe(1);
    });

    it("filters by targetType", async () => {
      const reporter = await createTestUser();
      const author = await createTestUser();
      const target = await createTestUser();
      const recipe = await createTestRecipe({ authorId: author._id });

      await createTestReport({
        reporterId: reporter._id,
        targetType: "recipe",
        targetId: recipe._id,
      });
      await createTestReport({
        reporterId: reporter._id,
        targetType: "user",
        targetId: target._id,
      });

      const recipeResult = await getReports({ targetType: "recipe", page: 1, limit: 10 });
      expect(recipeResult.total).toBe(1);
      expect(recipeResult.reports[0].targetType).toBe("recipe");

      const userResult = await getReports({ targetType: "user", page: 1, limit: 10 });
      expect(userResult.total).toBe(1);
      expect(userResult.reports[0].targetType).toBe("user");
    });

    it("returns empty results for page beyond data", async () => {
      const result = await getReports({ page: 5, limit: 10 });
      expect(result.reports).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe("reviewReport", () => {
    it("updates report status and assigns reviewer", async () => {
      const reporter = await createTestUser();
      const admin = await createTestUser({ isAdmin: true });
      const author = await createTestUser();
      const recipe = await createTestRecipe({ authorId: author._id });

      const report = await createTestReport({
        reporterId: reporter._id,
        targetId: recipe._id,
      });

      const reviewed = await reviewReport(
        report._id.toString(),
        admin._id.toString(),
        "reviewed",
        "Checked and confirmed"
      );

      expect(reviewed.status).toBe("reviewed");
      expect(reviewed.reviewedBy?._id.toString()).toBe(admin._id.toString());
      expect(reviewed.reviewNote).toBe("Checked and confirmed");
    });

    it("can set status to action_taken", async () => {
      const reporter = await createTestUser();
      const admin = await createTestUser({ isAdmin: true });
      const author = await createTestUser();
      const recipe = await createTestRecipe({ authorId: author._id });

      const report = await createTestReport({
        reporterId: reporter._id,
        targetId: recipe._id,
      });

      const reviewed = await reviewReport(
        report._id.toString(),
        admin._id.toString(),
        "action_taken",
        "Content removed"
      );

      expect(reviewed.status).toBe("action_taken");
    });

    it("can set status to dismissed", async () => {
      const reporter = await createTestUser();
      const admin = await createTestUser({ isAdmin: true });
      const author = await createTestUser();
      const recipe = await createTestRecipe({ authorId: author._id });

      const report = await createTestReport({
        reporterId: reporter._id,
        targetId: recipe._id,
      });

      const reviewed = await reviewReport(
        report._id.toString(),
        admin._id.toString(),
        "dismissed"
      );

      expect(reviewed.status).toBe("dismissed");
    });

    it("throws 404 for non-existent report", async () => {
      const fakeId = new Types.ObjectId();
      const adminId = new Types.ObjectId();

      try {
        await reviewReport(fakeId.toString(), adminId.toString(), "reviewed");
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as Error & { statusCode?: number };
        expect(error.message).toBe("Report not found");
        expect(error.statusCode).toBe(404);
      }
    });
  });
});
