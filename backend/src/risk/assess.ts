import type { Address, Hex } from "viem";
import { analyzeTransaction, type TransactionRequestInput } from "../analyzer/transactionAnalyzer.js";
import { runGuardianAgent } from "../agent/agent.js";
import { combine } from "./riskEngine.js";
import type { RiskAssessment } from "../agent/schema.js";

/// This is the Phase 3 "structured AI output feeding a deterministic risk
/// assessment" pipeline described in the project spec, minus the final step
/// (nothing here calls GuardianVault — that's Phase 5, agent integration).
/// The pipeline is: deterministic evidence gathering -> AI reasoning over
/// that evidence -> deterministic combination into a final score/decision.
/// The AI never sees a path that skips straight to a decision; `combine()`
/// always re-derives riskLevel/decision itself rather than trusting
/// aiOutput.riskLevel or any decision-shaped field from the model.
export async function assessTransaction(
  input: TransactionRequestInput,
  options?: { watchedTokens?: Address[] }
): Promise<{
  assessment: RiskAssessment;
  toolCallCount: number;
  transactionAnalysis: Awaited<ReturnType<typeof analyzeTransaction>>;
}> {
  const analysis = await analyzeTransaction(input, options);

  const prompt = buildPrompt(input, analysis);
  const agentResult = await runGuardianAgent(prompt);

  const assessment = combine({
    aiAssessment: agentResult.aiOutput,
    registryStatus: analysis.target.registryStatus,
    isUnlimitedApproval: analysis.isUnlimitedApproval,
    isExpired: false, // deadline lives in the on-chain request, not modeled pre-flight here
    extraFindings: analysis.findings,
  });

  return { assessment, toolCallCount: agentResult.toolCallCount, transactionAnalysis: analysis };
}

function buildPrompt(input: TransactionRequestInput, analysis: Awaited<ReturnType<typeof analyzeTransaction>>): string {
  return [
    "A user's Guardian-protected vault wants to submit this transaction:",
    `  from (vault): ${input.from}`,
    `  target: ${input.target}`,
    `  value (wei): ${input.value.toString()}`,
    `  data: ${input.data}`,
    "",
    "Evidence already gathered by deterministic tooling (you may still call",
    "your own tools to dig further, e.g. re-check the target or inspect the",
    "wallet's other approvals):",
    JSON.stringify(
      {
        decodedFunction: analysis.decodedCalldata.recognized ? analysis.decodedCalldata.functionName : "unrecognized",
        decodedArgs: analysis.decodedCalldata.args,
        targetRegistryStatus: analysis.target.registryStatus,
        targetHasCode: analysis.target.hasCode,
        targetUpgradeable: analysis.target.upgradeability.isProxy,
        isUnlimitedApproval: analysis.isUnlimitedApproval,
        simulationReverted: analysis.simulation.reverted,
        balanceDiffAvailable: Boolean(analysis.balanceDiff),
        balanceDiffSummary: analysis.balanceDiff
          ? {
              success: analysis.balanceDiff.success,
              tokenDeltas: analysis.balanceDiff.tokens.map((t) => ({
                token: t.token,
                account: t.account,
                delta: t.delta.toString(),
              })),
            }
          : undefined,
      },
      null,
      2
    ),
    "",
    "Assess the risk and respond with the required JSON object only.",
  ].join("\n");
}

export { analyzeTransaction };
export type { Address, Hex };
