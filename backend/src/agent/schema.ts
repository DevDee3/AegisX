import { z } from "zod";

/// This is the single most important file in Phase 3. Per the project's core
/// architectural rule — "AI = analysis/reasoning, contracts = enforcement" —
/// the AI is never allowed to trigger anything just by producing text that
/// looks right. Its output MUST parse against this schema, or it is treated
/// as a failed analysis (safe default: escalate to manual review), never as
/// an executable instruction. Nothing downstream reads raw AI text.

export const FindingSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const FindingCategorySchema = z.enum([
  "UNLIMITED_APPROVAL",
  "UNKNOWN_CONTRACT",
  "BLOCKED_CONTRACT",
  "SUSPICIOUS_CONTRACT",
  "UPGRADEABLE_CONTRACT",
  "PRIVILEGED_OWNER_FUNCTIONS",
  "UNVERIFIED_SOURCE",
  "LARGE_TRANSFER",
  "EXCESSIVE_WALLET_EXPOSURE",
  "SIMULATION_REVERT",
  "UNEXPECTED_ASSET_MOVEMENT",
  "OTHER",
]);

export const FindingSchema = z.object({
  severity: FindingSeveritySchema,
  category: FindingCategorySchema,
  description: z.string().min(1).max(500),
});

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const DecisionSchema = z.enum(["ALLOW", "REQUIRE_APPROVAL", "DELAY", "BLOCK"]);

/// What the AI is asked to produce. Note there is deliberately no field here
/// that could be interpreted as an authorization or an instruction to act —
/// only an assessment. `riskScore` in particular is documented everywhere
/// downstream as ONE INPUT to RiskEngine.combine(), never the decision itself.
export const AiRiskOutputSchema = z.object({
  riskScore: z.number().int().min(0).max(100),
  riskLevel: RiskLevelSchema,
  findings: z.array(FindingSchema).max(20),
  summary: z.string().min(1).max(1000),
});
export type AiRiskOutput = z.infer<typeof AiRiskOutputSchema>;

/// Final, deterministic-engine-produced assessment — this is what the API
/// actually returns and what a future Phase 5 pipeline would hand to the
/// vault. The AI's contribution (`aiAssessment`) is included for
/// transparency/explainability but every field that matters for a decision
/// (`finalScore`, `decision`) is computed by risk/riskEngine.ts, not by
/// parsing the AI's own claimed decision.
export const RiskAssessmentSchema = z.object({
  aiAssessment: AiRiskOutputSchema.nullable(), // null if AI unavailable/failed — deterministic-only path
  finalScore: z.number().int().min(0).max(100),
  riskLevel: RiskLevelSchema,
  decision: DecisionSchema,
  hardRuleTriggered: z.boolean(),
  findings: z.array(FindingSchema),
  reason: z.string(),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

/// Safely parses model output that is expected to be a JSON object matching
/// AiRiskOutputSchema. Any parse/validation failure returns `null` rather
/// than throwing — callers must treat a null AI assessment as "AI analysis
/// unavailable," falling back to deterministic-only scoring, never as
/// permission to skip risk evaluation entirely.
export function parseAiRiskOutput(raw: string): AiRiskOutput | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = AiRiskOutputSchema.safeParse(json);
  return result.success ? result.data : null;
}
