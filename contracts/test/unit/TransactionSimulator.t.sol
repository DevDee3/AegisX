// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GuardianTestBase} from "../GuardianTestBase.sol";
import {TransactionSimulator} from "../../src/simulation/TransactionSimulator.sol";

/// @notice These tests deploy TransactionSimulator directly (a normal `new`
///         deployment) purely to verify its internal accounting logic is
///         correct in isolation. Production usage never deploys it for real —
///         the backend injects its bytecode via eth_call state-override at the
///         vault's own address instead (see contracts/src/simulation/
///         TransactionSimulator.sol's top comment, and backend/src/analyzer/
///         simulate.ts). What's under test here is identical either way: only
///         the deployment mechanism differs, not the bytecode running.
contract TransactionSimulatorTest is GuardianTestBase {
    TransactionSimulator internal simulator;

    function setUp() public override {
        super.setUp();
        simulator = new TransactionSimulator();
        vm.deal(address(simulator), 10 ether);
        usdc.transfer(address(simulator), 1_000 ether);
        usdc.transfer(address(trustedRouter), 1_000 ether); // liquidity for the mock swap-out leg
    }

    function test_simulate_successfulErc20Transfer_showsBalanceDelta() public {
        address recipient = makeAddr("recipient");

        address[] memory nativeProbes = new address[](0);
        TransactionSimulator.TokenProbe[] memory tokenProbes = new TransactionSimulator.TokenProbe[](2);
        tokenProbes[0] = TransactionSimulator.TokenProbe({token: address(usdc), account: address(simulator)});
        tokenProbes[1] = TransactionSimulator.TokenProbe({token: address(usdc), account: recipient});

        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", recipient, 100 ether);

        TransactionSimulator.SimulationResult memory result =
            simulator.simulate(address(usdc), 0, data, nativeProbes, tokenProbes);

        assertTrue(result.success);
        assertEq(result.tokenBalancesBefore[0], 1_000 ether);
        assertEq(result.tokenBalancesAfter[0], 900 ether);
        assertEq(result.tokenBalancesBefore[1], 0);
        assertEq(result.tokenBalancesAfter[1], 100 ether);
    }

    function test_simulate_nativeValueTransfer_showsBalanceDelta() public {
        address recipient = makeAddr("nativeRecipient");
        vm.deal(recipient, 0);

        address[] memory nativeProbes = new address[](2);
        nativeProbes[0] = address(simulator);
        nativeProbes[1] = recipient;
        TransactionSimulator.TokenProbe[] memory tokenProbes = new TransactionSimulator.TokenProbe[](0);

        TransactionSimulator.SimulationResult memory result =
            simulator.simulate(recipient, 1 ether, "", nativeProbes, tokenProbes);

        assertTrue(result.success);
        assertEq(result.nativeBalancesBefore[0], 10 ether);
        assertEq(result.nativeBalancesAfter[0], 9 ether);
        assertEq(result.nativeBalancesBefore[1], 0);
        assertEq(result.nativeBalancesAfter[1], 1 ether);
    }

    function test_simulate_revertingCall_reportsFailureWithoutRevertingSimulation() public {
        address[] memory nativeProbes = new address[](0);
        TransactionSimulator.TokenProbe[] memory tokenProbes = new TransactionSimulator.TokenProbe[](1);
        tokenProbes[0] = TransactionSimulator.TokenProbe({token: address(usdc), account: address(simulator)});

        // Transfer more than the simulator holds — should revert inside the
        // sub-call, but `simulate()` itself must not revert; it should report
        // success=false so the caller gets a clean, decodable failure signal.
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", makeAddr("x"), 1_000_000 ether);

        TransactionSimulator.SimulationResult memory result =
            simulator.simulate(address(usdc), 0, data, nativeProbes, tokenProbes);

        assertFalse(result.success);
        // Balance unchanged since the sub-call reverted.
        assertEq(result.tokenBalancesBefore[0], result.tokenBalancesAfter[0]);
    }

    function test_simulate_swapThroughRouter_preservesMsgSenderSemantics() public {
        // This is the key property the state-override injection trick relies
        // on: when TransactionSimulator's code runs AT an address, its calls to
        // `target` show msg.sender == that address, not some other identity.
        // We verify it here by simulating an approve+swap sequence where the
        // router pulls funds via transferFrom(simulator, ..., amount) — that
        // only succeeds if msg.sender for the approve() was the simulator
        // itself, i.e. the same address later used as the swap's caller.
        vm.prank(address(simulator));
        usdc.approve(address(trustedRouter), 200 ether);

        address[] memory nativeProbes = new address[](0);
        TransactionSimulator.TokenProbe[] memory tokenProbes = new TransactionSimulator.TokenProbe[](2);
        tokenProbes[0] = TransactionSimulator.TokenProbe({token: address(usdc), account: address(simulator)});
        tokenProbes[1] = TransactionSimulator.TokenProbe({token: address(usdc), account: address(trustedRouter)});

        bytes memory data = abi.encodeWithSignature(
            "swap(address,uint256,address,uint256)", address(usdc), 100 ether, address(usdc), 100 ether
        );

        TransactionSimulator.SimulationResult memory result =
            simulator.simulate(address(trustedRouter), 0, data, nativeProbes, tokenProbes);

        assertTrue(result.success);
        // simulator's USDC balance is unchanged (100 out to router, 100 back from
        // the mock 1:1 swap), but the round-trip proves transferFrom(simulator,..)
        // succeeded, which only works if msg.sender during approve == simulator.
        assertEq(result.tokenBalancesBefore[0], result.tokenBalancesAfter[0]);
    }

    function test_simulate_nonContractTokenProbe_recordsZeroInsteadOfReverting() public {
        address[] memory nativeProbes = new address[](0);
        TransactionSimulator.TokenProbe[] memory tokenProbes = new TransactionSimulator.TokenProbe[](1);
        // Not an ERC20 — balanceOf() call should fail gracefully, not revert the sim.
        tokenProbes[0] = TransactionSimulator.TokenProbe({token: makeAddr("notAToken"), account: address(simulator)});

        TransactionSimulator.SimulationResult memory result =
            simulator.simulate(address(trustedRouter), 0, "", nativeProbes, tokenProbes);

        assertEq(result.tokenBalancesBefore[0], 0);
        assertEq(result.tokenBalancesAfter[0], 0);
    }
}
