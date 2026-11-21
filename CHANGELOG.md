# Changelog

## 0.1.0-alpha.2 — 2026-11-21

- Per-request verified recovery inspection with explicit DEGRADED reasons, requirement hashes and a documented Pi hook/transport boundary; observe-only defaults stay unchanged.
- Separate process/output observations; exit-zero tracebacks cannot produce PASS under the legacy approved-check policy. Registered check adapters can opt into explicit structured outcomes.
- Regression coverage for final SDK request bodies, downstream recovery removal, budget boundaries and fresh A-to-B continuation. See [validation](docs/recovery-verification-integrity.md).
- Candidate archives were exercised with real Pi 1.5.0 and a local model. Validation of an installed public-registry release remains separate; npm `0.1.0-alpha.1` is immutable.
- Unknown native exit metadata now remains PROCESS_STATUS_UNKNOWN while explicit test failures and diagnostic-only tracebacks are represented independently. Expected-exception approved checks may use structured outcomes; shell output never creates a trusted receipt.
- A candidate Pi 1.5.0 A-to-B diagnostic delivered recovery in 26/26 transport packets: A passed 16/16; the unchanged partial B passed 21/21 post-hoc, while the primary run remained STOPPED at its watchdog. Real compaction and workflow-completion follow-ups are reported separately.
- A manual SDK compaction preserved the raw history and removed the original goal from the retained tail. The live continuation stopped at its 20-minute watchdog without source edits (17/21 acceptance). All four packets contained the original clauses; the fourth explicitly reported degraded recovery and absent Task State at the budget boundary. This is mechanism coverage, not successful coding continuity or an automatic-threshold test. See [terminal diagnostics](docs/pi15-resume-smokes-results.md).
- Runtime files in the final archives are byte-identical to the live-tested candidate; all three exact archives passed fresh Node 22.19 consumer installation. No general token-savings, coding-superiority or automatic-loop-prevention claim is made.
- A separate B resume kept independent API acceptance at 21/21 and full recovery at 8/8, but stopped at its watchdog after a model-authored test indentation error and repeated reads. The workflow did not finish; a native traceback was retained as a diagnostic with unknown process status, without a trusted PASS.

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
