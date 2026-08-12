"use client";

import { useState } from "react";
import { analyzeContract, type ContractAnalysisResponse } from "@/lib/api";
import { FindingsList } from "@/components/GuardianUI";

const STATUS_TIER: Record<string, string> = {
  TRUSTED: "tier-low",
  UNKNOWN: "tier-medium",
  SUSPICIOUS: "tier-high",
  BLOCKED: "tier-critical",
};

export default function ContractsPage() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContractAnalysisResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await analyzeContract(address);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Registry lookup</h1>
        <p style={{ color: "var(--ward-mist)", margin: 0, fontSize: 14, maxWidth: 560 }}>
          Look up any contract's Guardian registry status, upgradeability, and ownership —
          the same read path RiskPolicy consults on-chain.
        </p>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginBottom: 20 }}>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="address">Contract address</label>
            <input id="address" required placeholder="0x..." value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Looking up…" : "Look up contract"}
          </button>
        </form>
        {error && <p style={{ color: "var(--signal-avalanche)", fontSize: 13, marginTop: 16 }}>{error}</p>}
      </div>

      {result && (
        <div className="grid-2">
          <div className="panel">
            <div className="panel-title">Status</div>
            <div className="stat-row">
              <span className="stat-label">Registry status</span>
              <span className={`badge ${STATUS_TIER[result.registryStatus] ?? ""}`}>
                <span className="badge-dot" />
                {result.registryStatus}
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Has code</span>
              <span className="stat-value">{result.hasCode ? "yes" : "no"}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Upgradeable proxy</span>
              <span className="stat-value">{result.upgradeability.isProxy ? result.upgradeability.pattern : "no"}</span>
            </div>
            {result.owner && (
              <div className="stat-row">
                <span className="stat-label">Owner</span>
                <span className="stat-value" style={{ fontSize: 11 }}>
                  {result.owner}
                </span>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="panel-title">Findings</div>
            <FindingsList findings={result.findings} />
          </div>
        </div>
      )}
    </div>
  );
}
