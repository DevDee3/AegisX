# AegisX — Backend (Phase 3–6: AI Analysis, Agent Integration, Monitoring)

TypeScript/Node backend providing read-only, tool-using AI analysis on top of
the on-chain contracts from Phase 1/2 (`../contracts`). **Nothing in this
package can execute a transaction.** There is no wallet client, no private
key, and no tool that calls `GuardianVault`. That boundary is structural
(see `src/blockchain/client.ts`), not just a convention — per the spec's core
rule, AI does analysis, contracts do enforcement.

## How this connects to Phase 1/2

- `src/blockchain/abis.ts` / `contractAnalyzer.ts` read `GuardianRegistry`'s
  `getContractStatus()` — the exact same on-chain source of truth
  `RiskPolicy.sol` consults, so the AI's picture of "trusted/unknown/
  suspicious/blocked" can never drift from what actually governs execution.
- `src/blockchain/decode.ts` mirrors `GuardianVault._isUnlimitedApproval`
  byte-for-byte (same selector, same `type(uint256).max` check).
- `src/risk/riskEngine.ts` mirrors `RiskPolicy.sol`'s thresholds (30/60/80)
  and penalty weights (unknown +15, suspicious +25, trusted -20, unlimited
  approval +40 and always BLOCK) so a risk score shown to a user pre-flight
  matches what the chain will compute at `proposeTransaction` time. If the
  Solidity constants ever change, update this file's constants to match —
  there's no shared codegen between the two packages yet.
- **This backend's output is explanatory only.** The chain doesn't trust it;
  `GuardianVault` always re-evaluates via the deployed `RiskPolicy` contract.
  Phase 5 (agent integration) is where this pipeline's output actually starts
  feeding a real `proposeTransaction` call — that wiring doesn't exist yet.

## What's built

```
src/
  config/env.ts              Validated env config (Zod), Fuji by default
  blockchain/
    client.ts                 Read-only viem client — no signer, anywhere
    abis.ts                   Minimal hand-picked ABI fragments
    introspection.ts          Bytecode, EIP-1967/beacon proxy detection, owner()
    decode.ts                 Calldata decoding (unlimited-approval detection)
  analyzer/
    contractAnalyzer.ts        Registry status + upgradeability + ownership -> findings
    transactionAnalyzer.ts     Decodes calldata, simulates via eth_call, aggregates findings
    walletAnalyzer.ts          Native balance + per-token balance/allowance exposure
  agent/
    schema.ts                  Zod schema = the validation boundary for AI output
    tools.ts                   Gemini function definitions bridging -> analyzers
    agent.ts                   Bounded tool-use loop (max 6 rounds), read-only tools only
  risk/
    riskEngine.ts               Deterministic combine(): AI score is ONE input
    assess.ts                   Orchestrates analyzer -> agent -> riskEngine
  api/
    server.ts                   Express endpoints (all read-only analysis)
    serialize.ts                bigint-safe JSON helper
```

## Endpoints

- `GET /health`
- `POST /api/analyze/contract` — `{ address }`
- `POST /api/analyze/transaction` — `{ from, target, value, data }`
- `POST /api/analyze/wallet` — `{ wallet, tokens: [{ token, spendersToCheck }] }`

## Running

```bash
npm install
cp .env.example .env   # set AVALANCHE_RPC_URL, GUARDIAN_REGISTRY_ADDRESS, GEMINI_API_KEY
npm run dev
```

Without `GEMINI_API_KEY` set, the server still runs — every endpoint falls
back to deterministic-only scoring (the AI assessment is `null`, and
`combine()` treats an absent AI opinion as maximally uncertain, not as
evidence of safety).

AI analysis uses Google's Gemini API with the pinned `gemini-3.6-flash` model.
Gemini's free tier has daily request limits; a daily quota exhaustion is
reported immediately and resets at midnight Pacific, while short per-minute
rate limits receive bounded backoff retries. Keep a paid or appropriately
limited key configured for demos that make many requests.

Sanity checks (no test runner wired up yet — a real vitest/jest suite is a
good next step, ideally alongside Phase 5):
```bash
npx tsx src/__tests__/manual-checks.ts
```

## Phase 4: transaction simulation, without a local fork

Running a local `anvil` fork per analysis request was ruled out early (see the
memory-footprint discussion below) — a full EVM node process is easily
200-400MB on its own. Instead, `TransactionSimulator.sol`
(`../contracts/src/simulation/`) is a stateless helper whose *runtime
bytecode* gets injected via `eth_call`'s `stateOverride` parameter, directly
at the vault's own address, for the duration of a single RPC call:

```
src/blockchain/
  calldataDecoder.ts          Human-readable decode for known functions
                               (approve/transfer/transferFrom/swap); honestly
                               reports "unrecognized" rather than guessing
  simulatorArtifact.ts         GENERATED — ABI + runtime bytecode, regenerate
                               with scripts/generate-simulator-artifact.mjs
                               after any change to TransactionSimulator.sol
  balanceDiffSimulator.ts      Encodes the state-override eth_call, decodes
                               before/after native + token balances
```

