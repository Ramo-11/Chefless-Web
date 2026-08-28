import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import {
  addItem,
  createList,
  duplicateList,
  generateFromSchedule,
  reorderItems,
} from "../../services/shopping-list-service";
import { createTestRecipe, createTestUser } from "../helpers";
import ShoppingList from "../../models/ShoppingList";
import ScheduleEntry from "../../models/ScheduleEntry";
import User from "../../models/User";

async function createUserInKitchen(kitchenId: Types.ObjectId) {
  const user = await createTestUser();
  await User.findByIdAndUpdate(user._id, { kitchenId });
  return user;
}

describe("shopping-list-service item order", () => {
  describe("order assignment", () => {
    it("numbers seeded items sequentially on create", async () => {
      const user = await createTestUser();

      const list = await createList(user._id.toString(), {
        name: "Weekly run",
        isPrivate: true,
        items: [
          { name: "Milk" },
          { name: "Bread" },
          { name: "Eggs" },
        ],
      });

      expect(list.items.map((item) => item.order)).toEqual([0, 1, 2]);
    });

    it("appends each added item after the current highest order", async () => {
      const user = await createTestUser();
      const list = await createList(user._id.toString(), {
        name: "Pantry",
        isPrivate: true,
        items: [{ name: "Rice" }],
      });

      const afterFirst = await addItem(list._id.toString(), user._id.toString(), {
        name: "Beans",
      });
      const afterSecond = await addItem(
        list._id.toString(),
        user._id.toString(),
        { name: "Lentils" }
      );

      expect(afterFirst.items.map((item) => item.order)).toEqual([0, 1]);
      expect(afterSecond.items.map((item) => item.order)).toEqual([0, 1, 2]);
    });

    it("falls back to array position for legacy items with no order field", async () => {
      const user = await createTestUser();
      const listId = new Types.ObjectId();

      await ShoppingList.collection.insertOne({
        _id: listId,
        userId: user._id,
        name: "Legacy list",
        items: [
          { _id: new Types.ObjectId(), name: "Olives", isChecked: false },
          { _id: new Types.ObjectId(), name: "Feta", isChecked: false },
        ],
        generatedFromSchedule: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const updated = await addItem(listId.toString(), user._id.toString(), {
        name: "Pita",
      });

      expect(updated.items[2].order).toBe(2);
    });

    it("preserves item order when a list is duplicated", async () => {
      const user = await createTestUser();
      const list = await createList(user._id.toString(), {
        name: "Original",
        isPrivate: true,
        items: [{ name: "Apples" }, { name: "Pears" }, { name: "Plums" }],
      });

      const reordered = await reorderItems(
        list._id.toString(),
        user._id.toString(),
        [
          list.items[2]._id.toString(),
          list.items[0]._id.toString(),
          list.items[1]._id.toString(),
        ]
      );

      const copy = await duplicateList(
        reordered._id.toString(),
        user._id.toString()
      );

      const byName = new Map(
        copy.items.map((item) => [item.name, item.order])
      );
      expect(byName.get("Plums")).toBe(0);
      expect(byName.get("Apples")).toBe(1);
      expect(byName.get("Pears")).toBe(2);
    });

    it("numbers generated items sequentially", async () => {
      const kitchenId = new Types.ObjectId();
      const user = await createUserInKitchen(kitchenId);
      const recipe = await createTestRecipe({ authorId: user._id });

      await ScheduleEntry.create({
        kitchenId,
        userId: user._id,
        date: new Date("2026-03-02T12:00:00.000Z"),
        mealSlot: "dinner",
        recipeId: recipe._id,
        status: "confirmed",
      });

      const { list } = await generateFromSchedule(user._id.toString(), {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-03-07T23:59:59.000Z"),
      });

      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.map((item) => item.order)).toEqual(
        list.items.map((_, index) => index)
      );
    });
  });

  describe("reorderItems", () => {
    it("rewrites and persists the new order", async () => {
      const user = await createTestUser();
      const list = await createList(user._id.toString(), {
        name: "Reorder me",
        isPrivate: true,
        items: [{ name: "One" }, { name: "Two" }, { name: "Three" }],
      });

      const [first, second, third] = list.items.map((item) =>
        item._id.toString()
      );

      const updated = await reorderItems(
        list._id.toString(),
        user._id.toString(),
        [third, first, second]
      );

      const orderById = new Map(
        updated.items.map((item) => [item._id.toString(), item.order])
      );
      expect(orderById.get(third)).toBe(0);
      expect(orderById.get(first)).toBe(1);
      expect(orderById.get(second)).toBe(2);

      const reloaded = await ShoppingList.findById(list._id);
      const persisted = new Map(
        (reloaded?.items ?? []).map((item) => [item._id.toString(), item.order])
      );
      expect(persisted.get(third)).toBe(0);
      expect(persisted.get(first)).toBe(1);
      expect(persisted.get(second)).toBe(2);
    });

    it("rejects an order that omits an item", async () => {
      const user = await createTestUser();
      const list = await createList(user._id.toString(), {
        name: "Partial",
        isPrivate: true,
        items: [{ name: "One" }, { name: "Two" }],
      });

      await expect(
        reorderItems(list._id.toString(), user._id.toString(), [
          list.items[0]._id.toString(),
        ])
      ).rejects.toThrow(/exactly once/);
    });

    it("rejects an order that repeats an item", async () => {
      const user = await createTestUser();
      const list = await createList(user._id.toString(), {
        name: "Repeated",
        isPrivate: true,
        items: [{ name: "One" }, { name: "Two" }],
      });

      const first = list.items[0]._id.toString();

      await expect(
        reorderItems(list._id.toString(), user._id.toString(), [first, first])
      ).rejects.toThrow(/exactly once/);
    });

    it("rejects an order containing an unknown item id", async () => {
      const user = await createTestUser();
      const list = await createList(user._id.toString(), {
        name: "Stranger item",
        isPrivate: true,
        items: [{ name: "One" }, { name: "Two" }],
      });

      await expect(
        reorderItems(list._id.toString(), user._id.toString(), [
          list.items[0]._id.toString(),
          new Types.ObjectId().toString(),
        ])
      ).rejects.toThrow(/exactly once/);
    });

    it("leaves the stored order untouched when validation fails", async () => {
      const user = await createTestUser();
      const list = await createList(user._id.toString(), {
        name: "Untouched",
        isPrivate: true,
        items: [{ name: "One" }, { name: "Two" }],
      });

      await expect(
        reorderItems(list._id.toString(), user._id.toString(), [])
      ).rejects.toThrow(/exactly once/);

      const reloaded = await ShoppingList.findById(list._id);
      expect((reloaded?.items ?? []).map((item) => item.order)).toEqual([0, 1]);
    });

    it("refuses callers who cannot access the list", async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const list = await createList(owner._id.toString(), {
        name: "Private list",
        isPrivate: true,
        items: [{ name: "One" }, { name: "Two" }],
      });

      await expect(
        reorderItems(list._id.toString(), stranger._id.toString(), [
          list.items[1]._id.toString(),
          list.items[0]._id.toString(),
        ])
      ).rejects.toThrow(/do not have access/);
    });

    it("lets another member of the same kitchen reorder a shared list", async () => {
      const kitchenId = new Types.ObjectId();
      const owner = await createUserInKitchen(kitchenId);
      const teammate = await createUserInKitchen(kitchenId);

      const list = await createList(owner._id.toString(), {
        name: "Kitchen list",
        items: [{ name: "One" }, { name: "Two" }],
      });

      const updated = await reorderItems(
        list._id.toString(),
        teammate._id.toString(),
        [list.items[1]._id.toString(), list.items[0]._id.toString()]
      );

      expect(updated.items[1].order).toBe(0);
      expect(updated.items[0].order).toBe(1);
    });
  });
});
