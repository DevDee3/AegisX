// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GuardianVault} from "../src/GuardianVault.sol";
import {GuardianSession} from "../src/GuardianSession.sol";

/// @notice Connects Phase 5's backend agent key to the deployed contracts.
///         Without this script, the backend's AGENT_PRIVATE_KEY (see
///         backend/README.md's Phase 5 section) can't call
///         proposeTransaction() at all — GuardianVault.proposeTransaction is
///         onlyRole(AGENT_ROLE), and nothing grants that role automatically
///         at deploy time. This is deliberate (see DeployCore's doc comment:
///         core deployment and agent authorization are separate, reviewable
///         steps) but it means this script is not optional — skipping it
///         leaves the backend's propose path permanently reverting.
///
/// Usage (after DeployCore and, optionally, DeployMocks):
///   forge script script/ConfigureAgent.s.sol:ConfigureAgent \
///     --rpc-url fuji --broadcast -vvvv
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY   — must hold VAULT_ADMIN_ROLE / SESSION_ADMIN_ROLE
///                            (i.e. the same key DeployCore used)
///   VAULT_ADDRESS           — from DeployCore's output
///   SESSION_ADDRESS         — from DeployCore's output
///   AGENT_ADDRESS            — the PUBLIC address corresponding to backend's
///                            AGENT_PRIVATE_KEY (derive it locally, e.g.
///                            `cast wallet address --private-key $KEY` —
///                            never pass the private key itself to this
///                            script or put it in this repo's env)
///   AGENT_MAX_TX_VALUE       — optional, defaults to 0.1 ether
///   AGENT_DAILY_LIMIT        — optional, defaults to 0.5 ether
///
/// The session's allowed-contracts list starts EMPTY on purpose — an agent
/// with a session but no allowed targets can propose to precisely nothing.
/// Add trusted demo targets explicitly (see the console output this script
/// prints) rather than defaulting to "allow everything," which would quietly
/// undermine the whole point of GuardianSession.
contract ConfigureAgent is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");
        address sessionAddress = vm.envAddress("SESSION_ADDRESS");
        address agentAddress = vm.envAddress("AGENT_ADDRESS");
        uint256 maxTxValue = vm.envOr("AGENT_MAX_TX_VALUE", uint256(0.1 ether));
        uint256 dailyLimit = vm.envOr("AGENT_DAILY_LIMIT", uint256(0.5 ether));

        GuardianVault vault = GuardianVault(payable(vaultAddress));
        GuardianSession session = GuardianSession(sessionAddress);

        console.log("Configuring agent:", agentAddress);
        console.log("  maxTxValue:", maxTxValue);
        console.log("  dailyLimit:", dailyLimit);

        vm.startBroadcast(deployerKey);

        vault.grantRole(vault.AGENT_ROLE(), agentAddress);

        address[] memory noContractsYet = new address[](0);
        address[] memory noTokensYet = new address[](0);
        session.createSession(agentAddress, maxTxValue, dailyLimit, 30 days, noContractsYet, noTokensYet);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Agent configured ===");
        console.log("AGENT_ROLE granted on GuardianVault.");
        console.log("Session created with an EMPTY allowed-contracts list.");
        console.log("Next: allow specific demo targets, e.g. (cast send):");
        console.log("  target contract:", sessionAddress);
        console.log("  function: setAllowedContract(address,address)");
        console.log("  args: agent =", agentAddress);
    }
}
