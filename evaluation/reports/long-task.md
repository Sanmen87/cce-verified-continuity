> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `0483e9ec86ea73dc6b44ba10c120754da923b9d6256dfb9ce7dbac8d3ab6407f` (source-92). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Ночной Long Task A: результат и post-hoc разбор

13 ноября 2026. Run `2026-11-12T20-28-14-379Z-0ce868a5`. [Протокол](../protocols/long-task-and-cross-session.md), управление стендом (original artifact not bundled; see [publication scope](../README.md)).

**Primary: STOPPED / TRIAL_WATCHDOG / NOT_EVALUATED.** Сессия шла с23:29 12 ноября до07:29 13 ноября по Москве,8 часов и примерно13 секунд с завершением/оценкой. Модель дошла до фазы8 из12; весь контракт задачи не завершён.

**Технический результат:**16 настоящих естественных compaction Pi,16 CCE handoffs,0 native fallbacks. Последняя завершённая фаза7 после15 compaction независимо принята60/60. Это реальная coding-сессия, а не offline filler replay. Полный текущий recovery подтверждён15/16 циклов; исходные шесть требований присутствовали в actual active provider context16/16. Эти утверждения не заменяют независимый verdict всей12-фазной задачи и не доказывают преимущество над Pi-only.

## Независимое качество кода

| Phase snapshot | Результат |
|---|---:|
| 1: contacts create/get/list | PASS16/16 |
| 2: update/archive | PASS21/21 |
| 3: deals | PASS30/30 |
| 4: optimistic concurrency | FAIL30/36 |
| 5: search/pagination, включая прежние требования | PASS45/45 |
| 6: durable audit | PASS52/52 |
| 7: atomic CSV import | PASS60/60 |
| 8: остановленный partial, отдельный post-hoc oracle | FAIL63/68 |

Фаза4 закончилась с native assistant stopReason=`length`; её snapshot не реализовал часть version semantics: missing expected_version не давал428, version conflict не давал409, update response не включал нужный version. К следующему принятому snapshot эти ошибки исправлены. Причинную связь всех ошибок с output limit отдельно не доказываем.

Пять failures partial8 относятся к tags.set/фильтрации по tags: операция ещё возвращала unknown_operation, фильтр отсутствовал. Первые60 проверок предыдущих этапов сохранили PASS. Partial score63/68 хранится отдельно и **не переименовывает** primary STOPPED/NOT_EVALUATED в успешное завершение.

## Compaction и требования

Все16 событий имеют reason=threshold и fromExtension=true. Нет ручного compact(), synthetic messages, native fallback или extension errors. Full before/after projection, boundary, summary/capacity, actual request и broker receipts сохранены.

После10 из16 межкомпактных интервалов наблюдались изменения source hashes. В остальных были чтения/проверки/рассуждение без записанных source changes; это не доказательство забытого решения или бесполезного цикла.

Handoff занимал примерно4567–9085 model-tokenizer tokens,11,5–23,1 KB. При добавлении фаз увеличивался обязательный scope. При неизменном этапе размеры выходили на плато: например, cycles9–11 около20,3 KB;12–14 около22,35 KB. Признаков копирования всех предыдущих summaries в каждую следующую не обнаружено. Будущая вместимость произвольного большого retained turn не гарантируется этим прогоном.

### Почему frozen evaluator показывает15/16

В цикле5 (`73eb6d57`, phase5) CCE handoff был COMPLETE и содержал все шесть требований вместе с Task State. Он действительно находился в provider payload. Но дополнительный automatic recovery имел `handoff_status=INCOMPLETE_BUDGET` и не включил свежий Task State. Evaluator намеренно выбирает request-time recovery и не подменяет его старым state из summary.

Поэтому строгий результат **15/16 для полного текущего recovery сохраняется**. Post-hoc отдельно подтверждает16/16 для присутствия исходного contract в actual active context. В спорной summary receipt уже был помечен UNKNOWN/STALE; потери исходных требований или ложного свежего PASS здесь не обнаружено. Это реальная неполная доставка свежего состояния из-за бюджета, а не полный PASS всех recovery.

Первые успешные provider payloads после каждого цикла показывают тот же результат: полноценный automatic Task State есть во всех, кроме5-го. Семь реальных последовательных compaction в этом опыте действительно упражнялись; гарантия корректности любого будущего цикла не заявляется.

