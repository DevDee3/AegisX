import { type Address, isAddressEqual, zeroAddress } from "viem";
import { getPublicClient } from "./client.js";
import { ownableAbi } from "./abis.js";

/// EIP-1967 implementation storage slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bb" as const;

/// EIP-1967 beacon slot, for beacon-proxy patterns.
const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d0" as const;

export interface UpgradeabilityResult {
  isProxy: boolean;
  pattern: "eip1967" | "beacon" | "none" | "unknown";
  implementation?: Address;
}

/// Reads the raw contract bytecode. An empty/absent result means either the
/// address has no code (EOA, or nothing deployed) or the RPC couldn't be reached.
export async function getBytecode(address: Address): Promise<`0x${string}` | undefined> {
  const client = getPublicClient();
  return client.getBytecode({ address });
}

/// Detects the most common upgradeable-proxy storage patterns by directly
/// reading storage slots — this works even if the contract doesn't expose a
/// standard `implementation()` view function, which is exactly the kind of
/// contract Guardian needs to catch (see test/mocks/UpgradeableAttack.sol on
/// the contracts side for the attack this defends against).
export async function checkUpgradeability(address: Address): Promise<UpgradeabilityResult> {
  const client = getPublicClient();

  const implSlotValue = await client.getStorageAt({ address, slot: EIP1967_IMPLEMENTATION_SLOT });
  const implAddress = slotValueToAddress(implSlotValue);
  if (implAddress && !isAddressEqual(implAddress, zeroAddress)) {
    return { isProxy: true, pattern: "eip1967", implementation: implAddress };
  }

  const beaconSlotValue = await client.getStorageAt({ address, slot: EIP1967_BEACON_SLOT });
  const beaconAddress = slotValueToAddress(beaconSlotValue);
  if (beaconAddress && !isAddressEqual(beaconAddress, zeroAddress)) {
    return { isProxy: true, pattern: "beacon", implementation: beaconAddress };
  }

  return { isProxy: false, pattern: "none" };
}

/// Attempts to read `owner()` via the common Ownable interface. Absence of an
/// owner is NOT evidence of safety — plenty of dangerous contracts have no
/// single EOA owner (e.g. a malicious multisig, or privileged roles gated by
/// a differently-named function) — so callers should treat this as one signal
/// among several, never a standalone verdict.
export async function tryGetOwner(address: Address): Promise<Address | undefined> {
  const client = getPublicClient();
  try {
    const owner = await client.readContract({
      address,
      abi: ownableAbi,
      functionName: "owner",
    });
    return owner;
  } catch {
    return undefined;
  }
}

function slotValueToAddress(slotValue: `0x${string}` | undefined): Address | undefined {
  if (!slotValue) return undefined;
  // Storage slot is 32 bytes; an address is the low 20 bytes.
  const addr = `0x${slotValue.slice(-40)}` as Address;
  return addr;
}
