> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `d0b0bfa8d210be0b893dd0eced18da74089695a9d06b2e9f03de62cffe7f94cb` (source-87). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# DjangoCRM benchmark protocol

v0.2 status: real local-model pilot results are in
[benchmark-results.md](../reports/first-pilot.md). The original v0.1 preparation
protocol below is retained; actual limitations are in benchmark-audit.md.
Upstream reviewed snapshot: **b1e9f2ea25bb2c755302d661c2f12fa716774f3e**.
Source: [DjangoCRM](https://github.com/DjangoCRM/django-crm/tree/b1e9f2ea25bb2c755302d661c2f12fa716774f3e).
Its AGPL code is a separate experimental subject, never part of CCE distribution.

## Independent clones

```powershell
npm.cmd run bench:prepare -- --dry-run
npm.cmd run bench:prepare -- --target .bench/trial-001
# Three independent arms for one task:
npm.cmd run bench:prepare -- --triplet --target .bench/trial-002
```

The first command only prints a plan and is tested. The second performs explicit
network clone operations into a new target. It refuses existing clone/state
destinations, creates two full independent clones, checks out the same exact SHA
without force, verifies clean worktrees, and records tool versions and launch arrays
in manifest.json. No dependency installer or CRM test is automatically executed.
Partial failure leaves files for inspection; use a new target instead of cleanup.

```text
trial-001/
  crm-baseline/          # Pi without CCE
  crm-cce/               # same initial SHA, Pi with CCE
  state/baseline/agent/  # separate models.json, settings, no shared memory
  state/baseline/sessions/
  state/cce/agent/
  state/cce/sessions/
  state/{baseline,cce}/cce.json
  manifest.json
```

Before launching either Pi, set PI_CODING_AGENT_DIR to that arm's agent directory,
pass its --session-dir explicitly, and use its working directory. Set CCE_CONFIG
to the cce arm's explicit cce.json. The generated launch arrays disable extension,
skill, template and theme discovery, then add only CCE with -e in the treatment.
Inspect the pinned CRM .pi settings/context files so both arms have identical
project instructions and no extra project-memory extension. Keep both local SQLite
files and model server conversation/KV state independent. Add .context-engine/
to each clone's .git/info/exclude (same ignore-only modification in both arms).

Use an identical localhost-only OpenAI-compatible model configuration in each
agent/models.json. Pi's official [local model guide](https://pi.dev/docs/latest/llama-cpp)
describes the provider setup. Require the same model id/weights checksum,
quantization, server version/flags, endpoint, temperature, seed (when supported),
top_p, maxTokens, contextWindow=65536, reasoning settings and compaction reserve=16384.
Record all parameters in manifest.json before any measured run. The script writes
null for unknown model/generation parameters instead of fabricating them.

Three conditions must be distinct: baseline; CCE observe-only; CCE assist. Never
label observe-only as an optimization. Prepare fresh paired clones per condition,
task and repetition; never reuse checkpoints or index state across arms.

## Upstream CRM tests

Reviewed official [installation/test instructions](https://github.com/DjangoCRM/django-crm/blob/b1e9f2ea25bb2c755302d661c2f12fa716774f3e/docs/installation_and_configuration_guide.md):
create an independent Python venv in each clone, install the pinned clone's
requirements.txt, then run its original suite:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py test tests/ --noinput
```

Use default development SQLite settings for an initial controlled run; upstream
describes MySQL/PostgreSQL for regular CRM operation. Record Python, pip, Django,
database and actual pip freeze. If the pinned checkout requires DB/configuration
changes, apply the same test-only settings to both arms and record them outside the
agent's task. Do not run setupdata automatically; it creates accounts and seed data.
No CRM environment was installed in v0.1. The v0.2 Python environment and executed
original-suite results are recorded in benchmark-results.md and its JSON artifact.

## Tasks and measurements

Start with the same immutable task text in both arms:
1. Trace Deal model's direct dependencies and identify source paths.
2. Add a specified object-level permission check with regression tests.
3. Implement Deal status history with regression tests (complex condition).

Before measured runs, write precise acceptance criteria and automated hidden
acceptance tests outside both clones. Record their SHA, but do not expose them to
the agent. Hold task wording, tests and initial commit constant within each pair.
Do not allow the agent to edit or see the hidden test oracle.

Collect Pi JSON/session events and local provider usage per request: actual
input/output/cache tokens when supplied, separate estimated context bytes/tokens,
LLM calls, compactions, wall duration, changed-file count, upstream test exit status
and hidden acceptance pass/fail. CCE metrics are numeric only in SQLite; provider
usage is measured as reported and context estimate is labelled estimated.
Collect baseline counters from the same Pi event stream; CCE is not loaded there.
Disable/log all unrelated extensions and background model calls. Redact secrets
before exporting logs; never publish raw CRM source or prompt dumps by default.

For restart experiments, interrupt at a predeclared stage. Preserve each worktree,
session directory and state independently, resume the same Pi session, and verify
pending work. In the CCE arm explicitly save/load a task checkpoint. Intentionally
change a source or HEAD in a separate trial to verify requiresRevalidation; do not
silently continue from stale assumptions or reset the workspace.

Run at least three paired repetitions and alternate arm order. Report every trial,
failed/aborted runs, median and spread, success rate and token source. No claim of
improvement is justified by the current implementation tests or dry-run.
