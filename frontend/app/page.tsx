"use client";

import { useState } from "react";
import { analyzeTransaction, type TransactionAnalysisResponse } from "@/lib/api";
import { WardDial } from "@/components/WardDial";
import { VerdictBadge, FindingsList, PipelineTrace } from "@/components/GuardianUI";
import { useWallet } from "@/lib/wallet";

function nativeToWei(value: string): string {
  const normalized = value.trim();
  if (normalized === "") return "0";
  if (!/^\d+(\.\d{1,18})?$/.test(normalized)) throw new Error("Native value must be a non-negative amount with up to 18 decimals.");
  const [whole, fraction = ""] = normalized.split(".");
  return `${BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18))}`;
}

function weiToNative(value: string): string {
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

const EXAMPLES = [
  {
    label: "Safe swap (trusted router)",
    from: "0x1111111111111111111111111111111111111a",
    target: "0x2222222222222222222222222222222222222b",
    value: "0",
    data: "0x",
  },
  {
    label: "Unlimited approval",
    from: "0x1111111111111111111111111111111111111a",
    target: "0x3333333333333333333333333333333333333c",
    value: "0",
    data:
      "0x095ea7b3000000000000000000000000ddddddddddddddddddddddddddddddddddddddddffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  },
];

export default function ConsolePage() {
  const [form, setForm] = useState({ from: "", target: "", value: "0", data: "0x" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransactionAnalysisResponse | null>(null);
  const [txHash, setTxHash] = useState("");
  const wallet = useWallet();

  async function importTransaction() {
    setError(null);
    try {
      const imported = await wallet.getTransaction(txHash);
      setForm({ ...imported, value: weiToNative(imported.value) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await analyzeTransaction({ ...form, value: nativeToWei(form.value) });
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
        <h1 style={{ fontSize: 28, margin: "0 0 8px", letterSpacing: "-0.01em" }}>Guardian Console</h1>
        <p style={{ color: "var(--ward-mist)", margin: 0, fontSize: 14, maxWidth: 560 }}>
          Submit a proposed transaction to see exactly what AegisX would decide before it ever
          reaches your vault — analysis, simulation, and the deterministic policy that has the
          final say.
        </p>
      </div>

      <PipelineTrace activeIndex={loading ? 2 : result ? 5 : -1} />

      <div className="grid-2">
        <div className="panel">
          <div className="panel-title">
            Proposed transaction
            <span className="mono" style={{ fontSize: 10 }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setForm({ from: ex.from, target: ex.target, value: ex.value, data: ex.data })}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--signal-mint)",
                    cursor: "pointer",
                    marginLeft: 10,
                    fontSize: 10,
                    textDecoration: "underline",
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </span>
          </div>
          <div className="field" style={{ marginBottom: 20 }}>
            <label htmlFor="txHash">Import existing transaction</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="txHash" placeholder="0x transaction hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
              <button className="btn" type="button" onClick={importTransaction} disabled={!txHash || wallet.busy}>Load</button>
            </div>
            <small style={{ color: "var(--ward-mist)" }}>Reads transaction details only; nothing is signed or broadcast.</small>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="from">Vault (from)</label>
              <input
                id="from"
                required
                placeholder="0x..."
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="target">Target contract</label>
              <input
                id="target"
                required
                placeholder="0x..."
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
              />
            </div>
            <div className="field">
            <label htmlFor="value">Value (AVAX/ETH)</label>
              <input id="value" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="data">Calldata</label>
              <textarea
                id="data"
                rows={3}
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Analyzing…" : "Analyze transaction"}
            </button>
          </form>
          {error && (
            <p style={{ color: "var(--signal-avalanche)", fontSize: 13, marginTop: 16 }}>{error}</p>
          )}
        </div>

        <div className="panel" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {result ? (
            <>
              <WardDial score={result.assessment.finalScore} level={result.assessment.riskLevel} />
              <div style={{ marginTop: 8 }}>
                <VerdictBadge decision={result.assessment.decision} level={result.assessment.riskLevel} />
              </div>
              <p style={{ fontSize: 12, color: "var(--ward-mist)", textAlign: "center", marginTop: 12, maxWidth: 220 }}>
                {result.assessment.reason}
              </p>
              {result.assessment.hardRuleTriggered && (
                <p className="mono" style={{ fontSize: 10, color: "var(--signal-avalanche)", marginTop: 4 }}>
                  HARD RULE TRIGGERED — not overridable by AI score
                </p>
              )}
              {!result.assessment.aiAssessment && (
                <p className="mono" style={{ fontSize: 10, color: "var(--signal-amber)", marginTop: 8, textAlign: "center" }}>
                  AI unavailable · deterministic policy only
                </p>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", color: "var(--ward-mist)", fontSize: 13 }}>
              <WardDial score={0} level="LOW" />
              <p style={{ marginTop: 8 }}>Submit a transaction to see its verdict.</p>
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="grid-2" style={{ marginTop: 20 }}>
          <div className="panel">
            <div className="panel-title">Findings</div>
            <FindingsList findings={result.assessment.findings} />
          </div>
          <div className="panel">
            <div className="panel-title">Evidence</div>
            <div className="stat-row">
              <span className="stat-label">Target registry status</span>
              <span className="stat-value">{result.transactionAnalysis.target.registryStatus}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Decoded function</span>
              <span className="stat-value">
                {result.transactionAnalysis.decodedCalldata.recognized
                  ? result.transactionAnalysis.decodedCalldata.functionName
                  : "unrecognized"}
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Unlimited approval</span>
              <span className="stat-value">{result.transactionAnalysis.isUnlimitedApproval ? "yes" : "no"}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Upgradeable proxy</span>
              <span className="stat-value">{result.transactionAnalysis.target.upgradeability.isProxy ? "yes" : "no"}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Simulation reverted</span>
              <span className="stat-value">{result.transactionAnalysis.simulation.reverted ? "yes" : "no"}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">AI tool calls used</span>
              <span className="stat-value">{result.toolCallCount}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
