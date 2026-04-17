import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o":       { inputPer1M: 2.50,  outputPer1M: 10.00 },
  "gpt-4o-mini":  { inputPer1M: 0.15,  outputPer1M: 0.60  },
  "gpt-4.1":      { inputPer1M: 2.00,  outputPer1M: 8.00  },
  "gpt-4.1-mini": { inputPer1M: 0.40,  outputPer1M: 1.60  },
  "gpt-5.2":      { inputPer1M: 7.50,  outputPer1M: 30.00 },
  "o4-mini":      { inputPer1M: 1.10,  outputPer1M: 4.40  },
  "o3":           { inputPer1M: 10.00, outputPer1M: 40.00 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = MODEL_COSTS[model] ?? MODEL_COSTS["gpt-4o"];
  return (promptTokens / 1_000_000) * costs.inputPer1M + (completionTokens / 1_000_000) * costs.outputPer1M;
}

export async function logApiCost(opts: {
  userId: number | null | undefined;
  endpoint: string;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined;
}): Promise<void> {
  if (!opts.usage) return;
  const promptTokens = opts.usage.prompt_tokens ?? 0;
  const completionTokens = opts.usage.completion_tokens ?? 0;
  const totalTokens = opts.usage.total_tokens ?? promptTokens + completionTokens;
  const estimatedCostUsd = estimateCost(opts.model, promptTokens, completionTokens);
  try {
    await db.execute(sql`
      INSERT INTO api_costs (user_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd)
      VALUES (${opts.userId ?? null}, ${opts.endpoint}, ${opts.model}, ${promptTokens}, ${completionTokens}, ${totalTokens}, ${estimatedCostUsd})
    `);
  } catch {
    // non-fatal — never block the response for analytics
  }
}

export async function logPhilInteraction(opts: {
  userId: number;
  interactionType: "programme_build" | "session_adjustment" | "review" | "conversational";
}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO phil_interactions (user_id, interaction_type)
      VALUES (${opts.userId}, ${opts.interactionType})
    `);
  } catch {
    // non-fatal
  }
}

export function detectPhilInteractionType(message: string): "programme_build" | "session_adjustment" | "review" | "conversational" {
  const m = message.toLowerCase();
  if (/programme|program|build.*plan|create.*plan|new.*plan|generate|training plan/.test(m)) return "programme_build";
  if (/adjust|change.*session|swap|reschedule|move.*session|edit.*session|modify.*session|replace.*session/.test(m)) return "session_adjustment";
  if (/how.*doing|progress|review|feedback|rate|assess|check in|summary|last week|this week/.test(m)) return "review";
  return "conversational";
}
