import "dotenv/config";
import mongoose from "mongoose";
import Recipe, { computeNormalizedIngredients } from "../models/Recipe";
import { env } from "../lib/env";

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const cursor = Recipe.find({})
    .select("_id ingredients normalizedIngredients")
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  let batch: mongoose.AnyBulkWriteOperation[] = [];

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const result = await Recipe.bulkWrite(batch, { ordered: false });
    updated += result.modifiedCount ?? 0;
    batch = [];
  }

  for await (const doc of cursor) {
    scanned += 1;
    const next = computeNormalizedIngredients(doc.ingredients ?? []);
    const current = doc.normalizedIngredients ?? [];
    const same =
      current.length === next.length &&
      current.every((value, index) => value === next[index]);

    if (!same) {
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { normalizedIngredients: next } },
        },
      });
    }

    if (batch.length >= BATCH_SIZE) {
      await flush();
    }

    if (scanned % 5000 === 0) {
      console.log(`  ...scanned ${scanned}, updated ${updated}`);
    }
  }

  await flush();

  console.log(`Done. Scanned ${scanned} recipe(s), updated ${updated}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
