// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GuardianVault} from "../src/GuardianVault.sol";
import {GuardianRegistry} from "../src/GuardianRegistry.sol";
import {RiskPolicy} from "../src/RiskPolicy.sol";
import {GuardianSession} from "../src/GuardianSession.sol";
import {GuardianSecurityModule} from "../src/GuardianSecurityModule.sol";
import {DataTypes} from "../src/libraries/DataTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockRouter} from "./mocks/MockRouter.sol";
import {MaliciousToken} from "./mocks/MaliciousToken.sol";
import {MaliciousRouter} from "./mocks/MaliciousRouter.sol";
import {ApprovalAttack} from "./mocks/ApprovalAttack.sol";
import {UpgradeableAttack} from "./mocks/UpgradeableAttack.sol";
import {HiddenMintToken} from "./mocks/HiddenMintToken.sol";

/// @dev Common deployment + helpers shared by unit / integration / fuzz / invariant tests.
abstract contract GuardianTestBase is Test {
    address internal admin = makeAddr("admin");
    address internal agent = makeAddr("agent"); // stands in for the AI agent / session key
    address internal attacker = makeAddr("attacker");
    address internal user = makeAddr("user");

    GuardianRegistry internal registry;
    RiskPolicy internal policy;
    GuardianVault internal vault;
    GuardianSession internal session;
    GuardianSecurityModule internal securityModule;

    MockERC20 internal usdc;
    MockRouter internal trustedRouter;

    MaliciousToken internal maliciousToken;
    MaliciousRouter internal maliciousRouter;
    ApprovalAttack internal approvalAttack;
    UpgradeableAttack internal upgradeableAttack;
    HiddenMintToken internal hiddenMintToken;

    function setUp() public virtual {
        vm.startPrank(admin);
        registry = new GuardianRegistry(admin);
        policy = new RiskPolicy(admin, address(registry));
        vault = new GuardianVault(admin, address(policy));
        vault.grantRole(vault.AGENT_ROLE(), agent);
        session = new GuardianSession(admin);
        securityModule = new GuardianSecurityModule(admin);
        // Security module is granted the same admin-level roles a human admin would
        // hold, so it can act (pause / revoke / emergency-withdraw) without ever
        // being handed the underlying private key.
        vault.grantRole(vault.VAULT_ADMIN_ROLE(), address(securityModule));
        session.grantRole(session.SESSION_ADMIN_ROLE(), address(securityModule));
        vm.stopPrank();

        usdc = new MockERC20("USD Coin", "USDC");
        trustedRouter = new MockRouter();

        maliciousToken = new MaliciousToken();
        maliciousRouter = new MaliciousRouter(attacker);
        approvalAttack = new ApprovalAttack(attacker);
        upgradeableAttack = new UpgradeableAttack(address(trustedRouter));
        hiddenMintToken = new HiddenMintToken();

        vm.prank(admin);
        registry.addTrustedContract(address(trustedRouter));

        // Fund the vault with USDC and native AVAX for execution tests.
        usdc.transfer(address(vault), 100_000 ether);
        vm.deal(address(vault), 100 ether);

        // Give the trusted router USDC liquidity for the mock 1:1 swap-out leg.
        usdc.transfer(address(trustedRouter), 100_000 ether);
    }

    function _buildRequest(address target, uint256 value, bytes memory data, uint256 nonce)
        internal
        view
        returns (DataTypes.TransactionRequest memory)
    {
        return DataTypes.TransactionRequest({
            vault: address(vault),
            target: target,
            value: value,
            data: data,
            nonce: nonce,
            deadline: block.timestamp + 1 days
        });
    }
}
