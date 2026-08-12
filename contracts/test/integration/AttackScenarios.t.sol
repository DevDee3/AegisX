// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";
import {GuardianVault} from "../../src/GuardianVault.sol";

/// @notice Demonstrates the attack primitives in test/mocks actually work as intended,
///         and that routing the same actions through GuardianVault's hard rules
///         prevents the exposure from ever being created.
contract AttackScenariosTest is GuardianTestBase {
    function test_approvalAttack_drainsWithoutGuardian() public {
        // A victim who approves directly (bypassing Guardian) can be drained at will.
        vm.startPrank(user);
        usdc.mint(user, 100 ether);
        usdc.approve(address(approvalAttack), type(uint256).max);
        vm.stopPrank();

        approvalAttack.drain(address(usdc), user);
        assertEq(usdc.balanceOf(attacker), 100 ether);
    }

    function test_guardianVault_neverGrantsTheApprovalThatEnablesDrain() public {
        // The same unlimited approval, routed through the vault, is rejected before
        // it is ever broadcast — the ApprovalAttack contract never gets an allowance
        // to drain in the first place.
        bytes memory approveMax =
            abi.encodeWithSignature("approve(address,uint256)", address(approvalAttack), type(uint256).max);
        DataTypes.TransactionRequest memory req = _buildRequest(address(usdc), 0, approveMax, 0);

        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 3);

        assertEq(usdc.allowance(address(vault), address(approvalAttack)), 0);
    }

    function test_maliciousToken_ownerCanFreezeAndMintArbitrarily() public {
        maliciousToken.transfer(user, 100 ether);

        // Privileged mint — a real analyzer should flag ownership with mint rights.
        maliciousToken.privilegedMint(attacker, 1_000_000 ether);
        assertEq(maliciousToken.balanceOf(attacker), 1_000_000 ether);

        // Privileged freeze blocks the victim's own transfers.
        maliciousToken.freeze(user);
        vm.prank(user);
        vm.expectRevert();
        maliciousToken.transfer(attacker, 1 ether);
    }

    function test_maliciousRouter_redirectsFundsInsteadOfSwapping() public {
        vm.startPrank(user);
        usdc.mint(user, 100 ether);
        usdc.approve(address(maliciousRouter), 100 ether);
        maliciousRouter.swap(address(usdc), 100 ether, address(usdc), 0);
        vm.stopPrank();

        // Funds went to the attacker, not back to the user as a real swap would.
        assertEq(usdc.balanceOf(attacker), 100 ether);
    }

    function test_guardianVault_blocksInteractionWithBlockedRouter() public {
        vm.prank(admin);
        registry.blockContract(address(maliciousRouter), "redirects funds instead of swapping");

        bytes memory data = abi.encodeWithSignature(
            "swap(address,uint256,address,uint256)", address(usdc), 100 ether, address(usdc), 0
        );
        DataTypes.TransactionRequest memory req = _buildRequest(address(maliciousRouter), 0, data, 0);

        vm.expectRevert();
        vm.prank(agent);
        vault.proposeTransaction(req, 10); // even if AI thinks it looks fine
    }

    function test_hiddenMintToken_hasNonObviousPrivilegedFunction() public {
        uint256 supplyBefore = hiddenMintToken.totalSupply();
        hiddenMintToken.rebalanceTreasuryAllocation(attacker, 500_000 ether);
        assertEq(hiddenMintToken.totalSupply(), supplyBefore + 500_000 ether);
    }

    function test_upgradeableAttack_ownerCanSwapImplementationSilently() public {
        address before = upgradeableAttack.implementation();
        upgradeableAttack.upgradeTo(address(maliciousRouter));
        assertTrue(upgradeableAttack.implementation() != before);
    }
}
