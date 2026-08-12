// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GuardianVault} from "../../src/GuardianVault.sol";
import {RiskPolicy} from "../../src/RiskPolicy.sol";
import {GuardianRegistry} from "../../src/GuardianRegistry.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";
import {MockRouter} from "../mocks/MockRouter.sol";

/// @dev Drives the vault through its legitimate, authorized entrypoints only
///      (propose as the agent, approve/execute/cancel/pause as the admin) so that
///      invariants can assert nothing ever escapes the authorized paths.
contract GuardianVaultHandler is Test {
    GuardianVault public vault;
    RiskPolicy public policy;
    GuardianRegistry public registry;
    MockRouter public router;
    address public admin;
    address public agent;

    bytes32[] public proposedHashes;

    uint256 public ghost_successfulExecutions;
    uint256 public ghost_blockedProposalAttempts;

    constructor(
        GuardianVault vault_,
        RiskPolicy policy_,
        GuardianRegistry registry_,
        MockRouter router_,
        address admin_,
        address agent_
    ) {
        vault = vault_;
        policy = policy_;
        registry = registry_;
        router = router_;
        admin = admin_;
        agent = agent_;
    }

    function propose(uint256 aiScoreSeed, uint256 valueSeed) external {
        uint256 aiScore = bound(aiScoreSeed, 0, 100);
        uint256 value = bound(valueSeed, 0, 1 ether);

        DataTypes.TransactionRequest memory req = DataTypes.TransactionRequest({
            vault: address(vault),
            target: address(router),
            value: value,
            data: "",
            nonce: vault.currentNonce(),
            deadline: block.timestamp + 1 days
        });

        vm.prank(agent);
        try vault.proposeTransaction(req, aiScore) returns (bytes32 hash) {
            proposedHashes.push(hash);
        } catch {
            ghost_blockedProposalAttempts++;
        }
    }

    function approveAndExecute(uint256 idxSeed) external {
        if (proposedHashes.length == 0) return;
        bytes32 hash = proposedHashes[idxSeed % proposedHashes.length];

        DataTypes.ProposalState state = vault.getProposalState(hash);
        if (state == DataTypes.ProposalState.PENDING) {
            vm.prank(admin);
            try vault.approveTransaction(hash) {} catch {}
            state = vault.getProposalState(hash);
        }
        if (state == DataTypes.ProposalState.APPROVED) {
            vm.prank(admin);
            try vault.executeTransaction(hash) returns (bool success, bytes memory) {
                if (success) ghost_successfulExecutions++;
            } catch {}
        }
    }

    function pauseToggle() external {
        bool isPaused = vault.paused();
        vm.prank(admin);
        if (isPaused) {
            vault.unpause();
        } else {
            vault.pause();
        }
    }

    function proposalCount() external view returns (uint256) {
        return proposedHashes.length;
    }
}
