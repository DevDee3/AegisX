import type { Address } from "viem";
import { getPublicClient } from "../blockchain/client.js";
import { guardianRegistryAbi, REGISTRY_STATUS, type RegistryStatus } from "../blockchain/abis.js";
import { checkUpgradeability, getBytecode, tryGetOwner, type UpgradeabilityResult } from "../blockchain/introspection.js";
import { env } from "../config/env.js";
import type { Finding } from "./types.js";

export interface ContractAnalysis {
  address: Address;
  hasCode: boolean;
  registryStatus: RegistryStatus;
  upgradeability: UpgradeabilityResult;
  owner?: Address;
  findings: Finding[];
}

/// Registry status comes from the on-chain GuardianRegistry, which is the
/// same contract RiskPolicy consults for its own hard rules — this call
/// reads the identical source of truth the deterministic engine will use,
/// so the AI's picture of "is this trusted" can never be stale relative to
/// what actually governs execution.
async function getRegistryStatus(target: Address): Promise<RegistryStatus> {
  if (!env.GUARDIAN_REGISTRY_ADDRESS) return "UNKNOWN";
  try {
    const client = getPublicClient();
    const statusIndex = await client.readContract({
      address: env.GUARDIAN_REGISTRY_ADDRESS as Address,
      abi: guardianRegistryAbi,
      functionName: "getContractStatus",
      args: [target],
    });
    return REGISTRY_STATUS[statusIndex] ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export async function analyzeContract(address: Address): Promise<ContractAnalysis> {
  const findings: Finding[] = [];

  const [bytecode, registryStatus, upgradeability, owner] = await Promise.all([
    getBytecode(address),
    getRegistryStatus(address),
    checkUpgradeability(address),
    tryGetOwner(address),
  ]);

  const hasCode = Boolean(bytecode && bytecode !== "0x");

  if (registryStatus === "BLOCKED") {
    findings.push({
      severity: "CRITICAL",
      category: "BLOCKED_CONTRACT",
      description: "This contract is on the Guardian blocklist.",
    });
  } else if (registryStatus === "SUSPICIOUS") {
    findings.push({
      severity: "HIGH",
      category: "SUSPICIOUS_CONTRACT",
      description: "This contract has been flagged as suspicious by Guardian monitoring.",
    });
  } else if (registryStatus === "UNKNOWN") {
    findings.push({
      severity: "MEDIUM",
      category: "UNKNOWN_CONTRACT",
      description: "This contract is not in the Guardian trusted registry.",
    });
  }

  if (upgradeability.isProxy) {
    findings.push({
      severity: "MEDIUM",
      category: "UPGRADEABLE_CONTRACT",
      description: `Contract is an upgradeable proxy (${upgradeability.pattern}). Its behavior can change without a new deployment.`,
    });
  }

  if (owner) {
    findings.push({
      severity: "LOW",
      category: "PRIVILEGED_OWNER_FUNCTIONS",
      description: `Contract exposes an owner() address (${owner}). Review for privileged functions gated behind it.`,
    });
  }

  if (!hasCode) {
    findings.push({
      severity: "HIGH",
      category: "OTHER",
      description: "No contract code found at this address on the configured chain.",
    });
  }

  return { address, hasCode, registryStatus, upgradeability, owner, findings };
}
