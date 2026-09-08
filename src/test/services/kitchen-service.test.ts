import { describe, expect, it } from "vitest";
import User from "../../models/User";
import Kitchen from "../../models/Kitchen";
import { createTestUser } from "../helpers";
import {
  createKitchen,
  joinKitchen,
  acceptKitchenInvite,
  sendKitchenInvite,
} from "../../services/kitchen-service";

describe("kitchen-service member capacity", () => {
  it("allows joining a free-tier kitchen with room", async () => {
    const lead = await createTestUser({ email: "lead1@test.com" });
    const kitchen = await createKitchen(lead._id.toString(), "Casa Uno");
    const joiner = await createTestUser({ email: "joiner1@test.com" });

    const result = await joinKitchen(joiner._id.toString(), kitchen.inviteCode);

    expect(result.memberCount).toBe(2);
    const updatedJoiner = await User.findById(joiner._id).lean();
    expect(updatedJoiner?.kitchenId?.toString()).toBe(kitchen._id.toString());
  });

  it("rejects joining a free-tier kitchen already at the member cap", async () => {
    const lead = await createTestUser({ email: "lead2@test.com" });
    const kitchen = await createKitchen(lead._id.toString(), "Casa Dos");
    const firstJoiner = await createTestUser({ email: "joiner2a@test.com" });
    await joinKitchen(firstJoiner._id.toString(), kitchen.inviteCode);

    const secondJoiner = await createTestUser({ email: "joiner2b@test.com" });

    await expect(
      joinKitchen(secondJoiner._id.toString(), kitchen.inviteCode)
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("maximum capacity"),
    });

    const finalKitchen = await Kitchen.findById(kitchen._id).lean();
    expect(finalKitchen?.memberCount).toBe(2);
    const untouchedUser = await User.findById(secondJoiner._id).lean();
    expect(untouchedUser?.kitchenId).toBeUndefined();
  });

  it("lets only one of two concurrent joiners take the last free-tier slot", async () => {
    const lead = await createTestUser({ email: "lead3@test.com" });
    const kitchen = await createKitchen(lead._id.toString(), "Casa Tres");
    const joinerA = await createTestUser({ email: "joiner3a@test.com" });
    const joinerB = await createTestUser({ email: "joiner3b@test.com" });

    const results = await Promise.allSettled([
      joinKitchen(joinerA._id.toString(), kitchen.inviteCode),
      joinKitchen(joinerB._id.toString(), kitchen.inviteCode),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalKitchen = await Kitchen.findById(kitchen._id).lean();
    expect(finalKitchen?.memberCount).toBe(2);
  });

  it("allows joining beyond the free-tier cap when the lead is premium", async () => {
    const lead = await createTestUser({ email: "lead4@test.com" });
    await User.updateOne({ _id: lead._id }, { $set: { isPremium: true } });
    const kitchen = await createKitchen(lead._id.toString(), "Casa Cuatro");

    const joiners = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        createTestUser({ email: `joiner4-${i}@test.com` })
      )
    );
    for (const joiner of joiners) {
      await joinKitchen(joiner._id.toString(), kitchen.inviteCode);
    }

    const finalKitchen = await Kitchen.findById(kitchen._id).lean();
    expect(finalKitchen?.memberCount).toBe(4);
  });

  it("lets only one of two concurrent invite acceptances take the last free-tier slot", async () => {
    const lead = await createTestUser({ email: "lead5@test.com" });
    const kitchen = await createKitchen(lead._id.toString(), "Casa Cinco");
    const recipientA = await createTestUser({ email: "recipient5a@test.com" });
    const recipientB = await createTestUser({ email: "recipient5b@test.com" });

    const inviteA = await sendKitchenInvite(
      lead._id.toString(),
      recipientA._id.toString()
    );
    const inviteB = await sendKitchenInvite(
      lead._id.toString(),
      recipientB._id.toString()
    );

    const results = await Promise.allSettled([
      acceptKitchenInvite(recipientA._id.toString(), inviteA._id.toString()),
      acceptKitchenInvite(recipientB._id.toString(), inviteB._id.toString()),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalKitchen = await Kitchen.findById(kitchen._id).lean();
    expect(finalKitchen?.memberCount).toBe(2);
  });
});
