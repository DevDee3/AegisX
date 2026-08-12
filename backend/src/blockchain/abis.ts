/// Minimal, hand-picked ABI fragments — only what the analyzer actually reads.
/// Keeping these small (rather than importing full artifact JSON) is both a
/// clarity choice and a memory/footprint choice for a free-tier deployment.

export const guardianRegistryAbi = [
  {
    type: "function",
    name: "getContractStatus",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getRecordedImplementation",
    stateMutability: "view",
    inputs: [{ name: "target", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ownableAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/// The registry's ContractStatus enum, mirrored from DataTypes.sol. Keep this
/// in sync with contracts/src/libraries/DataTypes.sol by hand — there is no
/// shared codegen between the two packages yet (a Phase-3+ improvement would
/// be generating this from the contracts' ABI at build time).
export const REGISTRY_STATUS = ["UNKNOWN", "TRUSTED", "SUSPICIOUS", "BLOCKED"] as const;
export type RegistryStatus = (typeof REGISTRY_STATUS)[number];
