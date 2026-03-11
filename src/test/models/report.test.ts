import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import Report from "../../models/Report";

describe("Report model", () => {
  it("creates a report with valid data", async () => {
    const reporterId = new Types.ObjectId();
    const targetId = new Types.ObjectId();

    const report = await Report.create({
      reporterId,
      targetType: "recipe",
      targetId,
      reason: "spam",
      description: "This is spam content",
    });

    expect(report.reporterId.toString()).toBe(reporterId.toString());
    expect(report.targetType).toBe("recipe");
    expect(report.targetId.toString()).toBe(targetId.toString());
    expect(report.reason).toBe("spam");
    expect(report.description).toBe("This is spam content");
    expect(report.status).toBe("pending");
    expect(report.createdAt).toBeInstanceOf(Date);
    expect(report.updatedAt).toBeInstanceOf(Date);
  });

  it("defaults status to pending", async () => {
    const report = await Report.create({
      reporterId: new Types.ObjectId(),
      targetType: "user",
      targetId: new Types.ObjectId(),
      reason: "harassment",
    });

    expect(report.status).toBe("pending");
  });

  it("requires reporterId", async () => {
    await expect(
      Report.create({
        targetType: "recipe",
        targetId: new Types.ObjectId(),
        reason: "spam",
      })
    ).rejects.toThrow(/reporterId/);
  });

  it("requires targetType", async () => {
    await expect(
      Report.create({
        reporterId: new Types.ObjectId(),
        targetId: new Types.ObjectId(),
        reason: "spam",
      })
    ).rejects.toThrow(/targetType/);
  });

  it("requires targetId", async () => {
    await expect(
      Report.create({
        reporterId: new Types.ObjectId(),
        targetType: "recipe",
        reason: "spam",
      })
    ).rejects.toThrow(/targetId/);
  });

  it("requires reason", async () => {
    await expect(
      Report.create({
        reporterId: new Types.ObjectId(),
        targetType: "recipe",
        targetId: new Types.ObjectId(),
      })
    ).rejects.toThrow(/reason/);
  });

  it("rejects invalid targetType enum value", async () => {
    await expect(
      Report.create({
        reporterId: new Types.ObjectId(),
        targetType: "comment",
        targetId: new Types.ObjectId(),
        reason: "spam",
      })
    ).rejects.toThrow(/targetType/);
  });

  it("rejects invalid reason enum value", async () => {
    await expect(
      Report.create({
        reporterId: new Types.ObjectId(),
        targetType: "recipe",
        targetId: new Types.ObjectId(),
        reason: "boring",
      })
    ).rejects.toThrow(/reason/);
  });

  it("rejects invalid status enum value", async () => {
    await expect(
      Report.create({
        reporterId: new Types.ObjectId(),
        targetType: "recipe",
        targetId: new Types.ObjectId(),
        reason: "spam",
        status: "approved",
      })
    ).rejects.toThrow(/status/);
  });

  it("accepts all valid reason values", async () => {
    const reasons = ["spam", "inappropriate", "copyright", "harassment", "other"] as const;

    for (const reason of reasons) {
      const report = await Report.create({
        reporterId: new Types.ObjectId(),
        targetType: "recipe",
        targetId: new Types.ObjectId(),
        reason,
      });
      expect(report.reason).toBe(reason);
    }
  });

  it("accepts all valid status values", async () => {
    const statuses = ["pending", "reviewed", "dismissed", "action_taken"] as const;

    for (const status of statuses) {
      const report = await Report.create({
        reporterId: new Types.ObjectId(),
        targetType: "recipe",
        targetId: new Types.ObjectId(),
        reason: "spam",
        status,
      });
      expect(report.status).toBe(status);
    }
  });

  it("enforces unique compound index on reporterId + targetType + targetId", async () => {
    await Report.ensureIndexes();

    const reporterId = new Types.ObjectId();
    const targetId = new Types.ObjectId();

    await Report.create({
      reporterId,
      targetType: "recipe",
      targetId,
      reason: "spam",
    });

    await expect(
      Report.create({
        reporterId,
        targetType: "recipe",
        targetId,
        reason: "inappropriate",
      })
    ).rejects.toThrow(/duplicate key|E11000/);
  });

  it("allows same reporter to report different targets", async () => {
    const reporterId = new Types.ObjectId();

    const report1 = await Report.create({
      reporterId,
      targetType: "recipe",
      targetId: new Types.ObjectId(),
      reason: "spam",
    });

    const report2 = await Report.create({
      reporterId,
      targetType: "recipe",
      targetId: new Types.ObjectId(),
      reason: "spam",
    });

    expect(report1._id.toString()).not.toBe(report2._id.toString());
  });

  it("allows same target to be reported by different reporters", async () => {
    const targetId = new Types.ObjectId();

    const report1 = await Report.create({
      reporterId: new Types.ObjectId(),
      targetType: "recipe",
      targetId,
      reason: "spam",
    });

    const report2 = await Report.create({
      reporterId: new Types.ObjectId(),
      targetType: "recipe",
      targetId,
      reason: "inappropriate",
    });

    expect(report1._id.toString()).not.toBe(report2._id.toString());
  });

  it("trims description whitespace", async () => {
    const report = await Report.create({
      reporterId: new Types.ObjectId(),
      targetType: "recipe",
      targetId: new Types.ObjectId(),
      reason: "spam",
      description: "  some description  ",
    });

    expect(report.description).toBe("some description");
  });
});
