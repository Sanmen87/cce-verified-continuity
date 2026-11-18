> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `a56e5f3e6af06579aec3592eb697f9b19ddafc66a1eaae88edbd115c8b53f4cf` (source-93). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Verified Continuity: два независимых coding-эксперимента

12 ноября 2026. Векторный поиск отложен. Это новые series; прежние STOPPED/NOT_EVALUATED и offline результаты не переоцениваются.

## Общие условия

Текущая IQ3_XXS, Pi SDK1.4.0, окно65536, native output16384, keepRecentTokens20000/reserveTokens16384. Sampling, thinking, retry и inference settings берутся из установленного Pi profile без подмены. CCE opt-in deterministic verified-state, existing native Project Memory/graph без vectors, handoff≤12000 и experimental recovery reserve2048. Global defaults остаются observe-only.

Изоляция: disposable Linux Docker, network none, uid1000, dropped capabilities, readonly input/control/code. Host broker пересылает только frozen local model chat/tokenizer. Oracle expected outputs/reference не монтируются solver-у; candidate выполняется только в отдельном ограниченном grader container. Независимые input/code/ledger/session copies, SHA-256 manifests и pinned image.

Пользователь отдельно разрешил A **до8 часов**; B сохраняет прежний operational watchdog50 минут. Tool watchdog180 секунд. Это лимиты безопасности процесса, не max requests/output override. Счётчик7 не является основанием менять Pi thresholds или продолжать решённую задачу.

Дополнение 13 ноября, только для следующих итераций: по разрешению пользователя в установленном Pi задан `httpIdleTimeoutMs=480000` (8 минут вместо нативных5). Benchmark переносит этот параметр в frozen `profile.settings`, используемый SDK. Это ожидание HTTP без данных, а не размер контекстного окна или общий watchdog. Будущие сравниваемые режимы должны иметь одинаковые480000; старый ночной A остаётся с300000. После изменения native settings нужны новые prepare/freeze/preflight; прежние frozen roots не исправляются на месте. Изменение не доказывает устранение медленного prefill или нехватку VRAM: диагностика (original artifact not bundled; see [publication scope](../README.md)).

## A — Long Task Continuity

Одна сессия, настоящая последовательная12-фазная Python/SQLite CRM-задача: contacts, soft archive, deals, optimistic versions, Unicode search, durable audit, CSV import, tags, activities, dependency-aware archive, migration, reports/export. Используется существующий contract/oracle, без нового source corpus и без искусственных сообщений.

**Ручной session.compact между фазами отключён.** Допустимы только естественные threshold/overflow compaction Pi. Нет filler, повторного запроса ради числа циклов, подмены output/window/keepRecent и обрезания tool pairs. Каждая фаза выдаётся один раз; после последней задача завершается.

Primary: independent acceptance cumulative task на последнем завершённом этапе; полный12-stage completion отдельно. После compaction записываются full before/after projection, firstKeptEntryId, actual summary, fromExtension/reason, capacity/fallback diagnostics, полный actual provider payload, требования, receipts/freshness и дальнейшие tool actions/source changes. Provider payload связывается с broker request по SHA; hook-only serialization не считается фактической отправкой.

Количество естественных compactions, доставка после каждого цикла, продолжение изменений и итоговое качество — отдельные оси. Если весь код принят после четырёх compaction: coding PASS,7+ NOT_EXERCISED. Седьмая compaction без следующего запроса не доказывает седьмое восстановление. Native fallback не считается CCE handoff.

## B — Cross-Session Continuity

Независимый от A seed — ранее **COMPLETED** coding phase1 `2026-11-12T07-28-26-230Z-d6949ce5`, independent16/16. Host сначала повторно проверяет принятую копию independent oracle; затем в отдельном zero-generation container открывает её existing Ledger/Project Memory, создаёт checkpoint, проверяет read-back и закрывает writers.

После этого новый solver container получает code + закрытое CCE state + pinned handle. **Полный native transcript A не монтируется и не импортируется в новую Pi B.** Исходные original events доступны в CCE history по выбранному scope. Project ID сохраняется через тот же canonical container workspace `/work/task`; физические копии независимы.

B получает только следующий feature request contacts.update/archive, без повторного перечисления прежних шести правил. Старые receipts исторические; B должна получить текущую карту/contract и выполнить изменения. Independent phase2 oracle21 cases проверяет результат отдельно. Этот B проверяет продолжение принятого исторического этапа, а не зависит от успешного завершения long A.

Сохраняются actual startup payload, restored requirements/map/receipt authority, native read paths/counts, observed scan commands, CCE tool calls, time to first observed source change и independent acceptance. Слово «useful» для изменения не означает correctness до oracle. Native read counts не доказывают отсутствия чтения через bash; shell file access без syscall tracing UNKNOWN. Повторное исследование оценивается по сохранённым действиям, не по заявлениям модели.

## Проверки до inference и отчёт

Zero-generation preflight проверяет актуальный SDK/model profile, startup delivery, empty clean B transcript, receipt authority, SHA/archive/read-back, snapshot/payload pipeline и sandbox. Offline synthetic stress большого retained tool turn допустим только как тест guard; он не входит в real compaction count.

Реальные LLM requests разрешены только после frozen manifest, calibration положительного и отрицательного oracle controls и успешного preflight. Материалы A/B сохраняются раздельно. STOP/watchdog сохраняет partial snapshots; независимая post-hoc оценка partial кода маркируется отдельно и не превращает STOPPED в COMPLETED.

Без Pi-only baseline нет causal advantage/token savings. Usage неизвестных/оборванных запросов остаётся UNKNOWN, суммы — lower bounds. Semantic presence при отсутствии exact/structured evidence не объявляется автоматически FAIL или PASS.
