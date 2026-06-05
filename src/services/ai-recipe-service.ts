import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import User from "../models/User";
import { env } from "../lib/env";
import { hasActivePremium } from "../lib/premium";
import { FREE_TIER_RECIPE_LIMIT } from "./recipe-service";
import type { ImportedRecipe, ImportedIngredient, ImportedStep } from "./recipe-import-service";

const AI_DAILY_LIMIT = 20;

/**
 * Per-day ceiling on free AI recipe imports. The product limit is the
 * {@link FREE_TIER_RECIPE_LIMIT} recipe cap; this is only an anti-abuse guard
 * because each import runs (and bills) a Claude read BEFORE the recipe is saved.
 */
const FREE_IMPORT_DAILY_LIMIT = 10;

const ingredientSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
});

const stepSchema = z.object({
  order: z.number().int().positive(),
  instruction: z.string(),
});

const recipeJsonSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  prepTime: z.number().nonnegative().optional(),
  cookTime: z.number().nonnegative().optional(),
  servings: z.number().positive().optional(),
  ingredients: z.array(ingredientSchema),
  steps: z.array(stepSchema),
  dietaryTags: z.array(z.string()).optional(),
  cuisineTags: z.array(z.string()).optional(),
});

interface ServiceError extends Error {
  statusCode: number;
  code?: string;
}

