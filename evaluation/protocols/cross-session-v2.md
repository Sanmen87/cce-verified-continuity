> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `5b70d09e912d0a9cead0566829900330bc9d926b975d1c2fa4d13973c1198d98` (source-95). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Cross-Session B v2 — заранее зафиксированный протокол

Зафиксирован до первого inference B v2. Это новая серия `cross-session-v2`; исторический B `2026-11-13T19-57-44-634Z-fb797f13` и его FAIL не изменяются.

## Задание и условия

Одна реальная локальная IQ3_XXS, прежний exact model preset, Pi1.4.0, context65536, output16384, keepRecent20000/reserve16384, HTTP idle480000, общий watchdog3000 секунд. Модель сама заканчивает задачу; нет искусственной compaction и запросов ради числа циклов. Один диагностический запуск, без автоматических retries эксперимента и подбора удачного результата.

Seed — тот же независимо принятый phase1 `2026-11-12T07-28-26-230Z-d6949ce5`, повторно проверенный перед B. Существующий A→clean B механизм CCE/closed checkpoint, independent workspace/Ledger/session, прежние шесть clauses и полный original contract. Старый native transcript не импортируется. Векторы отключены. Docker isolation и hidden oracle transport сохраняются.

Задание модели — исходный phase2 из `long/task.mjs` без изменений. Не сообщаем о прежнем FAIL, sqlite3.Row, конкретной ошибке archive, строке для исправления или результатах hidden cases. Публичная проверка доступна по прежнему пути и дополнена **общим инвариантом всего API**: каждый вызванный `handle` возвращает JSON-compatible dict, сериализуемый с `allow_nan=False`. Покрывается публичная последовательность всех операций phase2, без скрытых expected values. Ошибка самой публичной проверки во время работы — допустимый обычный feedback; заранее называть дефект модели нельзя.

## Независимая оценка

Исходные `crmCases(2)` (21 case), expected outputs и `gradeCRM` не меняются. Новый host-only executor на каждом case независимо проверяет JSON serialization ответа и after-input state. Невалидное значение не преобразуется в правильное: case получает INVALID_RESPONSE/INVALID_INPUT_STATE, продолжение идёт на том же состоянии БД. Исключение конкретного вызова также не обрывает остальные cases. Import/process failure по-прежнему является отдельным execution failure. Hidden expected/reference не монтируются solver-у, новые receipts не создают authority из исторических PASS.

До inference: regression controls для Row/NaN/bytes/cycle, exception, несерилизуемого изменения inputs и успешного следующего case; положительный reference и отрицательные controls; original seed revalidation; zero-generation lifecycle preflight; frozen source/settings/oracle hashes. Generic public checker проверяется на reference и нескольких типах несериализуемых ответов, а не только на дефекте прошлого B.

## Метрики

Primary — независимый PASS/FAIL и passed/total с отдельным числом invalid responses/exceptions. Отдельно — successful provider delivery original contract/map, receipt freshness authority, tokens/LLM attempts/errors/duration/compactions.

Чтения: attempted/successful native reads, project-file reads, unique project paths, повторные обращения к тем же paths; отдельно — повтор того же offset/limit без зарегистрированного изменения файла, если range args доступны из native history. Повторное чтение не объявляется автоматически лишним. Нормализуются относительные и абсолютные container paths; не считаются повтором разные файлы с одинаковым именем. Чтения через shell не считаются нулевыми: их полнота UNKNOWN без syscall tracing. Scan intent/команды и CCE calls учитываются отдельно. Отсутствие полного повторного исследования и ускорение не выводятся только из числа read calls.

Результат B v1 допускается как исторический diagnostic, не как чистый контроль эффекта v2 (изменились public check и executor). Без Pi-only пары нет причинного вывода или token savings. Compaction0 означает NOT_EXERCISED для исправления длинного post-compaction prefill, независимо от PASS B v2.

Сохраняются protocol/manifest, точный prompt и публичный checker, hashes неизменного hidden specification, closed seed/checkpoint, preflight, actual provider requests/broker, native history/events, независимый grade, метрики чтения и terminal result в новой серии. Runtime CCE и defaults не меняются.
