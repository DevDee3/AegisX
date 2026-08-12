import { createWalletClient, http, type Account, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { chain } from "./client.js";

/// This is the ONLY file in the entire backend that constructs a signing
/// account. `blockchain/client.ts` (the analysis-path client used by every
/// other module) is read-only by construction and imports nothing from here.
///
/// The account this produces can do exactly one thing on-chain: call
/// GuardianVault.proposeTransaction(), because that's the only function
/// AGENT_ROLE is authorized for (see contracts/src/GuardianVault.sol). It
/// cannot approve or execute a proposal — those require VAULT_ADMIN_ROLE,
/// which this key must never be granted. If you're reviewing this codebase
/// for the "can the AI move funds" question, the answer lives in two places:
/// this file (what key exists) and contracts/src/GuardianVault.sol's role
/// grants (what that key can actually call) — both must be checked together.
let _account: Account | undefined;
let _walletClient: WalletClient | undefined;

export function isOnChainProposeEnabled(): boolean {
  return env.ENABLE_ONCHAIN_PROPOSE && Boolean(env.AGENT_PRIVATE_KEY);
}

export function getAgentAccount(): Account {
  if (!env.AGENT_PRIVATE_KEY) {
    throw new Error(
      "AGENT_PRIVATE_KEY is not set — on-chain proposing is unavailable. This is expected " +
        "unless ENABLE_ONCHAIN_PROPOSE=true was explicitly configured."
    );
  }
  if (!_account) {
    _account = privateKeyToAccount(env.AGENT_PRIVATE_KEY as `0x${string}`);
  }
  return _account;
}

export function getAgentWalletClient(): WalletClient {
  if (!_walletClient) {
    _walletClient = createWalletClient({
      account: getAgentAccount(),
      chain,
      transport: http(env.AVALANCHE_RPC_URL, { timeout: 15_000, retryCount: 1 }),
    });
  }
  return _walletClient;
}
