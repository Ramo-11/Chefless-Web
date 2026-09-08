import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import User from "../../models/User";
import Recipe from "../../models/Recipe";
import PantryItem from "../../models/PantryItem";
import Block from "../../models/Block";
import SavedRecipe from "../../models/SavedRecipe";
import { normalizeIngredientName } from "../../lib/ingredients";
import {
  addPantryItem,
  addPantryItemsBulk,
  addStaples,
  clearPantry,
  deletePantryItem,
  getPantryMatches,
  listPantryItems,
  updatePantryItem,
} from "../../services/pantry-service";
import { createRecipe, updateRecipe, forkRecipe } from "../../services/recipe-service";

async function createPremiumUser(
  overrides: Partial<{ fullName: string; isPublic: boolean; isBanned: boolean }> = {}
) {
  const id = new Types.ObjectId();
  return User.create({
    _id: id,
    firebaseUid: `firebase-${id.toString()}`,
    email: `user-${id.toString()}@test.com`,
    fullName: overrides.fullName ?? "Test Chef",
    isPremium: true,
    isPublic: overrides.isPublic ?? true,
    isBanned: overrides.isBanned ?? false,
  });
}

async function createRecipeWithIngredients(
  authorId: Types.ObjectId,
  ingredientNames: string[],
  overrides: Partial<{
    title: string;
    isPrivate: boolean;
    isHidden: boolean;
    likesCount: number;
  }> = {}
) {
  return Recipe.create({
    authorId,
    title: overrides.title ?? "Test Recipe",
    baseServings: 4,
    isPrivate: overrides.isPrivate ?? false,
    isHidden: overrides.isHidden ?? false,
    likesCount: overrides.likesCount ?? 0,
    ingredients: ingredientNames.map((name) => ({
      name,
      quantity: 1,
      unit: "unit",
    })),
    steps: [{ order: 1, instruction: "Cook it." }],
  });
}

describe("normalizeIngredientName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeIngredientName("  Olive   Oil  ")).toBe("olive oil");
  });

  it("strips punctuation", () => {
    expect(normalizeIngredientName("Salt (optional)")).toBe("salt");
    expect(normalizeIngredientName("Confectioners' Sugar")).toBe("confectioner sugar");
  });

  it("drops leading quantities and units", () => {
    expect(normalizeIngredientName("2 cups flour")).toBe("flour");
    expect(normalizeIngredientName("1/2 tsp salt")).toBe("salt");
    expect(normalizeIngredientName("3 cloves garlic, minced")).toBe("garlic");
  });

  it("drops preparation and size descriptors anywhere in the name", () => {
    expect(normalizeIngredientName("2 large ripe tomatoes")).toBe("tomato");
    expect(normalizeIngredientName("Boneless Skinless Chicken Breast")).toBe(
      "chicken breast"
    );
    expect(normalizeIngredientName("1/2 cup finely chopped fresh basil")).toBe("basil");
    expect(normalizeIngredientName("Salt, to taste")).toBe("salt");
  });

  it("singularizes simple plurals", () => {
    expect(normalizeIngredientName("Tomatoes")).toBe("tomato");
    expect(normalizeIngredientName("Leaves")).toBe("leaf");
    expect(normalizeIngredientName("Potatoes")).toBe("potato");
    expect(normalizeIngredientName("Chickpeas")).toBe("chickpea");
    expect(normalizeIngredientName("Onions")).toBe("onion");
    expect(normalizeIngredientName("Eggs")).toBe("egg");
  });

  it("does not mangle words that legitimately end in s", () => {
    expect(normalizeIngredientName("Hummus")).toBe("hummus");
    expect(normalizeIngredientName("Couscous")).toBe("couscous");
    expect(normalizeIngredientName("Molasses")).toBe("molasses");
    expect(normalizeIngredientName("Asparagus")).toBe("asparagus");
    expect(normalizeIngredientName("Watercress")).toBe("watercress");
  });
});

