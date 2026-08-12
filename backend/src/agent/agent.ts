import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { env } from "../config/env.js";
import { guardianTools, executeGuardianTool } from "./tools.js";
import { parseAiRiskOutput, type AiRiskOutput } from "./schema.js";

const MODEL = "claude-sonnet-4-5"; // keep pinned; bump deliberately, not silently
const MAX_TOOL_ROUNDS = 6; // bound the chain — this is a bounded analysis agent, not an open-ended loop

const SYSTEM_PROMPT = `You are the AegisX security analysis agent.

Your job is ONLY to analyze and explain. You have read-only tools to inspect
contracts, transactions, and wallets on Avalanche. You do not have — and must
never claim to have — any tool that moves funds, approves tokens, or executes
a transaction. If asked to "do" something on-chain, explain that you can only
analyze and recommend; a human or the deterministic policy contract decides
what actually executes.

Use your tools to gather real on-chain evidence before forming an opinion.
Chain tool calls as needed (e.g. analyze a target contract, then analyze the
full transaction, then form a view). Do not guess at contract state you could
have looked up.

When you have gathered enough evidence, respond with ONLY a single JSON
object (no markdown fences, no prose before or after) matching exactly this
shape:
{
  "riskScore": <integer 0-100>,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "findings": [ { "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "category": "...", "description": "..." } ],
  "summary": "<one paragraph, plain language>"
}

Your riskScore is an INPUT to a separate deterministic risk engine, not a
final decision — the engine independently applies hard rules (blocklists,
unlimited-approval detection, spending limits) that you cannot override. Be
honest and specific rather than reassuring; understating risk has no benefit
since the deterministic layer will catch what you miss.`;

export interface AgentRunResult {
  aiOutput: AiRiskOutput | null;
  transcript: { role: string; content: string }[];
  toolCallCount: number;
}

/// Runs a bounded tool-use loop: the model may call any of `guardianTools`
/// up to MAX_TOOL_ROUNDS times, then must terminate with the structured JSON
/// object described in SYSTEM_PROMPT. Returns `aiOutput: null` (never throws
/// for a "bad" model response) if the model's final text doesn't validate
/// against AiRiskOutputSchema — callers fall back to deterministic-only
/// scoring in that case; see risk/riskEngine.ts combine().
export async function runGuardianAgent(userPrompt: string): Promise<AgentRunResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return { aiOutput: null, transcript: [], toolCallCount: 0 };
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];
  const transcript: { role: string; content: string }[] = [{ role: "user", content: userPrompt }];
  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: guardianTools,
      messages,
    });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      transcript.push({ role: "assistant", content: text });
      return { aiOutput: parseAiRiskOutput(text), transcript, toolCallCount };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        toolCallCount++;
        try {
          const result = await executeGuardianTool(block.name, block.input as Record<string, unknown>);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: JSON.stringify(result),
          };
        } catch (err) {
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: "user", content: toolResults });
    transcript.push({ role: "tool", content: `${toolUseBlocks.length} tool call(s)` });
  }

  // Exhausted the tool-call budget without a final structured answer — this
  // counts as "AI analysis unavailable," not a crash.
  return { aiOutput: null, transcript, toolCallCount };
}
