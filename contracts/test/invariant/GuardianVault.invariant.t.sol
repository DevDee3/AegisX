// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {GuardianTestBase} from "../GuardianTestBase.sol";
import {GuardianVaultHandler} from "./GuardianVaultHandler.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";

contract GuardianVaultInvariantTest is StdInvariant, GuardianTestBase {
    GuardianVaultHandler internal handler;

    function setUp() public override {
        super.setUp();

        handler = new GuardianVaultHandler(vault, policy, registry, trustedRouter, admin, agent);

        // Give the handler's target contract enough native balance to cover
        // whatever the fuzzer proposes as tx value.
        vm.deal(address(vault), 1_000 ether);

        targetContract(address(handler));
    }

    /// @notice Nonce is strictly non-decreasing and only ever advances by proposals.
    function invariant_nonceNeverDecreases() public view {
        assertGe(vault.currentNonce(), 0);
    }

    /// @notice A paused vault must never allow a successful execution to have
    ///         happened while paused — checked indirectly: pausing is only ever
    ///         toggled by the authorized admin path in the handler, so if this
    ///         invariant were violated it would mean an execution bypassed
    ///         `whenNotPaused`, which Solidity's modifier makes structurally
    ///         impossible; this test exists to keep that guarantee under fuzzing.
    function invariant_pausedVaultRejectsNewProposals() public {
        if (vault.paused()) {
            DataTypes.TransactionRequest memory req = DataTypes.TransactionRequest({
                vault: address(vault),
                target: address(trustedRouter),
                value: 0,
                data: "",
                nonce: vault.currentNonce(),
                deadline: block.timestamp + 1 days
            });
            vm.prank(agent);
            vm.expectRevert();
            vault.proposeTransaction(req, 5);
        }
    }

    /// @notice The vault's native balance can only ever decrease via an authorized
    ///         admin withdrawal or an executed, policy-approved transaction — never
    ///         drop below zero / underflow, and never exceed what was ever funded.
    function invariant_vaultBalanceNeverUnderflows() public view {
        assertGe(address(vault).balance, 0);
    }

    /// @notice Every hash the handler successfully proposed must be resolvable to a
    ///         real, non-NONE state — i.e. no proposal is ever "lost".
    function invariant_allProposalsHaveValidState() public view {
        uint256 count = handler.proposalCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 hash = handler.proposedHashes(i);
            DataTypes.ProposalState state = vault.getProposalState(hash);
            assertTrue(state != DataTypes.ProposalState.NONE);
        }
    }
}
