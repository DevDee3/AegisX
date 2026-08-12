const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
function requireAddress(value: string, label: string) {
  if (!EVM_ADDRESS.test(value.trim())) throw new Error(`${label} must be a valid 0x-prefixed EVM address (40 hexadecimal characters).`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    });
  } catch {
    throw new Error(`AegisX backend is unavailable at ${BACKEND_URL}. Start the backend or check NEXT_PUBLIC_BACKEND_URL.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface Finding {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
  description: string;
}

export interface RiskAssessment {
  aiAssessment: { riskScore: number; riskLevel: string; findings: Finding[]; summary: string } | null;
  finalScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  decision: "ALLOW" | "REQUIRE_APPROVAL" | "DELAY" | "BLOCK";
  hardRuleTriggered: boolean;
  findings: Finding[];
  reason: string;
}

export interface TransactionAnalysisResponse {
  assessment: RiskAssessment;
  toolCallCount: number;
  transactionAnalysis: {
    target: {
      address: string;
      hasCode: boolean;
      registryStatus: "UNKNOWN" | "TRUSTED" | "SUSPICIOUS" | "BLOCKED";
      upgradeability: { isProxy: boolean; pattern: string };
      owner?: string;
    };
    decodedCalldata: { recognized: boolean; functionName: string; args?: Record<string, unknown> };
    isUnlimitedApproval: boolean;
    simulation: { reverted: boolean; revertReason?: string };
    balanceDiffUnavailableReason?: string;
  };
}

export function analyzeTransaction(input: { from: string; target: string; value: string; data: string }) {
  requireAddress(input.from, "From address");
  requireAddress(input.target, "Target address");
  if (!/^0x[0-9a-fA-F]*$/.test(input.data)) throw new Error("Calldata must be hexadecimal and begin with 0x.");
  if (!/^\d+$/.test(input.value)) throw new Error("Value must be a non-negative integer in wei.");
  return request<TransactionAnalysisResponse>("/api/analyze/transaction", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ContractAnalysisResponse {
  address: string;
  hasCode: boolean;
  registryStatus: "UNKNOWN" | "TRUSTED" | "SUSPICIOUS" | "BLOCKED";
  upgradeability: { isProxy: boolean; pattern: string; implementation?: string };
  owner?: string;
  findings: Finding[];
}

export function analyzeContract(address: string) {
  requireAddress(address, "Contract address");
  return request<ContractAnalysisResponse>("/api/analyze/contract", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export interface WalletAnalysisResponse {
  wallet: string;
  nativeBalance: string;
  tokenExposure: { token: string; balance: string; allowances: { spender: string; amount: string }[] }[];
  findings: Finding[];
}

export function analyzeWallet(wallet: string, tokens: { token: string; spendersToCheck: string[] }[]) {
  requireAddress(wallet, "Wallet address");
  tokens.forEach((item) => { requireAddress(item.token, "Token address"); item.spendersToCheck.forEach((spender) => requireAddress(spender, "Spender address")); });
  return request<WalletAnalysisResponse>("/api/analyze/wallet", {
    method: "POST",
    body: JSON.stringify({ wallet, tokens }),
  });
}

export function discoverWallet(wallet: string) {
  requireAddress(wallet, "Wallet address");
  return request<{ fromBlock: string; toBlock: string; tokens: { token: string; spendersToCheck: string[] }[] }>("/api/analyze/wallet/discover", {
    method: "POST", body: JSON.stringify({ wallet }),
  });
}

export interface Alert {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  subject: string;
  blockNumber?: string;
  txHash?: string;
  detectedAt: string;
}

export function getAlerts(limit = 50) {
  return request<Alert[]>(`/api/monitor/alerts?limit=${limit}`);
}

export function triggerScan(body: unknown = {}) {
  return request<{ fromBlock: string; toBlock: string; alerts: Alert[] }>("/api/monitor/scan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getHealth() {
  return request<{ status: string; chainId: number }>("/health");
}
