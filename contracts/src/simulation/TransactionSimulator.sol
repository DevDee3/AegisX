// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TransactionSimulator
/// @notice A stateless helper used to simulate a Guardian transaction proposal
///         WITHOUT running a full local EVM fork (e.g. anvil). It is never meant
///         to be permanently deployed as part of the production system.
/// @dev Usage pattern (see backend/src/analyzer/simulate.ts):
///        1. Compile this contract and take its RUNTIME (deployed) bytecode.
///        2. Call `eth_call` with a `stateOverride` that temporarily replaces the
///           CODE at the vault's own address with this contract's bytecode, for
///           the duration of that single call only — nothing is persisted.
///        3. Call `simulate(...)` with `from` unset / irrelevant and `to` = the
///           vault address.
///      Because the injected code runs AT the vault's address, `address(this)`
///      inside `simulate()` IS the vault, and any sub-call this contract makes to
///      `target` sees `msg.sender == vault` — exactly matching what a real
///      `GuardianVault.executeTransaction` call would look like from the target
///      contract's point of view. This preserves allowance/ownership semantics
///      that a naive "call from a throwaway address" simulation would get wrong.
contract TransactionSimulator {
    /// @param target Contract the (simulated) vault would call.
    /// @param value Native AVAX value to send.
    /// @param data Calldata for the call.
    /// @param balanceProbes Addresses to snapshot native-AVAX balance of, before
    ///        and after — typically just [vault]. address(0) markers are NOT
    ///        special-cased here; use `tokenProbes` for ERC-20 balances instead.
    /// @param tokenProbes (token, account) pairs to snapshot ERC-20 balanceOf,
    ///        before and after. A failed balanceOf call (e.g. non-ERC20 address)
    ///        is recorded as 0 rather than reverting the whole simulation.
    struct TokenProbe {
        address token;
        address account;
    }

    struct SimulationResult {
        bool success;
        bytes returnData;
        uint256[] nativeBalancesBefore;
        uint256[] nativeBalancesAfter;
        uint256[] tokenBalancesBefore;
        uint256[] tokenBalancesAfter;
    }

    function simulate(
        address target,
        uint256 value,
        bytes calldata data,
        address[] calldata balanceProbes,
        TokenProbe[] calldata tokenProbes
    ) external returns (SimulationResult memory result) {
        result.nativeBalancesBefore = _snapshotNative(balanceProbes);
        result.tokenBalancesBefore = _snapshotTokens(tokenProbes);

        (bool success, bytes memory returnData) = target.call{value: value}(data);
        result.success = success;
        result.returnData = returnData;

        result.nativeBalancesAfter = _snapshotNative(balanceProbes);
        result.tokenBalancesAfter = _snapshotTokens(tokenProbes);
    }

    function _snapshotNative(address[] calldata probes) private view returns (uint256[] memory balances) {
        balances = new uint256[](probes.length);
        for (uint256 i = 0; i < probes.length; i++) {
            balances[i] = probes[i].balance;
        }
    }

    function _snapshotTokens(TokenProbe[] calldata probes) private view returns (uint256[] memory balances) {
        balances = new uint256[](probes.length);
        for (uint256 i = 0; i < probes.length; i++) {
            // Deliberately a raw low-level call rather than IERC20(...).balanceOf(...):
            // Solidity's typed external-call codegen inserts an extcodesize check that
            // reverts outside what try/catch can recover from when the target has no
            // code. A raw call has no such check — on real (and simulated) EVM
            // semantics, CALLing an address with no code simply succeeds trivially
            // with empty returndata, which we treat as balance 0 below.
            (bool ok, bytes memory ret) =
                probes[i].token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, probes[i].account));
            balances[i] = (ok && ret.length >= 32) ? abi.decode(ret, (uint256)) : 0;
        }
    }

    receive() external payable {}
}
