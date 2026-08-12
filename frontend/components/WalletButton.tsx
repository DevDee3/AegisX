"use client";
import { useWallet } from "@/lib/wallet";

export function WalletButton({ onConnected }: { onConnected?: (address: string) => void }) {
  const wallet = useWallet();
  function connect() { wallet.connect().then((address) => { if (address) onConnected?.(address); }); }
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <button className="btn" onClick={connect} disabled={wallet.busy}>{wallet.busy ? "Connecting…" : wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect wallet"}</button>
    {wallet.chainId && wallet.chainId !== "0xa869" && <span style={{ color: "var(--signal-avalanche)", fontSize: 11 }}>Switch to Fuji</span>}
    {wallet.error && <span style={{ color: "var(--signal-avalanche)", fontSize: 11 }}>{wallet.error}</span>}
  </div>;
}
