// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";

contract GuardianRegistryTest is GuardianTestBase {
    function test_defaultStatus_isUnknown() public view {
        assertEq(uint256(registry.getContractStatus(address(0xBEEF))), uint256(DataTypes.ContractStatus.UNKNOWN));
    }

    function test_addTrustedContract() public {
        vm.prank(admin);
        registry.addTrustedContract(address(0xBEEF));
        assertTrue(registry.isTrusted(address(0xBEEF)));
    }

    function test_blockContract() public {
        vm.prank(admin);
        registry.blockContract(address(0xBEEF), "rugpull");
        assertTrue(registry.isBlocked(address(0xBEEF)));
        assertEq(registry.getStatusReason(address(0xBEEF)), "rugpull");
    }

    function test_onlyAdmin_canTrustOrBlock() public {
        vm.expectRevert();
        vm.prank(attacker);
        registry.addTrustedContract(address(0xBEEF));

        vm.expectRevert();
        vm.prank(attacker);
        registry.blockContract(address(0xBEEF), "nope");
    }

    function test_monitorRole_canFlagSuspiciousButNotUnblockBlocked() public {
        vm.startPrank(admin);
        registry.grantRole(registry.MONITOR_ROLE(), agent);
        registry.blockContract(address(0xBEEF), "scam");
        vm.stopPrank();

        vm.prank(agent);
        registry.flagSuspicious(address(0xBEEF), "still investigating");
        // Blocked status must NOT be downgraded by a mere monitor flag.
        assertTrue(registry.isBlocked(address(0xBEEF)));
    }

    function test_monitorRole_cannotBlockDirectly() public {
        bytes32 monitorRole = registry.MONITOR_ROLE();
        vm.prank(admin);
        registry.grantRole(monitorRole, agent);

        vm.expectRevert();
        vm.prank(agent);
        registry.blockContract(address(0xBEEF), "scam");
    }

    function test_unblockResetsToUnknown() public {
        vm.startPrank(admin);
        registry.blockContract(address(0xBEEF), "scam");
        registry.unblockContract(address(0xBEEF));
        vm.stopPrank();
        assertEq(uint256(registry.getContractStatus(address(0xBEEF))), uint256(DataTypes.ContractStatus.UNKNOWN));
    }

    function test_recordAndReadImplementationSnapshot() public {
        vm.startPrank(admin);
        registry.grantRole(registry.MONITOR_ROLE(), agent);
        vm.stopPrank();

        vm.prank(agent);
        registry.recordImplementation(address(upgradeableAttack), address(trustedRouter));
        assertEq(registry.getRecordedImplementation(address(upgradeableAttack)), address(trustedRouter));
    }
}