describe("pantry-service CRUD", () => {
  it("adds a new item with an auto-derived category", async () => {
    const user = await createPremiumUser();

    const { item, merged } = await addPantryItem(user._id.toString(), {
      name: "Onion",
      quantity: 2,
      unit: "piece",
    });

    expect(merged).toBe(false);
    expect(item.name).toBe("Onion");
    expect(item.normalizedName).toBe("onion");
    expect(item.category).toBe("Produce");
    expect(item.quantity).toBe(2);
    expect(item.unit).toBe("piece");
  });

  it("merges a duplicate add with the same unit by summing quantities", async () => {
    const user = await createPremiumUser();

    await addPantryItem(user._id.toString(), { name: "Onion", quantity: 2, unit: "piece" });
    const { item, merged } = await addPantryItem(user._id.toString(), {
      name: "onion",
      quantity: 3,
      unit: "piece",
    });

    expect(merged).toBe(true);
    expect(item.quantity).toBe(5);

    const { total } = await listPantryItems(user._id.toString());
    expect(total).toBe(1);
  });

  it("merges a duplicate add with a different unit but leaves quantity untouched", async () => {
    const user = await createPremiumUser();

    await addPantryItem(user._id.toString(), { name: "Onion", quantity: 2, unit: "piece" });
    const { item, merged } = await addPantryItem(user._id.toString(), {
      name: "Onion",
      quantity: 10,
      unit: "cup",
    });

    expect(merged).toBe(true);
    expect(item.quantity).toBe(2);

    const { total } = await listPantryItems(user._id.toString());
    expect(total).toBe(1);
  });

  it("merges a duplicate add with a case-different unit as the same unit", async () => {
    const user = await createPremiumUser();

    await addPantryItem(user._id.toString(), { name: "Onion", quantity: 2, unit: "Piece" });
    const { item, merged } = await addPantryItem(user._id.toString(), {
      name: "Onion",
      quantity: 3,
      unit: "PIECE",
    });

    expect(merged).toBe(true);
    expect(item.quantity).toBe(5);
  });

  it("accumulates every increment under concurrent adds of the same ingredient and unit", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Garlic", quantity: 1, unit: "clove" });

    await Promise.all(
      Array.from({ length: 10 }, () =>
        addPantryItem(user._id.toString(), { name: "Garlic", quantity: 1, unit: "clove" })
      )
    );

    const { items, total } = await listPantryItems(user._id.toString());
    const garlic = items.find((i) => i.normalizedName === "garlic");

    expect(total).toBe(1);
    expect(garlic?.quantity).toBe(11);
  });

  it("merges duplicates within a bulk payload before hitting the database", async () => {
    const user = await createPremiumUser();

    const { items, added, merged } = await addPantryItemsBulk(user._id.toString(), [
      { name: "Garlic", quantity: 2, unit: "clove" },
      { name: "garlic", quantity: 3, unit: "clove" },
      { name: "Milk", quantity: 1, unit: "carton" },
    ]);

    expect(items).toHaveLength(2);
    expect(added).toBe(2);
    expect(merged).toBe(0);

    const garlic = items.find((i) => i.normalizedName === "garlic");
    expect(garlic?.quantity).toBe(5);
  });

  it("rejects a bulk payload containing an 81 character name without writing any item", async () => {
    const user = await createPremiumUser();

    await expect(
      addPantryItemsBulk(user._id.toString(), [
        { name: "Rice" },
        { name: "b".repeat(81) },
      ])
    ).rejects.toThrow();

    const { total } = await listPantryItems(user._id.toString());
    expect(total).toBe(0);
  });

  it("rejects a bulk payload over the 100 item cap", async () => {
    const user = await createPremiumUser();

    const items = Array.from({ length: 101 }, (_, i) => ({ name: `Item ${i}` }));

    await expect(addPantryItemsBulk(user._id.toString(), items)).rejects.toThrow(/100/);
  });

  it("merges on rename collision and deletes the loser, keeping the survivor", async () => {
    const user = await createPremiumUser();

    const tomato = await addPantryItem(user._id.toString(), {
      name: "Tomato",
      quantity: 2,
      unit: "piece",
    });
    const cucumber = await addPantryItem(user._id.toString(), {
      name: "Cucumber",
      quantity: 1,
      unit: "piece",
    });

    const { item } = await updatePantryItem(user._id.toString(), cucumber.item.id, {
      name: "Tomatoes",
    });

    expect(item.id).toBe(tomato.item.id);
    expect(item.quantity).toBe(3);

    const loser = await PantryItem.findById(cucumber.item.id);
    expect(loser).toBeNull();

    const { total } = await listPantryItems(user._id.toString());
    expect(total).toBe(1);
  });

  it("deletes a single item", async () => {
    const user = await createPremiumUser();
    const { item } = await addPantryItem(user._id.toString(), { name: "Rice" });

    await deletePantryItem(user._id.toString(), item.id);

    const found = await PantryItem.findById(item.id);
    expect(found).toBeNull();
  });

  it("throws deleting a pantry item that does not exist", async () => {
    const user = await createPremiumUser();

    await expect(
      deletePantryItem(user._id.toString(), new Types.ObjectId().toString())
    ).rejects.toThrow(/not found/);
  });

  it("clears the whole pantry", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Rice" });
    await addPantryItem(user._id.toString(), { name: "Beans" });

    const deleted = await clearPantry(user._id.toString());
    expect(deleted).toBe(2);

    const { total } = await listPantryItems(user._id.toString());
    expect(total).toBe(0);
  });

  it("adds the canonical staples list idempotently", async () => {
    const user = await createPremiumUser();

    const first = await addStaples(user._id.toString());
    expect(first.added).toBe(13);
    expect(first.items).toHaveLength(13);

    const second = await addStaples(user._id.toString());
    expect(second.added).toBe(0);
    expect(second.items).toHaveLength(13);

    const { total } = await listPantryItems(user._id.toString());
    expect(total).toBe(13);
  });

  it("accepts an 80 character name and rejects 81", async () => {
    const user = await createPremiumUser();

    await expect(
      addPantryItem(user._id.toString(), { name: "a".repeat(80) })
    ).resolves.toBeDefined();

    await expect(
      addPantryItem(user._id.toString(), { name: "b".repeat(81) })
    ).rejects.toThrow();
  });

  it("rejects a whitespace-only name", async () => {
    const user = await createPremiumUser();

    await expect(
      addPantryItem(user._id.toString(), { name: "   " })
    ).rejects.toThrow();
  });
});