function createError(
  message: string,
  statusCode: number,
  code?: string
): ServiceError {
  const err = new Error(message) as ServiceError;
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw createError("AI Recipe Helper is not configured.", 503, "AI_UNAVAILABLE");
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export type AiFeature = "generate" | "substitutions" | "format";

/**
 * Returns today's date as `YYYY-MM-DD` at [offsetMinutes] east of UTC
 * (Dart's `DateTime.timeZoneOffset.inMinutes`). Falls back to UTC when the
 * offset is missing. Never throws so bad client data can't wedge the quota.
 */
function localDayKey(offsetMinutes?: number | null): string {
  if (offsetMinutes == null || !Number.isFinite(offsetMinutes)) {
    return new Date().toISOString().slice(0, 10);
  }
  const localMs = Date.now() + offsetMinutes * 60_000;
  return new Date(localMs).toISOString().slice(0, 10);
}

function normalizeOffset(
  raw: number | null | undefined
): number | undefined {
  if (raw == null || !Number.isFinite(raw)) return undefined;
  // Sanity-clip to `-14*60..14*60` (no inhabited zone is outside Etc/GMT±14).
  const clipped = Math.round(raw);
  if (clipped < -840 || clipped > 840) return undefined;
  return clipped;
}

export async function getAiUsage(
  userId: string,
  offsetOverride?: number | null
): Promise<{ used: number; limit: number }> {
  const user = await User.findById(userId)
    .select(
      "aiRecipeHelperUsageDay aiRecipeHelperUsageCount timezoneOffsetMinutes"
    )
    .lean();
  if (!user) {
    throw createError("User not found", 404);
  }
  const offset =
    normalizeOffset(offsetOverride) ?? user.timezoneOffsetMinutes ?? undefined;
  const day = localDayKey(offset);
  const used =
    user.aiRecipeHelperUsageDay === day ? user.aiRecipeHelperUsageCount ?? 0 : 0;
  return { used, limit: AI_DAILY_LIMIT };
}

export async function assertAiQuota(
  userId: string,
  offsetOverride?: number | null
): Promise<void> {
  const { used, limit } = await getAiUsage(userId, offsetOverride);
  if (used >= limit) {
    throw createError(
      `Daily AI limit reached (${limit} uses). Try again tomorrow.`,
      429,
      "AI_QUOTA_EXCEEDED"
    );
  }
}

/**
 * Increments the user's daily + lifetime + per-feature AI counters and
 * stamps `aiLastUsedAt`. Also persists the client-supplied timezone offset
 * so the user record reflects their last-seen zone without a separate
 * endpoint.
 *
 * Rolls the daily counter over to `1` when the user's local day has changed;
 * otherwise `$inc`s it. Uses atomic updates so concurrent AI calls don't
 * lose increments the way a read-modify-write `.save()` loop would.
 */
export async function recordAiUsage(
  userId: string,
  feature: AiFeature,
  offsetOverride?: number | null
): Promise<void> {
  const existing = await User.findById(userId)
    .select("aiRecipeHelperUsageDay timezoneOffsetMinutes")
    .lean();

  const offset =
    normalizeOffset(offsetOverride) ?? existing?.timezoneOffsetMinutes ?? undefined;
  const day = localDayKey(offset);

  const featureField =
    feature === "generate"
      ? "aiGenerateCount"
      : feature === "substitutions"
      ? "aiSubstitutionsCount"
      : "aiFormatCount";

  const rolledOver = existing?.aiRecipeHelperUsageDay !== day;

  const setFields: Record<string, unknown> = {
    aiLastUsedAt: new Date(),
    aiRecipeHelperUsageDay: day,
  };
  const normalizedOverride = normalizeOffset(offsetOverride);
  if (normalizedOverride !== undefined) {
    setFields.timezoneOffsetMinutes = normalizedOverride;
  }

  const incFields: Record<string, number> = {
    aiTotalMessagesSent: 1,
    [featureField]: 1,
  };

  if (rolledOver) {
    // New local day — reset the daily counter to exactly 1 (this call).
    await User.updateOne(
      { _id: userId },
      { $set: { ...setFields, aiRecipeHelperUsageCount: 1 }, $inc: incFields }
    );
  } else {
    await User.updateOne(
      { _id: userId },
      {
        $set: setFields,
        $inc: { ...incFields, aiRecipeHelperUsageCount: 1 },
      }
    );
  }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

async function runRecipeJsonPrompt(system: string, userMessage: string): Promise<ImportedRecipe> {
  const client = getClient();
  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw createError("AI returned no text", 502);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(block.text));
  } catch {
    throw createError("AI returned invalid JSON", 502);
  }
  const data = recipeJsonSchema.parse(parsed);
  const ingredients: ImportedIngredient[] = data.ingredients.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
  }));
  const steps: ImportedStep[] = data.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ order: s.order, instruction: s.instruction }));

  return {
    title: data.title,
    description: data.description,
    prepTime: data.prepTime,
    cookTime: data.cookTime,
    servings: data.servings,
    ingredients,
    steps,
    dietaryTags: data.dietaryTags ?? [],
    cuisineTags: data.cuisineTags ?? [],
    sourceUrl: "",
  };
}

const JSON_ONLY_SYSTEM = `You are a cooking assistant for the Chefless app. Reply with a single JSON object only (no markdown), matching this shape:
{
  "title": string,
  "description"?: string,
  "prepTime"?: number (minutes),
  "cookTime"?: number (minutes),
  "servings"?: number,
  "ingredients": [{ "name": string, "quantity": number, "unit": string }],
  "steps": [{ "order": number (1-based), "instruction": string }],
  "dietaryTags"?: string[],
  "cuisineTags"?: string[]
}
Use sensible metric/imperial units (e.g. g, ml, tsp, cup).`;

export async function aiGenerateFromIngredients(prompt: string): Promise<ImportedRecipe> {
  const p = prompt.trim();
  if (!p) throw createError("Prompt is required", 400);
  if (p.length > 4000) throw createError("Prompt is too long", 400);
  return runRecipeJsonPrompt(
    JSON_ONLY_SYSTEM,
    `Create a complete recipe from what the user has. User input:\n${p}`
  );
}