Because the injected code runs *at* the vault's address, a sub-call it makes
to `target` shows `msg.sender == vault` — exactly what a real
`executeTransaction` would look like from the target's point of view. This is
proven in `contracts/test/unit/TransactionSimulator.t.sol` (5/5 passing),
including a test that would fail if that property didn't hold. This
sandboxed dev environment can't reach a live Fuji RPC to demonstrate the
`eth_call` half end-to-end (network egress is restricted here), but the
Solidity logic is fully covered, and the TS-side encode/decode round-trip is
covered by `src/__tests__/manual-checks.ts`.

`transactionAnalyzer.ts` now also flags **UNEXPECTED_ASSET_MOVEMENT** when
decoded calldata claims a `swap()` but the balance diff shows the claimed
output token never arrived — precisely the pattern
`contracts/test/mocks/MaliciousRouter.sol` exhibits (pretends to swap,
silently keeps the funds). A calldata-only read can't catch that; the balance
diff can.

Not attempted in Phase 4: decoding *emitted events* from the simulated call.
That needs a tracer RPC method (`debug_traceCall`) that most public
endpoints don't expose, so it's deferred — see "Not yet built" below.

## Phase 5: agent integration — where this codebase first gains the ability to act

Everything before this phase was read-only analysis. Phase 5 wires
`assessTransaction()`'s output into an actual `GuardianVault.proposeTransaction()`
call — but deliberately does NOT wire anything toward `approveTransaction()` or
`executeTransaction()`. Those stay human/admin-only, permanently, not just
"not yet built." An AI agent proposing a bounded, policy-checked transaction
that a human (or the deterministic policy) still has to let through is a
fundamentally different capability than an AI agent moving funds — this
codebase only ever gets the former.

```
src/blockchain/
  walletClient.ts        THE ONLY FILE that constructs a signing account.
                          Read this file + the AGENT_ROLE grants in
                          GuardianVault.sol together to answer "can the AI
                          move funds" — the answer is no, structurally.
  vaultAbi.ts             proposeTransaction + read helpers only — no
                          approve/execute entries exist in this ABI fragment
src/chain/
  proposeOnChain.ts        The only function in the backend that broadcasts a
                            transaction. Simulates first via the public
                            client (catches on-chain-state-drift reverts
                            before spending gas), then sends, waits for the
                            receipt, and decodes TransactionProposed /
                            TransactionBlocked from the logs.
src/risk/
  pipeline.ts               assessAndPropose(): ties Phase 3+4's assessment
                             to Phase 5's propose call, with two independent
                             gates (see below) that a BLOCK decision or a
                             disabled flag can never bypass.
```

### Two gates, both required, neither bypassable by the AI

1. **`ENABLE_ONCHAIN_PROPOSE=true`** — an operator-level env flag. Having
   `AGENT_PRIVATE_KEY` set is not sufficient by itself; env validation
   (`config/env.ts`) actively rejects a config with the flag on but no key,
   or a key but no `GUARDIAN_VAULT_ADDRESS`, at process boot — not at request
   time. Default: **off**. Verified by `src/__tests__/manual-checks.ts`,
   which spawns the process with various env combinations and checks it
   fails to boot exactly when it should.
2. **`assessment.decision !== "BLOCK"`**, checked in `pipeline.ts` before any
   chain interaction is attempted at all. There's no reason to spend gas on
   a call the deterministic `RiskPolicy` will reject anyway, and a BLOCK
   genuinely never reaches `proposeOnChain()` — not "reaches it and gets
   rejected there."

Even past both gates, `proposeOnChain()` simulates the call before sending,
because the deployed `RiskPolicy` re-evaluates independently against
whatever the actual on-chain state is at that moment (registry status,
spending limits, current nonce) — which can differ from what the backend
observed moments earlier. That's not a bug to work around; it's the point of
having the chain be the real authority rather than this backend's opinion.

### Endpoint

`POST /api/propose` — `{ target, value, data, watchedTokens? }`. Runs the
full pipeline. With `ENABLE_ONCHAIN_PROPOSE` off (the default), behaves
identically to `/api/analyze/transaction` plus an `onChainSkippedReason`
field explaining why nothing was sent. `GET /api/propose/status` reports
whether the gate is currently open.

### Not tested end-to-end here

Same limitation as Phase 4: this sandbox can't reach a live RPC, so
`proposeOnChain()`'s actual simulate → send → wait-for-receipt → decode-logs
path isn't exercised against a real chain in this environment. What IS
verified offline: both env-validation gates fire correctly at boot, and
`isOnChainProposeEnabled()` defaults to `false`. The ABI fragment in
`vaultAbi.ts` is hand-transcribed from `IGuardianVault.sol` (documented as
such, same tradeoff as `blockchain/abis.ts`) rather than generated — worth
switching to a generated artifact (like `simulatorArtifact.ts`) if this
drifts.

