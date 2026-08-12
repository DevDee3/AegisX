import { createPublicClient, http, type PublicClient } from "viem";
import { avalanche, avalancheFuji } from "viem/chains";
import { env } from "../config/env.js";

/// This client is READ-ONLY by construction — no wallet client, no private key,
/// anywhere in this module. The backend's job is analysis; only GuardianVault's
/// own on-chain access control decides what actually executes. Enforcing "no
/// signer in the backend for Phase 3" here means a bug in the AI/agent code
/// literally cannot move funds — there is no capability to misuse yet.
const chain = env.CHAIN_ID === avalanche.id ? avalanche : avalancheFuji;

let _client: PublicClient | undefined;

export function getPublicClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain,
      transport: http(env.AVALANCHE_RPC_URL, {
        // Keep a small retry budget — this process runs on a memory- and
        // time-constrained free-tier host; we don't want a hung RPC call
        // holding a request open indefinitely.
        timeout: 10_000,
        retryCount: 2,
      }),
      // Explicitly cap the client-side block cache; default viem behavior is
      // already conservative, but we're deliberate about it given the target
      // deployment footprint (see backend/README.md).
      cacheTime: 4_000,
    });
  }
  return _client;
}

export { chain };
