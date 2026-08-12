// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {DataTypes} from "../../src/libraries/DataTypes.sol";
import {GuardianSession} from "../../src/GuardianSession.sol";

/// @notice Proves GuardianVault + GuardianSession + GuardianSecurityModule work
///         together as one system, not three isolated contracts: a bounded agent
///         session is enforced at propose-time, and the security module can react
///         to a compromised agent by revoking its session mid-flight.
contract SessionEnforcementIntegrationTest is GuardianTestBase {
    function _wireSession(uint256 maxTx, uint256 daily) internal {
        address[] memory contracts = new address[](1);
        contracts[0] = address(trustedRouter);
        address[] memory tokens = new address[](0);

        vm.prank(admin);
        session.createSession(agent, maxTx, daily, 1 days, contracts, tokens);

        vm.prank(admin);
        vault.setSession(address(session));
    }

    function test_sessionBound_stopsAgentEvenWhenRiskPolicyWouldAllow() public {
        _wireSession(0.5 ether, 2 ether);

        // A low-risk, trusted-target transaction that RiskPolicy would happily
        // ALLOW — but it exceeds the agent's own session cap.
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 1 ether, "", 0);

        vm.expectRevert(GuardianSession.ExceedsSessionMaxTxValue.selector);
        vm.prank(agent);
        vault.proposeTransaction(req, 5);
    }

    function test_sessionBound_allowsWithinLimits() public {
        _wireSession(2 ether, 5 ether);

        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 1 ether, "", 0);
        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 5);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));
    }

    function test_sessionBound_blocksDisallowedTarget_evenIfTrustedInRegistry() public {
        _wireSession(2 ether, 5 ether);

        address otherTrusted = address(0xCAFE);
        vm.prank(admin);
        registry.addTrustedContract(otherTrusted);

        // trustedRouter's registry status is TRUSTED, but otherTrusted isn't in the
        // agent's session allow-list, so it must be rejected before ever reaching
        // RiskPolicy.
        DataTypes.TransactionRequest memory req = _buildRequest(otherTrusted, 0, "", 0);
        vm.expectRevert(GuardianSession.ContractNotAllowed.selector);
        vm.prank(agent);
        vault.proposeTransaction(req, 5);
    }

    function test_securityModule_revokesCompromisedAgentSessionMidFlight() public {
        _wireSession(2 ether, 5 ether);

        // Agent successfully proposes once.
        DataTypes.TransactionRequest memory req1 = _buildRequest(address(trustedRouter), 0.1 ether, "", 0);
        vm.prank(agent);
        vault.proposeTransaction(req1, 5);

        // Security team detects compromise and revokes via the security module —
        // not by touching the vault's core roles at all.
        vm.prank(admin);
        securityModule.emergencyRevokeSession(address(session), agent);

        // Same agent, same vault, same trusted target — now hard-blocked at the
        // session layer regardless of risk score.
        DataTypes.TransactionRequest memory req2 = _buildRequest(address(trustedRouter), 0.1 ether, "", 1);
        vm.expectRevert(GuardianSession.SessionNotActive.selector);
        vm.prank(agent);
        vault.proposeTransaction(req2, 5);
    }

    function test_clearingSession_removesEnforcement() public {
        _wireSession(0.1 ether, 0.1 ether);
        vm.prank(admin);
        vault.setSession(address(0));

        // No longer session-bound; a larger, low-risk trusted-target tx now succeeds.
        DataTypes.TransactionRequest memory req = _buildRequest(address(trustedRouter), 1 ether, "", 0);
        vm.prank(agent);
        bytes32 hash = vault.proposeTransaction(req, 5);
        assertEq(uint256(vault.getProposalState(hash)), uint256(DataTypes.ProposalState.APPROVED));
    }
}
