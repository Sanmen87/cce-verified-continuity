# Quickstart — CCE alpha

CCE is local tooling. A model server is not required to install, build, index source or run the zero-generation smoke. Normal use through a coding agent still requires that agent's configured model.

## Requirements

- Node.js >=22.19.0, npm, Git, ripgrep (`rg --version`).
- Pi 1.5.0 for the adapter; core and MCP work without Pi. Keep the host updated; the older benchmark pin is not a security recommendation.
- Python 3 is optional for schema evidence, and required by some development integration tests. An unavailable inspector must report UNKNOWN.

## From a source checkout

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run test:public
npm run build
npm run smoke:pi
node dist/packages/core/src/cli.js search . ContextEngine
pi -e ./packages/pi-extension
```

Use `npm.cmd` and `pi.cmd` in PowerShell if execution policy blocks `.ps1` shims. No policy change is required. Pi runs its own coding tools; review its shell setup for your platform.

## Install the built archives in another project

Build with `npm run release:pack`. Copy the three archives listed in `release-artifacts/latest.json` into a clean directory, then install them together, using the confirmed @sanmen87 scope:

```sh
npm init -y
npm install --ignore-scripts ./sanmen87-core-0.1.0-alpha.1.tgz ./sanmen87-pi-extension-0.1.0-alpha.1.tgz ./sanmen87-mcp-0.1.0-alpha.1.tgz
pi -e ./node_modules/@sanmen87/pi-extension
```

Pi and TypeBox are supplied by the host. Their `*` peers are optional to prevent npm from implicitly installing a second coding agent; explicitly install Pi 1.5.0 if you do not already have a working host. For standalone programmatic adapter imports, provide the host packages in the consumer project. Core alone requires neither Pi nor its SDKs.

```js
import { ContextEngine } from '@sanmen87/core';
const engine = await ContextEngine.open('.');
try {
  const found = await engine.searchCode('MyFunction');
  console.log(await engine.buildContext({ task: 'Inspect MyFunction', hits: found.hits }));
} finally { engine.close(); }
```

Node is ESM. Declaration files are included; TypeScript consumers need their normal Node.js types. Adapter-support `@sanmen87/core/internal/*` exports are unstable during alpha.

Core and core+MCP are checked with strict NodeNext declarations and `skipLibCheck:false`. The tested Pi host currently has upstream TS1543 errors in generated provider JSON declarations; Pi TypeScript consumers need `skipLibCheck:true` until the host fixes those declarations. Application `strict` remains enabled. The clean-install report records this exception rather than reporting a fully strict host declaration pass.

## Explicit assist and recovery

Create a trusted `cce.json` in your project:

```json
{
  "mode": "assist",
  "assist": { "strategy": "combined" },
  "retrieval": { "backend": "hybrid-native" },
  "hybrid": { "enableVector": false },
  "quality": { "coverageEnabled": true, "guardEnabled": true },
  "lifecycle": {
    "enabled": true,
    "ledgerEnabled": true,
    "projectionEnabled": true,
    "historyRecallEnabled": true,
    "recoveryPolicy": "verified-state",
    "compactionMode": "deterministic",
    "handoffBudgetTokens": 12000,
    "recoveryReserveTokens": 2048,
    "currentWorkEnabled": true
  }
}
```

PowerShell:

```powershell
$env:CCE_CONFIG = (Resolve-Path ./cce.json).Path
pi -e ./node_modules/@sanmen87/pi-extension
```

Bash:

```sh
CCE_CONFIG="$PWD/cce.json" pi -e ./node_modules/@sanmen87/pi-extension
```

Reload the extension after changing configuration. `CCE_CONFIG` is read only when explicitly selected by the host; untrusted project configuration is not automatically executed.

- Disable CWS only: set `lifecycle.currentWorkEnabled` to `false`. Requirements, provenance and Ledger stay available.
- Return to the default: unset `CCE_CONFIG` and reload Pi. Lifecycle is off and mode is observe-only.
- Vector retrieval stays off unless explicitly configured with a local embedding endpoint and model. It is not needed for AST/FTS/graph.
- Verification becomes authoritative only through registered host-approved checks bound to current sources. Plain shell output and model claims remain observations.

Project state lives under `.context-engine/`; exclude it from Git and publication. Checkpoint history may contain private source and prompts. Never publish that directory.

## MCP retrieval

```sh
npx --no-install cce-mcp --root . --log ./cce-tools.log.jsonl
```

The fixed workspace is an access boundary. Logs record tool metadata, source hashes and sizes; treat logs as private. MCP retrieval is separate from lifecycle and session continuation.
