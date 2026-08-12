# AegisX — Contracts (Phase 1: Smart Contract Foundation)

AI-powered programmable security layer for Avalanche wallets. This package covers
Phase 1 of the build: the deterministic on-chain foundation that the AI agent
(Phase 3+) will sit behind, never in front of.

## Core principle

    AI            = analysis / reasoning only
    Smart contract = deterministic enforcement
    Frontend/backend = orchestration

The AI-supplied risk score is ONE input to `RiskPolicy.evaluate()`. Hard rules
(blocklisted target, unlimited approval, expired request, spending limits) are
enforced independently and can never be overridden by a favorable AI score.

## Contracts (`src/`)

| Contract              | Responsibility |
|------------------------|----------------|
| `GuardianVault.sol`     | Holds assets; mediates every outbound call through propose → (approve) → execute; nonce + deadline replay protection; spending limits; pause; optional session enforcement |
| `GuardianRegistry.sol`  | TRUSTED / UNKNOWN / SUSPICIOUS / BLOCKED classification for target contracts; implementation-snapshot tracking for upgrade detection |
| `RiskPolicy.sol`        | Deterministic risk engine combining AI score + registry status + hard rules into a final ALLOW / REQUIRE_APPROVAL / DELAY / BLOCK decision |
| `GuardianSession.sol`   | Bounded per-agent session permissions (max tx value, daily limit, contract/token allow-lists, expiry) — caps blast radius of a compromised AI/agent key, enforced independently of RiskPolicy |
| `GuardianSecurityModule.sol` | Emergency responder actions (pause/unpause, revoke session, emergency withdraw to a specified recipient) plus a 24h timelock for sensitive config changes (e.g. spending limits, thresholds) |
| `simulation/TransactionSimulator.sol` | Stateless helper for balance-diff simulation. Never deployed for real — the backend injects its runtime bytecode via `eth_call` state-override at the vault's own address, so a sub-call to `target` preserves real `msg.sender` semantics without a local fork (see backend/README.md) |
| `libraries/DataTypes.sol` | Shared structs/enums |
| `interfaces/`            | `IGuardianVault`, `IGuardianRegistry`, `IRiskPolicy`, `IGuardianSession` |

## Malicious test contracts (`test/mocks/`)

`MaliciousToken`, `HiddenMintToken`, `MaliciousRouter`, `ApprovalAttack`,
`UpgradeableAttack` — intentionally malicious contracts used to prove Guardian's
hard rules actually stop real attack patterns. **Never deploy these to mainnet.**

## Tests (99 passing)

```
test/unit/            RiskPolicy, GuardianRegistry, GuardianVault, GuardianSession,
                       GuardianSecurityModule, TransactionSimulator unit tests
test/integration/     The 5 canonical demo scenarios (A-E) from the spec, attack-
                       scenario tests using the malicious mocks, and session-
                       enforcement wiring tests (vault + session + security module
                       working together, not in isolation)
test/fuzz/             Bounded-invariant fuzz tests (score bounds, monotonicity,
                       unlimited-approval always blocks, nonce non-reuse, spending
                       limit never bypassed)
test/invariant/        Stateful invariant tests driven by GuardianVaultHandler
                       (128 runs x 8192 calls, zero unexpected reverts)
```

Run:
```bash
forge build
forge test
forge coverage --report summary
```

Coverage (lines): RiskPolicy 100%, GuardianVault 94.2%, GuardianSession 93.3%,
GuardianSecurityModule 93.0%, GuardianRegistry 94.6%.

## Environment note

This box's network doesn't reach Foundry's default solc host
(`binaries.soliditylang.org`), so `foundry.toml` pins `solc` to a locally
downloaded binary at `/root/.solc/solc-0.8.35`. In a normal dev environment,
just run `foundryup` and drop that `solc =` line from `foundry.toml`.

## Deployment (Phase 8)

`script/` contains `Deploy.s.sol` (core system), `DeployMocks.s.sol` (demo +
attack mocks, hard-guarded against mainnet), and `ConfigureAgent.s.sol`
(grants the backend's Phase 5 agent key `AGENT_ROLE` + a bounded session).
All three are verified end-to-end against local `anvil` — see the repo-root
`DEPLOYMENT.md` for the full Fuji walkthrough.

## Not yet built (later phases, per the original spec)

- TransactionExecutor.sol as a separate contract (currently execution lives in
  GuardianVault directly — revisit if a dedicated executor is wanted for
  upgradeability)
- An automated end-to-end test suite running against live Fuji from CI (the
  deployment scripts are verified against local anvil; DEPLOYMENT.md's
  scenario walkthrough is currently a manual process)
