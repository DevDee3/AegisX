// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";

contract RiskPolicyTest is GuardianTestBase {
    function test_lowRisk_trustedTarget_allows() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 10, false);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.ALLOW));
        assertEq(uint256(a.level), uint256(DataTypes.RiskLevel.LOW));
        assertFalse(a.hardRuleTriggered);
    }

    function test_unknownTarget_addsPenalty_requiresApproval() public {
        address unknown = makeAddr("unknown");
        DataTypes.TransactionRequest memory req = _buildRequest(unknown, 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 40, false);
        // 40 + 15 (unknown) = 55 -> MEDIUM -> REQUIRE_APPROVAL
        assertEq(a.finalScore, 55);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.REQUIRE_APPROVAL));
    }

    function test_blockedTarget_alwaysBlocksRegardlessOfAiScore() public {
        vm.prank(admin);
        registry.blockContract(address(maliciousRouter), "known scam");

        DataTypes.TransactionRequest memory req = _buildRequest(address(maliciousRouter), 0, "", 0);
        // Even if the AI says it's perfectly safe (score 0), the hard rule wins.
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 0, false);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.BLOCK));
        assertTrue(a.hardRuleTriggered);
    }

    function test_unlimitedApproval_alwaysBlocks_evenWithLowAiScore() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(maliciousToken), 0, "", 0);
        // AI says totally safe (score 5) but the deterministic unlimited-approval
        // rule must still force a BLOCK. This is the core "AI recommendation !=
        // authorization" guarantee.
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 5, true);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.BLOCK));
        assertTrue(a.hardRuleTriggered);
    }

    function test_expiredRequest_blocks() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        req.deadline = block.timestamp; // will be expired once we warp
        vm.warp(block.timestamp + 1);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 5, false);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.BLOCK));
        assertTrue(a.hardRuleTriggered);
    }

    function test_trustedTarget_getsDiscount() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 50, false);
        // 50 - 20 (trusted discount) = 30 -> LOW
        assertEq(a.finalScore, 30);
        assertEq(uint256(a.level), uint256(DataTypes.RiskLevel.LOW));
    }

    function test_suspiciousTarget_addsPenalty() public {
        address sus = makeAddr("sus");
        bytes32 monitorRole = registry.MONITOR_ROLE();
        vm.startPrank(admin);
        registry.grantRole(monitorRole, admin);
        registry.flagSuspicious(sus, "unverified source code");
        vm.stopPrank();

        DataTypes.TransactionRequest memory req = _buildRequest(sus, 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 40, false);
        // 40 + 25 = 65 -> HIGH -> DELAY
        assertEq(a.finalScore, 65);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.DELAY));
    }

    function test_aiScoreIsClampedTo100() public {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 999, false);
        assertLe(a.finalScore, 100);
    }

    function test_onlyPolicyAdmin_canSetThresholds() public {
        vm.expectRevert();
        vm.prank(attacker);
        policy.setThresholds(10, 20, 30);

        vm.prank(admin);
        policy.setThresholds(20, 50, 75);
        assertEq(policy.lowMax(), 20);
    }

    function test_setThresholds_rejectsInvalidOrdering() public {
        vm.prank(admin);
        vm.expectRevert(); // lowMax >= mediumMax
        policy.setThresholds(50, 40, 80);
    }

    function test_onlyPolicyAdmin_canSetSpendingLimits() public {
        vm.expectRevert();
        vm.prank(attacker);
        policy.setSpendingLimits(address(vault), 1 ether, 5 ether);

        vm.prank(admin);
        policy.setSpendingLimits(address(vault), 1 ether, 5 ether);
        (uint256 maxTx, uint256 daily) = policy.getSpendingLimits(address(vault));
        assertEq(maxTx, 1 ether);
        assertEq(daily, 5 ether);
    }
}
