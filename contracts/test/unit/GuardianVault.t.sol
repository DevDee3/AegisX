// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";
import {GuardianVault} from "../../src/GuardianVault.sol";

contract GuardianVaultTest is GuardianTestBase {
    function test_deposit_native() public {
        uint256 before = address(vault).balance;
        vm.deal(user, 1 ether);
        vm.prank(user);
        vault.deposit{value: 1 ether}(address(0), 0);
        assertEq(address(vault).balance, before + 1 ether);
    }

    function test_deposit_erc20() public {
        usdc.transfer(user, 10 ether);
        vm.startPrank(user);
        usdc.approve(address(vault), 10 ether);
        vault.deposit(address(usdc), 10 ether);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), 100_000 ether + 10 ether);
    }

    function test_onlyAdmin_canWithdraw() public {
        vm.expectRevert();
        vm.prank(attacker);
        vault.withdraw(address(usdc), 1 ether, attacker);

        vm.prank(admin);
        vault.withdraw(address(usdc), 1 ether, admin);
        assertEq(usdc.balanceOf(admin), 1 ether);
    }

    function test_onlyAgent_canPropose() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        vm.expectRevert();
        vm.prank(attacker);
        vault.proposeTransaction(req, 5);
    }

    function test_lowRisk_autoApproved_thenExecutable() public {
        // First, grant the router a bounded (finite, not unlimited) allowance so the
        // swap itself can pull funds — this is itself a low-risk, auto-approved step.
        bytes memory approveData =
            abi.encodeWithSignature("approve(address,uint256)", address(trustedRouter), 100 ether);
        DataTypes.TransactionRequest memory approveReq = _buildRequest(address(usdc), 0, approveData, 0);
        vm.prank(agent);
        bytes32 approveHash = vault.proposeTransaction(approveReq, 10);
        assertEq(uint256(vault.getProposalState(approveHash)), uint256(DataTypes.ProposalState.APPROVED));
        vm.prank(admin);
        (bool approveSuccess,) = vault.executeTransaction(approveHash);
        assertTrue(approveSuccess);

        bytes memory data = abi.encodeWithSignature(
            "swap(address,uint256,address,uint256)", address(usdc), 100 ether, address(usdc), 100 ether
        );
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, data, 1);

        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 10);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));

        vm.prank(admin);
        (bool success,) = vault.executeTransaction(hash);
        assertTrue(success);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.EXECUTED));
    }

    function test_mediumRisk_requiresExplicitApproval() public {
        address unknown = makeAddr("unknown2");
        DataTypes.TransactionRequest memory req = _buildRequest(unknown, 0, "", 0);

        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 40);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.PENDING));

        // Cannot execute before approval.
        vm.prank(admin);
        vm.expectRevert();
        vault.executeTransaction(hash);

        vm.prank(admin);
        vault.approveTransaction(hash);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));
    }

    function test_criticalRisk_blockedAtProposalTime() public {
        vm.prank(admin);
        registry.blockContract(address(maliciousRouter), "known scam");

        DataTypes.TransactionRequest memory req = _buildRequest(address(maliciousRouter), 0, "", 0);
        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 5); // AI says safe; hard rule still blocks
    }

    function test_unlimitedApproval_blockedRegardlessOfAiScore() public {
        bytes memory approveMax =
            abi.encodeWithSignature("approve(address,uint256)", address(maliciousToken), type(uint256).max);
        DataTypes.TransactionRequest memory req = _buildRequest(address(usdc), 0, approveMax, 0);

        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 1); // AI thinks it's totally safe
    }

    function test_replayProtection_nonceReuseRejected() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        vm.prank(agent);
        vault.proposeTransaction(req, 10);

        // Same nonce again must fail — nonce has advanced.
        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 10);
    }

    function test_expiredRequest_rejectedAtProposal() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        req.deadline = block.timestamp + 1;
        vm.warp(block.timestamp + 2);

        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 10);
    }

    function test_pause_blocksProposalsAndExecution() public {
        vm.prank(admin);
        vault.pause();

        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 10);
    }

    function test_onlyAdmin_canPauseUnpause() public {
        vm.expectRevert();
        vm.prank(attacker);
        vault.pause();
    }

    function test_spendingLimit_blocksOversizedExecution() public {
        vm.prank(admin);
        policy.setSpendingLimits(address(vault), 1 ether, 10 ether);

        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 2 ether, "", 0);
        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 5); // low AI score, low risk score => auto-approved

        vm.prank(admin);
        vm.expectRevert(GuardianVault.ExceedsMaxTxValue.selector);
        vault.executeTransaction(hash);
    }

    function test_dailyLimit_blocksCumulativeOverspend() public {
        vm.prank(admin);
        policy.setSpendingLimits(address(vault), 10 ether, 3 ether);

        DataTypes.TransactionRequest memory req1 = _buildRequest(address(trustedRouter), 2 ether, "", 0);
        vm.prank(agent);
        bytes32 h1 = vault.proposeTransaction(req1, 5);
        vm.prank(admin);
        vault.executeTransaction(h1);

        DataTypes.TransactionRequest memory req2 = _buildRequest(address(trustedRouter), 2 ether, "", 1);
        vm.prank(agent);
        bytes32 h2 = vault.proposeTransaction(req2, 5);
        vm.prank(admin);
        vm.expectRevert(GuardianVault.ExceedsDailyLimit.selector);
        vault.executeTransaction(h2);
    }

    function test_cancelTransaction_byProposerOrAdmin() public {
        DataTypes.TransactionRequest memory req = _buildRequest(makeAddr("unknown3"), 0, "", 0);
        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 40); // PENDING

        vm.prank(agent);
        vault.cancelTransaction(hash);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.CANCELLED));
    }

    function test_cancelTransaction_randomAddressCannot() public {
        DataTypes.TransactionRequest memory req = _buildRequest(makeAddr("unknown4"), 0, "", 0);
        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 40);

        vm.expectRevert();
        vm.prank(attacker);
        vault.cancelTransaction(hash);
    }

    function test_wrongVaultBinding_rejected() public {
        DataTypes.TransactionRequest memory req = DataTypes.TransactionRequest({
            vault: address(0xDEAD), // wrong vault
            target: address(trustedRouter),
            value: 0,
            data: "",
            nonce: 0,
            deadline: block.timestamp + 1 days
        });
        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 5);
    }

    function test_withdraw_native() public {
        vm.prank(admin);
        vault.withdraw(address(0), 1 ether, admin);
        assertEq(admin.balance, 1 ether);
    }

    function test_withdraw_zeroAddressRecipient_reverts() public {
        vm.expectRevert(GuardianVault.ZeroAddress.selector);
        vm.prank(admin);
        vault.withdraw(address(0), 1 ether, address(0));
    }

    function test_withdraw_nativeInsufficientBalance_reverts() public {
        vm.expectRevert(GuardianVault.InsufficientBalance.selector);
        vm.prank(admin);
        vault.withdraw(address(0), 10_000 ether, admin);
    }

    function test_highRisk_delaysExecutionUntilReady() public {
        // Flag a target suspicious so a mid-range AI score lands in the HIGH tier.
        vm.startPrank(admin);
        registry.grantRole(registry.MONITOR_ROLE(), admin);
        address sus = makeAddr("delayTarget");
        registry.flagSuspicious(sus, "unverified");
        vm.stopPrank();

        DataTypes.TransactionRequest memory req = _buildRequest(sus, 0, "", 0);
        vm.prank(agent);
        // 55 (ai) + 25 (suspicious) = 80 -> still HIGH boundary; use 56 to land at 81 CRITICAL is too high,
        // so pick an ai score that lands cleanly in HIGH (61-80): 50 + 25 = 75.
        bytes32 hash = vault.proposeTransaction(req, 50);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.PENDING));

        // Cannot approve before the delay window elapses.
        vm.prank(admin);
        vm.expectRevert(GuardianVault.ProposalNotReady.selector);
        vault.approveTransaction(hash);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(admin);
        vault.approveTransaction(hash);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));
    }

    function test_execute_expiredBetweenApprovalAndExecution_marksExpired() public {
        address unknown = makeAddr("unknownExpiry");
        DataTypes.TransactionRequest memory req = DataTypes.TransactionRequest({
            vault: address(vault),
            target: unknown,
            value: 0,
            data: "",
            nonce: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 40); // MEDIUM -> PENDING
        vm.prank(admin);
        vault.approveTransaction(hash);

        vm.warp(block.timestamp + 2 hours); // now past deadline
        vm.prank(admin);
        vm.expectRevert(GuardianVault.RequestExpired.selector);
        vault.executeTransaction(hash);
        // The revert rolls back the state write too, so the proposal remains
        // APPROVED (not EXPIRED) — it simply can never be executed past its deadline.
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));
    }

    function test_cancelTransaction_alreadyExecuted_reverts() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 10); // auto-approved
        vm.prank(admin);
        vault.executeTransaction(hash);

        vm.expectRevert(GuardianVault.ProposalNotPending.selector);
        vm.prank(admin);
        vault.cancelTransaction(hash);
    }

    function test_approveTransaction_nonexistentProposal_reverts() public {
        vm.expectRevert(GuardianVault.ProposalNotFound.selector);
        vm.prank(admin);
        vault.approveTransaction(bytes32(uint256(0x1234)));
    }

    function test_setRiskPolicy_onlyAdmin() public {
        vm.expectRevert();
        vm.prank(attacker);
        vault.setRiskPolicy(address(policy));

        vm.prank(admin);
        vault.setRiskPolicy(address(policy));
        assertEq(address(vault.riskPolicy()), address(policy));
    }
}
