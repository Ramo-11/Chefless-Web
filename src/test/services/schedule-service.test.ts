import { describe, expect, it } from "vitest";
import ScheduleEntry from "../../models/ScheduleEntry";
import Kitchen from "../../models/Kitchen";
import User from "../../models/User";
import { createTestUser } from "../helpers";
import { setEntryRsvp } from "../../services/schedule-service";

async function createRsvpEntry(kitchenId: string, userId: string) {
  return ScheduleEntry.create({
    kitchenId,
    userId,
    date: new Date(),
    mealSlot: "dinner",
    status: "confirmed",
  });
}

describe("schedule-service setEntryRsvp", () => {
  it("never leaves two RSVP rows for the same member under concurrent submits", async () => {
    const lead = await createTestUser({ email: "rsvp-lead-1@test.com" });
    const kitchen = await Kitchen.create({
      name: "RSVP Kitchen",
      leadId: lead._id,
      inviteCode: "RSVPKIT1",
      memberCount: 1,
    });
    await User.updateOne(
      { _id: lead._id },
      { $set: { kitchenId: kitchen._id } }
    );
    const entry = await createRsvpEntry(
      kitchen._id.toString(),
      lead._id.toString()
    );

    await Promise.all([
      setEntryRsvp(lead._id.toString(), entry._id.toString(), "going"),
      setEntryRsvp(lead._id.toString(), entry._id.toString(), "going"),
      setEntryRsvp(lead._id.toString(), entry._id.toString(), "not_going"),
      setEntryRsvp(lead._id.toString(), entry._id.toString(), "going"),
    ]);

    const updated = await ScheduleEntry.findById(entry._id).lean();
    const mine = (updated?.rsvps ?? []).filter((r) => r.userId.equals(lead._id));
    expect(mine.length).toBe(1);
  });

  it("replaces the previous choice on a sequential resubmit", async () => {
    const lead = await createTestUser({ email: "rsvp-lead-2@test.com" });
    const kitchen = await Kitchen.create({
      name: "RSVP Kitchen 2",
      leadId: lead._id,
      inviteCode: "RSVPKIT2",
      memberCount: 1,
    });
    await User.updateOne(
      { _id: lead._id },
      { $set: { kitchenId: kitchen._id } }
    );
    const entry = await createRsvpEntry(
      kitchen._id.toString(),
      lead._id.toString()
    );

    await setEntryRsvp(lead._id.toString(), entry._id.toString(), "going");
    await setEntryRsvp(lead._id.toString(), entry._id.toString(), "not_going");

    const updated = await ScheduleEntry.findById(entry._id).lean();
    expect(updated?.rsvps).toHaveLength(1);
    expect(updated?.rsvps[0].status).toBe("not_going");
  });

  it("clears the RSVP row when status is null", async () => {
    const lead = await createTestUser({ email: "rsvp-lead-3@test.com" });
    const kitchen = await Kitchen.create({
      name: "RSVP Kitchen 3",
      leadId: lead._id,
      inviteCode: "RSVPKIT3",
      memberCount: 1,
    });
    await User.updateOne(
      { _id: lead._id },
      { $set: { kitchenId: kitchen._id } }
    );
    const entry = await createRsvpEntry(
      kitchen._id.toString(),
      lead._id.toString()
    );

    await setEntryRsvp(lead._id.toString(), entry._id.toString(), "going");
    await setEntryRsvp(lead._id.toString(), entry._id.toString(), null);

    const updated = await ScheduleEntry.findById(entry._id).lean();
    expect(updated?.rsvps).toHaveLength(0);
  });

  it("keeps each kitchen member's RSVP separate", async () => {
    const lead = await createTestUser({ email: "rsvp-lead-4@test.com" });
    const member = await createTestUser({ email: "rsvp-member-4@test.com" });
    const kitchen = await Kitchen.create({
      name: "RSVP Kitchen 4",
      leadId: lead._id,
      inviteCode: "RSVPKIT4",
      memberCount: 2,
    });
    await User.updateMany(
      { _id: { $in: [lead._id, member._id] } },
      { $set: { kitchenId: kitchen._id } }
    );
    const entry = await createRsvpEntry(
      kitchen._id.toString(),
      lead._id.toString()
    );

    await setEntryRsvp(lead._id.toString(), entry._id.toString(), "going");
    await setEntryRsvp(member._id.toString(), entry._id.toString(), "not_going");

    const updated = await ScheduleEntry.findById(entry._id).lean();
    expect(updated?.rsvps).toHaveLength(2);
    const leadRsvp = updated?.rsvps.find((r) => r.userId.equals(lead._id));
    const memberRsvp = updated?.rsvps.find((r) => r.userId.equals(member._id));
    expect(leadRsvp?.status).toBe("going");
    expect(memberRsvp?.status).toBe("not_going");
  });
});
