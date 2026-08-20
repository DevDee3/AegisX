"use client";

import { useEffect, useState } from "react";
import { getAlerts, triggerScan, type Alert } from "@/lib/api";

const SEVERITY_TIER: Record<string, string> = { LOW: "tier-low", MEDIUM: "tier-medium", HIGH: "tier-high", CRITICAL: "tier-critical" };

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAlerts() {
    setLoading(true); setError(null);
    try { setAlerts(await getAlerts()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }

  async function runScan() {
    setScanning(true); setError(null);
    try { await triggerScan(); await loadAlerts(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setScanning(false); }
  }

  useEffect(() => { loadAlerts(); }, []);

  return <div>
    <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Alerts</h1>
        <p style={{ color: "var(--ward-mist)", margin: 0, fontSize: 14, maxWidth: 560 }}>
          Guardian-specific monitoring: registry changes, blocked transactions, and upgrade drift.
          This is not a general chain activity feed.
        </p>
      </div>
      <button className="btn" onClick={runScan} disabled={scanning}>{scanning ? "Scanning..." : "Run scan now"}</button>
    </div>
    {error && <p style={{ color: "var(--signal-avalanche)", fontSize: 13, marginBottom: 16 }}>{error}</p>}
    <div className="panel">
      <div className="panel-title">Recent Guardian alerts {loading && "· loading..."}</div>
      {alerts.length === 0 ? <div className="empty-state">
        No Guardian anomalies were found in the configured recent block window. Ordinary wallet activity belongs in Wallet Scan.
      </div> : alerts.map((a, i) => <div className="finding" key={i}>
        <span className={`finding-sev ${SEVERITY_TIER[a.severity] ?? ""}`}>{a.severity}</span>
        <div className="finding-body"><p>{a.message}</p><span className="finding-category">{a.type} · {a.subject}</span></div>
      </div>)}
    </div>
  </div>;
}
