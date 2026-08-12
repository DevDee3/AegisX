import { getAddress, parseAbiItem, type Address } from "viem";
import { getPublicClient } from "../blockchain/client.js";
import { env } from "../config/env.js";

const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const approval = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");

export async function discoverWallet(wallet: Address) {
  const client = getPublicClient();
  const latest = await client.getBlockNumber();
  const fromBlock = latest > BigInt(env.MAX_EVENT_LOOKBACK_BLOCKS) ? latest - BigInt(env.MAX_EVENT_LOOKBACK_BLOCKS) : 0n;
  const [received, sent, approvals] = await Promise.all([
    client.getLogs({ event: transfer, args: { to: wallet }, fromBlock, toBlock: latest }),
    client.getLogs({ event: transfer, args: { from: wallet }, fromBlock, toBlock: latest }),
    client.getLogs({ event: approval, args: { owner: wallet }, fromBlock, toBlock: latest }),
  ]);
  const tokens = new Set<Address>();
  const spenders = new Map<Address, Set<Address>>();
  for (const log of [...received, ...sent]) if (log.address) tokens.add(getAddress(log.address));
  for (const log of approvals) {
    if (!log.address || !log.args.spender) continue;
    const token = getAddress(log.address);
    tokens.add(token);
    if (!spenders.has(token)) spenders.set(token, new Set());
    spenders.get(token)!.add(getAddress(log.args.spender));
  }
  return {
    fromBlock: fromBlock.toString(), toBlock: latest.toString(),
    tokens: [...tokens].map((token) => ({ token, spendersToCheck: [...(spenders.get(token) ?? [])] })),
  };
}
