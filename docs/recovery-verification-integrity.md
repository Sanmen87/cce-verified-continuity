# Recovery / Verification Integrity — итерация 21 ноября 2026

Статус: runtime-исправления в рабочем дереве, deterministic regression PASS. Это **не обновление уже опубликованной `0.1.0-alpha.1`** и не новый coding benchmark. Версия workspace пока сохранена; для публикации исправлений нужен отдельный prerelease. Нативные настройки Pi и модели, observe-only default, история и hidden acceptance не изменены.

## Аудит исходного B v2

Повторён `node --experimental-strip-types scripts/benchmark/continuity/action-continuity/audit.mjs`. Новый sidecar: `benchmarks/quality/verified-continuity/action-continuity/audit-2026-11-21T18-09-17-931Z.json`. Primary SHA и исходный Ledger сверены; старые результаты не переписаны.

| Request | Причина по frozen code и исходным observations | Исторический textBudget | Место после output reserve в отправленном frame |
|---|---|---:|---:|
| 2 | Оригиналы поместились; полный Task State снят compiler | 6968 | 36940 |
| 4 | То же | 7180 | 31870 |
| 8 | Anchored estimate обнулил бюджет до compilation | 0 | 28899 |
| 21 | Снят полный Task State | 8783 | 18581 |
| 23 | То же | 6811 | 16607 |
| 25 | То же | 4835 | 14633 |

Ранее уже добавлены matching-tokenizer пересчёт текущего SDK frame и минимальная Task State projection. Эти исправления существуют в текущем коде. Они не гарантируют, что произвольный будущий retained turn поместится: без matching host tokenizer остаётся консервативный fallback. Историческое место в отправленном запросе не является точным token count нового frame с добавленным recovery.

Пробел текущей итерации: provider hook записывал payload SHA и source projection, но не выдавал отдельный verdict о присутствии обязательного recovery. Нельзя было переносить успешный startup на каждый следующий запрос.

## Что изменено

### Recovery

- `packages/core/src/lifecycle/recovery-integrity.ts`: Pi-независимая проверка фактического переданного payload. Оригиналы обязательных активных событий проверяются по текущему scoped Ledger. Секретные/недоступные оригиналы дают UNKNOWN, без вывода текста в diagnostics.
- Учитывается текст user/system/developer сообщений. Assistant claims, tool output и metadata не подтверждают delivery. Пока поддержана форма `messages` с обычным текстом/text blocks; неподдерживаемая форма даёт явный `DEGRADED`, а не ложный успех.
- `packages/pi-extension/src/lifecycle.ts`: verified-state recovery инициализируется при context hook даже без предшествующего `session_start`. На каждом наблюдаемом provider attempt пишется `CCE_RECOVERY_INTEGRITY`: request ID, payload SHA, event IDs/hashes, presence, причины, packing, точка наблюдения. Текст контракта не логируется.
- Пропуск context hook, неизвестный/исчерпанный бюджет, partial projection и ошибка recovery не выдаются за полный recovery. Даже когда все original clauses есть, `INCOMPLETE_BUDGET` остаётся `DEGRADED`.
- `ExtensionOptions.onRecoveryDiagnostic` позволяет доверенному host собирать эти записи. Ошибка telemetry callback не изменяет нативный запрос.

**Граница гарантии:** по официальному Pi 1.5.0 API `before_provider_request` вызывается после provider serialization, но обработчики идут в порядке загрузки. Следующее расширение может заменить payload; ошибки extension handlers перехватываются Pi. Поэтому `PRESENT_AT_INSPECTION` относится к этой точке, `finalTransportVerification=UNAVAILABLE`, `providerDelivery=UNKNOWN`. Это не last-handler lock, не fail-closed firewall и не подтверждение получения сервером. Строгая блокировка через исключение в этом hook не имитируется.

Regression отдельно перехватывает **конечное тело запроса в SDK fetch после всех payload hooks**, без сетевого обращения. Negative control удаляет recovery после CCE: hook-inspection может видеть исходный recovery, final-body inspection выявляет потерю. Живой стенд обязан сохранять и проверять именно этот конечный packet. Универсальная гарантия финального transport в произвольной цепочке расширений остаётся ограничением адаптера.

### Verification

- `packages/core/src/quality/execution.ts`: отдельно представлены process outcome и наблюдение вывода. `exit 0` означает `SUCCEEDED`, а не тестовый PASS. Стандартный Python traceback/unittest failure/pytest failure при нулевом коде помечается `CONTRADICTORY`.
- Native Bash остаётся `OUTPUT_OBSERVATION_ONLY`, не создаёт trusted receipt. Противоречие сохраняется как OPEN_ISSUE, доступно в Task State/CWS и не закрывает другие issues.
- Legacy host-approved `exit-code` policy сохраняется для совместимости, но при противоречивом выводе receipt становится UNKNOWN, а не PASS.
- Host-approved `explicit-result` policy требует `outcome: PASS | FAIL | UNKNOWN` от зарегистрированного адаптера. Отсутствующий/невалидный outcome либо PASS с ненулевым exit не дают PASS. Это позволяет checker намеренно проверять исключение и интерпретировать структурированный результат; модель не может передать такой outcome инструменту.
- Смена файлов/Git binding, watchdog и restart сохраняют прежние правила freshness. Свежий approved PASS не равен независимому coding acceptance.

