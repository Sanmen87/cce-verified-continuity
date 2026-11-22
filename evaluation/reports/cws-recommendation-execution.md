# CWS recommendation execution — 22 November 2026

Derived public report; historical raw originals remain private. This was a local development candidate before alpha.3 packaging, not a trial of an installed public npm alpha.3 release. [Protocol](../protocols/cws-recommendation-execution.md), [projected results](../results/cws-recommendation-execution.json), [32 usage receipts](../results/cws-execution-usage-receipts.json).

Pi 1.5.0, local IQ3_XXS `cyber-tiel-coder-35b-a3b-mtp`, window 81 920. Same model load settings and cold reload before every arm. A: CWS assist; B: only the current next_action disabled. Objective state and verified memory remain available.

| Pair / arm | Independent acceptance | Delta from 17/21 seed | Minutes | Input | Output | Reasoning (included in output) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 A | PASS 21/21 | +4 | 42.34 | 387819 | 17770 | 12928 |
| 1 B | PASS 21/21 | +4 | 39.71 | 374189 | 15072 | 12751 |
| 2 B | FAIL 20/21 | +3 | 34.34 | 366074 | 12254 | 9999 |
| 2 A | FAIL 20/21 | +3 | 46.36 | 388769 | 20703 | 17409 |

Основная метрика: **по 1/2 полностью принятых задач**, то есть 50% у каждого варианта. По отдельным cases — 41/42 у каждого; это не доля завершённых задач. В обеих парах B использовала меньше input/output и времени, но это маленькая диагностическая выборка.

Totals A/B: input **776588 / 740263** (B −4.68%); output **38473 / 27326** (−28.97%); reasoning **30337 / 22750** (−25.01%); elapsed **88.70 / 74.04 minutes** (−16.52%). The first fully passing pair alone: input −3.51%, output −15.18%, time −6.22%. Both FAIL in pair 2 remain failures with distinct defects; their lower costs are not independently a success.

**B2 failure:** contacts.update raised a TypeError because the generated module-level list function shadowed Python's builtin. **A2 failure:** contacts.get returned an archived row with status 200 rather than the explicitly required 404. The stage-B prompt was present in every saved provider packet; missing task delivery is not established as the cause.

All four arms stopped at eight complete tool cycles, not the watchdog, before autonomous tests/final reporting. Model-invoked approved checks: **0**. B2's sole Bash command inspected test-file definitions/line count; it did not execute tests. Host checks and independent grading ran after stopping, and do not count as autonomous verification. Workflow success: **0/4**, separate from code acceptance **2/4**.

Mandatory requirements were preserved in **32/32** transport packets: **29 FULL + 3 MANDATORY**, no DEGRADED. A2 packets 6–8 omitted optional CWS; current next_action was present in **13/16 A** packets and **0/16 B**. All arms used an identical existing compacted seed; new in-trial compactions: **0**. Historical recommendations were shared unchanged in both arms. No voluntary CCE retrieval tools were called; automatic recovery was exercised.

No extension/transport errors, incomplete tool pairs, or identical observed reads without intervening edits were found. This does not exclude repeated reasoning or prove loop prevention. First-edit timing reversed by pair: A earlier in pair 1, B earlier in pair 2. Cache usage and complete per-request TTFT are unavailable. Native output capacity adjustments were preserved; no model settings were tuned between arms.

Offline public verification checks inventory, receipt sums and stated rates. Private audit additionally checked raw SSE usage, payload/source SHA, workspaces and tool pairs. Public JSON and receipts do not independently reproduce CRM grading or the full provider context. No Pi-only arm, general token-savings claim, causal loop-prevention claim or automatic default change follows from this series.