## Phase 6: monitoring — polling passes, not a persistent listener

Back in the Phase 3 discussion, the plan was to restructure monitoring around
polling/cron instead of a long-lived listener, because Render's free tier
sleeping after 15 minutes of inactivity kills any persistent WebSocket
subscription regardless of memory headroom. That's what's built here:

```
src/monitoring/
  types.ts                   Alert + AlertType (mirrors the spec's 7-type
                              taxonomy: HIGH_RISK_TRANSACTION,
                              UNLIMITED_APPROVAL, SUSPICIOUS_CONTRACT,
                              LARGE_TRANSFER, UPGRADE_DETECTED,
                              POLICY_VIOLATION, WALLET_ANOMALY)
  checkpointStore.ts          "last block scanned" tracking. In-memory by
                              default (documented limitation below);
                              interface is ready for a Postgres-backed swap
  registryEventScanner.ts     Fetches Guardian contract events in a bounded
                              range, then a PURE function (alertsFromLogs)
                              maps decoded logs -> Alert[] — no I/O, fully
                              unit-tested offline
  upgradeDetector.ts           Compares GuardianRegistry's recorded
                              implementation snapshot against a proxy's LIVE
                              storage — this is Scenario D from the spec
                              (a previously-trusted contract silently
                              upgrades) made real, and is exactly what
                              contracts/test/mocks/UpgradeableAttack.sol on
                              the contracts side exists to be tested against
  walletMonitor.ts             Bounded Transfer/Approval log scan for a given
                              wallet + token list — never "this wallet's
                              whole history" (same constraint as
                              walletAnalyzer.ts; an indexer's job, not RPC's)
  alertStore.ts                 Bounded in-memory alert log (caps at 500,
                              same persistence caveat)
  scan.ts                       Orchestrates one bounded pass: events since
                              last checkpoint, upgrade drift, wallet scans
```

**Trigger model**: `POST /api/monitor/scan` runs one pass and returns what it
found. This is meant to be hit by an external scheduler (a Render cron job,
GitHub Actions on a schedule, etc.) — nothing in this codebase runs its own
`setInterval` loop or `watchEvent` subscription. `GET /api/monitor/alerts`
serves the accumulated (bounded, in-memory) alert log.

**Honest limitation, stated once and referenced from both files it applies
to**: the checkpoint store and alert log are in-memory. They reset on every
process restart — including every free-tier wake-from-sleep. That's bounded
and correct (a scan just re-covers `MAX_EVENT_LOOKBACK_BLOCKS` instead of
picking up exactly where it left off, and old alerts are gone rather than
persisted), but it's not as good as real persistence would be. Both files
have a `CheckpointStore`/alert-log interface shaped so a Postgres-backed
implementation can drop in later without touching `scan.ts`.

**Not attempted in Phase 6**: `debug_traceCall`-based deep event decoding for
arbitrary third-party contracts (same RPC-support limitation as Phase 4).
Guardian's own contract events (registry/vault/session) are covered via
normal `eth_getLogs`, which every RPC supports.

## Memory / free-tier constraints (carried forward from earlier discussion)

- No local `anvil` fork for simulation — `transactionAnalyzer.ts` uses
  `eth_call`/`estimateGas` against the public RPC instead, specifically to
  avoid spinning up a full EVM process per request.
- `walletAnalyzer.ts` only checks a *given* list of tokens/spenders — it does
  not scan historical logs across a block range, which would be slow and
  memory-heavy per request. Broad "everything this wallet has ever touched"
  analysis needs an indexer (Phase 6 monitoring), not ad-hoc RPC calls.
- The agent's tool loop is capped at `MAX_TOOL_ROUNDS = 6` — bounded, not
  open-ended.
- Request bodies capped at 256kb.
- Still true from the earlier discussion: if this deploys on Render's free
  tier, the 512MB RAM ceiling probably isn't the binding constraint for this
  workload, but the 15-minute sleep-on-inactivity behavior conflicts with
  Phase 6's "continuous wallet monitoring" requirement — that'll need either
  an always-on instance or a polling/cron restructure when we get there.

## Not yet built (later phases)

- PostgreSQL persistence (currently everything is computed fresh per request;
  Phase 6's checkpoint store and alert log are in-memory for the same reason)
- `/api/chat` conversational endpoint (the agent loop exists in `agent.ts`
  but isn't exposed as a chat route yet)
- `debug_traceCall`-based event/log analysis for arbitrary third-party
  contracts — decoding emitted events from a *simulated* call needs a tracer
  RPC method most public endpoints don't expose; Guardian's own contract
  events (Phase 6) don't need this since they're read via normal
  `eth_getLogs`
- Deliberately, permanently NOT built: any path from this backend to
  `approveTransaction()` or `executeTransaction()`. That's not a gap to fill
  in a later phase — see Phase 5 above.
- Phase 7 (frontend) — not started
