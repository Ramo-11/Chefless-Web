import { Types } from "mongoose";
import ShoppingList, {
  IShoppingList,
  IShoppingListItem,
} from "../models/ShoppingList";
import ScheduleEntry from "../models/ScheduleEntry";
import Recipe, { IIngredient } from "../models/Recipe";
import User from "../models/User";
import { deleteImage, publicIdFromUrl } from "../lib/cloudinary";
import { categorizeIngredient, normalizeIngredientKey } from "../lib/ingredients";

interface ServiceError extends Error {
  statusCode: number;
}

function createError(message: string, statusCode: number): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

// --- Permission helpers ---

async function getUserWithKitchen(
  userId: string
): Promise<{ _id: Types.ObjectId; kitchenId?: Types.ObjectId }> {
  const user = await User.findById(userId).select("_id kitchenId").lean();
  if (!user) {
    throw createError("User not found", 404);
  }
  return user;
}

function effectiveOrder(item: IShoppingListItem, index: number): number {
  return typeof item.order === "number" ? item.order : index;
}

function nextOrder(items: IShoppingListItem[]): number {
  if (items.length === 0) return 0;
  const highest = items.reduce(
    (max, item, index) => Math.max(max, effectiveOrder(item, index)),
    0
  );
  return highest + 1;
}

async function assertListAccess(
  list: IShoppingList,
  userId: string
): Promise<void> {
  if (list.userId && list.userId.equals(userId)) {
    return;
  }

  if (list.kitchenId) {
    const user = await getUserWithKitchen(userId);
    if (user.kitchenId && user.kitchenId.equals(list.kitchenId)) {
      return;
    }
  }

  throw createError("You do not have access to this shopping list", 403);
}

// --- Service Functions ---

interface CreateListData {
  name?: string;
  kitchenId?: string;
  isPrivate?: boolean;
  items?: Array<{
    name: string;
    quantity?: number;
    unit?: string;
    category?: string;
  }>;
}

export async function createList(
  userId: string,
  data: CreateListData
): Promise<IShoppingList> {
  const user = await getUserWithKitchen(userId);

  const listFields: Record<string, unknown> = {
    name: data.name,
    items: (data.items ?? []).map((item, index) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category ?? categorizeIngredient(item.name),
      isChecked: false,
      addedBy: user._id,
      order: index,
    })),
    generatedFromSchedule: false,
  };

  // Explicit private list — belongs to this user only
  if (data.isPrivate) {
    listFields.userId = user._id;
  } else if (data.kitchenId) {
    // Explicit kitchen ID — verify membership
    if (!user.kitchenId || !user.kitchenId.equals(data.kitchenId)) {
      throw createError("You are not a member of this kitchen", 403);
    }
    listFields.kitchenId = new Types.ObjectId(data.kitchenId);
  } else if (user.kitchenId) {
    // User is in a kitchen, default to kitchen list
    listFields.kitchenId = user.kitchenId;
  } else {
    // Personal list
    listFields.userId = user._id;
  }

  const list = await ShoppingList.create(listFields);
  return list;
}

export async function getLists(userId: string): Promise<IShoppingList[]> {
  const user = await getUserWithKitchen(userId);

  const conditions: Record<string, unknown>[] = [
    { userId: user._id },
  ];

  if (user.kitchenId) {
    conditions.push({ kitchenId: user.kitchenId });
  }

  const lists = await ShoppingList.find({ $or: conditions })
    .sort({ updatedAt: -1 })
    .lean<IShoppingList[]>();

  return lists;
}

export async function getList(
  listId: string,
  userId: string
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId).lean<IShoppingList>();
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list as IShoppingList, userId);
  return list;
}

interface UpdateListData {
  name?: string;
  isPrivate?: boolean;
}

