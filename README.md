# AegisX

AegisX is a security layer for Avalanche wallets and GuardianVault transactions. It analyzes transactions before execution, inspects contract risk, scans wallet exposure, and applies deterministic security policy. AI can explain risk, but smart-contract rules remain the final authority.

## Features

- Pre-flight transaction analysis and simulation.
- Deterministic risk scoring and verdicts: allow, approval required, delay, or block.
- Unlimited-approval detection.
- Contract registry, ownership, and upgradeability analysis.
- Connected MetaMask/Core Wallet support.
- Avalanche Fuji network detection and switching.
- Wallet security scans for native balance, token balances, and allowances.
- Automatic recent ERC-20 token and approval discovery from on-chain logs.
- Monitoring alerts for registry and wallet-related activity.
- Responsive Ward Console interface for desktop and mobile.

## Project structure

```text
backend/     Express + TypeScript analysis API and RPC integrations
frontend/    Next.js Ward Console application
contracts/   Solidity Guardian contracts, scripts, and tests
```

## Requirements

- Node.js 20 or newer.
- npm.
- A browser wallet such as MetaMask or Core Wallet for wallet connection.
- Optional: Foundry, for compiling and testing the Solidity contracts.

## Run locally

Start the backend:

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Start the frontend in another terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The backend health endpoint is available at [http://localhost:8787/health](http://localhost:8787/health).

## Main pages

- `/` — transaction analysis console.
- `/scan` — connected-wallet security scan and recent activity discovery.
- `/contracts` — contract registry and upgradeability lookup.
- `/alerts` — monitoring alerts and bounded scan trigger.

## Important environment variables

Backend `.env`:

```env
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
CHAIN_ID=43113
PORT=8787
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
MAX_EVENT_LOOKBACK_BLOCKS=2000
GEMINI_API_KEY=
ENABLE_ONCHAIN_PROPOSE=false
```

Frontend `.env.local`:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787
```

Never commit `.env` or private keys. Use a dedicated, low-balance Fuji key for testing and rotate any key that has been exposed.

## Wallet scanning limitations

The automatic scan discovers ERC-20 tokens and approvals from the configured recent block window. It does not guarantee lifetime discovery and cannot identify every malicious contract or hack using RPC alone. Complete historical coverage requires an indexed data source and reputation/threat-intelligence feeds.

Scan results are security evidence, not a guarantee that a wallet is safe.

## Validation

```bash
cd backend
npm run typecheck

cd ../frontend
npm run typecheck
```

The frontend production build may require internet access because the current layout loads Google Fonts during the Next.js build.

## Security model

The backend is designed to analyze and explain. GuardianVault and the on-chain RiskPolicy enforce the final transaction rules. Keep analysis, proposal, approval, and execution as separate steps. Do not enable on-chain proposing until the deployed contracts, agent permissions, session bounds, and testnet configuration have been verified.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the Fuji deployment runbook and the package READMEs for component-specific details.
