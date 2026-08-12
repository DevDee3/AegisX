// Lightweight, dependency-free sanity checks (no test runner added yet —
// Phase 3 is backend logic; a proper vitest/jest suite is a good next step
// alongside Phase 5's execution-path tests). Run with: npx tsx src/__tests__/manual-checks.ts
import { decodeApprovalCalldata } from "../blockchain/decode.js";
import { decodeCalldata } from "../blockchain/calldataDecoder.js";
import { simulatorAbi, simulatorDeployedBytecode } from "../blockchain/simulatorArtifact.js";
import { isOnChainProposeEnabled } from "../blockchain/walletClient.js";
import { alertsFromLogs, type DecodedGuardianLog } from "../monitoring/registryEventScanner.js";
import { combine } from "../risk/riskEngine.js";
import { parseAiRiskOutput } from "../agent/schema.js";
import { encodeFunctionData } from "viem";
import { execFileSync } from "node:child_process";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const approveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const SPENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const MAX_UINT256 = (1n << 256n) - 1n;

// --- decodeApprovalCalldata ---
const approveMaxData = encodeFunctionData({
  abi: approveAbi,
  functionName: "approve",
  args: [SPENDER, MAX_UINT256],
});
const decoded = decodeApprovalCalldata(approveMaxData);
assert(decoded.isApproval === true, "decodes approve() calldata");
assert(decoded.isUnlimited === true, "detects unlimited approval (type(uint256).max)");

const approveSmallData = encodeFunctionData({
  abi: approveAbi,
  functionName: "approve",
  args: [SPENDER, 100n],
});
const decodedSmall = decodeApprovalCalldata(approveSmallData);
assert(decodedSmall.isUnlimited === false, "does not flag a bounded (100 wei) approval as unlimited");

// --- risk engine mirrors on-chain thresholds ---
const lowRisk = combine({
  aiAssessment: { riskScore: 10, riskLevel: "LOW", findings: [], summary: "fine" },
  registryStatus: "TRUSTED",
  isUnlimitedApproval: false,
  isExpired: false,
  extraFindings: [],
});
assert(lowRisk.decision === "ALLOW", "trusted target + low AI score -> ALLOW");
assert(lowRisk.finalScore === 0, "trusted discount (20) floors at 0 for score 10");

const blocked = combine({
  aiAssessment: { riskScore: 2, riskLevel: "LOW", findings: [], summary: "looks safe" },
  registryStatus: "BLOCKED",
  isUnlimitedApproval: false,
  isExpired: false,
  extraFindings: [],
});
assert(blocked.decision === "BLOCK", "blocked registry status forces BLOCK regardless of AI score");
assert(blocked.hardRuleTriggered === true, "blocked target sets hardRuleTriggered");

const unlimitedApproval = combine({
  aiAssessment: { riskScore: 5, riskLevel: "LOW", findings: [], summary: "looks safe" },
  registryStatus: "UNKNOWN",
  isUnlimitedApproval: true,
  isExpired: false,
  extraFindings: [],
});
assert(unlimitedApproval.decision === "BLOCK", "unlimited approval forces BLOCK even with low AI score (AI recommendation != authorization)");

// --- structured AI output validation ---
const validJson = JSON.stringify({
  riskScore: 42,
  riskLevel: "MEDIUM",
  findings: [{ severity: "MEDIUM", category: "UNKNOWN_CONTRACT", description: "not trusted" }],
  summary: "moderate risk",
});
assert(parseAiRiskOutput(validJson) !== null, "valid AI JSON parses");

const malformedJson = "I think this is safe, risk score around 20 probably";
assert(parseAiRiskOutput(malformedJson) === null, "free-text (non-JSON) AI output is rejected, not coerced");

const outOfRangeJson = JSON.stringify({ riskScore: 500, riskLevel: "LOW", findings: [], summary: "x" });
assert(parseAiRiskOutput(outOfRangeJson) === null, "out-of-range riskScore (500) is rejected by schema bounds");

// --- calldata decoder ---
const swapData = encodeFunctionData({
  abi: [
    {
      type: "function",
      name: "swap",
      stateMutability: "nonpayable",
      inputs: [
        { name: "tokenIn", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "tokenOut", type: "address" },
        { name: "minOut", type: "uint256" },
      ],
      outputs: [{ name: "", type: "uint256" }],
    },
  ] as const,
  functionName: "swap",
  args: [SPENDER, 100n, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 90n],
});
const decodedSwap = decodeCalldata(swapData);
assert(decodedSwap.recognized === true, "recognizes swap() calldata");
assert(decodedSwap.functionName === "swap", "correctly names the decoded function");
assert(
  String(decodedSwap.args?.tokenIn).toLowerCase() === SPENDER.toLowerCase(),
  "decodes swap() tokenIn arg correctly"
);

