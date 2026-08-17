import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";
import type { Address, Hex } from "viem";
import { analyzeContract } from "../analyzer/contractAnalyzer.js";
import { analyzeTransaction } from "../analyzer/transactionAnalyzer.js";
import { analyzeWallet } from "../analyzer/walletAnalyzer.js";

/// Every tool here is READ-ONLY analysis. There is deliberately no
/// `execute_transaction`, `send_funds`, or similar tool in this list — per
/// the project's core rule, the agent has tools for reasoning, never for
/// acting. Phase 5 (agent integration) wires the agent's OUTPUT into the
/// vault's propose path; it will still never give the agent a tool that
/// calls the vault directly.

export const guardianTools: FunctionDeclaration[] = [
  {
    name: "analyze_contract",
    description:
      "Inspect a contract address: Guardian registry status (trusted/unknown/suspicious/blocked), upgradeability (proxy pattern detection), and owner() if present. Use this before assessing risk on any target contract.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        address: { type: SchemaType.STRING, description: "0x-prefixed contract address" },
      },
      required: ["address"],
    },
  },
  {
    name: "analyze_transaction",
    description:
      "Analyze a proposed transaction: decodes the calldata (recognizes approve/transfer/transferFrom/swap and reports args), checks for unlimited-approval patterns, runs the target contract analysis, and does a fast eth_call-based revert check. Use this for any concrete transaction the user is considering.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from: { type: SchemaType.STRING, description: "sender address (the Guardian vault)" },
        target: { type: SchemaType.STRING, description: "target contract address" },
        value: { type: SchemaType.STRING, description: "native AVAX value in wei, as a decimal string" },
        data: { type: SchemaType.STRING, description: "0x-prefixed calldata" },
      },
      required: ["from", "target", "value", "data"],
    },
  },
  {
    name: "analyze_wallet",
    description:
      "Check a wallet's native balance and, for a given list of tokens/spenders, its ERC-20 balances and outstanding allowances. Use this to answer questions about exposure or 'what has this wallet approved'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        wallet: { type: SchemaType.STRING },
        tokens: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              token: { type: SchemaType.STRING },
              spendersToCheck: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            },
            required: ["token", "spendersToCheck"],
          },
        },
      },
      required: ["wallet", "tokens"],
    },
  },
];

export async function executeGuardianTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "analyze_contract": {
      const address = input.address as Address;
      const result = await analyzeContract(address);
      return serializeBigInts(result);
    }
    case "analyze_transaction": {
      const result = await analyzeTransaction({
        from: input.from as Address,
        target: input.target as Address,
        value: BigInt(input.value as string),
        data: input.data as Hex,
      });
      return serializeBigInts(result);
    }
    case "analyze_wallet": {
      const tokens = input.tokens as { token: Address; spendersToCheck: Address[] }[];
      const result = await analyzeWallet(input.wallet as Address, tokens);
      return serializeBigInts(result);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/// JSON.stringify chokes on bigint; tool results go back to Gemini as JSON
/// text, so convert bigints to strings before sending.
function serializeBigInts(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}
