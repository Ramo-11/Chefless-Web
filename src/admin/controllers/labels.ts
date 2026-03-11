import { Request, Response } from "express";
import SystemLabel from "../../models/SystemLabel";

export async function labelsPage(req: Request, res: Response): Promise<void> {
  try {
    const labels = await SystemLabel.find().sort({ order: 1 }).lean();
    res.render("labels", { page: "labels", labels });
  } catch (error) {
    console.error("Failed to load labels page:", error);
    res.status(500).send("Internal server error");
  }
}

export async function createLabel(req: Request, res: Response): Promise<void> {
  try {
    const { name, slug, icon, order } = req.body;

    if (!name || !slug) {
      res.status(400).json({ error: "Name and slug are required" });
      return;
    }

    const existing = await SystemLabel.findOne({ slug }).lean();
    if (existing) {
      res.status(409).json({ error: "A label with this slug already exists" });
      return;
    }

    await SystemLabel.create({
      name: String(name).trim(),
      slug: String(slug).toLowerCase().replace(/\s+/g, "-"),
      icon: icon ? String(icon).trim() : undefined,
      order: parseInt(order) || 0,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to create label:", error);
    res.status(500).json({ error: "Failed to create label" });
  }
}

export async function updateLabel(req: Request, res: Response): Promise<void> {
  try {
    const { name, icon, order } = req.body;

    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const label = await SystemLabel.findByIdAndUpdate(
      req.params.id,
      {
        name: String(name).trim(),
        icon: icon ? String(icon).trim() : undefined,
        order: parseInt(order) || 0,
      },
      { new: true }
    ).lean();

    if (!label) {
      res.status(404).json({ error: "Label not found" });
      return;
    }

    res.json({ success: true, label });
  } catch (error) {
    console.error("Failed to update label:", error);
    res.status(500).json({ error: "Failed to update label" });
  }
}

export async function deleteLabel(req: Request, res: Response): Promise<void> {
  try {
    const label = await SystemLabel.findByIdAndDelete(req.params.id);
    if (!label) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete label:", error);
    res.status(500).json({ error: "Failed to delete label" });
  }
}
