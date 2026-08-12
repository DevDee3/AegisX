// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockRouter} from "../test/mocks/MockRouter.sol";
import {MaliciousToken} from "../test/mocks/MaliciousToken.sol";
import {MaliciousRouter} from "../test/mocks/MaliciousRouter.sol";
import {ApprovalAttack} from "../test/mocks/ApprovalAttack.sol";
import {UpgradeableAttack} from "../test/mocks/UpgradeableAttack.sol";
import {HiddenMintToken} from "../test/mocks/HiddenMintToken.sol";
import {GuardianRegistry} from "../src/GuardianRegistry.sol";

/// @notice Deploys the demo token/router pair AND the malicious attack
///         contracts used to run the Phase 8 security demonstration for
///         real, on Fuji. This is the on-chain analog of GuardianTestBase's
///         mock deployment — same contracts, same relationships, just
///         actually deployed instead of spun up in a Foundry test.
///
/// HARD GUARD: this script reverts immediately if run against chain ID 43114
/// (Avalanche mainnet). Per the original spec section 18: malicious mocks are
/// "strictly for local/Fuji test environments and educational demonstrations"
/// and must NEVER reach mainnet — that constraint is enforced here in code,
/// not just left as a comment for a human to remember.
///
/// Usage:
///   forge script script/DeployMocks.s.sol:DeployMocks \
///     --rpc-url fuji --broadcast -vvvv
///
/// Requires DEPLOYER_PRIVATE_KEY and REGISTRY_ADDRESS (from DeployCore's
/// output) in the environment.
contract DeployMocks is Script {
    uint256 constant AVALANCHE_MAINNET_CHAIN_ID = 43114;

    function run() external {
        require(block.chainid != AVALANCHE_MAINNET_CHAIN_ID, "DeployMocks: refusing to deploy attack mocks to mainnet");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address registryAddress = vm.envAddress("REGISTRY_ADDRESS");

        console.log("Deploying AegisX demo + attack mocks (chain", block.chainid, ")");

        vm.startBroadcast(deployerKey);

        // --- Benign demo pair: trusted swap path for Scenario A ---
        MockERC20 usdc = new MockERC20("Demo USD Coin", "dUSDC");
        MockRouter trustedRouter = new MockRouter();
        usdc.mint(address(trustedRouter), 1_000_000 ether); // liquidity for the mock 1:1 swap-out leg
        console.log("MockERC20 (dUSDC):", address(usdc));
        console.log("MockRouter (trusted):", address(trustedRouter));

        // --- Attack mocks for Scenarios B-E and the malicious-contract tests ---
        MaliciousToken maliciousToken = new MaliciousToken();
        MaliciousRouter maliciousRouter = new MaliciousRouter(deployer); // "attacker" = deployer for demo visibility
        ApprovalAttack approvalAttack = new ApprovalAttack(deployer);
        UpgradeableAttack upgradeableAttack = new UpgradeableAttack(address(trustedRouter));
        HiddenMintToken hiddenMintToken = new HiddenMintToken();
        console.log("MaliciousToken:", address(maliciousToken));
        console.log("MaliciousRouter:", address(maliciousRouter));
        console.log("ApprovalAttack:", address(approvalAttack));
        console.log("UpgradeableAttack:", address(upgradeableAttack));
        console.log("HiddenMintToken:", address(hiddenMintToken));

        // --- Wire the registry so the demo has a TRUSTED and a BLOCKED target
        //     from the start, matching Scenario A / Scenario B's starting
        //     conditions in the spec rather than requiring a manual step. ---
        GuardianRegistry registry = GuardianRegistry(registryAddress);
        registry.addTrustedContract(address(trustedRouter));
        registry.blockContract(address(maliciousRouter), "demo: known scam router, pre-blocked for Scenario B");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Mock deployment complete ===");
        console.log("trustedRouter is TRUSTED in the registry (Scenario A / C reference point)");
        console.log("maliciousRouter is BLOCKED in the registry (Scenario B reference point)");
        console.log("maliciousToken, approvalAttack, upgradeableAttack, hiddenMintToken are UNKNOWN");
        console.log("(deliberately left unclassified so Scenario C's 'unknown contract' story works)");
    }
}
