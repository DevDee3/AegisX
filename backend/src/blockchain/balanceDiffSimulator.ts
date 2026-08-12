import type { Address, Hex } from "viem";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import { getPublicClient } from "./client.js";
import { simulatorAbi, simulatorDeployedBytecode } from "./simulatorArtifact.js";

export interface TokenProbe {
  token: Address;
  account: Address;
}

export interface BalanceDiffResult {
  success: boolean;
  returnData: Hex;
  native: { account: Address; before: bigint; after: bigint; delta: bigint }[];
  tokens: { token: Address; account: Address; before: bigint; after: bigint; delta: bigint }[];
}

/// Simulates `target.call{value}(data)` as if it were sent BY `vaultAddress`,
/// and reports the resulting native + token balance deltas for the given
/// probes — all from a single, stateless `eth_call`. No local fork, no
/// persisted state, nothing left running afterward.
///
/// How: the call's `stateOverride` temporarily replaces the bytecode AT
/// `vaultAddress` with TransactionSimulator's runtime bytecode, for the
/// duration of this one RPC call only (the real, on-chain vault contract is
/// completely untouched). We then call `simulate(...)` with `to:
/// vaultAddress` — so the injected code runs at that address, meaning any
/// sub-call it makes to `target` shows `msg.sender == vaultAddress`, exactly
/// matching a real `GuardianVault.executeTransaction`. See
/// contracts/src/simulation/TransactionSimulator.sol for the full rationale
/// and contracts/test/unit/TransactionSimulator.t.sol for proof this
/// msg.sender-preservation property holds.
///
/// Requires an RPC provider that supports `eth_call` state overrides (most
/// modern providers do; a handful of minimal/free public endpoints don't —
/// callers should treat a thrown error here as "balance-diff simulation
/// unavailable on this RPC" and fall back to the calldata-only analysis in
/// transactionAnalyzer.ts, not as a hard failure).
export async function simulateBalanceDiff(params: {
  vaultAddress: Address;
  target: Address;
  value: bigint;
  data: Hex;
  nativeProbes: Address[];
  tokenProbes: TokenProbe[];
}): Promise<BalanceDiffResult> {
  const client = getPublicClient();

  const callData = encodeFunctionData({
    abi: simulatorAbi,
    functionName: "simulate",
    args: [
      params.target,
      params.value,
      params.data,
      params.nativeProbes,
      params.tokenProbes.map((p) => ({ token: p.token, account: p.account })),
    ],
  });

  const { data: resultData } = await client.call({
    to: params.vaultAddress,
    data: callData,
    stateOverride: [{ address: params.vaultAddress, code: simulatorDeployedBytecode }],
  });

  if (!resultData) {
    throw new Error("Simulation returned no data — RPC may not support state overrides");
  }

  const decoded = decodeFunctionResult({
    abi: simulatorAbi,
    functionName: "simulate",
    data: resultData,
  });

  return {
    success: decoded.success,
    returnData: decoded.returnData,
    native: params.nativeProbes.map((account, i) => ({
      account,
      before: decoded.nativeBalancesBefore[i],
      after: decoded.nativeBalancesAfter[i],
      delta: decoded.nativeBalancesAfter[i] - decoded.nativeBalancesBefore[i],
    })),
    tokens: params.tokenProbes.map((probe, i) => ({
      token: probe.token,
      account: probe.account,
      before: decoded.tokenBalancesBefore[i],
      after: decoded.tokenBalancesAfter[i],
      delta: decoded.tokenBalancesAfter[i] - decoded.tokenBalancesBefore[i],
    })),
  };
}
