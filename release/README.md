# Code Context Engine — 0.1.0-alpha.2

**English** · [Русский](README.RU.md)

Local TypeScript context and continuity tooling for coding agents. CCE indexes current source, preserves user requirements and history, and produces bounded recovery with source provenance. Pi is the first adapter; the core does not depend on Pi, Codex or a model service.

## See continuity work

1. **Task:** add contact archiving to a CRM while preserving tenant isolation, original records and active-list rules.
2. **Compaction:** CCE retains the four original requirements and Task State; an earlier PASS is marked STALE after the source changes.
3. **Continue:** without entering the contract again, a scripted continuation applies the completed code; a separate public test passes **6/6**.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run demo:continuity
```

[Reproducible short demo](examples/continuity/README.md): real Pi SDK manual compaction and the production CCE hook, with no model or GPU. Transcript and edits are scripted; this verifies the mechanism and separate fixture tests, **not autonomous LLM coding**. Original history stays addressable; see the generated before/after artifacts.

**Experimental alpha:** no demonstrated general coding advantage, token savings or automatic loop prevention. Model claims and file hashes do not prove correct code. See [limitations](release/docs/limitations.md).

Start with [QUICKSTART](QUICKSTART.md). Requirements: Node.js **>=22.19.0**, Git and ripgrep. Python 3 is used only for optional schema inspection and some development tests. The Pi adapter is tested with Pi **1.5.0**. Installation, tests and smoke do not require LM Studio or a downloaded model.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run build
npm run smoke:pi
node dist/packages/core/src/cli.js status .
```

The development workspaces are private and expose source TypeScript. `npm run release:pack` creates the actual distributable packages: compiled ESM, declarations, explicit exports, bundled grammar assets and license notices. `npm run release:clean-install` installs those archives in independent temporary projects and checks their runtime, types and Pi loader.

Package identifiers use the owner-confirmed `@sanmen87` npm scope. The [GitHub repository](https://github.com/Sanmen87/cce-verified-continuity) is public. The alpha version is `0.1.0-alpha.2`, distributed with the `alpha` tag. See [npm installation](QUICKSTART.md#install-the-alpha-from-npm) or use source/built archives; release preparation is described in [publishing](release/docs/publishing.md).

## Behavior and opt-in

Default: **observe-only**. Loading the extension keeps native prompts/history/tool exposure unchanged. CCE lifecycle is disabled. To try the installed adapter:

```sh
pi -e ./packages/pi-extension
```

For explicit assist and verified recovery, select a trusted configuration with `CCE_CONFIG`; see QUICKSTART. [Пошаговая настройка lifecycle на русском](docs/lifecycle-setup.ru.md) includes a ready-to-use config, Windows/Linux launch commands, diagnostics and disable instructions. History and tool-call/result pairs are preserved. CWS is included within enabled lifecycle; disable its recommendation projection with `lifecycle.currentWorkEnabled: false` without disabling the contract or Ledger.

| Included in alpha | Scope |
|---|---|
| Project Memory, AST, FTS, bounded graph | Local code evidence; hybrid backend opt-in |
| Task Contract, Ledger, Task State | Versioned user requirements and provenance |
| Pi compaction/recovery | Explicitly enabled lifecycle; incomplete/native fallback distinguished |
| Durable continuation | Explicit checkpoint/handle, same validated workspace and adapter support |
| CWS / Action Continuity | Deterministic recommendation; no execution authority or loop guarantee |
| Vector retrieval | Experimental, disabled by default; explicit local model required; no claimed Russian-query improvement |

Core packages: `@sanmen87/core`, `@sanmen87/pi-extension`, `@sanmen87/mcp`. The MCP adapter provides read-only retrieval and logs; it does not implement Pi lifecycle.

Alpha.2 reliability work separates [process/output evidence and trusted verification](docs/shell-evidence-validation.md), audits each observed recovery packet, and preserves unknown/stale states. The [Pi 1.5 candidate A-to-B diagnostic](docs/pi15-candidate-smoke-results.md) produced independently accepted code but ended at its watchdog; compaction and agent completion are separate checks. See the recorded limits before treating the result as a completed workflow or a token-savings claim.

## Evaluation results

[Public evaluations](evaluation/README.md) include methodology, negative and interrupted results, machine-readable summaries, 64 extracted provider-usage receipts, and the authored synthetic fixture with captured source evidence for 12 MCP trials. Historical scores and post-hoc classifications are preserved.

Run `npm run test:evaluation` for an **offline** audit of published hashes, arithmetic and the original MCP scoring/source ranges. It makes no model requests. Native CRM grading is not fully reproducible from this bundle: raw private archives and hidden acceptance code are withheld. The evaluation index explains these limits; general coding advantage and token savings remain unproven.

[Architecture](release/docs/architecture.md) · [Limitations](release/docs/limitations.md) · [Changelog](CHANGELOG.md) · [Apache-2.0](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
