import { type Address, type Hex, parseEventLogs } from "viem";
import { getPublicClient } from "../blockchain/client.js";
import { getAgentAccount, getAgentWalletClient, isOnChainProposeEnabled } from "../blockchain/walletClient.js";
import { guardianVaultAbi, PROPOSAL_STATE, type ProposalState } from "../blockchain/vaultAbi.js";
import { env } from "../config/env.js";

export interface ProposeInput {
  target: Address;
  value: bigint;
  data: Hex;
  /// How long the proposal should remain valid for, in seconds from now.
  /// Kept short by default (see DEFAULT_DEADLINE_SECONDS) — an agent-proposed
  /// transaction sitting valid for days is more attack surface, not less.
  deadlineSeconds?: number;
  aiScore: number;
}

export interface ProposeResult {
  requestHash: Hex;
  txHash: Hex;
  blockedOnChain: boolean;
  blockedReason?: string;
  proposalState: ProposalState;
}

const DEFAULT_DEADLINE_SECONDS = 30 * 60; // 30 minutes

/// Sends `proposeTransaction` to GuardianVault, signed by the bounded agent
/// key. This is the ONLY function in the entire backend that broadcasts a
/// transaction. It is also the only function that can even theoretically
/// fail in a way that costs gas — every caller of this function (see
/// risk/pipeline.ts) is expected to have already checked
/// `isOnChainProposeEnabled()` and the deterministic BLOCK decision before
/// getting here.
///
/// Note this call can still fail/revert even when our own off-chain
/// assessment said ALLOW — the deployed RiskPolicy re-evaluates independently
/// against current on-chain state (registry status, spending limits, nonce)
/// at the moment this transaction lands, which can differ from what we saw
/// moments earlier. That's not a bug to route around; it's the whole point
/// of "the chain is the actual authority, not the backend's opinion."
export async function proposeOnChain(input: ProposeInput): Promise<ProposeResult> {
  if (!isOnChainProposeEnabled()) {
    throw new Error("On-chain proposing is disabled (ENABLE_ONCHAIN_PROPOSE is not true).");
  }
  if (!env.GUARDIAN_VAULT_ADDRESS) {
    throw new Error("GUARDIAN_VAULT_ADDRESS is not configured.");
  }

  const vaultAddress = env.GUARDIAN_VAULT_ADDRESS as Address;
  const publicClient = getPublicClient();
  const walletClient = getAgentWalletClient();
  const account = getAgentAccount();

  const nonce = await publicClient.readContract({
    address: vaultAddress,
    abi: guardianVaultAbi,
    functionName: "currentNonce",
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + (input.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS));

  const request = {
    vault: vaultAddress,
    target: input.target,
    value: input.value,
    data: input.data,
    nonce,
    deadline,
  };

  // Simulate first via the public client: this both validates against
  // current chain state before we spend gas, and gives us a clean revert
  // reason if the deterministic policy would block it (e.g. a hard rule the
  // off-chain analysis didn't independently know about, like an on-chain
  // spending limit change since our last read).
  let simulation;
  try {
    simulation = await publicClient.simulateContract({
      address: vaultAddress,
      abi: guardianVaultAbi,
      functionName: "proposeTransaction",
      args: [request, BigInt(Math.max(0, Math.min(100, Math.round(input.aiScore))))],
      account,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`On-chain proposal simulation failed (would revert): ${message.slice(0, 400)}`);
  }

  const txHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  const proposedLogs = parseEventLogs({
    abi: guardianVaultAbi,
    eventName: "TransactionProposed",
    logs: receipt.logs,
  });
  const blockedLogs = parseEventLogs({
    abi: guardianVaultAbi,
    eventName: "TransactionBlocked",
    logs: receipt.logs,
  });

  if (blockedLogs.length > 0) {
    const blocked = blockedLogs[0].args;
    return {
      requestHash: blocked.requestHash,
      txHash,
      blockedOnChain: true,
      blockedReason: blocked.reason,
      proposalState: "CANCELLED", // matches GuardianVault.sol's terminal state for a blocked proposal
    };
  }

  if (proposedLogs.length === 0) {
    throw new Error("Transaction succeeded but emitted neither TransactionProposed nor TransactionBlocked.");
  }

  const requestHash = proposedLogs[0].args.requestHash;
  const stateIndex = await publicClient.readContract({
    address: vaultAddress,
    abi: guardianVaultAbi,
    functionName: "getProposalState",
    args: [requestHash],
  });

  return {
    requestHash,
    txHash,
    blockedOnChain: false,
    proposalState: PROPOSAL_STATE[stateIndex] ?? "NONE",
  };
}
