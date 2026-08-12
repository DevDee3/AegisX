"use client";

import { useState } from "react";
import { analyzeWallet, discoverWallet, type WalletAnalysisResponse } from "@/lib/api";
import { FindingsList } from "@/components/GuardianUI";

export default function ScanPage() {
  const [wallet, setWallet] = useState("");
  const [tokens, setTokens] = useState("");
  const [result, setResult] = useState<WalletAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string | null>(null);

  async function scan() {
    setLoading(true); setError(null); setResult(null);
    try {
      const tokenList = tokens.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const [token, spenderText = ""] = entry.split("|");
        return { token: token.trim(), spendersToCheck: spenderText.split(";").map((spender) => spender.trim()).filter(Boolean) };
      });
      setResult(await analyzeWallet(wallet, tokenList));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }

  async function discover() {
    setDiscovering(true); setError(null); setDiscoveryNote(null);
    try {
      const found = await discoverWallet(wallet);
      setTokens(found.tokens.map((item) => `${item.token}${item.spendersToCheck.length ? `|${item.spendersToCheck.join(";")}` : ""}`).join(", "));
      setDiscoveryNote(`Discovered ${found.tokens.length} token(s) from blocks ${found.fromBlock}–${found.toBlock}. Review the list, then run the security scan.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setDiscovering(false); }
  }

  return <div>
    <div style={{ marginBottom: 32 }}>
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Wallet security scan</h1>
      <p style={{ color: "var(--ward-mist)", margin: 0, fontSize: 14, maxWidth: 620 }}>
        Check a connected wallet for known exposure signals before funds are at risk.
        AegisX reports evidence, not a guarantee of safety.
      </p>
    </div>

    <div className="panel" style={{ maxWidth: 680, marginBottom: 20 }}>
      <div className="panel-title">Scan wallet</div>
      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="scan-wallet">Wallet address</label>
        <input id="scan-wallet" placeholder="Connect a wallet or enter 0x..." value={wallet} onChange={(e) => setWallet(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="scan-tokens">Tokens and spenders to inspect (optional)</label>
        <input id="scan-tokens" placeholder="0xToken|0xSpender1;0xSpender2, 0xToken2" value={tokens} onChange={(e) => setTokens(e.target.value)} />
      </div>
      <button className="btn" type="button" onClick={discover} disabled={discovering || !wallet} style={{ marginRight: 8 }}>{discovering ? "Discovering…" : "Discover recent activity"}</button>
      <button className="btn btn-primary" onClick={scan} disabled={loading || !wallet}>{loading ? "Scanning…" : "Scan for exposure"}</button>
      <p style={{ color: "var(--ward-mist)", fontSize: 12, marginBottom: 0 }}>
        Checks native balance, supplied token balances, and allowances. Use token|spender to detect unlimited approvals. Full historical discovery requires an indexer.
      </p>
      {discoveryNote && <p style={{ color: "var(--signal-mint)", fontSize: 12 }}>{discoveryNote}</p>}
      {error && <p style={{ color: "var(--signal-avalanche)", fontSize: 13 }}>{error}</p>}
    </div>

    {result && <div className="grid-2">
      <div className="panel">
        <div className="panel-title">Exposure summary</div>
        <div className="stat-row"><span className="stat-label">Wallet</span><span className="stat-value mono" style={{ fontSize: 11 }}>{result.wallet}</span></div>
        <div className="stat-row"><span className="stat-label">Native balance (wei)</span><span className="stat-value">{result.nativeBalance}</span></div>
        <div className="stat-row"><span className="stat-label">Tokens checked</span><span className="stat-value">{result.tokenExposure.length}</span></div>
        <div className="stat-row"><span className="stat-label">Findings</span><span className="stat-value">{result.findings.length}</span></div>
        <div className="stat-row"><span className="stat-label">Unlimited approvals</span><span className="stat-value">{result.findings.filter((finding) => finding.category === "UNLIMITED_APPROVAL").length}</span></div>
      </div>
      <div className="panel"><div className="panel-title">Security findings</div><FindingsList findings={result.findings} /></div>
    </div>}
  </div>;
}
