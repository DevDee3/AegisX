import express, { type Request, type Response, type NextFunction } from "express";
import { isAddress, type Address, type Hex } from "viem";
import { env } from "../config/env.js";
import { analyzeContract } from "../analyzer/contractAnalyzer.js";
import { analyzeWallet } from "../analyzer/walletAnalyzer.js";
import { assessTransaction } from "../risk/assess.js";
import { assessAndPropose } from "../risk/pipeline.js";
import { isOnChainProposeEnabled } from "../blockchain/walletClient.js";
import { serializeBigInts } from "./serialize.js";
import { runScan } from "../monitoring/scan.js";
import { alertLog } from "../monitoring/alertStore.js";
import { discoverWallet } from "../analyzer/walletDiscovery.js";

const app = express();
const requestTimes = new Map<string, number[]>();
app.use((req, res, next) => {
  const now = Date.now();
  const key = req.ip ?? "unknown";
  const recent = (requestTimes.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 120) return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  recent.push(now);
  requestTimes.set(key, recent);
  next();
});
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && env.CORS_ORIGINS.split(",").map((value) => value.trim()).includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "256kb" })); // small cap — this API never needs large bodies

app.get("/health", (_req, res) => {
  res.json({ status: "ok", chainId: env.CHAIN_ID, aiProvider: "gemini", aiConfigured: Boolean(env.GEMINI_API_KEY) });
});

/// NOTE on every route below: these all return an ANALYSIS. None of them
/// touch GuardianVault, hold a private key, or have any capability to send a
/// transaction. That boundary is enforced structurally (see
/// blockchain/client.ts — there is no wallet client anywhere in this
/// package), not just by convention.

app.post("/api/analyze/contract", asyncHandler(async (req, res) => {
  const address = req.body?.address as Address | undefined;
  if (!address) return res.status(400).json({ error: "address is required" });
  if (!isAddress(address)) return res.status(400).json({ error: "address must be a valid 0x-prefixed EVM address" });

  const result = await analyzeContract(address);
  res.json(serializeBigInts(result));
}));

app.post("/api/analyze/transaction", asyncHandler(async (req, res) => {
  const { from, target, value, data, watchedTokens } = req.body ?? {};
  if (!from || !target || value === undefined || !data) {
    return res.status(400).json({ error: "from, target, value, data are required" });
  }
  if (!isAddress(from) || !isAddress(target) || typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data) || !/^\d+$/.test(String(value))) {
    return res.status(400).json({ error: "from and target must be valid EVM addresses; value must be integer wei; data must be hex" });
  }

  const { assessment, toolCallCount, transactionAnalysis } = await assessTransaction(
    {
      from: from as Address,
      target: target as Address,
      value: BigInt(value as string),
      data: data as Hex,
    },
    { watchedTokens: (watchedTokens as Address[] | undefined) ?? [] }
  );

  res.json(serializeBigInts({ assessment, toolCallCount, transactionAnalysis }));
}));

app.post("/api/analyze/wallet", asyncHandler(async (req, res) => {
  const { wallet, tokens } = req.body ?? {};
  if (!wallet) return res.status(400).json({ error: "wallet is required" });
  if (!isAddress(wallet)) return res.status(400).json({ error: "wallet must be a valid 0x-prefixed EVM address" });
  if (!Array.isArray(tokens)) return res.status(400).json({ error: "tokens must be an array" });
  for (const item of tokens) {
    if (!item?.token || !isAddress(item.token) || !Array.isArray(item.spendersToCheck) || item.spendersToCheck.some((a: unknown) => typeof a !== "string" || !isAddress(a))) {
      return res.status(400).json({ error: "tokens must contain valid 0x-prefixed EVM addresses" });
    }
  }

  const result = await analyzeWallet(wallet as Address, tokens ?? []);
  res.json(serializeBigInts(result));
}));

app.post("/api/analyze/wallet/discover", asyncHandler(async (req, res) => {
  const wallet = req.body?.wallet;
  if (!isAddress(wallet)) return res.status(400).json({ error: "wallet must be a valid 0x-prefixed EVM address" });
  res.json(await discoverWallet(wallet as Address));
}));

/// THE ONE ROUTE THAT CAN TOUCH THE CHAIN. Everything above is pure analysis.
/// This route runs the full assess -> (gated) propose pipeline. Even with
/// ENABLE_ONCHAIN_PROPOSE=true, it can only ever call proposeTransaction —
/// never approve or execute (see chain/proposeOnChain.ts and
/// blockchain/walletClient.ts for where that boundary is enforced). When the
/// gate is off (the default), this route behaves identically to
/// /api/analyze/transaction plus an explanatory `onChainSkippedReason`.
app.post("/api/propose", asyncHandler(async (req, res) => {
  const { target, value, data, watchedTokens } = req.body ?? {};
  if (!target || value === undefined || !data) {
    return res.status(400).json({ error: "target, value, data are required" });
  }
  if (!env.GUARDIAN_VAULT_ADDRESS) {
    return res.status(503).json({ error: "GUARDIAN_VAULT_ADDRESS is not configured on this server" });
  }

  const result = await assessAndPropose(
    {
      target: target as Address,
      value: BigInt(value as string),
      data: data as Hex,
      watchedTokens: (watchedTokens as Address[] | undefined) ?? [],
    },
    env.GUARDIAN_VAULT_ADDRESS as Address
  );

  res.json(serializeBigInts(result));
}));

app.get("/api/propose/status", (_req, res) => {
  res.json({ onChainProposeEnabled: isOnChainProposeEnabled() });
});

/// Meant to be triggered by an external scheduler (Render cron job, GitHub
/// Actions cron, etc.) hitting this endpoint periodically — NOT run as an
/// in-process interval. See monitoring/scan.ts for why. Each call does one
/// bounded pass and returns what it found; results also accumulate in the
/// in-memory alert log for /api/monitor/alerts to serve.
app.post("/api/monitor/scan", asyncHandler(async (req, res) => {
  const { upgradeTargets, wallets } = req.body ?? {};

  if (!env.GUARDIAN_REGISTRY_ADDRESS && !env.GUARDIAN_VAULT_ADDRESS) {
    return res.status(503).json({ error: "No Guardian contract addresses configured to scan" });
  }

  const report = await runScan({
    addresses: {
      registry: env.GUARDIAN_REGISTRY_ADDRESS as Address | undefined,
      vault: env.GUARDIAN_VAULT_ADDRESS as Address | undefined,
    },
    upgradeTargets,
    wallets,
  });

  alertLog.add(report.alerts);
  res.json(serializeBigInts(report));
}));

app.get("/api/monitor/alerts", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json(serializeBigInts(alertLog.recent(limit)));
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const message = err instanceof Error ? err.message : "Internal error";
  res.status(500).json({ error: message });
});

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

app.listen(env.PORT, () => {
  console.log(`AegisX backend listening on :${env.PORT} (chain ${env.CHAIN_ID})`);
});

export { app };
