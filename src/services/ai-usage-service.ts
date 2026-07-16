import AiUsageEvent, { AiUsageFeature } from "../models/AiUsageEvent";
import User from "../models/User";
import { logger } from "../lib/logger";

/**
 * Published Anthropic pricing in USD per million tokens, frozen into each
 * ledger row at insert time. Cache writes bill at 1.25x the input rate and
 * cache reads at 0.1x (Anthropic's standard multipliers). Add a row here
 * when the AI service moves to a new model.
 */
const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export interface AiCallMeta {
  userId: string;
  feature: AiUsageFeature;
}

interface AnthropicUsageShape {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function computeCostUsd(model: string, u: AnthropicUsageShape): number {
  const pricing = MODEL_PRICING_PER_MTOK[model];
  if (!pricing) {
    logger.warn({ model }, "No pricing entry for AI model; recording zero cost");
    return 0;
  }
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const inputCost =
    (u.input_tokens * pricing.input +
      cacheCreation * pricing.input * 1.25 +
      cacheRead * pricing.input * 0.1) /
    1_000_000;
  const outputCost = (u.output_tokens * pricing.output) / 1_000_000;
  return inputCost + outputCost;
}

/**
 * Records one billable Claude call to the permanent ledger. Fire-and-forget:
 * never throws and never blocks the AI response path, so a ledger hiccup can
 * only cost a row of analytics, not a user-facing failure.
 */
export function recordAiCall(
  meta: AiCallMeta,
  model: string,
  usage: AnthropicUsageShape
): void {
  void AiUsageEvent.create({
    userId: meta.userId,
    feature: meta.feature,
    modelId: model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    costUsd: computeCostUsd(model, usage),
  }).catch((err: unknown) => {
    logger.error({ err, meta }, "Failed to record AI usage event");
  });
}

export interface AiCostAnalytics {
  costThisMonth: number;
  costLastMonth: number;
  costAllTime: number;
  callsThisMonth: number;
  callsAllTime: number;
  tokensAllTime: { input: number; output: number };
  byFeature: { feature: string; calls: number; costUsd: number }[];
  monthlyTrend: { month: string; costUsd: number; calls: number }[];
  trackingSince: Date | null;
}

function startOfUtcMonth(offsetMonths: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
}

/** Cost analytics for the admin revenue page, from the AiUsageEvent ledger. */
export async function getAiCostAnalytics(): Promise<AiCostAnalytics> {
  const thisMonthStart = startOfUtcMonth(0);
  const lastMonthStart = startOfUtcMonth(-1);
  const trendStart = startOfUtcMonth(-11);

  const [totalsAgg, windowAgg, byFeatureAgg, trendAgg, earliest] =
    await Promise.all([
      AiUsageEvent.aggregate<{
        _id: null;
        costUsd: number;
        calls: number;
        inputTokens: number;
        outputTokens: number;
      }>([
        {
          $group: {
            _id: null,
            costUsd: { $sum: "$costUsd" },
            calls: { $sum: 1 },
            inputTokens: { $sum: "$inputTokens" },
            outputTokens: { $sum: "$outputTokens" },
          },
        },
      ]),
      AiUsageEvent.aggregate<{ _id: string; costUsd: number; calls: number }>([
        { $match: { createdAt: { $gte: lastMonthStart } } },
        {
          $group: {
            _id: {
              $cond: [{ $gte: ["$createdAt", thisMonthStart] }, "this", "last"],
            },
            costUsd: { $sum: "$costUsd" },
            calls: { $sum: 1 },
          },
        },
      ]),
      AiUsageEvent.aggregate<{ _id: string; costUsd: number; calls: number }>([
        { $group: { _id: "$feature", costUsd: { $sum: "$costUsd" }, calls: { $sum: 1 } } },
        { $sort: { costUsd: -1 } },
      ]),
      AiUsageEvent.aggregate<{ _id: string; costUsd: number; calls: number }>([
        { $match: { createdAt: { $gte: trendStart } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            costUsd: { $sum: "$costUsd" },
            calls: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      AiUsageEvent.findOne().sort({ createdAt: 1 }).select("createdAt").lean(),
    ]);

  const totals = totalsAgg[0];
  const thisMonth = windowAgg.find((w) => w._id === "this");
  const lastMonth = windowAgg.find((w) => w._id === "last");

  // Fill the 12-month window so the chart never has gaps.
  const byMonth = new Map(trendAgg.map((t) => [t._id, t]));
  const monthlyTrend: AiCostAnalytics["monthlyTrend"] = [];
  for (let i = -11; i <= 0; i++) {
    const d = startOfUtcMonth(i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const row = byMonth.get(key);
    monthlyTrend.push({
      month: key,
      costUsd: row?.costUsd ?? 0,
      calls: row?.calls ?? 0,
    });
  }

  return {
    costThisMonth: thisMonth?.costUsd ?? 0,
    costLastMonth: lastMonth?.costUsd ?? 0,
    costAllTime: totals?.costUsd ?? 0,
    callsThisMonth: thisMonth?.calls ?? 0,
    callsAllTime: totals?.calls ?? 0,
    tokensAllTime: {
      input: totals?.inputTokens ?? 0,
      output: totals?.outputTokens ?? 0,
    },
    byFeature: byFeatureAgg.map((f) => ({
      feature: f._id,
      calls: f.calls,
      costUsd: f.costUsd,
    })),
    monthlyTrend,
    trackingSince: earliest?.createdAt ?? null,
  };
}

export interface AiUsageStats {
  totalCalls: number;
  generateCalls: number;
  substitutionsCalls: number;
  formatCalls: number;
  activeAiUsers30d: number;
  topUsers: { name: string; email: string; calls: number }[];
}

/**
 * Usage stats for the admin analytics page, from the lifetime per-user
 * counters on the User model (these predate the cost ledger, so they cover
 * all history; "import" calls count under generate, matching the quota).
 */
export async function getAiUsageStats(): Promise<AiUsageStats> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [countersAgg, activeAiUsers30d, topUsersRaw] = await Promise.all([
    User.aggregate<{
      _id: null;
      total: number;
      generate: number;
      substitutions: number;
      format: number;
    }>([
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$aiTotalMessagesSent", 0] } },
          generate: { $sum: { $ifNull: ["$aiGenerateCount", 0] } },
          substitutions: { $sum: { $ifNull: ["$aiSubstitutionsCount", 0] } },
          format: { $sum: { $ifNull: ["$aiFormatCount", 0] } },
        },
      },
    ]),
    User.countDocuments({ aiLastUsedAt: { $gte: thirtyDaysAgo } }),
    User.find({ aiTotalMessagesSent: { $gt: 0 } })
      .sort({ aiTotalMessagesSent: -1 })
      .limit(5)
      .select("fullName email aiTotalMessagesSent")
      .lean(),
  ]);

  const counters = countersAgg[0];
  return {
    totalCalls: counters?.total ?? 0,
    generateCalls: counters?.generate ?? 0,
    substitutionsCalls: counters?.substitutions ?? 0,
    formatCalls: counters?.format ?? 0,
    activeAiUsers30d,
    topUsers: topUsersRaw.map((u) => ({
      name: u.fullName ?? "Unknown",
      email: u.email ?? "",
      calls: u.aiTotalMessagesSent ?? 0,
    })),
  };
}