export async function updateList(
  listId: string,
  userId: string,
  updates: UpdateListData
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const setFields: Record<string, unknown> = {};
  const unsetFields: Record<string, 1> = {};

  if (updates.name !== undefined) {
    setFields.name = updates.name;
  }

  if (updates.isPrivate !== undefined) {
    const user = await getUserWithKitchen(userId);
    if (updates.isPrivate) {
      // Make personal — set userId, remove kitchenId
      setFields.userId = user._id;
      unsetFields.kitchenId = 1;
    } else {
      // Make shared — set kitchenId, remove userId
      if (!user.kitchenId) {
        throw createError(
          "You must be in a kitchen to make a list shared",
          400
        );
      }
      setFields.kitchenId = user.kitchenId;
      unsetFields.userId = 1;
    }
  }

  const updateQuery: Record<string, unknown> = {};
  if (Object.keys(setFields).length > 0) {
    updateQuery.$set = setFields;
  }
  if (Object.keys(unsetFields).length > 0) {
    updateQuery.$unset = unsetFields;
  }

  if (Object.keys(updateQuery).length === 0) {
    return list;
  }

  const updated = await ShoppingList.findByIdAndUpdate(
    listId,
    updateQuery,
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

export async function deleteList(
  listId: string,
  userId: string
): Promise<void> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  await ShoppingList.findByIdAndDelete(listId);
}

interface AddItemData {
  name: string;
  quantity?: number;
  unit?: string;
  recipeId?: string;
  category?: string;
  notes?: string;
  imageUrl?: string;
}

export async function addItem(
  listId: string,
  userId: string,
  item: AddItemData
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const MAX_ITEMS = 500;
  if (list.items.length >= MAX_ITEMS) {
    throw createError(`Shopping lists are limited to ${MAX_ITEMS} items.`, 400);
  }

  const newItem = {
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    recipeId: item.recipeId ? new Types.ObjectId(item.recipeId) : undefined,
    isChecked: false,
    addedBy: new Types.ObjectId(userId),
    category: item.category ?? categorizeIngredient(item.name),
    notes: item.notes,
    imageUrl: item.imageUrl,
    order: nextOrder(list.items),
  };

  const updated = await ShoppingList.findByIdAndUpdate(
    listId,
    { $push: { items: newItem } },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

export async function addItems(
  listId: string,
  userId: string,
  items: AddItemData[]
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const MAX_ITEMS = 500;
  if (list.items.length + items.length > MAX_ITEMS) {
    throw createError(`Shopping lists are limited to ${MAX_ITEMS} items.`, 400);
  }

  const existingByKey = new Map<string, number>();
  list.items.forEach((item, index) => {
    existingByKey.set(itemMergeKey(item.name, item.unit), index);
  });

  const additions: Record<string, unknown>[] = [];
  const increments: Record<string, number> = {};
  let order = nextOrder(list.items);

  for (const item of items) {
    const key = itemMergeKey(item.name, item.unit);
    const existingIndex = existingByKey.get(key);

    if (
      existingIndex !== undefined &&
      typeof item.quantity === "number" &&
      typeof list.items[existingIndex].quantity === "number"
    ) {
      const path = `items.${existingIndex}.quantity`;
      increments[path] = (increments[path] ?? 0) + item.quantity;
      continue;
    }

    additions.push({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      recipeId: item.recipeId ? new Types.ObjectId(item.recipeId) : undefined,
      isChecked: false,
      addedBy: new Types.ObjectId(userId),
      category: item.category ?? categorizeIngredient(item.name),
      notes: item.notes,
      imageUrl: item.imageUrl,
      order: order++,
    });
    existingByKey.set(key, list.items.length + additions.length - 1);
  }

  const update: Record<string, unknown> = {};
  if (additions.length > 0) update.$push = { items: { $each: additions } };
  if (Object.keys(increments).length > 0) update.$inc = increments;

  if (Object.keys(update).length === 0) return list.toObject() as IShoppingList;

  const updated = await ShoppingList.findByIdAndUpdate(listId, update, {
    new: true,
    runValidators: true,
  });

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

function itemMergeKey(name: string, unit?: string | null): string {
  return `${normalizeIngredientKey(name)}|${normalizeIngredientKey(unit ?? "")}`;
}

export async function removeItem(
  listId: string,
  userId: string,
  itemId: string
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  // Delete the item's image from Cloudinary if it has one
  const item = list.items.find((i) => i._id.equals(itemId));
  if (item?.imageUrl) {
    const publicId = publicIdFromUrl(item.imageUrl);
    if (publicId) {
      deleteImage(publicId).catch(() => {});
    }
  }

  const updated = await ShoppingList.findByIdAndUpdate(
    listId,
    { $pull: { items: { _id: new Types.ObjectId(itemId) } } },
    { new: true }
  );

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

interface UpdateItemData {
  name?: string;
  quantity?: number | null;
  unit?: string | null;
  category?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
}

export async function updateItem(
  listId: string,
  userId: string,
  itemId: string,
  updates: UpdateItemData
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const item = list.items.find((i) => i._id.equals(itemId));
  if (!item) {
    throw createError("Item not found in this shopping list", 404);
  }

  const setFields: Record<string, unknown> = {};
  const unsetFields: Record<string, 1> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      unsetFields[`items.$.${key}`] = 1;
    } else if (value !== undefined) {
      setFields[`items.$.${key}`] = value;
    }
  }

  const updateQuery: Record<string, unknown> = {};
  if (Object.keys(setFields).length > 0) {
    updateQuery.$set = setFields;
  }
  if (Object.keys(unsetFields).length > 0) {
    updateQuery.$unset = unsetFields;
  }

  if (Object.keys(updateQuery).length === 0) {
    return list;
  }

  const updated = await ShoppingList.findOneAndUpdate(
    { _id: listId, "items._id": new Types.ObjectId(itemId) },
    updateQuery,
    { new: true }
  );

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

export async function clearCompleted(
  listId: string,
  userId: string
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const updated = await ShoppingList.findByIdAndUpdate(
    listId,
    { $pull: { items: { isChecked: true } } },
    { new: true }
  );

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

export async function toggleItem(
  listId: string,
  userId: string,
  itemId: string
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const item = list.items.find((i) => i._id.equals(itemId));
  if (!item) {
    throw createError("Item not found in this shopping list", 404);
  }

  const updated = await ShoppingList.findOneAndUpdate(
    { _id: listId, "items._id": new Types.ObjectId(itemId) },
    { $set: { "items.$.isChecked": !item.isChecked } },
    { new: true }
  );

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

export async function reorderItems(
  listId: string,
  userId: string,
  itemIds: string[]
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const currentIds = list.items.map((item) => item._id.toString());
  const requestedIds = new Set(itemIds);

  const isPermutation =
    itemIds.length === currentIds.length &&
    requestedIds.size === itemIds.length &&
    currentIds.every((id) => requestedIds.has(id));

  if (!isPermutation) {
    throw createError(
      "The new order must include every item in this list exactly once",
      400
    );
  }

  const positionById = new Map(itemIds.map((id, index) => [id, index]));

  for (const item of list.items) {
    const position = positionById.get(item._id.toString());
    if (position !== undefined) {
      item.order = position;
    }
  }

  await list.save();

  return list;
}

export async function duplicateList(
  listId: string,
  userId: string,
  name?: string
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId).lean<IShoppingList>();
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list as IShoppingList, userId);

  const user = await getUserWithKitchen(userId);

  // Duplicate items — reset checked state and assign to current user
  const duplicatedItems = list.items.map((item, index) => ({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    recipeId: item.recipeId,
    isChecked: false,
    addedBy: user._id,
    category: item.category,
    notes: item.notes,
    imageUrl: item.imageUrl,
    order: effectiveOrder(item, index),
  }));

  const listFields: Record<string, unknown> = {
    name: name ?? `${list.name ?? "Untitled"} (copy)`,
    items: duplicatedItems,
    generatedFromSchedule: false,
  };

  // Inherit visibility from original list
  if (list.kitchenId) {
    listFields.kitchenId = list.kitchenId;
  } else {
    listFields.userId = user._id;
  }

  const newList = await ShoppingList.create(listFields);
  return newList;
}

export async function uncheckAll(
  listId: string,
  userId: string
): Promise<IShoppingList> {
  const list = await ShoppingList.findById(listId);
  if (!list) {
    throw createError("Shopping list not found", 404);
  }

  await assertListAccess(list, userId);

  const updated = await ShoppingList.findByIdAndUpdate(
    listId,
    { $set: { "items.$[].isChecked": false } },
    { new: true }
  );

  if (!updated) {
    throw createError("Shopping list not found", 404);
  }

  return updated;
}

interface GenerateData {
  kitchenId?: string;
  startDate: Date;
  endDate: Date;
  name?: string;
}

interface CombinedIngredient {
  name: string;
  quantity: number;
  unit: string;
  recipeIds: Types.ObjectId[];
  category: string;
}

export interface GeneratedShoppingList {
  list: IShoppingList;
  meta: {
    /** Number of scheduled recipes that were omitted because they weren't viewable by the whole kitchen. */
    skippedPrivateCount: number;
  };
}

export async function generateFromSchedule(
  userId: string,
  data: GenerateData
): Promise<GeneratedShoppingList> {
  const user = await getUserWithKitchen(userId);

  let kitchenId: Types.ObjectId;

  if (data.kitchenId) {
    if (!user.kitchenId || !user.kitchenId.equals(data.kitchenId)) {
      throw createError("You are not a member of this kitchen", 403);
    }
    kitchenId = new Types.ObjectId(data.kitchenId);
  } else if (user.kitchenId) {
    kitchenId = user.kitchenId;
  } else {
    throw createError(
      "You need to be in a kitchen to generate a shopping list from a schedule",
      400
    );
  }

  // 1. Fetch schedule entries with recipes for the date range
  const entries = await ScheduleEntry.find({
    kitchenId,
    date: { $gte: data.startDate, $lte: data.endDate },
    recipeId: { $exists: true, $ne: null },
  }).lean();

  if (entries.length === 0) {
    throw createError(
      "No scheduled recipes found in this date range",
      400
    );
  }

  // 2. Collect unique recipe IDs
  const recipeIds = [
    ...new Set(entries.map((e) => e.recipeId!.toString())),
  ].map((id) => new Types.ObjectId(id));

  // 3. Fetch recipes + their authors. Only include recipes visible to every
  //    kitchen member — i.e. public, non-private, non-hidden, non-banned-author.
  //    Members may have scheduled private recipes of their own; those are
  //    silently skipped (see skippedPrivateCount in the response meta).
  const recipes = await Recipe.find({ _id: { $in: recipeIds } })
    .select("_id ingredients authorId isPrivate isHidden")
    .lean();

  const authorIds = [
    ...new Set(recipes.map((r) => r.authorId.toString())),
  ].map((id) => new Types.ObjectId(id));
  const authors = await User.find({ _id: { $in: authorIds } })
    .select("_id isPublic isBanned")
    .lean();
  const authorMap = new Map(authors.map((a) => [a._id.toString(), a]));

  const viewableRecipes = recipes.filter((r) => {
    if (r.isPrivate) return false;
    if (r.isHidden) return false;
    const author = authorMap.get(r.authorId.toString());
    if (!author) return false;
    if (author.isBanned) return false;
    if (!author.isPublic) return false;
    return true;
  });

  // Recipes we pulled in from the schedule but excluded on visibility grounds
  const skippedPrivateCount = recipes.length - viewableRecipes.length;

  const recipeMap = new Map(
    viewableRecipes.map((r) => [r._id.toString(), r])
  );

  // 4. Count how many times each recipe appears in the schedule
  const recipeCounts = new Map<string, number>();
  for (const entry of entries) {
    const rid = entry.recipeId!.toString();
    recipeCounts.set(rid, (recipeCounts.get(rid) ?? 0) + 1);
  }

  // 5. Combine ingredients: group by normalized name + unit
  const combinedMap = new Map<string, CombinedIngredient>();

  for (const [recipeIdStr, count] of recipeCounts.entries()) {
    const recipe = recipeMap.get(recipeIdStr);
    if (!recipe) continue;

    const recipeObjectId = new Types.ObjectId(recipeIdStr);

    for (const ingredient of recipe.ingredients) {
      const normalizedName = normalizeIngredientKey(ingredient.name);
      const normalizedUnit = normalizeIngredientKey(ingredient.unit);
      const key = `${normalizedName}|${normalizedUnit}`;

      const existing = combinedMap.get(key);
      if (existing) {
        existing.quantity += ingredient.quantity * count;
        if (!existing.recipeIds.some((id) => id.equals(recipeObjectId))) {
          existing.recipeIds.push(recipeObjectId);
        }
      } else {
        combinedMap.set(key, {
          name: ingredient.name.trim(),
          quantity: ingredient.quantity * count,
          unit: ingredient.unit.trim(),
          recipeIds: [recipeObjectId],
          category: categorizeIngredient(ingredient.name),
        });
      }
    }
  }

  // 6. Build items array
  const items = Array.from(combinedMap.values()).map((combined, index) => ({
    name: combined.name,
    quantity: combined.quantity,
    unit: combined.unit,
    recipeId: combined.recipeIds[0],
    isChecked: false,
    addedBy: user._id,
    category: combined.category,
    order: index,
  }));

  // 7. Create the shopping list
  const listName =
    data.name ??
    `Week of ${data.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const list = await ShoppingList.create({
    kitchenId,
    name: listName,
    items,
    generatedFromSchedule: true,
    scheduleStartDate: data.startDate,
    scheduleEndDate: data.endDate,
  });

  return { list, meta: { skippedPrivateCount } };
}
