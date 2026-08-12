/// Hand-picked ABI fragment mirroring contracts/src/interfaces/IGuardianVault.sol
/// and the TransactionRequest struct in contracts/src/libraries/DataTypes.sol.
/// Kept in sync by hand — see backend/README.md's note on this same tradeoff
/// for blockchain/abis.ts. Only proposeTransaction and the read paths needed
/// to support it are included here; there is deliberately no approve/execute
/// entry — this backend has no business encoding calls to those.
export const guardianVaultAbi = [
  {
    type: "function",
    name: "proposeTransaction",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "vault", type: "address" },
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "aiScore", type: "uint256" },
    ],
    outputs: [{ name: "requestHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "currentNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getProposalState",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "event",
    name: "TransactionProposed",
    inputs: [
      { name: "requestHash", type: "bytes32", indexed: true },
      { name: "proposer", type: "address", indexed: true },
      {
        name: "request",
        type: "tuple",
        indexed: false,
        components: [
          { name: "vault", type: "address" },
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
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
] as const;

/// Mirrors DataTypes.ProposalState — keep in sync with
/// contracts/src/libraries/DataTypes.sol by hand.
export const PROPOSAL_STATE = ["NONE", "PENDING", "APPROVED", "EXECUTED", "CANCELLED", "EXPIRED"] as const;
export type ProposalState = (typeof PROPOSAL_STATE)[number];
