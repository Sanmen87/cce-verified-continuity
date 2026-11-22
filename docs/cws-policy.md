# CWS recommendation modes / режимы рекомендаций CWS

Available from **0.1.0-alpha.3**. CWS presents the current objective, observations, unresolved requirements and verification state. Its optional `next_action` is a derived recommendation, never authority to execute or proof of completion.

Merge this fragment into the trusted config selected with `CCE_CONFIG`:

```json
{
  "lifecycle": {
    "currentWorkEnabled": true,
    "currentWorkPolicy": {
      "stateProjection": true,
      "actionRecommendation": "off"
    }
  }
}
```

This fragment does not enable lifecycle by itself. Start with the complete [lifecycle setup](lifecycle-setup.ru.md) or [QUICKSTART](../QUICKSTART.md).

| actionRecommendation | Objective/state projection | Current next_action | Host diagnostic callback |
| --- | --- | --- | --- |
| `off` | Preserved | Absent | Mode and projection hash, recommendation null |
| `observe` | Preserved | Absent | Computed proposal, excluded from model context, tools and Ledger |
| `assist` (compatible default) | Preserved | Included when optional recovery details fit | Computed proposal |

**Русский:** `off` убирает только актуальную рекомендацию `next_action`, сохраняя сам CWS и проверяемую память. `observe` вычисляет её для диагностики, но не отправляет модели. `assist` сохраняет прежнее поведение. Общие defaults CCE остаются **observe-only, lifecycle disabled**; это отдельные настройки от режима рекомендаций.

`stateProjection` currently accepts only `true`. To disable the whole CWS use `currentWorkEnabled: false`; Task Contract, Ledger, receipts and mandatory recovery remain separate. Unknown keys/modes are rejected.

Registered host integrations may provide `registerCce(pi, { onCurrentWorkDiagnostic(view) { /* trusted telemetry */ } })`. The callback includes mode, derived proposal or null, scope/sequence, projection SHA and `includedInProjection`. `providerDelivery: "UNKNOWN"` is deliberate: this callback does not prove the final packet was delivered. Adaptive MANDATORY packing can omit optional CWS, including the recommendation. Separate packet inspection checks mandatory recovery. Callback errors do not interrupt recovery. Ordinary Pi config cannot install this callback or obtain a shadow log by itself.

Исторические рекомендации в уже существующей истории не удаляются при выборе off/observe. Новая настройка управляет текущими проекциями; tool-call/result pairs и transcript сохраняются.

After editing the selected config, restart Pi or use its supported reload. Benchmark your own model with acceptance and checks, not output tokens alone. Our [two-pair diagnostic](../evaluation/reports/cws-recommendation-execution.md) found equal complete-task acceptance and lower costs without the current recommendation, but neither variant reached autonomous verification within eight cycles. No universal speed/quality or loop-prevention claim is made.
