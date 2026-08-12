import type { Address, Hex } from "viem";
import { getPublicClient } from "../blockchain/client.js";
import { decodeApprovalCalldata } from "../blockchain/decode.js";
import { decodeCalldata, type DecodedCalldata } from "../blockchain/calldataDecoder.js";
import { simulateBalanceDiff, type BalanceDiffResult, type TokenProbe } from "../blockchain/balanceDiffSimulator.js";
import { analyzeContract, type ContractAnalysis } from "./contractAnalyzer.js";
import type { Finding } from "./types.js";

export interface TransactionRequestInput {
  from: Address; // the Guardian vault address this transaction would be proposed from
  target: Address;
  value: bigint;
  data: Hex;
}

export interface QuickSimulationResult {
  reverted: boolean;
  revertReason?: string;
  gasEstimate?: bigint;
}

export interface TransactionAnalysis {
  target: ContractAnalysis;
  decodedCalldata: DecodedCalldata;
  isUnlimitedApproval: boolean;
  approvalSpender?: Address;
  simulation: QuickSimulationResult;
  balanceDiff?: BalanceDiffResult; // present only when watchedTokens were supplied and the RPC supports it
  balanceDiffUnavailableReason?: string;
  findings: Finding[];
}

/// Fast fail-fast check via eth_estimateGas from an EOA-equivalent perspective.
/// This is intentionally NOT a local anvil fork — spinning up a full local EVM
/// node per analysis request is exactly the kind of per-request memory spike
/// that would blow a free-tier host's RAM budget. This complements (does not
/// replace) the deeper balanceDiff simulation below.
async function quickSimulate(input: TransactionRequestInput): Promise<QuickSimulationResult> {
  const client = getPublicClient();
  try {
    const gasEstimate = await client.estimateGas({
      account: input.from,
      to: input.target,
      value: input.value,
      data: input.data,
    });
    return { reverted: false, gasEstimate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reverted: true, revertReason: message.slice(0, 300) };
  }
}

export async function analyzeTransaction(
  input: TransactionRequestInput,
  options?: { watchedTokens?: Address[] }
): Promise<TransactionAnalysis> {
  const findings: Finding[] = [];

  const [targetAnalysis, simulation] = await Promise.all([analyzeContract(input.target), quickSimulate(input)]);
  findings.push(...targetAnalysis.findings);

  const decodedCalldata = decodeCalldata(input.data);

  const approval = decodeApprovalCalldata(input.data);
  if (approval.isUnlimited) {
    findings.push({
      severity: "CRITICAL",
      category: "UNLIMITED_APPROVAL",
      description: `Transaction grants an unlimited token approval to ${approval.spender}.`,
    });
  }

  if (simulation.reverted) {
    findings.push({
      severity: "HIGH",
      category: "SIMULATION_REVERT",
      description: `Simulation indicates this transaction would revert: ${simulation.revertReason ?? "unknown reason"}`,
    });
  }

  let balanceDiff: BalanceDiffResult | undefined;
  let balanceDiffUnavailableReason: string | undefined;

  const watchedTokens = options?.watchedTokens ?? [];
  if (!simulation.reverted && watchedTokens.length > 0) {
    const tokenProbes: TokenProbe[] = watchedTokens.flatMap((token) => [
      { token, account: input.from },
      { token, account: input.target },
    ]);

    try {
      balanceDiff = await simulateBalanceDiff({
        vaultAddress: input.from,
        target: input.target,
        value: input.value,
        data: input.data,
        nativeProbes: [input.from],
        tokenProbes,
      });

      findings.push(...findingsFromBalanceDiff(decodedCalldata, balanceDiff, input.from));
    } catch (err) {
      // Not every RPC endpoint supports eth_call state overrides. Treat this
      // as "deep simulation unavailable," not as an analysis failure — the
      // calldata-level checks above still stand on their own.
      balanceDiffUnavailableReason = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    target: targetAnalysis,
    decodedCalldata,
    isUnlimitedApproval: approval.isUnlimited,
    approvalSpender: approval.spender,
    simulation,
    balanceDiff,
    balanceDiffUnavailableReason,
    findings,
  };
}

/// Compares what the decoded calldata claims to do against what the balance
/// diff actually shows, and flags the gap. This is exactly the check that
/// would catch contracts/test/mocks/MaliciousRouter.sol on the contracts
/// side: it exposes a swap()-shaped function but never sends back the output
/// token — a calldata-only read can't see that; a balance diff can.
function findingsFromBalanceDiff(
  decoded: DecodedCalldata,
  diff: BalanceDiffResult,
  vaultAddress: Address
): Finding[] {
  const findings: Finding[] = [];

  if (decoded.functionName === "swap" && decoded.args) {
    const tokenOut = String(decoded.args.tokenOut).toLowerCase();
    const outLeg = diff.tokens.find(
      (t) => t.account.toLowerCase() === vaultAddress.toLowerCase() && t.token.toLowerCase() === tokenOut
    );
    if (diff.success && outLeg && outLeg.delta <= 0n) {
      findings.push({
        severity: "CRITICAL",
        category: "UNEXPECTED_ASSET_MOVEMENT",
        description:
          "Calldata claims a swap() into the requested output token, but simulation shows the vault's balance of that token did not increase. Funds may be redirected instead of swapped.",
      });
    }
  }

  return findings;
}