export async function aiSuggestSubstitutions(
  ingredients: string,
  dietaryNeed: string
): Promise<{ substitutions: { original: string; replacement: string; note?: string }[] }> {
  const ing = ingredients.trim();
  const need = dietaryNeed.trim();
  if (!ing || !need) throw createError("ingredients and dietaryNeed are required", 400);

  const client = getClient();
  const subSchema = z.object({
    substitutions: z.array(
      z.object({
        original: z.string(),
        replacement: z.string(),
        note: z.string().optional(),
      })
    ),
  });

  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system:
      "Reply with JSON only: { \"substitutions\": [{ \"original\", \"replacement\", \"note?\" }] }",
    messages: [
      {
        role: "user",
        content: `Suggest ingredient substitutions for this dietary need: ${need}\n\nCurrent ingredients / recipe context:\n${ing.slice(0, 8000)}`,
      },
    ],
  });
  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw createError("AI returned no text", 502);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(block.text));
  } catch {
    throw createError("AI returned invalid JSON", 502);
  }
  return subSchema.parse(parsed);
}

export async function aiFormatRoughNotes(notes: string): Promise<ImportedRecipe> {
  const n = notes.trim();
  if (!n) throw createError("Notes are required", 400);
  if (n.length > 12000) throw createError("Notes are too long", 400);
  return runRecipeJsonPrompt(
    JSON_ONLY_SYSTEM,
    `Turn these rough cooking notes into a structured recipe with estimated quantities and clear steps:\n${n}`
  );
}

// ---------------------------------------------------------------------------
// Social-caption import
// ---------------------------------------------------------------------------

const CAPTION_MAX_LENGTH = 12000;

const CAPTION_IMPORT_SYSTEM = `You are a cooking assistant for the Chefless app. You are given the public caption or description of a social media post or web page. Your job is to extract a single cookable recipe from it, or to declare there is none.

Your reply MUST be a single valid JSON object and nothing else. No prose, no apologies, no markdown fences, no commentary before or after the JSON.

If the text does not describe an actual cookable recipe (no real ingredients, or just a passing mention of food, or a joke / meme / non-food content), reply with exactly this and nothing else:
{"notARecipe": true}

A caption qualifies as a recipe only when it actually lists or implies cookable ingredients AND describes how to prepare them. A caption that just says "cooking", "made dinner", or names a dish without telling the reader how to make it is NOT a recipe — reply with {"notARecipe": true}.

Otherwise reply with a single JSON object in this shape:
{
  "title": string,
  "description"?: string,
  "prepTime"?: number (minutes),
  "cookTime"?: number (minutes),
  "servings"?: number,
  "ingredients": [{ "name": string, "quantity": number, "unit": string }],
  "steps": [{ "order": number (1-based), "instruction": string }],
  "dietaryTags"?: string[],
  "cuisineTags"?: string[]
}
"ingredients" must have at least one item and "steps" must have at least one item. Infer reasonable quantities and units (e.g. g, ml, tsp, cup) when the caption is vague. Do not invent a recipe that is not implied by the text — if in doubt, reply with {"notARecipe": true}.`;

/**
 * Extracts a structured recipe from a social caption / page description.
 * Returns `null` when the caption holds no cookable recipe (the model returns
 * the `{"notARecipe":true}` sentinel) so the route can map that to
 * NO_RECIPE_FOUND. On success the recipe's `sourceUrl` is set to [sourceUrl].
 */