## Regression coverage и проверки

Новые `tests/recovery-integrity.test.ts`, `tests/verification-integrity.test.ts` и расширение `tests/durable-continuation.test.ts` проверяют:

1. Missing recovery, аналогичный request 8, и отдельный diagnostic для повторного provider attempt.
2. Малый/неизвестный бюджет, отсутствие ложного COMPLETE и восстановление после возвращения capacity.
3. Partial Task State при сохранённых originals.
4. Конечный SDK transport body и downstream-removal negative control.
5. `exit 0 + traceback`, отдельные process/output/trust признаки и отсутствие native trusted PASS.
6. Явную checker policy с ожидаемым исключением и отказ при отсутствующем/противоречивом результате.
7. Fresh A→B: тот же contract revision в SDK packet, исторические receipts не становятся текущими.
8. Существующие проверки stale receipts, повреждённого/чужого handle и workspace isolation остаются в полном suite.

Выполнено: `npm.cmd test` **247/247 PASS**, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run smoke:pi` PASS. Отдельный targeted suite integrity + durable continuation: **14/14 PASS**. Smoke использует установленный Pi **1.5.0**, не вызывает LLM. Публичный suite до последнего добавления partial-state case: **164/164 PASS**; полный suite включает этот case.

Из отдельного просканированного snapshot собраны три архива **кандидата `0.1.0-alpha.2`**, без изменения установленной/опубликованной alpha.1. Чистая установка на Windows/Node **22.19.0**: **3/3 PASS** (core, core+MCP, Pi+adapters), включая consumer types нового diagnostic callback. У Pi host сохранено известное upstream-исключение TS1543: application strict проходит с документированным `skipLibCheck:true`; core/MCP проходят с `skipLibCheck:false`. Отчёт: `release-artifacts/integrity-candidate-install.json`. Кандидат **не опубликован**, версия основного workspace пока не менялась.

## Offline диагностика циклов и retrieval

Новый `node scripts/benchmark/continuity/integrity-audit.mjs` проверяет сохранённые 25 B v2 requests: все 25 payload SHA различаются, несовпадений ролей/tool-result pairs и невалидных JSON arguments не обнаружено. Сообщений, состоящих только из `?`, и U+FFFD replacement characters в этих frames не обнаружено. Отдельно разобран 81 сохранённый request/SSE file pair из original/retry roots CWS-серии: 58 различных request-file hashes. Эти файлы включают копии/идентичные тела; их количество нельзя считать числом независимых LLM attempts. Отчёт: `.bench/recovery-integrity/audit-2026-11-21T18-24-58-054Z/audit.json`.

В исходной pair 2 / current-work / cycle 1 **11 743 ASCII `?` уже присутствуют в raw SSE в поле `reasoning_content`**, других непробельных символов в этом поле нет; final usage отсутствует. Значит, наблюдаемый поток не возник только при отображении лога. Это не устанавливает причину в модели, GPU, template или cache/backend и не доказывает, что CCE вызвал сбой.

Точный tokenized backend prompt/chat template и достаточная историческая cache telemetry недоступны. Их корректность и причинный эффект порядка AB/BA — UNKNOWN. Сохранённая группа из десяти одинаковых create probes подтверждается; причинная роль CCE/модели/backend не установлена. Новая генерация для проверки непоставленной гипотезы не запускалась.

`npm.cmd run test:evaluation` PASS: strict MCP **9/12**, evidence **12/12**, 64 опубликованных usage receipts. Baseline 5/6 и CCE 4/6 сохранены. Три known-path FAIL означали лишних, но фактически существующих callers вместо ожидаемого пустого массива; это не установленный дефект AST/FTS retrieval. Ranking не менялся. Для новой серии нужно заранее уточнить known-path формат, старый oracle не переоценивать.

## Живой Pi 1.5 smoke

[Протокол](pi15-continuity-smoke-protocol.md). **NOT RUN.** Docker daemon доступен (29.9.3). `lms ps --json` вернул `[]`; IQ3_XXS GGUF присутствует на диске, но модель не загружена. Нужен опубликованный prerelease с исправлениями: `0.1.0-alpha.1` неизменяема и не включает эту итерацию. Чистая установка текущей alpha сама по себе не проверяет новый runtime.

Следующий шаг: подготовить новый prerelease, проверить его clean install и только затем выполнить опубликованный A→B smoke на загруженной IQ3_XXS. До этого нельзя заявлять проверенную live-непрерывность текущих исправлений на Pi 1.5.
