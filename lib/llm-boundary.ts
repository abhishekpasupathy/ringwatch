/**
 * RingWatch — LLM Boundary (Stage 4)
 *
 * ════════════════════════════════════════════════════════════════════
 * DESIGN CHOICE — WHY WE USE AI HERE, AND WHERE WE CHOSE NOT TO:
 *
 * The fraud-ring DETECTION decision (flagging, scoring, threshold comparison)
 * is made 100% deterministically in lib/detector.ts using graph-metric
 * scoring. No LLM is involved in that decision.
 *
 * This module contains the ONLY LLM call in the entire system. It is used
 * exclusively to produce a plain-English explanation of a decision that has
 * ALREADY been made deterministically. The LLM:
 *   ✓ Summarizes WHY a community looks suspicious (structural evidence)
 *   ✗ Does NOT make fraud determinations
 *   ✗ Does NOT override or influence the suspicion score
 *   ✗ Does NOT receive raw threshold values
 *   ✗ Does NOT receive raw account IDs or transaction amounts
 *
 * This separation is intentional, auditable, and architecturally enforced
 * by the runtime assertion in this module (see validateInput()).
 * ════════════════════════════════════════════════════════════════════
 */

import Groq from "groq-sdk";

export interface StructuralEvidence {
  clusterSize: number;
  internalEdgeDensity: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  timeBurstPresent: boolean;
  paymentFormatCount: number;
  suspicionTier: "MEDIUM" | "HIGH";
}

const FORBIDDEN_FIELDS = [
  "threshold",
  "suspicionScore",
  "score",
  "cutoff",
  "accountId",
  "accountIds",
  "rawAmount",
  "transactionIds",
] as const;

function validateInput(evidence: Record<string, unknown>): void {
  for (const forbidden of FORBIDDEN_FIELDS) {
    if (forbidden in evidence) {
      throw new Error(
        `LLM boundary violation: evidence object contains forbidden field "${forbidden}". ` +
          `The LLM explanation layer must not receive raw thresholds or account identifiers.`
      );
    }
  }
}

export function toDensityLabel(
  internalEdgeRatio: number
): StructuralEvidence["internalEdgeDensity"] {
  if (internalEdgeRatio < 0.2) return "LOW";
  if (internalEdgeRatio < 0.4) return "MEDIUM";
  if (internalEdgeRatio < 0.7) return "HIGH";
  return "VERY_HIGH";
}

export function toSuspicionTier(
  suspicionScore: number,
  threshold: number
): StructuralEvidence["suspicionTier"] {
  const margin = suspicionScore - threshold;
  return margin > 0.15 ? "HIGH" : "MEDIUM";
}

const SYSTEM_PROMPT = `You are a fraud-pattern analyst assistant for RingWatch, a financial transaction monitoring system.

You will receive structural evidence about a flagged transaction cluster. Your job is to write 2-3 plain-English sentences explaining WHY this cluster appears suspicious based on the structural evidence provided.

STRICT RULES:
1. Only explain what the structural evidence shows — do not speculate beyond it.
2. Do NOT mention specific account names, transaction amounts, or numeric thresholds.
3. Do NOT state whether the accounts are definitely committing fraud — only that the PATTERN is suspicious.
4. Do NOT suggest how to evade detection (this is a defense-only system).
5. Use language a non-technical merchant or risk officer would understand.
6. Output ONLY the 2-3 sentence explanation. No headers, no bullet points.`;

// Supported Groq models with fallback sequence
const CANDIDATE_MODELS = [
  "groq/compound-mini",
  "groq/compound",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
];

export async function explainCluster(evidence: StructuralEvidence): Promise<string> {
  validateInput(evidence as unknown as Record<string, unknown>);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.error("[Groq Boundary Error] GROQ_API_KEY environment variable is missing or empty.");
    return "This cluster exhibits tight internal connectivity and synchronized transaction bursts consistent with coordinated ring behavior. Settlement holds are recommended for interacting accounts.";
  }

  const client = new Groq({ apiKey });

  const userMessage = `Flagged cluster structural evidence:
- Cluster size: ${evidence.clusterSize} accounts
- Internal connection density: ${evidence.internalEdgeDensity}
- Synchronized transaction bursts detected: ${evidence.timeBurstPresent ? "Yes" : "No"}
- Number of distinct payment formats used: ${evidence.paymentFormatCount}
- Alert severity: ${evidence.suspicionTier}

Explain why this cluster pattern is suspicious in 2-3 plain-English sentences.`;

  let explanation = "";
  let lastError: unknown = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 200,
        temperature: 0.3,
      });

      explanation = completion.choices[0]?.message?.content?.trim() ?? "";
      if (explanation) {
        console.log(`[Groq Boundary Success] Successfully generated explanation using model: ${model}`);
        break;
      }
    } catch (err: unknown) {
      lastError = err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Groq Boundary Model Fallback] Model '${model}' failed: ${errorMsg}. Trying next model...`
      );
    }
  }

  if (!explanation) {
    console.error("[Groq Boundary Error] All Groq model attempts failed:", lastError);
    return "This cluster exhibits a dense network structure with synchronized transaction bursts across multiple payment formats. The pattern indicates coordinated account activity requiring manual risk review.";
  }

  // Safety filter for threshold values
  if (/\b0\.\d{2,}\b/.test(explanation)) {
    return "This cluster shows an unusual pattern of connections and transaction timing consistent with coordinated ring behavior. Accounts involved have high internal connectivity and synchronized activity.";
  }

  return explanation;
}
