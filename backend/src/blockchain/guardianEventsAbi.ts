/// Event-only ABI fragments for scanning Guardian contract activity. Mirrors
/// the `event` declarations in contracts/src/GuardianRegistry.sol,
/// contracts/src/GuardianVault.sol, and contracts/src/GuardianSession.sol —
/// kept in sync by hand, same tradeoff documented in blockchain/abis.ts.

export const guardianRegistryEventsAbi = [
  {
    type: "event",
    name: "ContractBlocked",
    inputs: [
      { name: "target", type: "address", indexed: true },
      { name: "admin", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ContractFlaggedSuspicious",
    inputs: [
      { name: "target", type: "address", indexed: true },
      { name: "admin", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ImplementationSnapshotUpdated",
    inputs: [
      { name: "target", type: "address", indexed: true },
      { name: "implementation", type: "address", indexed: true },
    ],
  },
] as const;

export const guardianVaultEventsAbi = [
  {
    type: "event",
    name: "TransactionExecuted",
    inputs: [
      { name: "requestHash", type: "bytes32", indexed: true },
      { name: "success", type: "bool", indexed: false },
      { name: "returnData", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransactionBlocked",
    inputs: [
      { name: "requestHash", type: "bytes32", indexed: true },
      { name: "reason", type: "string", indexed: false },
      { name: "riskScore", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VaultPaused",
    inputs: [{ name: "admin", type: "address", indexed: true }],
  },
] as const;

export const guardianSessionEventsAbi = [
  {
    type: "event",
    name: "SessionRevoked",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "revokedBy", type: "address", indexed: true },
    ],
  },
] as const;
