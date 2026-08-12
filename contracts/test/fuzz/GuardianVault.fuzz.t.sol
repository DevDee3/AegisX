// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";
import {GuardianVault} from "../../src/GuardianVault.sol";

contract GuardianVaultFuzzTest is GuardianTestBase {
    /// @dev Any transaction value strictly greater than the configured per-tx max
    ///      must fail execution, for any max/value combination.
    function testFuzz_maxTxValueNeverBypassed(uint96 maxTxValue, uint96 value) public {
        vm.assume(value > maxTxValue);
        vm.assume(maxTxValue > 0);
        vm.deal(address(vault), uint256(value) + 1 ether);

        vm.prank(admin);
        policy.setSpendingLimits(address(vault), maxTxValue, type(uint96).max);

        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), value, "", 0);
        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 5);

        // Only attempt execution if the proposal auto-approved (low risk path);
        // otherwise approve it explicitly so we reach the spending-limit check.
        if (vault.getProposalState(hash) != DataTypes.ProposalState.APPROVED) {
            vm.prank(admin);
            vault.approveTransaction(hash);
        }

        vm.prank(admin);
        vm.expectRevert(GuardianVault.ExceedsMaxTxValue.selector);
        vault.executeTransaction(hash);
    }

    /// @dev A nonce, once consumed (successfully or via a blocked/failed proposal),
    ///      can never be reused for a subsequent proposal.
    function testFuzz_nonceCanNeverBeReused(uint8 numProposals) public {
        numProposals = uint8(bound(numProposals, 1, 20));
        for (uint256 i = 0; i < numProposals; i++) {
            DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", i);
            vm.prank(agent);
            vault.proposeTransaction(req, 5);
        }

        // Replaying any already-consumed nonce must fail.
        DataTypes.TransactionRequest memory replay = _buildRequest(address(trustedRouter), 0, "", 0);
        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(replay, 5);

        assertEq(vault.currentNonce(), numProposals);
    }
}
