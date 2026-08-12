// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GuardianRegistry} from "../src/GuardianRegistry.sol";
import {RiskPolicy} from "../src/RiskPolicy.sol";
import {GuardianVault} from "../src/GuardianVault.sol";
import {GuardianSession} from "../src/GuardianSession.sol";
import {GuardianSecurityModule} from "../src/GuardianSecurityModule.sol";

/// @notice Phase 8 deployment script for the core AegisX system. Deploys the
///         five core contracts and wires them together exactly the way
///         GuardianTestBase.sol does in the test suite — this script is the
///         production analog of that test setup, kept deliberately close to
///         it so "does the deployed system match what 99 tests already
///         proved correct" is an easy question to answer by diffing the two.
///
/// Usage (Fuji testnet):
///   forge script script/Deploy.s.sol:DeployCore \
///     --rpc-url fuji \
///     --broadcast \
///     --verify \
///     -vvvv
///
/// Required env vars (see contracts/.env.example):
///   DEPLOYER_PRIVATE_KEY   — the admin/deployer key. Holds VAULT_ADMIN_ROLE,
///                            REGISTRY_ADMIN_ROLE, POLICY_ADMIN_ROLE etc.
///                            after deployment. This is NOT the backend's
///                            AGENT_PRIVATE_KEY from Phase 5 — keep them
///                            separate, exactly like the deployed system's
///                            own role separation requires.
///   SNOWTRACE_API_KEY     — only needed if you pass --verify.
///
/// NEVER run this against `avalanche` (mainnet) until the contracts have had
/// an actual security review — see the original spec's section 33
/// (Deployment) and 18 (never deploy malicious mocks to mainnet, which this
/// script doesn't touch — see DeployMocks.s.sol for those, Fuji-only).
contract DeployCore is Script {
    // Conservative starting policy — tune after watching real Fuji activity.
    uint256 constant DEFAULT_MAX_TX_VALUE = 1 ether; // ~ "$1,000"-equivalent placeholder in native AVAX terms
    uint256 constant DEFAULT_DAILY_LIMIT = 5 ether;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deploying AegisX core system");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        GuardianRegistry registry = new GuardianRegistry(deployer);
        console.log("GuardianRegistry:", address(registry));

        RiskPolicy policy = new RiskPolicy(deployer, address(registry));
        console.log("RiskPolicy:", address(policy));

        GuardianVault vault = new GuardianVault(deployer, address(policy));
        console.log("GuardianVault:", address(vault));

        GuardianSession session = new GuardianSession(deployer);
        console.log("GuardianSession:", address(session));

        GuardianSecurityModule securityModule = new GuardianSecurityModule(deployer);
        console.log("GuardianSecurityModule:", address(securityModule));

        // Wire session enforcement into the vault (opt-in — see
        // GuardianVault.setSession; the vault runs fine without this, but the
        // demo story wants a bounded agent from the start).
        vault.setSession(address(session));

        // Grant the security module the same admin-level roles a human admin
        // holds, so it can act (pause / revoke / emergency-withdraw) without
        // ever being handed the underlying private key — mirrors
        // GuardianTestBase.sol's setUp() exactly.
        vault.grantRole(vault.VAULT_ADMIN_ROLE(), address(securityModule));
        session.grantRole(session.SESSION_ADMIN_ROLE(), address(securityModule));

        // Conservative starting spending limits. These are NOT hardcoded
        // policy — RiskPolicy.setSpendingLimits can be re-called later, and
        // per Phase 2, changing them post-deployment should go through
        // GuardianSecurityModule's 24h timelock rather than a direct admin
        // call, once the security module is the intended long-term operator.
        policy.setSpendingLimits(address(vault), DEFAULT_MAX_TX_VALUE, DEFAULT_DAILY_LIMIT);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment complete ===");
        console.log("Set these in backend/.env:");
        console.log("  GUARDIAN_REGISTRY_ADDRESS=", address(registry));
        console.log("  GUARDIAN_VAULT_ADDRESS=", address(vault));
        console.log("Set these in frontend/.env.local:");
        console.log("  NEXT_PUBLIC_GUARDIAN_REGISTRY_ADDRESS=", address(registry));
        console.log("  NEXT_PUBLIC_GUARDIAN_VAULT_ADDRESS=", address(vault));
        console.log("Also record (not printed to a .env, used directly by scripts/ops):");
        console.log("  GuardianSession:", address(session));
        console.log("  GuardianSecurityModule:", address(securityModule));
    }
}
