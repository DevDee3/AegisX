import type { Hex } from "viem";

const APPROVE_SELECTOR = "0x095ea7b3" as const; // approve(address,uint256)
const MAX_UINT256 = (1n << 256n) - 1n;

export interface DecodedApproval {
  isApproval: boolean;
  isUnlimited: boolean;
  spender?: `0x${string}`;
  amount?: bigint;
}

/// Mirrors GuardianVault._isUnlimitedApproval exactly (same selector, same
/// type(uint256).max check) so the AI's analysis and the on-chain hard rule
/// never disagree about what counts as "unlimited". If this drifts from the
/// Solidity source, the AI could rate something as safe that the contract
/// will hard-block (confusing, but not unsafe) or vice versa (just a UX
/// annoyance, since the contract's hard rule is authoritative either way) —
/// see contracts/src/GuardianVault.sol for the source of truth.
export function decodeApprovalCalldata(data: Hex): DecodedApproval {
  if (!data.startsWith(APPROVE_SELECTOR) || data.length < 10 + 128) {
    return { isApproval: false, isUnlimited: false };
  }

  // 4-byte selector + 32-byte left-padded spender + 32-byte amount.
  const spenderWord = data.slice(10, 74);
  const amountWord = data.slice(74, 138);
  const spender = `0x${spenderWord.slice(-40)}` as `0x${string}`;
  const amount = BigInt(`0x${amountWord}`);

  return {
    isApproval: true,
    isUnlimited: amount === MAX_UINT256,
    spender,
    amount,
  };
}
