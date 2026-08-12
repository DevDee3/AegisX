import type { AiRiskOutput, RiskAssessment } from "../agent/schema.js";
import type { RegistryStatus } from "../blockchain/abis.js";
import type { Finding } from "../analyzer/types.js";

/// This module mirrors contracts/src/RiskPolicy.sol's thresholds and penalty
/// weights on purpose, so a "SAFE — risk 18/100" the backend shows a user
/// before they sign is the same number the on-chain policy would compute
/// during proposeTransaction — no separate, drifting scoring model. If the
/// Solidity thresholds ever change, update the constants below to match.
///
/// IMPORTANT: this engine is explanatory / pre-flight only. The chain does
/// not trust this output — GuardianVault always re-evaluates via the deployed
/// RiskPolicy contract at propose time. Nothing here can execute anything.

const LOW_MAX = 30;
const MEDIUM_MAX = 60;
const HIGH_MAX = 80;

const UNKNOWN_CONTRACT_PENALTY = 15;
const UNLIMITED_APPROVAL_PENALTY = 40;
const SUSPICIOUS_CONTRACT_PENALTY = 25;
const TRUSTED_PROTOCOL_DISCOUNT = 20;

export interface CombineInput {
  aiAssessment: AiRiskOutput | null;
  registryStatus: RegistryStatus;
  isUnlimitedApproval: boolean;
  isExpired: boolean;
  extraFindings: Finding[];
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function combine(input: CombineInput): RiskAssessment {
  // No AI input at all -> treat as maximally uncertain, not maximally safe.
  // An absent AI opinion is not evidence of safety; default to the middle of
  // the range so deterministic penalties alone decide the outcome.
  let score = input.aiAssessment ? clamp(input.aiAssessment.riskScore) : 50;

  let hardRuleTriggered = false;
  let reason = "Transaction within policy";
  const findings: Finding[] = [...(input.aiAssessment?.findings ?? []), ...input.extraFindings];

  if (input.registryStatus === "BLOCKED") {
    hardRuleTriggered = true;
    reason = "Target contract is blocklisted";
    score = 100;
  } else if (input.isExpired) {
    hardRuleTriggered = true;
    reason = "Transaction request has expired";
    score = 100;
  } else {
    if (input.registryStatus === "UNKNOWN") {
      score = clamp(score + UNKNOWN_CONTRACT_PENALTY);
      reason = "Target contract is not in the trusted registry";
    } else if (input.registryStatus === "SUSPICIOUS") {
      score = clamp(score + SUSPICIOUS_CONTRACT_PENALTY);
      reason = "Target contract has been flagged as suspicious";
    } else if (input.registryStatus === "TRUSTED") {
      score = clamp(score - TRUSTED_PROTOCOL_DISCOUNT);
    }

    if (input.isUnlimitedApproval) {
      score = clamp(score + UNLIMITED_APPROVAL_PENALTY);
      reason = "Transaction grants unlimited token approval";
      hardRuleTriggered = true; // matches RiskPolicy.sol: always forces BLOCK
    }
  }

  const riskLevel = levelFor(score);
  const decision = decisionFor(riskLevel, hardRuleTriggered);

  return {
    aiAssessment: input.aiAssessment,
    finalScore: score,
    riskLevel,
    decision,
    hardRuleTriggered,
    findings,
    reason,
  };
}

function levelFor(score: number): RiskAssessment["riskLevel"] {
  if (score <= LOW_MAX) return "LOW";
  if (score <= MEDIUM_MAX) return "MEDIUM";
  if (score <= HIGH_MAX) return "HIGH";
  return "CRITICAL";
}

function decisionFor(level: RiskAssessment["riskLevel"], hardRuleTriggered: boolean): RiskAssessment["decision"] {
  if (hardRuleTriggered || level === "CRITICAL") return "BLOCK";
  if (level === "HIGH") return "DELAY";
  if (level === "MEDIUM") return "REQUIRE_APPROVAL";
  return "ALLOW";
}
