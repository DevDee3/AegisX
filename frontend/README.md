# AegisX — Frontend (Phase 7: Guardian Console)

Next.js (App Router) frontend for AegisX — the "Ward Console" surfaces the
same pipeline built in Phases 3–6 of `../backend`: submit a proposed
transaction, watch it move through ANALYZE → SIMULATE → SCORE → POLICY →
VERDICT, and see the deterministic decision before anything ever reaches
`GuardianVault`.

## Design

Not a generic dashboard template. The design system ("Ward Console") is
built from the project's own real content rather than decoration:

- **Color** is functional, not decorative: the only accents are the four
  risk-tier colors (mint/amber/ember/avalanche-red), and each appears only
  in its designated severity context — LOW/MEDIUM/HIGH/CRITICAL map directly
  to `RiskPolicy.sol`'s actual on-chain thresholds (30/60/80).
- **The signature element, `WardDial`** (`components/WardDial.tsx`), is an
  arc gauge whose tick marks sit at exactly those three thresholds. It's not
  a generic progress ring — it's a literal rendering of the deterministic
  policy contract's boundaries.
- **The pipeline trace** (`components/GuardianUI.tsx`'s `PipelineTrace`) is a
  structural device that encodes something true: it names the actual stages
  `assess.ts`/`pipeline.ts` execute server-side, not an arbitrary sequence.
- **Type**: Instrument Sans for display/body, JetBrains Mono for all
  on-chain data (addresses, hashes, scores) — monospace where the content
  actually is tabular/fixed-width data, not as a decorative "technical" cue.

## Pages

```
app/
  page.tsx              Guardian Console (flagship) — submit a transaction,
                         see WardDial + verdict + findings + evidence, via
                         POST /api/analyze/transaction
  vault/page.tsx          Wallet exposure — native + per-token balances,
                         via POST /api/analyze/wallet
  contracts/page.tsx      Registry lookup — trust status, upgradeability,
                         ownership, via POST /api/analyze/contract
  alerts/page.tsx          Monitoring feed — recent alerts + a manual
                         "run scan now" trigger, via GET/POST /api/monitor/*
```

All four call `../backend` directly — this frontend has no server-side logic
of its own beyond what Next.js needs to render pages; every actual decision
still happens in the deterministic on-chain `RiskPolicy` and the backend's
`combine()` mirror of it, exactly as designed since Phase 3.

## Running

```bash
npm install
cp .env.example .env   # point NEXT_PUBLIC_BACKEND_URL at your backend
npm run dev
```

For production, set `NEXT_PUBLIC_BACKEND_URL` in the frontend hosting
provider to the deployed backend's public HTTPS URL before rebuilding. This
variable is embedded at build time.

Requires `../backend` running (see its README) for any page to show real
data — this frontend has nothing to fall back to on its own, by design; it's
a view onto the pipeline, not a second implementation of it.

## Verified in this environment / not verified

- `npx tsc --noEmit` and `next build` both succeed cleanly (4 static pages,
  zero type errors) — verified here by temporarily swapping the Google Fonts
  imports for system fonts, since this sandbox's network doesn't reach
  `fonts.googleapis.com` (same category of limitation as the Fuji RPC access
  noted in `../backend/README.md`). The real Google Fonts imports are what's
  shipped in `app/layout.tsx`; a normal deployment environment (Vercel,
  local dev with internet access) will fetch them at build time as usual.
- Not exercised end-to-end against a live backend + live chain in this
  sandbox, for the same RPC-access reason as Phases 4–6.

## Not yet built

- No wallet connect (wagmi/viem browser integration) — forms currently take
  a "from" vault address as plain text input rather than reading it from a
  connected wallet. The spec calls for this; it's a reasonable next
  increment once there's a live testnet deployment to connect to.
- No `/policies` or `/settings` pages from the original spec's suggested
  page list — the four built here cover the core analysis/monitoring loop;
  policy configuration and settings would primarily call endpoints that
  don't exist yet either (there's no `/api/policy` route in the backend).
- No transaction history page — would need the Postgres persistence layer
  that's also still pending on the backend side.