## Задержки и ошибки provider

**16 попыток оборвались около300 секунд**, ещё одна — при финальном watchdog. Для всех этих failed calls broker сохранил HTTP200 headers, но не получил body frames до обрыва. В native session16 assistant errors с текстом Request timed out.

В установленном Pi SDK1.4.0 `core/http-dispatcher.js` задаёт `DEFAULT_HTTP_IDLE_TIMEOUT_MS=300_000`; `sdk.js` использует это значение как default request timeout. В пользовательских settings отдельное httpIdleTimeoutMs не установлено, hash settings совпадает с frozen протоколом. Это native default, не новый benchmark cap. Host fetch/relay тоже участвуют в цепочке; точную причину ожидания первого body frame — prefill, backend, buffering или другое — этот разбор не устанавливает.

Сумма длительностей16 пятиминутных прерванных попыток — **4799,866 секунд, около80 минут**. Это не равно доказанным80 минутам бесполезной работы: часть обработки могла повлиять на cache следующей попытки. Но паузы являются существенным наблюдаемым ограничением производительности.

Самые долгие фазы:5 — около103 минут,6 —157 минут,7 —75 минут. Эти величины сами по себе не доказывают repeated deliberation/забывание решения; отдельная Decision Continuity разметка здесь NOT RUN.

## Использование CCE и расходы

CCE работал **автоматически через recovery/compaction**. Модель не вызывала cce_search/cce_expand/cce_history или cce_run_approved_check. Она дважды вызывала старый cce_save_checkpoint; один вызов отвергнут с STALE_FILE_HASH. Это не проверка durable A→B и не history retrieval adoption. Межфазные approved public checks запускал host; они не считаются model-invoked verification.

Model tools: bash95,read54,write9,edit23,cce_save_checkpoint2. Семь isError tool outcomes:5 exact-text edit mismatch,1 bash import-check failure,1 stale checkpoint SHA. Source path/sandbox denial не отмечены среди этих errors. Старый SHA корректно не принят как текущее evidence.

| Метрика | Значение |
|---|---:|
| LLM attempts | 204 |
| Complete responses с known usage/matched actual payload | 187 |
| Unknown/aborted usage | 17 |
| Input lower bound | 7 672 303 |
| Output lower bound | 230 749 |
| Tokenizer requests | 2205 |
| CCE extension errors | 0 |
| Frozen inputs verified | true |

Это lower bounds, не полный расход; cache usage не измерен. Без Pi-only контроля token savings/causal advantage **NOT MEASURED**. Output includes whatever provider counted; reasoning отдельно этим отчётом не атрибутируется.

## Доказательства и проверка

Оригинальный terminal result (original artifact not bundled; see [publication scope](../README.md)), отдельный post-hoc JSON (original artifact not bundled; see [publication scope](../README.md)), индекс evidence с SHA-256 (original artifact not bundled; see [publication scope](../README.md)).

Сохранены65 файлов,26 926 973 байта: primary/protocol/manifest, broker/native history/events, original contract, snapshots/actual request каждого цикла, grades и partial code. Post-hoc script сверил hashes actual payloads с broker, пересчитал delivery и сохранил исходный result SHA. Исходный primary/frozen verdict не изменён. Анализатор: `scripts/benchmark/continuity/verified/analyze.mjs`; результаты создаются с flag=wx, повторная запись не допускается.

Production-код/настройки в этом разборе не менялись. Новые unit/integration benchmarks **NOT RUN**; выполнены syntax check анализатора, пересчёт evidence и проверка SHA привязки actual requests к broker. Независимые grades — реально выполненные terminal grader calls ночного controller.

## Следующий шаг

Приоритет — измерить ожидание первого body frame после compaction и разобрать budget неполного automatic recovery в цикле5. B остаётся prepared/preflight PASS, реальный coding B **NOT RUN**. Новый LLM-прогон и runtime fixes этим разбором не запускались.

Дополнение 13 ноября: корреляция с логами LM Studio (original artifact not bundled; see [publication scope](../README.md)) установила незавершённый prefill во всех16 таймаутах. В15 случаях перед запросом менялась ранняя история после compaction; отдельно обнаружены предупреждения о частичном CPU attention fallback. Это последующая диагностика сохранённых артефактов, без изменения исходных результатов или настроек.
