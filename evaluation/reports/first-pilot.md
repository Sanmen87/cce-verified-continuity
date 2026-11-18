> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `13f732e25e315a45c02e47a829fd37e1d4e71da9c438c238ef024118a784f87b` (source-85). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# First real local-model pilot — 2026-11-04

9/9 main runs recorded. One pilot per task/mode; no statistical confidence claim.
Calibration is excluded. Trials ran sequentially: A baseline/observe-only/assist,
B assist/baseline/observe-only, C observe-only/assist/baseline.

Model: Cyber-Tiel-Coder-35B-A3B-MTP-UD-Q2_K_XL.gguf, SHA-256
9fd8dae3d4fb9be2ecaea0b71fe9cddb361c0aef6fdc1331798de8e6483183a8.
LM Studio 0.4.27+2, llama.cpp Vulkan AVX2 backend 2.69.0; Pi 1.4.0.
Endpoint http://127.0.0.1:1234/v1; loaded context 65536 from native model API;
temperature 0.2, top_p 0.95, seed 42 requested, max output 2048 per request.
Seed determinism is not established. The loaded model reports max context 262144;
that is distinct from its active 65536 configuration. No full-window stress test was run.

| Task | Mode | Solver stop | Acceptance | Input tokens | Output tokens | LLM requests | CCE calls | Compactions | Seconds |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| A | baseline | complete | PASS | 46889 | 2259 | 6 | 0 | 0 | 126.1 |
| A | observe-only | complete | PASS | 46889 | 2259 | 6 | 0 | 0 | 120.0 |
| A | assist | complete | PASS | 29882 | 1544 | 6 | 1 | 0 | 80.8 |
| B | baseline | request-limit | FAIL | 244638 | 1057 | 14 | 0 | 0 | 305.0 |
| B | observe-only | request-limit | FAIL | 244638 | 1057 | 14 | 0 | 0 | 298.5 |
| B | assist | request-limit | FAIL | 177248 | 2908 | 14 | 1 | 0 | 233.4 |
| C | baseline | request-limit | FAIL | 181394 | 4460 | 14 | 0 | 0 | 314.0 |
| C | observe-only | output-limit | FAIL | 152692 | 3292 | 11 | 0 | 0 | 299.6 |
| C | assist | request-limit | FAIL | 111025 | 1184 | 14 | 2 | 0 | 133.9 |

Tokens are provider-reported values, summed across calls, distinct from the stored
UTF-8 byte estimates. Cache read/write counters absent from the server are UNKNOWN,
not measured zeros. Request metadata includes tool-call IDs, hashes of exact tool
results, and the subsequent requests consuming those results. It contains no raw
prompts, model reasoning, source snippets or credentials.

All source copies start clean at CRM b1e9f2ea25bb2c755302d661c2f12fa716774f3e.
Sessions, SQLite and agent configs are separate. Baseline has no CCE extension.
The common Pi SDK solver tools are workspace-only read/grep/find/edit/write;
arbitrary shell is excluded equally in all modes, so hidden external tests are
not readable or executable by the solver. This is a controlled Pi tool allowlist,
not an unrestricted default-shell Pi comparison. The common prompt normalizes
the cwd section to <workspace> while actual tools still target their own clones.

Upstream CRM setup initially failed with App Control DLL denials for NumPy mtrand,
then pandas offsets. Subsequent normal imports passed without changing policy or
packages. The third untouched-suite attempt ran 393 tests in 25.418 seconds:
5 failures, 4 skipped, no errors. All failures assert immediate notification email
delivery. An isolated diagnostic waiting for the existing background queue passed
all five; it is not substituted for the original FAIL. The original control CRM
and diagnostic's source files were not changed.
Python 3.15.0, Django 6.0.8, SQLite 3.53.4; exact requirements installed as wheels.

A acceptance compares the complete model/base/relation artifact with an independent
AST oracle from an untouched pinned checkout. B checks the pure permission predicate
against a truth table plus static admin integration and added test methods. C has independent real database tests covering
transitions, no-op, nulls, update_fields, deletion and atomic failure. Structural
failures are FAIL; a DLL failure before these database tests is NOT_RUN, never PASS.

The C oracle was itself verified on a separate known-good control: seven real
Django/SQLite tests PASS. This control solution is outside all main solver clones
and is not a model result. All six B/C solver runs failed to supply the required
implementation/test/migration artifacts within the declared budgets. C baseline
left a partial change in crm/models/deal.py. Its post-solver upstream suite ran
388 tests: 5 failures and 16 errors;
the added history table is missing because no migration was delivered, and initial
saves with a non-null stage incorrectly attempt to record history. Other B/C arms
made no application-source changes. These are failed task outcomes, not token wins.

Checkpoint load: **PASS**; same Pi session: true;
freshness revalidation required: false; task continuation acceptance: **PASS**.
The stop occurred after 2 real provider turns, then a separate process issued
6 requests and completed A. One confirmed file/hash step and one pending action
were restored. The original raw turn_end counter includes a synthetic abort event; it is not an extra LLM request.

Machine-readable evidence: pilot-2026-11-04.json (original artifact not bundled; see [publication scope](../README.md)).
Local detailed evidence and Pi session files are under .bench/results (Git ignored).
Raw Pi sessions contain local task/source data and are not exported in this report.
See [analysis](first-pilot-analysis.md), next iteration (original artifact not bundled; see [publication scope](../README.md)), and
benchmark audit (original artifact not bundled; see [publication scope](../README.md)) for limitations and reproduction.
