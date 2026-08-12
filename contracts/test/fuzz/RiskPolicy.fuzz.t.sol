// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";

contract RiskPolicyFuzzTest is GuardianTestBase {
    /// @dev Final score is always within [0,100] regardless of AI input.
    function testFuzz_finalScoreAlwaysBounded(uint256 aiScore, bool unlimitedApproval) public view {
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, aiScore, unlimitedApproval);
        assertLe(a.finalScore, 100);
    }

    /// @dev Unlimited approval must ALWAYS resolve to BLOCK, no matter the AI score
    ///      or which (non-blocked) registry tier the target is in.
    function testFuzz_unlimitedApprovalAlwaysBlocks(uint256 aiScore, uint8 statusSeed) public {
        aiScore = bound(aiScore, 0, 100);
        address target = makeAddr(string(abi.encodePacked("fuzzTarget", statusSeed)));

        vm.startPrank(admin);
        if (statusSeed % 3 == 0) {
            registry.addTrustedContract(target);
        } else if (statusSeed % 3 == 1) {
            registry.grantRole(registry.MONITOR_ROLE(), admin);
            registry.flagSuspicious(target, "fuzz");
        }
        // else leave UNKNOWN
        vm.stopPrank();

        DataTypes.TransactionRequest memory req = _buildRequest(target, 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, aiScore, true);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.BLOCK));
    }

    /// @dev A blocked target always resolves to BLOCK regardless of AI score.
    function testFuzz_blockedTargetAlwaysBlocks(uint256 aiScore) public {
        aiScore = bound(aiScore, 0, 100);
        address target = makeAddr("fuzzBlocked");
        vm.prank(admin);
        registry.blockContract(target, "fuzz block");

        DataTypes.TransactionRequest memory req = _buildRequest(target, 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, aiScore, false);
        assertEq(uint256(a.decision), uint256(DataTypes.Decision.BLOCK));
    }

    /// @dev Monotonicity: for a trusted target with no hard rules, a strictly higher
    ///      AI input never produces a strictly lower final score.
    function testFuzz_scoreMonotonicInAiInput(uint256 lowInput, uint256 highDelta) public view {
        lowInput = bound(lowInput, 0, 90);
        highDelta = bound(highDelta, 0, 100 - lowInput);
        uint256 highInput = lowInput + highDelta;

        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, "", 0);
        DataTypes.RiskAssessment memory lowA = policy.evaluate(req, lowInput, false);
        DataTypes.RiskAssessment memory highA = policy.evaluate(req, highInput, false);
        assertGe(highA.finalScore, lowA.finalScore);
    }
}
