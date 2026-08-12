import { decodeFunctionData, type Hex } from "viem";

/// A small, deliberately curated registry of function signatures the analyzer
/// knows how to decode into human-readable form — not a general 4byte-directory
/// lookup (which would mean an external network call per unknown selector,
/// another cost we're avoiding on a memory/latency-constrained deployment).
/// Anything outside this list decodes to { functionName: "unknown", selector }
/// rather than guessing — an honest "we don't recognize this" beats a wrong guess.
const KNOWN_ABI = [
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
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
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
] as const;

export interface DecodedCalldata {
  recognized: boolean;
  functionName: string;
  selector: Hex;
  args?: Record<string, unknown>;
}

export function decodeCalldata(data: Hex): DecodedCalldata {
  const selector = data.slice(0, 10) as Hex;

  for (const abiEntry of KNOWN_ABI) {
    try {
      const decoded = decodeFunctionData({ abi: [abiEntry], data });
      const args: Record<string, unknown> = {};
      abiEntry.inputs.forEach((input, i) => {
        const value = (decoded.args as readonly unknown[])[i];
        args[input.name] = typeof value === "bigint" ? value.toString() : value;
      });
      return { recognized: true, functionName: abiEntry.name, selector, args };
    } catch {
      // selector didn't match this ABI entry; try the next one
    }
  }

  return { recognized: false, functionName: "unknown", selector };
}
