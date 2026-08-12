import type { Address, Hex } from "viem";
import { assessTransaction } from "./assess.js";
import { proposeOnChain, type ProposeResult } from "../chain/proposeOnChain.js";
import { isOnChainProposeEnabled } from "../blockchain/walletClient.js";
import type { RiskAssessment } from "../agent/schema.js";
import type { TransactionAnalysis } from "../analyzer/transactionAnalyzer.js";

export interface PipelineInput {
  target: Address;
  value: bigint;
  data: Hex;
  watchedTokens?: Address[];
}

export interface PipelineResult {
  assessment: RiskAssessment;
  transactionAnalysis: TransactionAnalysis;
  toolCallCount: number;
  onChain?: ProposeResult;
  onChainSkippedReason?: string;
}

/// The full Phase 3-5 pipeline: gather evidence -> AI reasoning -> deterministic
/// combine() -> (gated) propose on-chain. This is the one function that ties
/// every phase together end to end, per the "wire each phase to the next,
/// don't just move on" instruction from earlier in this project.
///
/// Two independent gates stand between "the AI thought this was fine" and
/// "a transaction got proposed on-chain":
///   1. isOnChainProposeEnabled() — an operator-level switch (env config).
///   2. assessment.decision !== "BLOCK" — checked HERE, before we ever build
///      a chain transaction, even though GuardianVault would itself reject a
///      hard-rule violation. There's no reason to spend gas on a call we
///      already know the contract will revert, and it keeps this function's
///      logic legible: a BLOCK decision genuinely never reaches proposeOnChain.
/// Neither gate can be bypassed by anything the AI outputs — `injectedPropose`
/// exists purely for testing (dependency injection), not as a production
/// escape hatch; production callers should never pass it.
export async function assessAndPropose(
  input: PipelineInput,
  vaultAddress: Address,
  injectedPropose: typeof proposeOnChain = proposeOnChain
): Promise<PipelineResult> {
  const { assessment, toolCallCount, transactionAnalysis } = await assessTransaction(
    { from: vaultAddress, target: input.target, value: input.value, data: input.data },
    { watchedTokens: input.watchedTokens }
  );

  if (assessment.decision === "BLOCK") {
    return {
      assessment,
      transactionAnalysis,
      toolCallCount,
      onChainSkippedReason: `Assessment decision is BLOCK (${assessment.reason}) — not attempting on-chain proposal.`,
    };
  }

  if (!isOnChainProposeEnabled()) {
    return {
      assessment,
      transactionAnalysis,
      toolCallCount,
      onChainSkippedReason: "On-chain proposing is disabled (ENABLE_ONCHAIN_PROPOSE is not true).",
    };
  }

  const aiScore = assessment.aiAssessment?.riskScore ?? assessment.finalScore;

  const onChain = await injectedPropose({
    target: input.target,
    value: input.value,
    data: input.data,
    aiScore,
  });

  return { assessment, transactionAnalysis, toolCallCount, onChain };
}
