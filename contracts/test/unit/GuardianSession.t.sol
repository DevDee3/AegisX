// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {GuardianSession} from "../../src/GuardianSession.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";

contract GuardianSessionTest is GuardianTestBase {
    function _createBasicSession(uint256 maxTx, uint256 daily, uint256 duration) internal {
        address[] memory contracts = new address[](1);
        contracts[0] = address(trustedRouter);
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        vm.prank(admin);
        session.createSession(agent, maxTx, daily, duration, contracts, tokens);
    }

    function test_createSession_setsPermissions() public {
        _createBasicSession(1 ether, 5 ether, 1 days);
        DataTypes.SessionPermissions memory s = session.getSession(agent);
        assertTrue(s.active);
        assertEq(s.maxTxValue, 1 ether);
        assertEq(s.dailyLimit, 5 ether);
        assertTrue(session.isContractAllowed(agent, address(trustedRouter)));
        assertTrue(session.isTokenAllowed(agent, address(usdc)));
    }

    function test_onlySessionAdmin_canCreateSession() public {
        address[] memory empty = new address[](0);
        vm.expectRevert();
        vm.prank(attacker);
        session.createSession(agent, 1 ether, 5 ether, 1 days, empty, empty);
    }

    function test_checkAndConsume_withinLimits_succeeds() public {
        _createBasicSession(1 ether, 5 ether, 1 days);
        session.checkAndConsume(agent, address(trustedRouter), 0.5 ether);
        assertEq(session.sessionSpentToday(agent), 0.5 ether);
    }

    function test_checkAndConsume_exceedsMaxTxValue_reverts() public {
        _createBasicSession(1 ether, 5 ether, 1 days);
        vm.expectRevert(GuardianSession.ExceedsSessionMaxTxValue.selector);
        session.checkAndConsume(agent, address(trustedRouter), 2 ether);
    }

    function test_checkAndConsume_exceedsDailyLimit_reverts() public {
        _createBasicSession(2 ether, 3 ether, 1 days);
        session.checkAndConsume(agent, address(trustedRouter), 2 ether);
        vm.expectRevert(GuardianSession.ExceedsSessionDailyLimit.selector);
        session.checkAndConsume(agent, address(trustedRouter), 2 ether);
    }

    function test_checkAndConsume_disallowedContract_reverts() public {
        _createBasicSession(1 ether, 5 ether, 1 days);
        vm.expectRevert(GuardianSession.ContractNotAllowed.selector);
        session.checkAndConsume(agent, address(maliciousRouter), 0.1 ether);
    }

    function test_checkAndConsume_expiredSession_reverts() public {
        _createBasicSession(1 ether, 5 ether, 1 hours);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(GuardianSession.SessionExpired.selector);
        session.checkAndConsume(agent, address(trustedRouter), 0.1 ether);
    }

    function test_checkAndConsume_inactiveSession_reverts() public {
        vm.expectRevert(GuardianSession.SessionNotActive.selector);
        session.checkAndConsume(agent, address(trustedRouter), 0.1 ether);
    }

    function test_revokeSession_blocksSubsequentUse() public {
        _createBasicSession(1 ether, 5 ether, 1 days);
        vm.prank(admin);
        session.revokeSession(agent);

        vm.expectRevert(GuardianSession.SessionNotActive.selector);
        session.checkAndConsume(agent, address(trustedRouter), 0.1 ether);
    }

    function test_dailyLimit_resetsNextDay() public {
        _createBasicSession(2 ether, 2 ether, 3 days);
        session.checkAndConsume(agent, address(trustedRouter), 2 ether);

        vm.warp(block.timestamp + 1 days + 1);
        // Should succeed again since the rolling day index has advanced.
        session.checkAndConsume(agent, address(trustedRouter), 2 ether);
    }

    function test_setAllowedContract_ownerCanAdjustAllowlist() public {
        _createBasicSession(1 ether, 5 ether, 1 days);
        vm.prank(admin);
        session.setAllowedContract(agent, address(maliciousRouter), true);
        assertTrue(session.isContractAllowed(agent, address(maliciousRouter)));

        vm.prank(admin);
        session.setAllowedContract(agent, address(maliciousRouter), false);
        assertFalse(session.isContractAllowed(agent, address(maliciousRouter)));
    }
}
