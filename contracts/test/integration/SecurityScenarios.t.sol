// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";
import {GuardianVault} from "../../src/GuardianVault.sol";

/// @notice End-to-end reproductions of the five canonical demo scenarios:
///         A) safe trusted-protocol swap -> ALLOW
///         B) unlimited approval to a malicious contract -> BLOCK
///         C) unknown contract -> REQUIRE_APPROVAL
///         D) previously-trusted contract silently upgrades -> flagged
///         E) AI says safe but spending limit still rejects -> BLOCK
contract SecurityScenariosTest is GuardianTestBase {
    function test_scenarioA_safeTrustedSwap_allowsAndExecutes() public {
        // Bounded approval so the router can pull funds for the swap leg.
        bytes memory approveData =
            abi.encodeWithSignature("approve(address,uint256)", address(trustedRouter), 50 ether);
        vm.prank(agent);
        bytes32 approveHash = vault.proposeTransaction(_buildRequest(address(usdc), 0, approveData, 0), 10);
        vm.prank(admin);
        vault.executeTransaction(approveHash);

        bytes memory data = abi.encodeWithSignature(
            "swap(address,uint256,address,uint256)", address(usdc), 50 ether, address(usdc), 50 ether
        );
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 0, data, 1);

        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 12); // AI: low risk

        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));

        vm.prank(admin);
        (bool success,) = vault.executeTransaction(hash);
        assertTrue(success);
    }

    function test_scenarioB_unlimitedApprovalToMaliciousContract_isBlocked() public {
        bytes memory approveMax =
            abi.encodeWithSignature("approve(address,uint256)", address(maliciousRouter), type(uint256).max);
        DataTypes.TransactionRequest memory req = _buildRequest(address(usdc), 0, approveMax, 0);

        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 8); // AI severely underestimates risk; irrelevant
    }

    function test_scenarioC_unknownContract_requiresUserConfirmation() public {
        address unknownDex = makeAddr("unknownDex");
        DataTypes.TransactionRequest memory req = _buildRequest(unknownDex, 0, "", 0);

        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 37);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.PENDING));
    }

    function test_scenarioD_upgradeDetected_viaImplementationSnapshotMismatch() public {
        // Guardian previously trusted this proxy and recorded its implementation.
        vm.startPrank(admin);
        registry.addTrustedContract(address(upgradeableAttack));
        registry.grantRole(registry.MONITOR_ROLE(), admin);
        registry.recordImplementation(address(upgradeableAttack), address(trustedRouter));
        vm.stopPrank();

        address previousImpl = registry.getRecordedImplementation(address(upgradeableAttack));

        // Contract owner silently swaps the implementation.
        upgradeableAttack.upgradeTo(address(maliciousRouter));

        // Off-chain monitor / backend detects drift on next check.
        address currentImpl = upgradeableAttack.implementation();
        assertTrue(currentImpl != previousImpl);

        // Monitor flags it and the registry downgrades trust accordingly.
        vm.prank(admin);
        registry.flagSuspicious(address(upgradeableAttack), "implementation changed since last trust snapshot");

        DataTypes.TransactionRequest memory req = _buildRequest(address(upgradeableAttack), 0, "", 0);
        DataTypes.RiskAssessment memory a = policy.evaluate(req, 15, false);
        // Suspicious penalty pushes even a low AI score into DELAY/HIGH territory.
        assertGt(uint256(a.level), uint256(DataTypes.RiskLevel.LOW));
    }

    function test_scenarioE_aiSaysSafeButSpendingLimitBlocks() public {
        vm.prank(admin);
        policy.setSpendingLimits(address(vault), 100 ether, 500 ether);

        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 200 ether, "", 0);

        vm.prank(agent);
        // AI is confident this is safe (score 5) and the trusted target keeps the
        // deterministic risk score low too -> proposal auto-approves.
        bytes32 hash = vault.proposeTransaction(req, 5);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));

        // But the hard-coded vault spending limit is independent of risk score and
        // still rejects execution: "AI recommendation != authorization".
        vm.prank(admin);
        vm.expectRevert(GuardianVault.ExceedsMaxTxValue.selector);
        vault.executeTransaction(hash);
    }
}
