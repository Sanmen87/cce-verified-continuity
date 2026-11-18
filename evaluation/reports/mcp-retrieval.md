> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `6bc6f538983af8696e61a9317bb633a39f9db3931374ba0bf7734705537b9aa5` (source-90). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# CCE MCP Retrieval Evaluation — результаты 12 испытаний

Дата: **11 ноября 2026 года**. Формат ответов, retrieval и схемы MCP-инструментов не менялись. Это read-only диагностика на небольшом искусственном проекте. Coding, lifecycle и восстановление после compaction не проверялись.

## Основной результат

**12/12 испытаний завершены, tool/transport errors — 0.** По заранее зафиксированному строгому критерию ответа и evidence: baseline **5/6**, CCE **4/6**, всего **9/12**. Необходимые source ranges с правильным SHA присутствуют в захваченных клиентом tool results **12/12**. Исходные оценки сохранены.

Модель самостоятельно использовала CCE во всех шести CCE-trials: **8 search + 12 expand = 20 вызовов**. В known-path иногда использовался CCE, хотя известный путь позволял просто прочитать файл. Дополнительные обращения также учтены.

## Все 12 испытаний

| Испытание | Строгая оценка | Evidence | CCE calls | Tool errors | Секунды | Input CLI | Cached | Non-cached | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| r1-known-path-baseline | FAIL | PASS | 0 | 0 | 18.718 | 59133 | 45696 | 13437 | 268 |
| r1-known-path-cce | FAIL | PASS | 1 | 0 | 17.809 | 59563 | 43264 | 16299 | 213 |
| r1-unknown-definition-baseline | PASS | PASS | 0 | 0 | 20.530 | 62923 | 56704 | 6219 | 212 |
| r1-unknown-definition-cce | PASS | PASS | 5 | 0 | 21.766 | 72964 | 63616 | 9348 | 438 |
| r1-historical-decoy-baseline | PASS | PASS | 0 | 0 | 23.099 | 57009 | 46080 | 10929 | 181 |
| r1-historical-decoy-cce | PASS | PASS | 3 | 0 | 17.842 | 49262 | 44160 | 5102 | 272 |
| r2-historical-decoy-cce | PASS | PASS | 3 | 0 | 21.746 | 54197 | 47488 | 6709 | 290 |
| r2-historical-decoy-baseline | PASS | PASS | 0 | 0 | 16.120 | 58613 | 40064 | 18549 | 187 |
| r2-unknown-definition-cce | PASS | PASS | 5 | 0 | 19.493 | 52402 | 33280 | 19122 | 349 |
| r2-unknown-definition-baseline | PASS | PASS | 0 | 0 | 20.153 | 62619 | 56576 | 6043 | 228 |
| r2-known-path-cce | FAIL | PASS | 3 | 0 | 24.316 | 74626 | 66432 | 8194 | 395 |
| r2-known-path-baseline | PASS | PASS | 0 | 0 | 12.829 | 37065 | 23552 | 13513 | 98 |

## Причины FAIL без переоценки

Три FAIL: `r1-known-path-baseline`, `r1-known-path-cce`, `r2-known-path-cce`. Во всех definition и значения cases правильны, но вместо ожидаемого `callers: []` модель указала двух действительно существующих production callers. Зафиксированный критерий точного совпадения `callers` не выполнен; исходные grades не изменены. Четвёртый known-path trial (`r2-known-path-baseline`) вернул пустой массив и прошёл.

Это обнаружило неоднозначность нашего задания: пустой массив в примере JSON мог восприниматься как место для заполнения. Запрос и зафиксированный evaluator требовали более узкого ответа. Будущее задание следует уточнить до следующего измерения; менять текущие оценки на PASS после просмотра результатов нельзя.

Дополнительная фактическая проверка: definition/cases верны **12/12**. Указанные вне known-path контракта callers являются актуальными вызывающими функциями, а не historical decoy. Поле `wrongClaimedSources` в исходном result означает несовпадение с ожидаемым набором сценария; оно **не доказывает фактическую ложность** этих ссылок. В отдельном `analysis.json` это разделено на `extraButFactuallyCurrent` и `falseSourceClaims`. Это дополнительное объяснение, а не новая acceptance-метрика. Ложных утверждений об актуальном определении в ответах не обнаружено.

## Суммы по режимам

| Метрика | Baseline | CCE |
| --- | ---: | ---: |
| Строго успешные задачи | 5 | 4 |
| Input CLI | 337362 | 363014 |
| Cached input | 268672 | 298240 |
| Non-cached input | 68690 | 64774 |
| Output CLI | 1174 | 1957 |
| Сумма trial durations, с | 111.449 | 122.972 |

