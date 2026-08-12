#!/usr/bin/env node
// Regenerates src/blockchain/simulatorArtifact.ts from the compiled
// TransactionSimulator.sol Foundry artifact. Run this any time the contract
// changes: `node scripts/generate-simulator-artifact.mjs`
//
// This keeps the backend's copy of the ABI/bytecode as a checked-in,
// generated file (not hand-transcribed) so it can never silently drift from
// the Solidity source in ../contracts.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.resolve(
  __dirname,
  "../../contracts/out/TransactionSimulator.sol/TransactionSimulator.json"
);
const outPath = path.resolve(__dirname, "../src/blockchain/simulatorArtifact.ts");

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const deployedBytecode = artifact.deployedBytecode.object;
const abi = artifact.abi;

const header = `// GENERATED FILE — do not hand-edit.
// Regenerate with: node scripts/generate-simulator-artifact.mjs
// Source: contracts/src/simulation/TransactionSimulator.sol
`;

const content = `${header}
export const simulatorAbi = ${JSON.stringify(abi, null, 2)} as const;

export const simulatorDeployedBytecode = "${deployedBytecode}" as \`0x\${string}\`;
`;

writeFileSync(outPath, content);
console.log(`Wrote ${outPath} (${deployedBytecode.length / 2} bytes of runtime bytecode)`);
