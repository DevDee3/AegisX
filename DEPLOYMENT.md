# AegisX — Phase 8: Fuji Deployment & Live Demo Runbook

Phases 1-7 built and unit-tested every piece in isolation (contracts via
Foundry, backend via offline TS checks). Phase 8 is not more code — it's
proving the whole system works together against a real deployed testnet,
per the original spec's phased plan (section 35, Phase 8: "Deploy safe and
intentionally malicious test contracts to a controlled environment.
Demonstrate Guardian successfully blocking attacks.").

This sandbox has no outbound access to Fuji's RPC, so the steps below
couldn't be executed live from here — but every script referenced has been
run and verified end-to-end against a local Foundry `anvil` node (see the
`contracts/script/*.s.sol` doc comments and this project's chat history for
the verification runs), including confirming the mainnet guard in
`DeployMocks.s.sol` actually reverts rather than just being a comment. What
follows is the exact sequence to run for real, on Fuji.

## Prerequisites

- A funded Fuji deployer wallet. Get testnet AVAX from the
  [Avalanche Fuji faucet](https://core.app/tools/testnet-faucet/).
- `foundryup` installed locally (this repo's `contracts/foundry.toml` pins a
  local solc path specific to the sandbox this was built in — remove the
  `solc = "/root/.solc/solc-0.8.35"` line in your own environment and let
  `forge build` fetch solc normally).
- Node 20+ for the backend and frontend.

## Step 1 — Deploy the core system

```bash
cd contracts
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY
source .env
forge script script/Deploy.s.sol:DeployCore --rpc-url fuji --broadcast --verify -vvvv
```

Record the five printed addresses (Registry, RiskPolicy, Vault, Session,
SecurityModule). `DeployCore` also wires them together exactly the way
`GuardianTestBase.sol` does for the test suite, and sets conservative
starting spending limits (1 AVAX per tx, 5 AVAX/day — tune after watching
real activity).

## Step 2 — Deploy the demo + attack mocks (Fuji only)

```bash
export REGISTRY_ADDRESS=<from step 1>
forge script script/DeployMocks.s.sol:DeployMocks --rpc-url fuji --broadcast -vvvv
```

This deploys the benign demo pair (a mock USDC + a mock trusted router) and
all five attack mocks from Phase 1
(`MaliciousToken`/`MaliciousRouter`/`ApprovalAttack`/`UpgradeableAttack`/
`HiddenMintToken`), and pre-classifies the registry: the trusted router is
marked TRUSTED, the malicious router is marked BLOCKED — matching Scenario
A/B's starting conditions from the spec so the demo doesn't need a manual
registry step. **This script hard-reverts if pointed at mainnet (chain ID
43114)** — verified, not just documented.

## Step 3 — Connect the backend's agent key

The backend's `AGENT_PRIVATE_KEY` (Phase 5) has no on-chain authority until
you explicitly grant it:

```bash
export VAULT_ADDRESS=<from step 1>
export SESSION_ADDRESS=<from step 1>
export AGENT_ADDRESS=<public address matching backend's AGENT_PRIVATE_KEY>
forge script script/ConfigureAgent.s.sol:ConfigureAgent --rpc-url fuji --broadcast -vvvv
```

This grants `AGENT_ROLE` on the vault and creates a `GuardianSession` for
that address — deliberately with an **empty** allowed-contracts list. Add
the trusted router explicitly afterward (the script prints the exact `cast
send` command), rather than defaulting to "allow everything," which would
quietly defeat the point of Phase 2's session bounding.

## Step 4 — Wire the backend

```bash
cd ../backend
cp .env.example .env
```

Fill in:
```
GUARDIAN_REGISTRY_ADDRESS=<step 1>
GUARDIAN_VAULT_ADDRESS=<step 1>
AGENT_PRIVATE_KEY=<the key behind AGENT_ADDRESS from step 3>
ENABLE_ONCHAIN_PROPOSE=true
GEMINI_API_KEY=<your key, for real AI analysis instead of deterministic-only>
```

```bash
npm install && npm run dev
```

Confirm `GET /api/propose/status` now returns `{"onChainProposeEnabled":true}`.

## Step 5 — Wire the frontend

```bash
cd ../frontend
cp .env.example .env.local
```

Fill in the backend URL and the deployed addresses (see
`frontend/.env.example`), then `npm install && npm run dev`.

## Step 6 — Walk the five scenarios for real

With everything above running against live Fuji contracts:

| Scenario | What to do | Expected result |
|---|---|---|
| A — safe trusted swap | Propose a small swap through the deployed mock trusted router | LOW risk, ALLOW, executes after admin approval |
| B — unlimited approval | Propose `approve(maliciousRouter, type(uint256).max)` | Hard-blocked at `proposeTransaction` — reverts on-chain, never reaches PENDING |
| C — unknown contract | Propose a call to `HiddenMintToken` (deployed UNKNOWN) | MEDIUM risk, REQUIRE_APPROVAL |
| D — silent upgrade | Call `UpgradeableAttack.upgradeTo(maliciousRouter)` yourself, then trigger `POST /api/monitor/scan` | `UPGRADE_DETECTED` alert appears, once a registry snapshot was recorded for it first |
| E — AI says safe, limit blocks anyway | Propose a large-value transfer through the trusted router (over the 1 AVAX default limit) | AI may score it low; vault's spending limit still rejects at execute time |

Each of these has an exact Foundry-test analog already proven in
`contracts/test/integration/SecurityScenarios.t.sol` — Phase 8 is running
the same logic live rather than proving new logic.

## What Phase 8 deliberately does not do

- No mainnet deployment. Nothing in this runbook or the scripts it
  references touches `avalanche` (mainnet) — see the original spec's
  section 33 and `DeployMocks.s.sol`'s hard guard.
- No automated end-to-end test suite running against live Fuji from CI —
  that's a reasonable next step but wasn't built here; this runbook is a
  manual walkthrough.
