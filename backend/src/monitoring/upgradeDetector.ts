import type { Address, PublicClient } from "viem";
import { guardianRegistryAbi } from "../blockchain/abis.js";
import { checkUpgradeability } from "../blockchain/introspection.js";
import type { Alert } from "./types.js";

export interface UpgradeCheckTarget {
  address: Address;
  label?: string;
}

/// For each watched proxy contract, compares its LIVE implementation slot
/// against the snapshot GuardianRegistry recorded the last time it was
/// trusted (see GuardianRegistry.recordImplementation in contracts). A
/// mismatch means the contract's actual code changed since Guardian last
/// looked at it — this is exactly Scenario D from the original spec
/// ("previously trusted contract changes implementation") and exactly what
/// contracts/test/mocks/UpgradeableAttack.sol exists to let us test against
/// on the Solidity side (see
/// contracts/test/integration/SecurityScenarios.t.sol's scenario D test).
export async function detectUpgrades(
  client: PublicClient,
  registryAddress: Address,
  targets: UpgradeCheckTarget[]
): Promise<Alert[]> {
  const now = new Date().toISOString();
  const alerts: Alert[] = [];

  for (const target of targets) {
    const [recorded, live] = await Promise.all([
      client.readContract({
        address: registryAddress,
        abi: guardianRegistryAbi,
        functionName: "getRecordedImplementation",
        args: [target.address],
      }),
      checkUpgradeability(target.address),
    ]);

    const zero = "0x0000000000000000000000000000000000000000";
    const hasRecorded = recorded && recorded.toLowerCase() !== zero;
    const liveImpl = live.implementation?.toLowerCase();

    if (hasRecorded && liveImpl && liveImpl !== recorded.toLowerCase()) {
      alerts.push({
        type: "UPGRADE_DETECTED",
        severity: "CRITICAL",
        subject: target.address,
        message: `${target.label ?? target.address} changed implementation: was ${recorded}, now ${live.implementation}. Previously-trusted behavior may no longer hold.`,
        detectedAt: now,
      });
    }
  }

  return alerts;
}
