import type { Address } from "viem";
import { getPublicClient } from "../blockchain/client.js";
import { erc20Abi } from "../blockchain/abis.js";
import type { Finding } from "./types.js";

export interface TokenExposure {
  token: Address;
  balance: bigint;
  allowances: { spender: Address; amount: bigint }[];
}

export interface WalletAnalysis {
  wallet: Address;
  nativeBalance: bigint;
  tokenExposure: TokenExposure[];
  findings: Finding[];
}

const MAX_UINT256 = (1n << 256n) - 1n;

/// Checks a wallet's balance and outstanding allowances for a *known* set of
/// tokens/spenders — there is no general "scan all of a wallet's history for
/// every token it has ever touched" here yet. That requires an indexer
/// (Phase 6 monitoring / an events-driven store), not ad-hoc RPC calls; doing
/// it via RPC alone would mean scanning historical Transfer/Approval logs
/// across a large block range per request, which is both slow and exactly
/// the kind of per-request cost that doesn't fit a free-tier deployment.
export async function analyzeWallet(
  wallet: Address,
  watchedTokens: { token: Address; spendersToCheck: Address[] }[]
): Promise<WalletAnalysis> {
  const client = getPublicClient();
  const findings: Finding[] = [];

  const nativeBalance = await client.getBalance({ address: wallet });

  const tokenExposure: TokenExposure[] = await Promise.all(
    watchedTokens.map(async ({ token, spendersToCheck }) => {
      const balance = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      });

      const allowances = await Promise.all(
        spendersToCheck.map(async (spender) => {
          const amount = await client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [wallet, spender],
          });
          return { spender, amount };
        })
      );

      for (const a of allowances) {
        if (a.amount === MAX_UINT256) {
          findings.push({
            severity: "HIGH",
            category: "UNLIMITED_APPROVAL",
            description: `Wallet has an outstanding unlimited approval on ${token} to ${a.spender}.`,
          });
        }
      }

      return { token, balance, allowances };
    })
  );

  return { wallet, nativeBalance, tokenExposure, findings };
}
