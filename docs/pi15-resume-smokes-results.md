# Pi 1.5 compaction и B completion — статус проверки

21 ноября 2026. Два независимых продолжения исходного run `2026-11-21T18-49-35-900Z-bb6cd2f9`; [зафиксированный протокол](pi15-resume-smokes-protocol.md). Прежний STOPPED и post-hoc оценки не пересматриваются. Это кандидат alpha.2, а не проверка опубликованного npm-выпуска.

## Подготовка

Shell evidence regression, полный suite 248/248, typecheck/build/Pi smoke и три clean installs — PASS. Linux/Node 22.19: 12/12 checks PASS. Оба matching zero-generation preflight прошли: compaction на копии A и полное восстановление согласованной B; генерация в preflight запрещена broker guard.

## Live compaction

Run `2026-11-21T20-17-36-134Z-bdd84cde`, 23:17–23:37 МСК. **STOPPED / TRIAL_WATCHDOG**, independent phase-two acceptance **17/21 FAIL**, strict workflow false. Seed A до продолжения уже имел те же 17/21 phase-two cases; модель выполнила три native read, без source edits и model-invoked approved checks. Финального ответа нет. Это не успешная разработка после compaction.

Подтверждена одна настоящая **manual** Pi 1.5 SDK compaction: fromExtension=true, original user entry вышел из retained tail, raw history сохранена. Native keepRecent=20000/reserve=16384 не менялись. Automatic threshold этим тестом не проверен.

Проверены все четыре финальных transport packets: original contract и тексты шести clauses присутствуют **4/4**, matching CCE hook SHA **4/4**. Полный Task State — **3/4**. В четвёртом packet Task State отсутствует; CCE явно сообщил **DEGRADED / INCOMPLETE_BUDGET / RECOVERY_COVERAGE_INCOMPLETE**. Наличие исходных текстов не превращает этот packet в полный recovery. Extension errors — 0.

По matching-tokenizer accounting до recovery четвёртого packet: window 65792, occupied 45179, output reserve 16384, available 4229; после отдельного envelope 2048 остаётся textBudget **2181**. Скомпилировано 1837 токенов неполной проекции. Это исчерпание расчётного лимита текущего frame; подсчёт SDK JSON не является точным измерением backend prefill и сам по себе не доказывает ошибку окна. Последний body был отправлен и получил SSE, но отменён watchdog до final usage. Почему модель не дошла до редактирования за выделенное время, причинно не установлено.

Provider usage — нижняя граница **120160 input / 8700 output** по 3 завершённым запросам, из них 8266 reasoning уже входят в output. Четвёртый attempt отменён, его расход UNKNOWN. Полные проекции, packet bodies, native history и SHA сохранены приватно; terminal sidecar проверяет неизменность primary. Экономия или преимущество над Pi-only не оценивались.

## B completion

Run `2026-11-21T20-37-40-241Z-bb4d79f8`, 23:37–23:57 МСК. **STOPPED / TRIAL_WATCHDOG**, independent acceptance **21/21 PASS**, agentReturned=false, strict workflow=false. Seed уже проходил 21/21: сохранённый PASS не является новым доказательством coding improvement. Это продолжение сохранённой B со своей native history и Ledger, не новый clean A→B. Модели не сообщались post-hoc 21/21 или детали independent oracle.

Все **8/8** финальных packets содержали original contract, шесть structured clauses и FULL Task State; SHA CCE hook совпали с transport **8/8**, DEGRADED 0, extension errors 0. Automatic recovery работал без model-invoked CCE tools.

Модель выполнила edit `test_crm.py`, две native Bash-команды и пять чтений того же файла. Unit-test запуск после edit показал **IndentationError**. Native Bash вернул isError=false без exit-code metadata; CCE отразил PROCESS_STATUS_UNKNOWN и TOOL_DIAGNOSTIC_OBSERVED в следующем provider packet, без trusted PASS. Исправления файла после этого edit не наблюдалось. Model-invoked approved checks — 0; host после остановки не подменяет их своей проверкой.

Independent oracle проверяет CRM API, а не синтаксис model-authored test suite: поэтому 21/21 совместим с поломанным `test_crm.py`. Нельзя называть такой workflow завершённым или весь проект исправным. Этот запуск демонстрирует, что корректно доставленные требования и диагностическое предупреждение сами по себе не предотвращают повторные чтения и не обеспечивают завершение задачи.

Provider usage: нижняя граница **244008 input / 4053 output** по 7 завершённым запросам; 1164 reasoning входят в output. Восьмой отменён, usage UNKNOWN. Новых compaction в B — 0.

## Что подтверждено и что остаётся

Shell evidence regression и живая доставка диагностического предупреждения — PASS. Настоящий manual compaction CCE/Pi 1.5 и сохранность истории подтверждены. Полная доставка recovery после compaction — только 3/4: четвёртый packet явно DEGRADED. Успешная coding continuity после compaction и самостоятельное завершение B — **не подтверждены**. Natural-threshold compaction и опубликованный npm live run — **NOT RUN**. Pi-only контроля и доказанной экономии нет.

Кандидат проверен из изолированно установленных архивов; runtime финальных release-архивов побайтно идентичен ему. Release checks и решение о публикации отдельны от неуспешного workflow benchmark. Raw packets, scoped Ledger, source snapshots и hidden oracle остаются приватными. Публичный отчёт не является полным воспроизводимым CRM benchmark: curated public evaluation и regression tests имеют отдельный scope.

Terminal sidecars: `<compaction-run-id>.terminal-analysis.json` и `<completion-run-id>.terminal-analysis.json` в локальном quality-каталоге. Они сверяют primary SHA, каждый request-body SHA и hashes Ledger records/blobs; исходный A→B run и оба terminal primary не изменены. Новых model calls для анализа — 0.
