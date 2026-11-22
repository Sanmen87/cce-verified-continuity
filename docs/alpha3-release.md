# CCE 0.1.0-alpha.3 — CWS recommendation control

Experimental alpha, selected for the **latest npm channel** at the owner's request. This does not designate a stable 0.1.0 release.

## Changes / изменения

- Independent CWS modes `off / observe / assist`. Off removes only current next_action; observe computes it for a trusted diagnostic callback without sending it to the model. State projection and verified memory remain available; recommendation default stays assist.
- Scoped diagnostics report the projection hash, not a claimed provider delivery. Shadow proposals are excluded from model-visible state, tools and Ledger; telemetry exceptions cannot block recovery.
- Adaptive recovery packs original contract and mandatory verified state before optional details, with explicit MANDATORY/DEGRADED outcomes and final packet checks. Delivery freshness and provider budget boundaries are covered by regressions. No model-window increase or fixed 80K default is introduced in the library.
- New configuration, final SDK packet and clean-consumer type coverage. Existing Task Contract semantics, receipt trust/freshness and observe-only/lifecycle-off defaults stay intact.
- Published diagnostic AB/BA results with all four acceptance outcomes, 32 extracted provider-usage receipts and an offline arithmetic verifier. Private raw sessions, prompts/reasoning and hidden acceptance code are excluded.

## Real local-model diagnostic

Pi 1.5.0, IQ3_XXS, context 81 920, identical cold reloads, independent Docker workspaces, eight completed tool cycles per arm.

| Pair | A: assist | B: off |
| --- | --- | --- |
| 1 | 21/21 PASS | 21/21 PASS |
| 2 | 20/21 FAIL | 20/21 FAIL |

Complete-task acceptance: **1/2 for each variant**. Across these two pairs B used 4.68% less input, 28.97% less output (reasoning included), and 16.52% less elapsed time. Recovery preserved mandatory requirements in 32/32 packets: 29 FULL, 3 MANDATORY. In the last three A2 packets CWS was omitted by adaptive packing.

All arms reached the cycle limit before autonomous testing/final reporting. No approved checks were invoked by the model. These are diagnostic costs at equal observed full-acceptance rates, not general token savings, noninferiority or loop prevention. [Methodology, failures and receipts](../evaluation/README.md).

## Upgrade / обновление

```sh
npm install --ignore-scripts @sanmen87/core@0.1.0-alpha.3 @sanmen87/pi-extension@0.1.0-alpha.3 @sanmen87/mcp@0.1.0-alpha.3
```

Use a single Pi extension source, then restart/reload. See [CWS configuration](cws-policy.md) and [Russian lifecycle guide](lifecycle-setup.ru.md). The eight-cycle limiter is a benchmark control, not a production feature. Agent Policy Engine, extra memory and additional LLM compressors remain deferred.
