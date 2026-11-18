> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `e5f56a576733eea3fa06952ac5e8f5fcaff9f3a6a7c98639893a87979ca17256` (source-89). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# CCE v0.5-fix2 — results

Статус: retrieval/correctness validated на фиксированных samples; native coding BLOCKED_OS_PROVISIONING. Реальные coding success rate и provider token savings не измерены.

| Cohort | Mode | N | Recall@10 | MRR | nDCG@10 | Packed Recall /9600 B |
| --- | --- | --- | --- | --- | --- | --- |
| known22 | selective | 22 | 86.36% | 0.778 | 0.798 | 81.82% |
| known22 | combined | 22 | 95.45% | 0.793 | 0.831 | 90.91% |
| crm36 | selective | 36 | 83.33% | 0.659 | 0.700 | 80.56% |
| crm36 | combined | 36 | 83.33% | 0.662 | 0.702 | 80.56% |
| knownBlinkerMitt16 | selective | 16 | 87.50% | 0.715 | 0.757 | 81.25% |
| knownBlinkerMitt16 | combined | 16 | 87.50% | 0.715 | 0.757 | 81.25% |
| previousNew20 | selective | 20 | 95.00% | 0.710 | 0.766 | 80.00% |
| previousNew20 | combined | 20 | 100.00% | 0.722 | 0.787 | 85.00% |
| previousConfirmation20 | selective | 20 | 100.00% | 0.867 | 0.901 | 95.00% |
| previousConfirmation20 | combined | 20 | 100.00% | 0.867 | 0.901 | 95.00% |
| finalIndependent12 | selective | 12 | 100.00% | 0.565 | 0.678 | 79.17% |
| finalIndependent12 | combined | 12 | 100.00% | 0.565 | 0.678 | 79.17% |

Final12 — cachelib / p-map / trace-mapping, queries/anchors frozen до grammar patch, code frozen до первого запроса. Previous20 и first20 — regression для финального кода. На12 новых query additional gain vs SELECTIVE не доказан: качество сохранено. На старых auth cases восстановлен ранее потерянный source, q19 rank исправлен.

## Paired regressions

Нет потерь ранее покрытых anchors относительно SELECTIVE на финальных regression/independent samples.

Нет падений MRR относительно SELECTIVE на этих samples.

Полные before/after hits, lost/gained anchors и graph trace включены в results.json. Ни старые failures, ни старые benchmark docs/JSON не заменялись.

| CRM lane | request p50/p95 ms | graph/rerank p50/p95 ms | sampled RSS MiB | whole graph reads | traversal SQL | cache hit warm |
| --- | --- | --- | --- | --- | --- | --- |
| off | 564.35 / 667.06 | 5.09 / 8.08 | 313.4 | 0 | 0 | — |
| always | 693.67 / 784.25 | 154.22 / 217.24 | 669.9 | 108 | 0 | — |
| selective | 570.96 / 636.58 | 5.27 / 9.37 | 316.7 | 0 | 10 | 100.00% |
| planner | 574.94 / 660.29 | 5.14 / 11.65 | 276.5 | 0 | 80 | 100.00% |
| combined | 580.06 / 678.35 | 5.65 / 13.20 | 317.2 | 0 | 80 | 100.00% |

## Native coding

0/48 trial RUN. User имеет только текущий ПК. AppContainer Node FS probes отклоняют host source/auth/oracle, но Git Bash hangs; restricted-token alternative не прошёл launcher/desktop checks. Windows11Pro, firmware virtualization true; Windows Sandbox не установлен. Подготовлены admin enable script и initial WSB probe; OS change/VM/LLM trials NOT RUN. Подробности в native runbook.

Raw: results (original artifact not bundled; see [publication scope](../README.md)), final regression (original artifact not bundled; see [publication scope](../README.md)), independent confirmation (original artifact not bundled; see [publication scope](../README.md)), source lock (original artifact not bundled; see [publication scope](../README.md)).

## Полная таблица последнего independent12

| Mode | Recall@10 | MRR | nDCG legacy | Packed Recall/9600B |
| --- | --- | --- | --- | --- |
| off | 79.17% | 0.578 | 0.634 | 66.67% |
| always | 87.50% | 0.556 | 0.638 | 75.00% |
| selective | 100.00% | 0.565 | 0.678 | 79.17% |
| planner | 100.00% | 0.565 | 0.678 | 79.17% |
| combined | 100.00% | 0.565 | 0.678 | 79.17% |

OFF имеет немного больший MRR при меньшем recall; это tradeoff прежней graph strategy, не дополнительный выигрыш fix2. Сравнение новых механизмов с SELECTIVE не показывает снижения этих метрик или нового среднего gain на12 queries.

Метрики используют прежний единый source-anchor evaluator. Его nDCG — legacy coverage statistic: binary gain на первый hit, покрывающий новые anchors, и ideal по количеству target anchors. Когда один класс покрывает несколько anchors, абсолютный ceiling не равен стандартному document-qrels nDCG. Числа сохранены для paired comparison; они не доказывают semantic completeness. Определения полноценного qrels и внешняя проверка разметки — TODO. Recall, MRR и full-body coverage показаны отдельно.

## Перепроверка cross-run latency

Bulk final combined p50≈580ms выше исторического fix1 490.70ms. В том же bulk run control SELECTIVE≈571ms: разница≈1.6%. Поэтому дополнительно выполнен alternating paired recheck frozen fix1 vs final fix2 на двух новых clones, одинаковом read-only embedding fixture, warmup и3warmpasses, без concurrent tests.

| Code | p50 ms | p95 ms | graph/rerank p50 ms | sampled RSS MiB |
| --- | --- | --- | --- | --- |
| frozen fix1 | 614.60 | 667.41 | 5.36 | 199.1 |
| fix2 | 614.57 | 660.54 | 5.97 | 205.9 |

Paired p50 delta -0.005%; заметного общего latency regression здесь нет. Небольшой graph-stage/RSS overhead виден. Оба arms медленнее старой сессии: перенос490.70ms между запусками не изолирует code effect. Конкретную причину изменения host conditions не установили. Это noisy single-machine измерение, не статистическая гарантия и не true peak RSS. Все Fast candidate/score hashes совпали. Raw paired recheck (original artifact not bundled; see [publication scope](../README.md)).
