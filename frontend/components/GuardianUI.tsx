const TIER_CLASS: Record<string, string> = {
  LOW: "tier-low",
  MEDIUM: "tier-medium",
  HIGH: "tier-high",
  CRITICAL: "tier-critical",
};

const DECISION_LABEL: Record<string, string> = {
  ALLOW: "ALLOW",
  REQUIRE_APPROVAL: "REQUIRES APPROVAL",
  DELAY: "DELAYED",
  BLOCK: "BLOCKED",
};

export function VerdictBadge({ decision, level }: { decision: string; level: string }) {
  return (
    <span className={`badge ${TIER_CLASS[level] ?? ""}`}>
      <span className="badge-dot" />
      {DECISION_LABEL[decision] ?? decision}
    </span>
  );
}

interface Finding {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
  description: string;
}

export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <div className="empty-state">No findings — nothing stood out in this analysis.</div>;
  }
  return (
    <div>
      {findings.map((f, i) => (
        <div className="finding" key={i}>
          <span className={`finding-sev ${TIER_CLASS[f.severity] ?? ""}`}>{f.severity}</span>
          <div className="finding-body">
            <p>{f.description}</p>
            <span className="finding-category">{f.category}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const STAGES = ["ANALYZE", "SIMULATE", "SCORE", "POLICY", "VERDICT"] as const;

export function PipelineTrace({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="trace">
      {STAGES.map((stage, i) => (
        <span key={stage} style={{ display: "flex", alignItems: "center" }}>
          <span className={`trace-step ${i < activeIndex ? "done" : i === activeIndex ? "active" : ""}`}>{stage}</span>
          {i < STAGES.length - 1 && <span className="trace-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}
