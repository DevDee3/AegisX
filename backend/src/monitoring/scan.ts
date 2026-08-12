import type { Address } from "viem";
import { getPublicClient } from "../blockchain/client.js";
import { env } from "../config/env.js";
import { fetchGuardianLogs, alertsFromLogs, type ScanAddresses } from "./registryEventScanner.js";
import { detectUpgrades, type UpgradeCheckTarget } from "./upgradeDetector.js";
import { scanWalletActivity, type WalletWatchTarget } from "./walletMonitor.js";
import { defaultCheckpointStore, type CheckpointStore } from "./checkpointStore.js";
import type { Alert } from "./types.js";

export interface ScanConfig {
  addresses: ScanAddresses;
  upgradeTargets?: UpgradeCheckTarget[];
  wallets?: { wallet: Address; tokens: WalletWatchTarget[] }[];
}

export interface ScanReport {
  fromBlock: bigint;
  toBlock: bigint;
  alerts: Alert[];
}

const CHECKPOINT_KEY = "guardian-scan";

/// Runs ONE bounded scan pass: contract/vault/session events since the last
/// checkpoint (or the last MAX_EVENT_LOOKBACK_BLOCKS if there is none),
/// upgrade-drift detection on the watched proxies, and wallet activity scans.
/// This function is designed to be called by an external trigger — a
/// scheduled job (Render cron, GitHub Actions cron, etc.) hitting
/// POST /api/monitor/scan — not run as an in-process `setInterval` loop.
/// That's a direct response to the earlier discussion in this project: a
/// free-tier host that sleeps after 15 minutes of inactivity can't sustain a
/// long-lived timer or WebSocket subscription anyway, so "wake up, do one
/// bounded pass, go back to sleep" is the shape that actually fits, whether
/// or not memory happens to be the binding constraint that day.
export async function runScan(
  config: ScanConfig,
  checkpointStore: CheckpointStore = defaultCheckpointStore
): Promise<ScanReport> {
  const client = getPublicClient();
  const latestBlock = await client.getBlockNumber();

  const lastCheckpoint = await checkpointStore.get(CHECKPOINT_KEY);
  const lookback = BigInt(env.MAX_EVENT_LOOKBACK_BLOCKS);
  const fromBlock = lastCheckpoint ?? (latestBlock > lookback ? latestBlock - lookback : 0n);
  const toBlock = latestBlock;

  const alerts: Alert[] = [];

  const logs = await fetchGuardianLogs(client, config.addresses, fromBlock, toBlock);
  alerts.push(...alertsFromLogs(logs));

  if (config.upgradeTargets?.length && config.addresses.registry) {
    alerts.push(...(await detectUpgrades(client, config.addresses.registry, config.upgradeTargets)));
  }

  if (config.wallets?.length) {
    for (const { wallet, tokens } of config.wallets) {
      alerts.push(...(await scanWalletActivity(client, wallet, tokens, fromBlock, toBlock)));
    }
  }

  await checkpointStore.set(CHECKPOINT_KEY, toBlock + 1n);

  return { fromBlock, toBlock, alerts };
}
