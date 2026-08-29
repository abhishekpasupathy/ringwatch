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
 *
 * The right tool for the right job:
 *   - Fraud detection: deterministic graph algorithms (auditable, explainable)
 *   - Human explanation: LLM (fluent, context-aware natural language)
 * ════════════════════════════════════════════════════════════════════
 */

import Groq from "groq-sdk";

// Structural evidence that CAN be passed to the LLM
// (derived from graph metrics — no raw data, no thresholds)
export interface StructuralEvidence {
  clusterSize: number;
  internalEdgeDensity: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  timeBurstPresent: boolean;
  paymentFormatCount: number;
  suspicionTier: "MEDIUM" | "HIGH";
  // Deliberately omitted: suspicionScore (numeric), threshold, account IDs
}

// Fields that MUST NOT be present in the evidence object
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

/**
 * Runtime assertion: verifies the evidence object does not contain
 * raw threshold values or account identifiers before sending to Groq.
 * This is the architectural enforcement of the LLM boundary.
 */
function validateInput(evidence: Record<string, unknown>): void {
  for (const forbidden of FORBIDDEN_FIELDS) {
    if (forbidden in evidence) {
      throw new Error(
        `LLM boundary violation: evidence object contains forbidden field "${forbidden}". ` +
          `The LLM explanation layer must not receive raw thresholds or account identifiers. ` +
          `See lib/llm-boundary.ts for the design rationale.`
      );
    }
  }
}

/**
 * Maps numeric internal edge ratio to a human-readable density label.
 * The actual numeric value is NOT passed to the LLM.
 */
export function toDensityLabel(
  internalEdgeRatio: number
): StructuralEvidence["internalEdgeDensity"] {
  if (internalEdgeRatio < 0.2) return "LOW";
  if (internalEdgeRatio < 0.4) return "MEDIUM";
  if (internalEdgeRatio < 0.7) return "HIGH";
  return "VERY_HIGH";
}

/**
 * Maps suspicion score to a tier label.
 * The actual numeric score is NOT passed to the LLM.
 */
export function toSuspicionTier(
  suspicionScore: number,
  threshold: number
): StructuralEvidence["suspicionTier"] {
  // Only reach this function if score >= threshold (already flagged)
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

/**
 * Calls Groq to generate a plain-English explanation for a flagged cluster.
 * The detection decision has already been made by detector.ts before this is called.
 *
 * @param evidence Structural evidence (no raw thresholds or account IDs)
 * @returns Plain-English explanation string
 */
export async function explainCluster(evidence: StructuralEvidence): Promise<string> {
  // Enforce the LLM boundary at runtime
  validateInput(evidence as unknown as Record<string, unknown>);

  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const userMessage = `Flagged cluster structural evidence:
- Cluster size: ${evidence.clusterSize} accounts
- Internal connection density: ${evidence.internalEdgeDensity}
- Synchronized transaction bursts detected: ${evidence.timeBurstPresent ? "Yes" : "No"}
- Number of distinct payment formats used: ${evidence.paymentFormatCount}
- Alert severity: ${evidence.suspicionTier}

Explain why this cluster pattern is suspicious in 2-3 plain-English sentences.`;

  const completion = await client.chat.completions.create({
    model: "llama3-8b-8192",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 200,
    temperature: 0.3, // low temperature for consistent, factual explanations
  });

  const explanation = completion.choices[0]?.message?.content?.trim() ?? "";

  // Final safety check: ensure no numeric thresholds leaked into the response
  // (belt-and-suspenders — the system prompt already prohibits this)
  if (/\b0\.\d{2,}\b/.test(explanation)) {
    return "This cluster shows an unusual pattern of connections and transaction timing that is consistent with coordinated ring behavior. The accounts involved have a high degree of internal connectivity and synchronized activity. A manual review is recommended.";
  }

  return explanation;
}
