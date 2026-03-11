import { Request, Response } from "express";
import SeasonalTag from "../../models/SeasonalTag";
import Recipe from "../../models/Recipe";

export async function seasonalPage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const tags = await SeasonalTag.find().sort({ startDate: -1 }).lean();
    const selectedTag = req.query.tag as string;

    let taggedRecipes: Array<Record<string, unknown>> = [];
    let searchResults: Array<Record<string, unknown>> = [];
    const search = (req.query.search as string) || "";

    if (selectedTag) {
      taggedRecipes = await Recipe.find({ seasonalTags: selectedTag })
        .populate("authorId", "fullName")
        .select("title authorId photos likesCount createdAt seasonalTags")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
    }

    if (search) {
      searchResults = await Recipe.find({
        title: { $regex: search, $options: "i" },
        isHidden: { $ne: true },
      })
        .populate("authorId", "fullName")
        .select("title authorId photos likesCount createdAt seasonalTags")
        .limit(20)
        .lean();
    }

    res.render("seasonal", {
      page: "seasonal",
      tags,
      selectedTag,
      taggedRecipes,
      searchResults,
      search,
    });
  } catch (error) {
    console.error("Failed to load seasonal page:", error);
    res.status(500).send("Internal server error");
  }
}

export async function createTag(req: Request, res: Response): Promise<void> {
  try {
    const { name, slug, startDate, endDate } = req.body;

    if (!name || !slug || !startDate || !endDate) {
      res.status(400).json({ error: "All fields are required" });
      return;
    }

    const existing = await SeasonalTag.findOne({ slug }).lean();
    if (existing) {
      res.status(409).json({ error: "A tag with this slug already exists" });
      return;
    }

    await SeasonalTag.create({
      name: String(name).trim(),
      slug: String(slug).toLowerCase().replace(/\s+/g, "-"),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to create tag:", error);
    res.status(500).json({ error: "Failed to create tag" });
  }
}

export async function toggleTag(req: Request, res: Response): Promise<void> {
  try {
    const tag = await SeasonalTag.findById(req.params.id);
    if (!tag) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    tag.isActive = !tag.isActive;
    await tag.save();
    res.json({ success: true, isActive: tag.isActive });
  } catch (error) {
    console.error("Failed to toggle tag:", error);
    res.status(500).json({ error: "Failed to update tag" });
  }
}

export async function deleteTag(req: Request, res: Response): Promise<void> {
  try {
    const tag = await SeasonalTag.findById(req.params.id);
    if (!tag) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }

    // Remove this tag from all recipes
    await Recipe.updateMany(
      { seasonalTags: tag.slug },
      { $pull: { seasonalTags: tag.slug } }
    );

    await SeasonalTag.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete tag:", error);
    res.status(500).json({ error: "Failed to delete tag" });
  }
}

export async function tagRecipe(req: Request, res: Response): Promise<void> {
  try {
    const { recipeId, tagSlug } = req.body;

    if (!recipeId || !tagSlug) {
      res.status(400).json({ error: "Recipe ID and tag slug are required" });
      return;
    }

    const tag = await SeasonalTag.findOne({ slug: tagSlug });
    if (!tag) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }

    await Recipe.findByIdAndUpdate(recipeId, {
      $addToSet: { seasonalTags: tagSlug },
    });

    tag.recipesCount = await Recipe.countDocuments({ seasonalTags: tagSlug });
    await tag.save();

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to tag recipe:", error);
    res.status(500).json({ error: "Failed to tag recipe" });
  }
}

export async function untagRecipe(req: Request, res: Response): Promise<void> {
  try {
    const { recipeId, tagSlug } = req.body;

    if (!recipeId || !tagSlug) {
      res.status(400).json({ error: "Recipe ID and tag slug are required" });
      return;
    }

    await Recipe.findByIdAndUpdate(recipeId, {
      $pull: { seasonalTags: tagSlug },
    });

    const tag = await SeasonalTag.findOne({ slug: tagSlug });
    if (tag) {
      tag.recipesCount = await Recipe.countDocuments({ seasonalTags: tagSlug });
      await tag.save();
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to untag recipe:", error);
    res.status(500).json({ error: "Failed to untag recipe" });
  }
}
