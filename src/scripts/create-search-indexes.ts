import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../lib/env";
import {
  RECIPES_SEARCH_INDEX_NAME,
  recipesSearchIndexDefinition,
} from "../lib/atlas-search";

function isUnsupportedClusterError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /atlas|not supported|not allowed|unrecognized|no such command|command not found/i.test(
    message
  );
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("No active database connection");
  }
  const collection = db.collection("recipes");

  let existing: Array<{ name?: string }> = [];
  try {
    existing = await collection
      .listSearchIndexes(RECIPES_SEARCH_INDEX_NAME)
      .toArray();
  } catch (err) {
    if (isUnsupportedClusterError(err)) {
      console.error(
        `This cluster does not support Atlas Search index management. ` +
          `Search indexes can only be created on a MongoDB Atlas cluster with Search enabled ` +
          `(not a self-hosted mongod or a plain shared-tier cluster without Search).`
      );
    } else {
      console.error("Failed to list existing search indexes:", err);
    }
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const alreadyExists = existing.some(
    (idx) => idx.name === RECIPES_SEARCH_INDEX_NAME
  );

  try {
    if (alreadyExists) {
      await collection.updateSearchIndex(
        RECIPES_SEARCH_INDEX_NAME,
        recipesSearchIndexDefinition
      );
      console.log(`Updated existing search index '${RECIPES_SEARCH_INDEX_NAME}'.`);
    } else {
      await collection.createSearchIndex({
        name: RECIPES_SEARCH_INDEX_NAME,
        definition: recipesSearchIndexDefinition,
      });
      console.log(`Created search index '${RECIPES_SEARCH_INDEX_NAME}'.`);
    }
  } catch (err) {
    if (isUnsupportedClusterError(err)) {
      console.error(
        `This cluster does not support Atlas Search index management. ` +
          `Search indexes can only be created on a MongoDB Atlas cluster with Search enabled.`
      );
    } else {
      console.error(`Failed to write search index '${RECIPES_SEARCH_INDEX_NAME}':`, err);
    }
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  console.log(
    "Atlas is now building the index in the background. Check the Atlas UI (Search tab) or " +
      "`listSearchIndexes` for status; it is not queryable until status is READY."
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