export async function aiExtractRecipeFromCaption(
  caption: string,
  sourceUrl: string
): Promise<ImportedRecipe | null> {
  const trimmed = caption.trim();
  if (!trimmed) throw createError("Caption is required", 400);

  const client = getClient();
  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system: CAPTION_IMPORT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Extract the recipe from this caption:\n${trimmed.slice(0, CAPTION_MAX_LENGTH)}`,
      },
    ],
  });

  // Treat any non-recipe outcome (sentinel, no text block, unparseable JSON,
  // schema mismatch, empty ingredients/steps, missing title) as null so the
  // route returns a clean NO_RECIPE_FOUND. We only let genuine infrastructure
  // failures (network / auth from the SDK call above) bubble up.

  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(block.text));
  } catch {
    return null;
  }

  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>).notARecipe === true
  ) {
    return null;
  }

  const result = recipeJsonSchema.safeParse(parsed);
  if (!result.success) return null;

  const data = result.data;
  const title = data.title.trim();
  const ingredients: ImportedIngredient[] = data.ingredients
    .filter((i) => i.name.trim() !== "")
    .map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit }));
  const steps: ImportedStep[] = data.steps
    .filter((s) => s.instruction.trim() !== "")
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ order: s.order, instruction: s.instruction }));

  if (!title || ingredients.length === 0 || steps.length === 0) return null;

  return {
    title,
    description: data.description,
    prepTime: data.prepTime,
    cookTime: data.cookTime,
    servings: data.servings,
    ingredients,
    steps,
    dietaryTags: data.dietaryTags ?? [],
    cuisineTags: data.cuisineTags ?? [],
    sourceUrl,
  };
}

// ---------------------------------------------------------------------------
// Import gating (free: recipe-count cap + daily anti-abuse -> premium daily quota)
// ---------------------------------------------------------------------------

/**
 * Enforces the AI-import gate WITHOUT consuming it.
 *
 * Premium users fall through to the existing daily quota check. For free users
 * the import feature itself is not the restriction — the recipe count is: they
 * may keep importing until originals + saved reach {@link FREE_TIER_RECIPE_LIMIT}
 * (throws 403 `RECIPE_LIMIT_REACHED`, matching the create/save cap). A separate
 * per-day ceiling ({@link FREE_IMPORT_DAILY_LIMIT}, 429 `AI_QUOTA_EXCEEDED`)
 * guards against re-running the billable AI read without ever saving.
 *
 * The daily counter is only advanced later by {@link recordImportUsage} after a
 * successful extraction, so a failed import does not burn the cap.
 */
export async function assertImportAllowed(
  userId: string,
  offsetOverride?: number | null
): Promise<void> {
  const user = await User.findById(userId)
    .select(
      "isPremium premiumExpiresAt originalRecipesCount savedRecipesCount aiRecipeHelperUsageDay aiRecipeHelperUsageCount timezoneOffsetMinutes"
    )
    .lean();
  if (!user) {
    throw createError("User not found", 404);
  }

  if (hasActivePremium(user)) {
    await assertAiQuota(userId, offsetOverride);
    return;
  }

  const recipeCount =
    (user.originalRecipesCount ?? 0) + (user.savedRecipesCount ?? 0);
  if (recipeCount >= FREE_TIER_RECIPE_LIMIT) {
    throw createError(
      `Free accounts can have ${FREE_TIER_RECIPE_LIMIT} recipes total. Upgrade to premium for unlimited recipes.`,
      403,
      "RECIPE_LIMIT_REACHED"
    );
  }

  const offset =
    normalizeOffset(offsetOverride) ?? user.timezoneOffsetMinutes ?? undefined;
  const day = localDayKey(offset);
  const usedToday =
    user.aiRecipeHelperUsageDay === day
      ? user.aiRecipeHelperUsageCount ?? 0
      : 0;
  if (usedToday >= FREE_IMPORT_DAILY_LIMIT) {
    throw createError(
      `Daily import limit reached (${FREE_IMPORT_DAILY_LIMIT}). Try again tomorrow.`,
      429,
      "AI_QUOTA_EXCEEDED"
    );
  }
}

/**
 * Records a successful AI import by advancing the shared daily AI counter (as
 * the `generate` feature) and stamping `aiLastUsedAt`. Free users are bounded
 * by {@link FREE_IMPORT_DAILY_LIMIT} and premium users by {@link AI_DAILY_LIMIT}
 * — both read the same `aiRecipeHelperUsageCount`, only the ceiling differs.
 */
export async function recordImportUsage(
  userId: string,
  offsetOverride?: number | null
): Promise<void> {
  await recordAiUsage(userId, "generate", offsetOverride);
}
