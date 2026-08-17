import { z } from "zod";

/// Centralized, validated environment config. Fail fast on boot rather than
/// discovering a missing var deep inside a request handler.
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8787),
    CORS_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),

    // Chain config: Fuji by default in development. Never default to mainnet.
    AVALANCHE_RPC_URL: z.string().url().default("https://api.avax-test.network/ext/bc/C/rpc"),
    CHAIN_ID: z.coerce.number().int().positive().default(43113), // Fuji

    // On-chain Guardian contract addresses (read-only reads happen regardless;
    // GUARDIAN_VAULT_ADDRESS is also required if ENABLE_ONCHAIN_PROPOSE is set).
    GUARDIAN_REGISTRY_ADDRESS: z.string().optional(),
    GUARDIAN_VAULT_ADDRESS: z.string().optional(),

    // AI provider. If absent, the agent falls back to deterministic-only analysis
    // (still functional — the deterministic risk engine never depends on the AI).
    GEMINI_API_KEY: z.string().optional(),

    // --- Phase 5: the ONLY place a private key enters this codebase. ---
    // This must be a bounded AGENT_ROLE key on GuardianVault (ideally further
    // bounded by a GuardianSession — see contracts/src/GuardianSession.sol),
    // never the vault's admin key. Holding this key grants exactly one
    // capability: calling proposeTransaction(). It can NEVER approve or
    // execute a proposal — those on-chain functions are gated to
    // VAULT_ADMIN_ROLE, which this codebase does not and must never hold.
    AGENT_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex private key")
      .optional(),

    // Explicit, separate opt-in for actually SENDING the propose transaction
    // on-chain. Having AGENT_PRIVATE_KEY set is not enough by itself — this
    // flag exists so "the backend can currently move toward on-chain action"
    // is never true by accident (e.g. a key left in .env from a different
    // environment). Default false: dry-run / analysis-only.
    ENABLE_ONCHAIN_PROPOSE: z
      .string()
      .optional()
      .transform((v) => v === "true"),

    // Kept intentionally small: this process is expected to run on a memory-
    // constrained free-tier host. See backend/README.md.
    MAX_EVENT_LOOKBACK_BLOCKS: z.coerce.number().int().positive().default(2000),
  })
  .refine((data) => !data.ENABLE_ONCHAIN_PROPOSE || Boolean(data.AGENT_PRIVATE_KEY), {
    message: "ENABLE_ONCHAIN_PROPOSE=true requires AGENT_PRIVATE_KEY to be set",
    path: ["AGENT_PRIVATE_KEY"],
  })
  .refine((data) => !data.ENABLE_ONCHAIN_PROPOSE || Boolean(data.GUARDIAN_VAULT_ADDRESS), {
    message: "ENABLE_ONCHAIN_PROPOSE=true requires GUARDIAN_VAULT_ADDRESS to be set",
    path: ["GUARDIAN_VAULT_ADDRESS"],
  });

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