const unknownData = "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as const;
const decodedUnknown = decodeCalldata(unknownData);
assert(decodedUnknown.recognized === false, "unrecognized selector decodes honestly as unrecognized, not a guess");
assert(decodedUnknown.functionName === "unknown", "unrecognized function name is 'unknown'");

// --- simulator artifact sanity ---
assert(simulatorAbi.length > 0, "simulator ABI loaded from generated artifact");
assert(
  simulatorDeployedBytecode.startsWith("0x") && simulatorDeployedBytecode.length > 100,
  "simulator deployed bytecode loaded and non-trivial"
);
const simulateCallData = encodeFunctionData({
  abi: simulatorAbi,
  functionName: "simulate",
  args: [SPENDER, 0n, "0x", [SPENDER], [{ token: SPENDER, account: SPENDER }]],
});
assert(simulateCallData.startsWith("0x"), "can encode a call to the generated simulator ABI without throwing");

// --- Phase 5 safety gates ---
assert(
  isOnChainProposeEnabled() === false,
  "on-chain proposing is disabled by default (no ENABLE_ONCHAIN_PROPOSE/AGENT_PRIVATE_KEY in this process's env)"
);

function runEnvCheck(env: Record<string, string>): { exitCode: number; stderr: string } {
  try {
    execFileSync("npx", ["tsx", "-e", "import('./src/config/env.js')"], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    return { exitCode: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer };
    return { exitCode: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
  }
}

const missingKeyResult = runEnvCheck({ ENABLE_ONCHAIN_PROPOSE: "true", AGENT_PRIVATE_KEY: "", GUARDIAN_VAULT_ADDRESS: "" });
assert(
  missingKeyResult.exitCode !== 0,
  "ENABLE_ONCHAIN_PROPOSE=true with no AGENT_PRIVATE_KEY/GUARDIAN_VAULT_ADDRESS fails env validation at boot"
);

const validAgentKey = `0x${"1".repeat(64)}`;
const missingVaultResult = runEnvCheck({
  ENABLE_ONCHAIN_PROPOSE: "true",
  AGENT_PRIVATE_KEY: validAgentKey,
  GUARDIAN_VAULT_ADDRESS: "",
});
assert(
  missingVaultResult.exitCode !== 0,
  "ENABLE_ONCHAIN_PROPOSE=true with a key but no GUARDIAN_VAULT_ADDRESS still fails env validation"
);

const validConfigResult = runEnvCheck({
  ENABLE_ONCHAIN_PROPOSE: "true",
  AGENT_PRIVATE_KEY: validAgentKey,
  GUARDIAN_VAULT_ADDRESS: "0x0000000000000000000000000000000000000001",
});
assert(validConfigResult.exitCode === 0, "a fully-specified on-chain-propose config loads without error");

// --- Phase 6 monitoring: pure alert-mapping logic ---
const sampleLogs: DecodedGuardianLog[] = [
  {
    source: "registry",
    eventName: "ContractBlocked",
    args: { target: "0xabc0000000000000000000000000000000000a", admin: SPENDER, reason: "known scam" },
    blockNumber: 100n,
  },
  {
    source: "vault",
    eventName: "TransactionBlocked",
    args: { requestHash: "0xdead", reason: "unlimited approval", riskScore: 100n },
    blockNumber: 101n,
  },
  {
    source: "vault",
    eventName: "TransactionExecuted",
    args: { requestHash: "0xbeef", success: true, returnData: "0x" },
    blockNumber: 102n,
  },
  {
    source: "vault",
    eventName: "TransactionExecuted",
    args: { requestHash: "0xfeed", success: false, returnData: "0x" },
    blockNumber: 103n,
  },
  {
    source: "registry",
    eventName: "ImplementationSnapshotUpdated",
    args: { target: SPENDER, implementation: SPENDER },
    blockNumber: 104n,
  },
];
const mappedAlerts = alertsFromLogs(sampleLogs);
assert(
  mappedAlerts.some((a) => a.type === "SUSPICIOUS_CONTRACT" && a.severity === "HIGH"),
  "ContractBlocked event maps to a HIGH-severity SUSPICIOUS_CONTRACT alert"
);
assert(
  mappedAlerts.some((a) => a.type === "POLICY_VIOLATION" && a.severity === "CRITICAL"),
  "TransactionBlocked event maps to a CRITICAL POLICY_VIOLATION alert"
);
assert(
  !mappedAlerts.some((a) => a.subject === "0xbeef"),
  "a successful TransactionExecuted does NOT generate an alert"
);
assert(
  mappedAlerts.some((a) => a.subject === "0xfeed" && a.type === "WALLET_ANOMALY"),
  "a failed TransactionExecuted DOES generate a WALLET_ANOMALY alert"
);
assert(
  mappedAlerts.length === 3,
  `ImplementationSnapshotUpdated alone generates no alert (expected 3 total, got ${mappedAlerts.length})`
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
