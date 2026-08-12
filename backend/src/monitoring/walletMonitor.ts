import type { Address, PublicClient } from "viem";
import { erc20Abi } from "../blockchain/abis.js";
import type { Alert } from "./types.js";

const MAX_UINT256 = (1n << 256n) - 1n;

/// A large-transfer threshold is necessarily heuristic without USD pricing —
/// this takes a caller-supplied threshold PER TOKEN (in that token's smallest
/// unit) rather than guessing, so the caller (which knows the token's
/// decimals and rough value) decides what "large" means for it.
export interface WalletWatchTarget {
  token: Address;
  largeTransferThreshold?: bigint;
}

/// Scans Transfer/Approval logs for `wallet` across `tokens`, in
/// [fromBlock, toBlock] — a BOUNDED range, never "this wallet's whole
/// history." Scanning a wallet's entire history via getLogs would mean an
/// unbounded, potentially huge log fetch per request; that's an indexer's
/// job (a real Postgres-backed events table), not something to do live over
/// RPC on every scan pass. See walletAnalyzer.ts for the same constraint
/// applied to the read-only analysis path.
export async function scanWalletActivity(
  client: PublicClient,
  wallet: Address,
  tokens: WalletWatchTarget[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<Alert[]> {
  const now = new Date().toISOString();
  const alerts: Alert[] = [];

  for (const { token, largeTransferThreshold } of tokens) {
    const [outgoing, incoming, approvals] = await Promise.all([
      client.getContractEvents({
        address: token,
        abi: erc20Abi,
        eventName: "Transfer",
        args: { from: wallet },
        fromBlock,
        toBlock,
      }),
      client.getContractEvents({
        address: token,
        abi: erc20Abi,
        eventName: "Transfer",
        args: { to: wallet },
        fromBlock,
        toBlock,
      }),
      client.getContractEvents({
        address: token,
        abi: erc20Abi,
        eventName: "Approval",
        args: { owner: wallet },
        fromBlock,
        toBlock,
      }),
    ]);

    for (const log of [...outgoing, ...incoming]) {
      const value = log.args.value ?? 0n;
      if (largeTransferThreshold && value >= largeTransferThreshold) {
        const direction = log.args.from?.toLowerCase() === wallet.toLowerCase() ? "out of" : "into";
        alerts.push({
          type: "LARGE_TRANSFER",
          severity: "MEDIUM",
          subject: wallet,
          message: `Large transfer (${value.toString()}) of ${token} ${direction} the wallet.`,
          blockNumber: log.blockNumber ?? undefined,
          txHash: log.transactionHash ?? undefined,
          detectedAt: now,
        });
      }
    }

    for (const log of approvals) {
      if (log.args.value === MAX_UINT256) {
        alerts.push({
          type: "UNLIMITED_APPROVAL",
          severity: "HIGH",
          subject: wallet,
          message: `Wallet granted an unlimited approval on ${token} to ${log.args.spender}.`,
          blockNumber: log.blockNumber ?? undefined,
          txHash: log.transactionHash ?? undefined,
          detectedAt: now,
        });
      }
    }
  }

  return alerts;
}
