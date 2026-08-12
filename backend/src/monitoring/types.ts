export const ALERT_TYPES = [
  "HIGH_RISK_TRANSACTION",
  "UNLIMITED_APPROVAL",
  "SUSPICIOUS_CONTRACT",
  "LARGE_TRANSFER",
  "UPGRADE_DETECTED",
  "POLICY_VIOLATION",
  "WALLET_ANOMALY",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface Alert {
  type: AlertType;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  /// The on-chain address most relevant to this alert (a target contract, a
  /// wallet, a proposal hash rendered as a string) — kept generic since alert
  /// sources vary widely.
  subject: string;
  blockNumber?: bigint;
  txHash?: string;
  detectedAt: string; // ISO timestamp — when THIS scan pass found it, not when the underlying event happened
}
