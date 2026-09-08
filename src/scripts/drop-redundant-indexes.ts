import "dotenv/config";
import mongoose, { Model } from "mongoose";
import { env } from "../lib/env";
import Recipe from "../models/Recipe";
import User from "../models/User";
import Follow from "../models/Follow";
import Notification from "../models/Notification";
import AuditLog from "../models/AuditLog";
import Block from "../models/Block";
import Cookbook from "../models/Cookbook";
import CookedPost from "../models/CookedPost";
import ClientError from "../models/ClientError";
import RecipeRating from "../models/RecipeRating";
import RecipeShare from "../models/RecipeShare";

const TARGETS: Array<{ model: Model<unknown>; indexNames: string[] }> = [
  { model: Recipe, indexNames: ["authorId_1"] },
  { model: User, indexNames: ["isSeed_1"] },
  { model: Follow, indexNames: ["followerId_1"] },
  { model: Notification, indexNames: ["userId_1", "userId_1_createdAt_-1"] },
  { model: AuditLog, indexNames: ["adminId_1"] },
  { model: Block, indexNames: ["blockerId_1"] },
  { model: Cookbook, indexNames: ["ownerId_1"] },
  { model: CookedPost, indexNames: ["userId_1", "recipeId_1"] },
  { model: ClientError, indexNames: ["fingerprint_1"] },
  { model: RecipeRating, indexNames: ["recipeId_1"] },
  { model: RecipeShare, indexNames: ["recipientId_1"] },
];

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");

  for (const { model, indexNames } of TARGETS) {
    const collection = model.collection;
    const existing = await collection.indexes();
    const existingNames = new Set(existing.map((idx) => idx.name));

    for (const indexName of indexNames) {
      if (!existingNames.has(indexName)) {
        console.log(`${collection.collectionName}: '${indexName}' already gone, skipping.`);
        continue;
      }
      await collection.dropIndex(indexName);
      console.log(`${collection.collectionName}: dropped '${indexName}'.`);
    }
  }

  console.log("Done.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