Это суммы **всех** trials, включая FAIL. Они не доказывают экономию при одинаковом качестве. Суммарный input CCE выше, non-cached input ниже; результат зависит от неконтролируемого cache и состава неуспешных задач. Output CCE также выше. CLI usage не является независимо проверенной billing-телеметрией. Число внутренних запросов к модели из этих агрегатов неизвестно.

## Парные разницы: CCE минус baseline

| Сценарий | Повтор | Обе успешны | Δ input | Δ non-cached | Δ output | Δ секунд |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| known-path | 1 | нет | +430 | +2862 | -55 | -0.909 |
| known-path | 2 | нет | +37561 | -5319 | +297 | +11.487 |
| unknown-definition | 1 | да | +10041 | +3129 | +226 | +1.236 |
| unknown-definition | 2 | да | -10217 | +13079 | +121 | -0.660 |
| historical-decoy | 1 | да | -7747 | -5827 | +91 | -5.257 |
| historical-decoy | 2 | да | -4416 | -11840 | +103 | +5.626 |

В unknown-definition направление input-разницы меняется между повторами. В historical-decoy CCE использовал меньше input в обоих повторах, но преимущество по времени не повторилось. В unknown-definition повтора 2 общий input CCE ниже, а non-cached input заметно выше. Поэтому устойчивую общую экономию эта серия не подтверждает.

Только четыре пары строго успешны в обоих режимах; две known-path пары не включаются в вывод об экономии. По два повтора на сценарий — диагностика, а не статистическое доказательство. Cache не сбрасывался и не контролировался.

## Инструменты и payload

| Снимок tools/list | Tools | Байты | UTF-8 оценка токенов |
| --- | ---: | ---: | ---: |
| baseline | 2 | 819 | 1024 |
| cce | 4 | 1967 | 2459 |

Каталог CCE больше на 1148 байт. Это сериализация SDK tools/list, а не точный размер внутреннего model prompt. Ответы сервера учитываются в `evidence.serverProduced`, тела исходников в клиентских результатах — в `clientCapturedSourceBodyBytes`. Точная внутренняя доставка контекста модели неизвестна. Эти числа нельзя напрямую вычитать из input CLI или интерпретировать как точные provider tokens.

Baseline сделал 28 workspace_read_file и 5 listing; CCE — 7 workspace_read_file, 12 expand, 8 search и 1 listing. Это вызовы API, а не число физических чтений индексатора. Preview/reference не засчитываются как чтение тела. Чтение historical decoy само по себе не считается ошибкой.

## Воспроизводимость и проверки

Run: `<private-path>`.

Protocol SHA-256: `754dabaa02020591839ec45cb08fe94e07d91c9e480cb418f96b774a228915c4`. Зафиксированные source hashes остались неизменными после всей серии. Git HEAD недоступен в текущем workspace без исходного коммита; commit SHA записан как null, воспроизводимость опирается на подробную source hash map.

В каждом trial сохранены `invocation.json`, `events.jsonl`, `stderr.log`, `tools.jsonl`, `answer.json`, `result.json` и отдельная копия workspace. Preflight использовал отдельные копии; каждый trial начинался с отсутствующим `.context-engine`. OS cache не сбрасывался. Запрошена модель `gpt-6.1-sol`, reasoning low; фактическая версия весов/разрешение alias — UNKNOWN. Порядок режимов и задач чередовался согласно протоколу; повторных попыток не было.

[Зафиксированный протокол](../protocols/mcp-retrieval.md) · Машинные итоги (original artifact not bundled; see [publication scope](../README.md)) · Подробный анализ (original artifact not bundled; see [publication scope](../README.md)) · Проверки (original artifact not bundled; see [publication scope](../README.md))

Проверки этой доработки: **164/164 tests PASS**, typecheck/build/Pi smoke PASS. Изменены study runner, evaluator, status viewer, тесты и документация; production core/MCP adapter не менялись. Все 12 клиентских трасс сопоставлены с журналами сервера; SHA исходников и копий fixture совпадают, запрещённых операций не обнаружено. Старые micro-pair, Pi и CRM результаты сохранены отдельно.

Просмотр завершённой серии из консоли:

```powershell
npm.cmd run bench:codex:study:status
```

## Следующий шаг

Не менять ranking по результатам этих 12 trials. Для отдельной зарегистрированной format-ablation можно переиспользовать одинаковые query/results и сравнить формы ответа, сохранив содержимое, порядок, SHA и объём previews. Known-path контракт нужно отдельно уточнить до измерений: явно указать, что callers не запрашиваются, либо исключить поле из ответа. Эти изменения не применялись к завершённой серии. Новые format/coding/lifecycle испытания: **NOT RUN**.
