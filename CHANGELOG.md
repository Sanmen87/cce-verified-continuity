# Changelog

## Unreleased

- Per-request verified recovery inspection with explicit DEGRADED reasons, requirement hashes and a documented Pi hook/transport boundary; observe-only defaults stay unchanged.
- Separate process/output observations; exit-zero tracebacks cannot produce PASS under the legacy approved-check policy. Registered check adapters can opt into explicit structured outcomes.
- Regression coverage for final SDK request bodies, downstream recovery removal, budget boundaries and fresh A-to-B continuation. See [validation](docs/recovery-verification-integrity.md).
- A published Pi 1.5.0 live continuity smoke is planned separately; these fixes are not included in npm `0.1.0-alpha.1`.
- Unknown native exit metadata now remains PROCESS_STATUS_UNKNOWN while explicit test failures and diagnostic-only tracebacks are represented independently. Expected-exception approved checks may use structured outcomes; shell output never creates a trusted receipt.
- A candidate Pi 1.5.0 A-to-B diagnostic delivered recovery in 26/26 transport packets: A passed 16/16; the unchanged partial B passed 21/21 post-hoc, while the primary run remained STOPPED at its watchdog. Real compaction and workflow-completion follow-ups are reported separately.

## 0.1.0-alpha.1 — 2026-11-19

- First packaged alpha of the existing local CCE core, Pi adapter and read-only MCP adapter.
- Compiled ESM entry points, declarations, explicit files/exports, grammar assets and independent tarball installation checks.
- Apache-2.0 for original CCE code; retained MIT provenance and notices for adapted components.
- Independent CWS opt-out while preserving Task Contract, Ledger and recovery; observe-only/lifecycle-off defaults unchanged.
- Windows/Linux no-LLM CI and guarded OIDC publishing workflow; private research artifacts excluded by an explicit public export.
- Experimental vector retrieval remains disabled by default. No claims of proven token savings, general coding advantage or automatic loop prevention.

- Package scope: `@sanmen87`; alpha dist-tag, no stable/latest claim.
- English/Russian README and a reproducible, model-free Pi/CCE continuity demonstration with separate public fixture acceptance.

External-user validation remains separate from packaging checks. This first publication bootstraps the package identities through the owner's npm CLI; OIDC/provenance for subsequent releases requires the npm Trusted Publisher configuration. No provenance is claimed for the bootstrap publication.
