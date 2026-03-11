import mongoose from "mongoose";
import { env } from "../lib/env";
import SystemLabel from "../models/SystemLabel";

interface LabelSeed {
  name: string;
  slug: string;
  icon: string;
  order: number;
}

const labels: LabelSeed[] = [
  { name: "Breakfast", slug: "breakfast", icon: "\u{1F305}", order: 1 },
  { name: "Lunch", slug: "lunch", icon: "\u{2600}\u{FE0F}", order: 2 },
  { name: "Dinner", slug: "dinner", icon: "\u{1F319}", order: 3 },
  { name: "Snack", slug: "snack", icon: "\u{1F37F}", order: 4 },
  { name: "Dessert", slug: "dessert", icon: "\u{1F370}", order: 5 },
  { name: "Drink", slug: "drink", icon: "\u{1F964}", order: 6 },
];

async function seedLabels(): Promise<void> {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected.");

  for (const label of labels) {
    const result = await SystemLabel.findOneAndUpdate(
      { slug: label.slug },
      { $set: label },
      { upsert: true, new: true }
    );
    console.log(`Upserted label: ${result.name} (${result.slug})`);
  }

  console.log(`Seeded ${labels.length} system labels.`);
  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

seedLabels().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
