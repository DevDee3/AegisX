import { GoogleGenerativeAI, type Content, type GenerateContentResult } from "@google/generative-ai";
import { env } from "../config/env.js";
import { guardianTools, executeGuardianTool } from "./tools.js";
import { parseAiRiskOutput, type AiRiskOutput } from "./schema.js";

const MODEL = "gemini-2.5-flash";
const MAX_TOOL_ROUNDS = 6;
const MAX_RATE_LIMIT_RETRIES = 2;

const SYSTEM_PROMPT = `You are the AegisX security analysis agent.

Your job is ONLY to analyze and explain. You have read-only tools to inspect
contracts, transactions, and wallets on Avalanche. You do not have — and must
never claim to have — any tool that moves funds, approves tokens, or executes
a transaction. If asked to "do" something on-chain, explain that you can only
analyze and recommend; a human or the deterministic policy contract decides
what actually executes.

Use your tools to gather real on-chain evidence before forming an opinion.
Chain tool calls as needed. Do not guess at contract state you could have
looked up.

When you have gathered enough evidence, respond with ONLY a single JSON
object (no markdown fences, no prose before or after) matching exactly this shape:
{
  "riskScore": <integer 0-100>,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "findings": [ { "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "category": "...", "description": "..." } ],
  "summary": "<one paragraph, plain language>"
}

Your riskScore is an INPUT to a separate deterministic risk engine, not a
final decision — the engine independently applies hard rules that you cannot
override. Be honest and specific rather than reassuring.`;

export interface AgentRunResult {
  aiOutput: AiRiskOutput | null;
  transcript: { role: string; content: string }[];
  toolCallCount: number;
}

export async function runGuardianAgent(userPrompt: string): Promise<AgentRunResult> {
  if (!env.GEMINI_API_KEY) return { aiOutput: null, transcript: [], toolCallCount: 0 };

  const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = client.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: guardianTools }],
  });
  const contents: Content[] = [{ role: "user", parts: [{ text: userPrompt }] }];
  const transcript: { role: string; content: string }[] = [{ role: "user", content: userPrompt }];
  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await generateWithQuotaHandling(() => model.generateContent({ contents }));
    const parts = response.response.candidates?.[0]?.content.parts ?? [];
    const functionCalls = parts.filter((part) => part.functionCall).map((part) => part.functionCall!);

    if (functionCalls.length === 0) {
      const text = parts.filter((part) => part.text).map((part) => part.text).join("\n");
      transcript.push({ role: "assistant", content: text });
      return { aiOutput: parseAiRiskOutput(text), transcript, toolCallCount };
    }

    contents.push({ role: "model", parts });
    const functionResponses = await Promise.all(functionCalls.map(async (call) => {
      toolCallCount++;
      try {
        const result = await executeGuardianTool(call.name, (call.args ?? {}) as Record<string, unknown>);
        return { functionResponse: { name: call.name, response: result as Record<string, unknown> } };
      } catch (err) {
        return { functionResponse: { name: call.name, response: { error: err instanceof Error ? err.message : String(err) } } };
      }
    }));
    contents.push({ role: "user", parts: functionResponses });
    transcript.push({ role: "tool", content: `${functionCalls.length} tool call(s)` });
  }

  return { aiOutput: null, transcript, toolCallCount };
}

async function generateWithQuotaHandling(request: () => Promise<GenerateContentResult>): Promise<GenerateContentResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!is429(err) || isDailyQuota(message)) {
        if (is429(err) && isDailyQuota(message)) {
          throw new Error("Gemini daily quota exhausted; quota resets at midnight Pacific.");
        }
        throw err;
      }
      if (attempt >= MAX_RATE_LIMIT_RETRIES) throw new Error(`Gemini rate limit persisted after ${MAX_RATE_LIMIT_RETRIES} retries: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

function is429(err: unknown): boolean {
  const status = (err as { status?: number; response?: { status?: number } })?.status ?? (err as { response?: { status?: number } })?.response?.status;
  return status === 429 || /429|resource exhausted|rate limit/i.test(err instanceof Error ? err.message : String(err));
}

function isDailyQuota(message: string): boolean {
  return /daily|per day|requestsperday|quota.*exhausted|resets?.*midnight|GenerateRequestsPerDay/i.test(message);
}