describe("pantry-service matches", () => {
  it("returns no matches for an empty pantry without erroring", async () => {
    const user = await createPremiumUser();
    await createRecipeWithIngredients(user._id, ["Water"]);

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 20,
    });

    expect(result).toEqual({ matches: [], nextCursor: null, total: 0 });
  });

  it("computes have/missing counts and match percent against a partial pantry", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });
    await addPantryItem(user._id.toString(), { name: "Onion" });

    await createRecipeWithIngredients(user._id, ["Tomato", "Onion", "Garlic"]);

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 20,
    });

    expect(result.matches).toHaveLength(1);
    const match = result.matches[0];
    expect(match.haveCount).toBe(2);
    expect(match.totalCount).toBe(3);
    expect(match.missingCount).toBe(1);
    expect(match.matchPercent).toBe(67);
    expect(match.missingIngredients).toEqual(["Garlic"]);
  });

  it("gives a 1-item pantry a 100 percent match against a 1-ingredient recipe", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Egg" });
    await createRecipeWithIngredients(user._id, ["Egg"]);

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 0,
      limit: 20,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchPercent).toBe(100);
    expect(result.matches[0].missingCount).toBe(0);
  });

  it("filters exactly with maxMissing: 0", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });
    await addPantryItem(user._id.toString(), { name: "Onion" });

    await createRecipeWithIngredients(user._id, ["Tomato", "Onion"], {
      title: "Cookable now",
    });
    await createRecipeWithIngredients(user._id, ["Tomato", "Onion", "Garlic"], {
      title: "Missing one",
    });

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 0,
      limit: 20,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].recipe.title).toBe("Cookable now");
  });

  it("excludes recipes with zero ingredients entirely", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });
    await createRecipeWithIngredients(user._id, []);

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 20,
    });

    expect(result.matches).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("returns missing ingredient names in their original casing", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });
    await createRecipeWithIngredients(user._id, ["Tomato", "Fresh Basil Leaves"]);

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 20,
    });

    expect(result.matches[0].missingIngredients).toEqual(["Fresh Basil Leaves"]);
  });

  it("treats water and plain salt as always available even when absent from the pantry", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Flour" });
    await createRecipeWithIngredients(user._id, ["Flour", "Water", "Salt"]);

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 0,
      limit: 20,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].haveCount).toBe(3);
    expect(result.matches[0].missingCount).toBe(0);
  });

  describe("scope", () => {
    it("scope mine only includes own and saved recipes, not every visible recipe", async () => {
      const user = await createPremiumUser();
      const friend = await createPremiumUser({ fullName: "Friend" });
      await addPantryItem(user._id.toString(), { name: "Tomato" });

      await createRecipeWithIngredients(user._id, ["Tomato"], { title: "Mine" });
      await createRecipeWithIngredients(friend._id, ["Tomato"], { title: "Friend public" });

      const result = await getPantryMatches(user._id.toString(), {
        scope: "mine",
        maxMissing: 5,
        limit: 20,
      });

      expect(result.matches.map((m) => m.recipe.title)).toEqual(["Mine"]);
    });

    it("scope all also includes other visible public recipes", async () => {
      const user = await createPremiumUser();
      const friend = await createPremiumUser({ fullName: "Friend" });
      await addPantryItem(user._id.toString(), { name: "Tomato" });

      await createRecipeWithIngredients(user._id, ["Tomato"], { title: "Mine" });
      await createRecipeWithIngredients(friend._id, ["Tomato"], { title: "Friend public" });

      const result = await getPantryMatches(user._id.toString(), {
        scope: "all",
        maxMissing: 5,
        limit: 20,
      });

      const titles = result.matches.map((m) => m.recipe.title).sort();
      expect(titles).toEqual(["Friend public", "Mine"]);
    });

    it("excludes another user's private recipe from scope all", async () => {
      const user = await createPremiumUser();
      const stranger = await createPremiumUser({ fullName: "Stranger" });
      await addPantryItem(user._id.toString(), { name: "Tomato" });

      await createRecipeWithIngredients(stranger._id, ["Tomato"], {
        title: "Private",
        isPrivate: true,
      });

      const result = await getPantryMatches(user._id.toString(), {
        scope: "all",
        maxMissing: 5,
        limit: 20,
      });

      expect(result.matches).toHaveLength(0);
    });

    it("excludes a blocked author's recipe from scope all", async () => {
      const user = await createPremiumUser();
      const blocked = await createPremiumUser({ fullName: "Blocked" });
      await addPantryItem(user._id.toString(), { name: "Tomato" });

      await createRecipeWithIngredients(blocked._id, ["Tomato"], { title: "Blocked recipe" });
      await Block.create({ blockerId: user._id, blockedId: blocked._id });

      const result = await getPantryMatches(user._id.toString(), {
        scope: "all",
        maxMissing: 5,
        limit: 20,
      });

      expect(result.matches).toHaveLength(0);
    });
  });

  it("paginates deterministically, covering every match exactly once", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });

    for (let i = 0; i < 7; i++) {
      await createRecipeWithIngredients(user._id, ["Tomato"], {
        title: `Recipe ${i}`,
        likesCount: i,
      });
    }

    const full = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 50,
    });
    expect(full.matches).toHaveLength(7);
    expect(full.total).toBe(7);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await getPantryMatches(user._id.toString(), {
        scope: "mine",
        maxMissing: 5,
        limit: 3,
        cursor,
      });
      seen.push(...page.matches.map((m) => m.recipe.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(new Set(full.matches.map((m) => m.recipe.id)));
  });

  it("does not duplicate results when a new recipe is added between pages", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });

    for (let i = 0; i < 5; i++) {
      await createRecipeWithIngredients(user._id, ["Tomato"], {
        title: `Recipe ${i}`,
        likesCount: i,
      });
    }

    const page1 = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 2,
    });
    expect(page1.matches.map((m) => m.recipe.title)).toEqual(["Recipe 4", "Recipe 3"]);
    expect(page1.nextCursor).toBeTruthy();

    await createRecipeWithIngredients(user._id, ["Tomato"], {
      title: "Newcomer",
      likesCount: 100,
    });

    const page2 = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });

    const titles = [...page1.matches, ...page2.matches].map((m) => m.recipe.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).not.toContain("Newcomer");
  });

  it("returns 400 for a cursor that does not resolve to a current match", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });
    await createRecipeWithIngredients(user._id, ["Tomato"]);

    await expect(
      getPantryMatches(user._id.toString(), {
        scope: "mine",
        maxMissing: 5,
        limit: 20,
        cursor: new Types.ObjectId().toString(),
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("excludes a hidden recipe from the owner's own matches", async () => {
    const user = await createPremiumUser();
    await addPantryItem(user._id.toString(), { name: "Tomato" });
    await createRecipeWithIngredients(user._id, ["Tomato"], {
      title: "Hidden",
      isHidden: true,
    });

    const result = await getPantryMatches(user._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 20,
    });

    expect(result.matches).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("excludes a saved recipe once the author's account goes private", async () => {
    const author = await createPremiumUser({ fullName: "Author" });
    const saver = await createPremiumUser({ fullName: "Saver" });
    await addPantryItem(saver._id.toString(), { name: "Tomato" });

    const recipe = await createRecipeWithIngredients(author._id, ["Tomato"], {
      title: "Saved Recipe",
    });
    await SavedRecipe.create({ userId: saver._id, recipeId: recipe._id });

    await User.updateOne({ _id: author._id }, { $set: { isPublic: false } });

    const result = await getPantryMatches(saver._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 20,
    });

    expect(result.matches).toHaveLength(0);
  });

  it("excludes a saved recipe once the author makes it private", async () => {
    const author = await createPremiumUser({ fullName: "Author" });
    const saver = await createPremiumUser({ fullName: "Saver" });
    await addPantryItem(saver._id.toString(), { name: "Tomato" });

    const recipe = await createRecipeWithIngredients(author._id, ["Tomato"], {
      title: "Saved Recipe",
    });
    await SavedRecipe.create({ userId: saver._id, recipeId: recipe._id });

    await Recipe.updateOne({ _id: recipe._id }, { $set: { isPrivate: true } });

    const result = await getPantryMatches(saver._id.toString(), {
      scope: "mine",
      maxMissing: 5,
      limit: 20,
    });

    expect(result.matches).toHaveLength(0);
  });
});

describe("normalizedIngredients stays in sync", () => {
  it("is populated on create, deduplicated and normalized", async () => {
    const user = await createPremiumUser();

    const recipe = await createRecipe(user._id.toString(), {
      title: "Fresh Recipe",
      ingredients: [
        { name: "2 cups Flour", quantity: 2, unit: "cup" },
        { name: "Flour", quantity: 1, unit: "cup" },
        { name: "Egg", quantity: 1, unit: "unit" },
      ],
    });

    const stored = await Recipe.findById(recipe._id).lean();
    expect([...(stored?.normalizedIngredients ?? [])].sort()).toEqual(["egg", "flour"]);
  });

  it("is recomputed after an edit changes the ingredients", async () => {
    const user = await createPremiumUser();

    const recipe = await createRecipe(user._id.toString(), {
      title: "Edit Me",
      ingredients: [{ name: "Onion", quantity: 1, unit: "unit" }],
    });

    await updateRecipe(recipe._id.toString(), user._id.toString(), {
      ingredients: [
        { name: "Garlic", quantity: 2, unit: "clove" },
        { name: "Ginger", quantity: 1, unit: "unit" },
      ],
    });

    const stored = await Recipe.findById(recipe._id).lean();
    expect([...(stored?.normalizedIngredients ?? [])].sort()).toEqual(["garlic", "ginger"]);
  });

  it("is populated on a fork/remix from the forked ingredients", async () => {
    const author = await createPremiumUser({ fullName: "Author" });
    const forker = await createPremiumUser({ fullName: "Forker" });

    const original = await createRecipe(author._id.toString(), {
      title: "Original",
      ingredients: [{ name: "Tomato", quantity: 1, unit: "unit" }],
    });

    const forked = await forkRecipe(original._id.toString(), forker._id.toString());

    const stored = await Recipe.findById(forked._id).lean();
    expect(stored?.normalizedIngredients).toEqual(["tomato"]);
  });
});
