/**
 * One-time / maintenance: snapshot the original chef's signature onto every
 * existing remix that pre-dates the snapshot field. New remixes are snapshotted
 * inline by `forkRecipe`; this script only catches the historical backlog.
 *
 * For each fork with `forkedFrom.authorId` set, it looks up the origin author's
 * current signature and writes it to `originalSignatureUrl`. If the origin
 * author no longer has a signature on file, the field is left unset.
 *
 * Run: npm run backfill:remix-signatures
 */
import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User";
import Recipe from "../models/Recipe";
import { env } from "../lib/env";

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const remixes = await Recipe.find({
    "forkedFrom.authorId": { $ne: null },
    originalSignatureUrl: { $exists: false },
  })
    .select("_id forkedFrom")
    .lean();

  if (remixes.length === 0) {
    console.log("No remixes need backfilling.");
    await mongoose.disconnect();
    return;
  }

  // Cache author lookups so a popular origin author isn't queried per-remix.
  const cache = new Map<string, string | null>();
  let snapshotted = 0;
  let skipped = 0;

  for (const remix of remixes) {
    const authorId = remix.forkedFrom?.authorId?.toString();
    if (!authorId) {
      skipped += 1;
      continue;
    }
    if (!cache.has(authorId)) {
      const author = await User.findById(authorId).select("signature").lean();
      cache.set(authorId, author?.signature ?? null);
    }
    const sig = cache.get(authorId);
    if (!sig) {
      skipped += 1;
      continue;
    }
    await Recipe.updateOne(
      { _id: remix._id },
      { $set: { originalSignatureUrl: sig } }
    );
    snapshotted += 1;
  }

  console.log(
    `Backfill complete — snapshotted ${snapshotted} remix(es), skipped ${skipped} without an origin signature.`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
