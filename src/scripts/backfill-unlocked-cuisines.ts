import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User";
import CookedPost from "../models/CookedPost";
import { canonicalCuisine } from "../lib/cuisines";
import { env } from "../lib/env";

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const cursor = User.find({ unlockedCuisines: { $exists: false } })
    .select("_id")
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  let batch: mongoose.AnyBulkWriteOperation[] = [];

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const result = await User.bulkWrite(batch, { ordered: false });
    updated += result.modifiedCount ?? 0;
    batch = [];
  }

  for await (const doc of cursor) {
    scanned += 1;

    const cuisineTags = await CookedPost.distinct("cuisineTags", {
      userId: doc._id,
      removedAt: null,
    });
    const unlockedCuisines = Array.from(
      new Set(
        cuisineTags
          .map((c) => (typeof c === "string" ? canonicalCuisine(c) : null))
          .filter((c): c is string => c !== null)
      )
    );

    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { unlockedCuisines } },
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await flush();
    }

    if (scanned % 5000 === 0) {
      console.log(`  ...scanned ${scanned}, updated ${updated}`);
    }
  }

  await flush();

  console.log(`Done. Scanned ${scanned} users, updated ${updated}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
