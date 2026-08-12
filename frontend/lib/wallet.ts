"use client";

import { useCallback, useEffect, useState } from "react";

export const FUJI_CHAIN_ID = "0xa869";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

function provider() {
  return (window as Window & { ethereum?: EthereumProvider }).ethereum;
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (): Promise<string | null> => {
    const eth = provider();
    if (!eth) { setError("No browser wallet found. Install MetaMask or Core Wallet."); return null; }
    setBusy(true); setError(null);
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
      const currentChain = await eth.request({ method: "eth_chainId" }) as string;
      if (currentChain !== FUJI_CHAIN_ID) {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FUJI_CHAIN_ID }] });
        } catch (switchError: unknown) {
          if ((switchError as { code?: number }).code === 4902) {
            await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: FUJI_CHAIN_ID, chainName: "Avalanche Fuji", nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 }, rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"], blockExplorerUrls: ["https://testnet.snowtrace.io"] }] });
          } else throw switchError;
        }
      }
      setAddress(accounts[0] ?? null); setChainId(FUJI_CHAIN_ID); return accounts[0] ?? null;
    } catch (e) { setError(e instanceof Error ? e.message : "Wallet connection failed"); return null; }
    finally { setBusy(false); }
  }, []);

  const getTransaction = useCallback(async (hash: string) => {
    const eth = provider();
    if (!eth) throw new Error("Connect MetaMask or Core Wallet first.");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash.trim())) throw new Error("Enter a valid 0x-prefixed transaction hash.");
    const tx = await eth.request({ method: "eth_getTransactionByHash", params: [hash.trim()] }) as { from?: string; to?: string; value?: string; input?: string } | null;
    if (!tx) throw new Error("Transaction was not found. It may still be pending or belong to another network.");
    if (!tx.from || !tx.to) throw new Error("This transaction does not contain a usable sender and target.");
    return { from: tx.from, target: tx.to, value: tx.value ? BigInt(tx.value).toString() : "0", data: tx.input && tx.input !== "0x" ? tx.input : "0x" };
  }, []);

  useEffect(() => {
    const eth = provider();
    if (!eth?.on) return;
    const accountsChanged = (...args: unknown[]) => setAddress((args[0] as string[] | undefined)?.[0] ?? null);
    const chainChanged = (...args: unknown[]) => setChainId(args[0] as string);
    eth.on("accountsChanged", accountsChanged); eth.on("chainChanged", chainChanged);
    return () => { eth.removeListener?.("accountsChanged", accountsChanged); eth.removeListener?.("chainChanged", chainChanged); };
  }, []);

  return { address, chainId, busy, error, connect, getTransaction };
}
