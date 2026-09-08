import "dotenv/config";
import mongoose from "mongoose";
import Recipe from "../models/Recipe";
import { TRENDING_DECAY_RATE } from "../services/feed-service";
import { env } from "../lib/env";

const BATCH_SIZE = 500;

export function computeTrendingScore(
  likesCount: number,
  forksCount: number,
  createdAt: Date,
  now: Date
): number {
  const ageDays =
    (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const rawEngagement = likesCount + forksCount * 3;
  return rawEngagement * Math.exp(-TRENDING_DECAY_RATE * ageDays);
}

export async function recomputeTrendingScores(
  now: Date = new Date()
): Promise<{ scanned: number; updated: number }> {
  const cursor = Recipe.find({})
    .select("_id likesCount forksCount createdAt")
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
    const trendingScore = computeTrendingScore(
      doc.likesCount ?? 0,
      doc.forksCount ?? 0,
      doc.createdAt,
      now
    );

    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { trendingScore, trendingScoreUpdatedAt: now } },
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

  return { scanned, updated };
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const { scanned, updated } = await recomputeTrendingScores();

  console.log(`Done. Scanned ${scanned} recipe(s), updated ${updated}.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
