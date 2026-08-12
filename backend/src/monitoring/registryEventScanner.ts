import type { Address, PublicClient } from "viem";
import { guardianRegistryEventsAbi, guardianVaultEventsAbi, guardianSessionEventsAbi } from "../blockchain/guardianEventsAbi.js";
import type { Alert } from "./types.js";

export interface ScanAddresses {
  registry?: Address;
  vault?: Address;
  session?: Address;
}

/// Decoded, address-agnostic log shape this module deals in — deliberately
/// small so `alertsFromLogs` (below) can be tested with plain object
/// literals, no client/network involved.
export interface DecodedGuardianLog {
  source: "registry" | "vault" | "session";
  eventName: string;
  args: Record<string, unknown>;
  blockNumber?: bigint;
  transactionHash?: `0x${string}`;
}

/// Fetches Guardian contract events in [fromBlock, toBlock] via
/// getContractEvents (bounded range — callers, see scan.ts, cap this at
/// MAX_EVENT_LOOKBACK_BLOCKS). This is a single bounded RPC round-trip per
/// event type, not a persistent subscription — see checkpointStore.ts and
/// scan.ts for why: a long-lived `watchEvent` subscription doesn't survive
/// a free-tier host sleeping after 15 minutes of inactivity, so polling in
/// bounded passes is the actual fit for that deployment target, independent
/// of memory.
export async function fetchGuardianLogs(
  client: PublicClient,
  addresses: ScanAddresses,
  fromBlock: bigint,
  toBlock: bigint
): Promise<DecodedGuardianLog[]> {
  const logs: DecodedGuardianLog[] = [];

  if (addresses.registry) {
    const registryLogs = await client.getContractEvents({
      address: addresses.registry,
      abi: guardianRegistryEventsAbi,
      fromBlock,
      toBlock,
    });
    for (const log of registryLogs) {
      logs.push({
        source: "registry",
        eventName: log.eventName,
        args: log.args as Record<string, unknown>,
        blockNumber: log.blockNumber ?? undefined,
        transactionHash: log.transactionHash ?? undefined,
      });
    }
  }

  if (addresses.vault) {
    const vaultLogs = await client.getContractEvents({
      address: addresses.vault,
      abi: guardianVaultEventsAbi,
      fromBlock,
      toBlock,
    });
    for (const log of vaultLogs) {
      logs.push({
        source: "vault",
        eventName: log.eventName,
        args: log.args as Record<string, unknown>,
        blockNumber: log.blockNumber ?? undefined,
        transactionHash: log.transactionHash ?? undefined,
      });
    }
  }

  if (addresses.session) {
    const sessionLogs = await client.getContractEvents({
      address: addresses.session,
      abi: guardianSessionEventsAbi,
      fromBlock,
      toBlock,
    });
    for (const log of sessionLogs) {
      logs.push({
        source: "session",
        eventName: log.eventName,
        args: log.args as Record<string, unknown>,
        blockNumber: log.blockNumber ?? undefined,
        transactionHash: log.transactionHash ?? undefined,
      });
    }
  }

  return logs;
}

/// Pure mapping from decoded logs to alerts — no I/O, fully unit-testable
/// (see src/__tests__/manual-checks.ts). Deliberately conservative about
/// what counts as alert-worthy: e.g. ContractTrusted isn't here because
/// trusting something is the safe/expected direction, not an anomaly.
export function alertsFromLogs(logs: DecodedGuardianLog[]): Alert[] {
  const now = new Date().toISOString();
  const alerts: Alert[] = [];

  for (const log of logs) {
    const base = { blockNumber: log.blockNumber, txHash: log.transactionHash, detectedAt: now };

    switch (`${log.source}:${log.eventName}`) {
      case "registry:ContractBlocked":
        alerts.push({
          ...base,
          type: "SUSPICIOUS_CONTRACT",
          severity: "HIGH",
          subject: String(log.args.target),
          message: `Contract ${log.args.target} was blocked in the Guardian registry: ${log.args.reason}`,
        });
        break;

      case "registry:ContractFlaggedSuspicious":
        alerts.push({
          ...base,
          type: "SUSPICIOUS_CONTRACT",
          severity: "MEDIUM",
          subject: String(log.args.target),
          message: `Contract ${log.args.target} was flagged suspicious: ${log.args.reason}`,
        });
        break;

      case "vault:TransactionBlocked":
        alerts.push({
          ...base,
          type: "POLICY_VIOLATION",
          severity: "CRITICAL",
          subject: String(log.args.requestHash),
          message: `Vault blocked a proposed transaction (risk score ${log.args.riskScore}): ${log.args.reason}`,
        });
        break;

      case "vault:TransactionExecuted":
        if (log.args.success === false) {
          alerts.push({
            ...base,
            type: "WALLET_ANOMALY",
            severity: "MEDIUM",
            subject: String(log.args.requestHash),
            message: `An approved vault transaction executed but failed on-chain (requestHash ${log.args.requestHash}).`,
          });
        }
        break;

      case "vault:VaultPaused":
        alerts.push({
          ...base,
          type: "POLICY_VIOLATION",
          severity: "HIGH",
          subject: String(log.args.admin),
          message: `Vault was paused by ${log.args.admin}.`,
        });
        break;

      case "session:SessionRevoked":
        alerts.push({
          ...base,
          type: "POLICY_VIOLATION",
          severity: "HIGH",
          subject: String(log.args.agent),
          message: `Agent session for ${log.args.agent} was revoked by ${log.args.revokedBy}.`,
        });
        break;

      default:
        // registry:ImplementationSnapshotUpdated is intentionally not
        // alert-worthy on its own — it's a recorded baseline, not an
        // anomaly. Drift detection against that baseline lives in
        // upgradeDetector.ts, which is where an actual alert can fire.
        break;
    }
  }

  return alerts;
}
