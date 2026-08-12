// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {GuardianSecurityModule} from "../../src/GuardianSecurityModule.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";

contract GuardianSecurityModuleTest is GuardianTestBase {
    function test_emergencyPause_pausesVault() public {
        vm.prank(admin);
        securityModule.emergencyPause(address(vault));
        assertTrue(vault.paused());
    }

    function test_emergencyUnpause() public {
        vm.startPrank(admin);
        securityModule.emergencyPause(address(vault));
        securityModule.emergencyUnpause(address(vault));
        vm.stopPrank();
        assertFalse(vault.paused());
    }

    function test_onlyResponder_canEmergencyPause() public {
        vm.expectRevert();
        vm.prank(attacker);
        securityModule.emergencyPause(address(vault));
    }

    function test_emergencyRevokeSession() public {
        address[] memory empty = new address[](0);
        vm.prank(admin);
        session.createSession(agent, 1 ether, 5 ether, 1 days, empty, empty);

        vm.prank(admin);
        securityModule.emergencyRevokeSession(address(session), agent);

        DataTypes.SessionPermissions memory s = session.getSession(agent);
        assertFalse(s.active);
    }

    function test_emergencyWithdraw_requiresNonZeroRecipient() public {
        vm.expectRevert(GuardianSecurityModule.ZeroAddress.selector);
        vm.prank(admin);
        securityModule.emergencyWithdraw(address(vault), address(usdc), 1 ether, address(0));
    }

    function test_emergencyWithdraw_movesFunds() public {
        vm.prank(admin);
        securityModule.emergencyWithdraw(address(vault), address(usdc), 1 ether, admin);
        assertEq(usdc.balanceOf(admin), 1 ether);
    }

    function test_scheduleAction_notExecutableBeforeDelay() public {
        bytes memory data = abi.encodeWithSignature("setThresholds(uint256,uint256,uint256)", 20, 50, 75);
        vm.prank(admin);
        bytes32 id = securityModule.scheduleAction(address(policy), data);

        vm.expectRevert(GuardianSecurityModule.ActionNotReady.selector);
        vm.prank(admin);
        securityModule.executeAction(id);
    }

    function test_scheduleAction_executesAfterDelay() public {
        bytes memory data = abi.encodeWithSignature("setThresholds(uint256,uint256,uint256)", 20, 50, 75);
        bytes32 policyAdminRole = policy.POLICY_ADMIN_ROLE();
        // securityModule doesn't hold POLICY_ADMIN_ROLE on policy by default in the
        // test base — grant it so the scheduled call can actually succeed.
        vm.prank(admin);
        policy.grantRole(policyAdminRole, address(securityModule));

        vm.prank(admin);
        bytes32 id = securityModule.scheduleAction(address(policy), data);

        vm.warp(block.timestamp + securityModule.MIN_DELAY() + 1);
        vm.prank(admin);
        securityModule.executeAction(id);

        assertEq(policy.lowMax(), 20);
    }

    function test_scheduleAction_cannotExecuteTwice() public {
        bytes memory data = abi.encodeWithSignature("setThresholds(uint256,uint256,uint256)", 20, 50, 75);
        bytes32 policyAdminRole = policy.POLICY_ADMIN_ROLE();
        vm.prank(admin);
        policy.grantRole(policyAdminRole, address(securityModule));

        vm.prank(admin);
        bytes32 id = securityModule.scheduleAction(address(policy), data);
        vm.warp(block.timestamp + securityModule.MIN_DELAY() + 1);

        vm.prank(admin);
        securityModule.executeAction(id);

        vm.expectRevert(GuardianSecurityModule.ActionAlreadyExecuted.selector);
        vm.prank(admin);
        securityModule.executeAction(id);
    }

    function test_cancelAction_preventsExecution() public {
        bytes memory data = abi.encodeWithSignature("setThresholds(uint256,uint256,uint256)", 20, 50, 75);
        vm.prank(admin);
        bytes32 id = securityModule.scheduleAction(address(policy), data);

        vm.prank(admin);
        securityModule.cancelAction(id);

        vm.warp(block.timestamp + securityModule.MIN_DELAY() + 1);
        vm.expectRevert(GuardianSecurityModule.ActionCancelledError.selector);
        vm.prank(admin);
        securityModule.executeAction(id);
    }

    function test_onlyProposer_canSchedule() public {
        bytes memory data = abi.encodeWithSignature("setThresholds(uint256,uint256,uint256)", 20, 50, 75);
        vm.expectRevert();
        vm.prank(attacker);
        securityModule.scheduleAction(address(policy), data);
    }

    function test_executeAction_revertsIfUnderlyingCallFails() public {
        // Not granting POLICY_ADMIN_ROLE means the underlying call will revert.
        bytes memory data = abi.encodeWithSignature("setThresholds(uint256,uint256,uint256)", 20, 50, 75);
        vm.prank(admin);
        bytes32 id = securityModule.scheduleAction(address(policy), data);

        vm.warp(block.timestamp + securityModule.MIN_DELAY() + 1);
        vm.expectRevert(GuardianSecurityModule.ActionCallFailed.selector);
        vm.prank(admin);
        securityModule.executeAction(id);
    }
}
