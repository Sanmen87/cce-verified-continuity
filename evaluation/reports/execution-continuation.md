> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `824086f22a7a58bd5f05436698799927d06f94be50fb8184821f6be9b64153a0` (source-97). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Execution Continuation: результаты серии

18–19 ноября 2026. Последняя пара закончилась 19 ноября в **01:10:17 МСК**; её длительность около 4 минут 43 секунд. Активных candidate containers и прогонов нет. Новый inference при разборе не запускался.

**Полный independent acceptance не получен ни в одном из восьми завершённых вариантов. CWS дал частичный прогресс в двух описательных сравнениях, оба раза во второй позиции AB. Устойчивое преимущество и экономия токенов не доказаны.**

## Пара 4

| Метрика | Baseline | CWS |
|---|---:|---:|
| Independent acceptance | FAIL, 17/21 | FAIL, 20/21 |
| Provider cycles | 8 | 8 |
| Изменения исходников | 0 | 2 |
| Input tokens | 275352 | 285243 |
| Output tokens | 3232 | 2700 |
| Input + output | 278584 | 287943 |
| Длительность arm с grading, секунд | 119,474 | 162,148 |

Baseline восемь раз повторил одинаковый успешный create probe. CWS начал с неуспешного edit `crm/service.py`, перечитал файл, выполнил unit tests, получил FAIL с exit 1, диагностировал update через отдельный probe, прочитал `crm/contacts.py` и внёс два изменения. Финальный unit test оставил два failures из 49; independent oracle оставил один failure из 21 — `contacts.archive` возвращает 500.

Четыре прежних независимых провала baseline сохранились. CWS исправил три из них; полного завершения нет. Оба arm остановлены по одинаковому лимиту 8 cycles, без transport errors и без watchdog timeout. Последний tool result CWS с оставшимися failures не был отправлен в девятый запрос: такого запроса не было по протоколу. Это не потеря результата внутри отправленного packet.

## Все попытки, без подмены исходного сбоя

A — baseline, B — CWS. Таблица описывает фактически выполненные попытки, **не четыре чистые preregistered пары**.

| Пара / попытка | Порядок | Baseline | CWS | Наблюдение |
|---|---|---:|---:|---|
| 1, исходная | AB | 17/21 | 20/21 | CWS частично исправил код |
| 2, исходная | BA | NOT RUN | NOT EVALUATED | Первый CWS ответ: 11743 одинаковых `?`, остановка 20-минутным watchdog |
| 2, диагностический повтор после reload | BA | 17/21 | 17/21 | Оба arm по 8 одинаковых create probes, без edits |
| 3, после reload | BA | 17/21 | 17/21 | Оба arm по 8 одинаковых create probes, без edits |
| 4, после reload | AB | 17/21 | 20/21 | CWS частично исправил код |

В исходном primary schedule оценены три arm каждого типа, все FAIL; первый CWS arm пары 2 остался NOT EVALUATED, соответствующий baseline не запускался. Два arm диагностического повтора пары 2 — отдельное post-hoc evidence, а не замена неудачной попытки. Копия пары 1 в retry root не посчитана повторным trial.

Среди восьми завершённых arm, включая диагностический повтор, **0/4 полностью принятых задач у baseline и 0/4 у CWS**. Не следует выдавать сумму прошедших cases за долю завершённых задач.

Все завершённые BA дали CWS 17/21 и повтор probe; обе AB дали CWS 20/21. Это наблюдаемая связь с порядком. На четырёх завершённых сравнениях одного snapshot нельзя отделить действие CWS от порядка, cache, состояния backend или вариативности генерации. Reload также разделил состояние backend. Механизм связи не установлен.

## Стоимость завершённых попыток

| Сумма четырёх завершённых arm каждого типа | Baseline | CWS | Изменение CWS |
|---|---:|---:|---:|
| Input tokens | 1106963 | 1144598 | +3,40% |
| Output tokens | 12464 | 15061 | +20,84% |
| Input + output | 1119427 | 1159659 | +3,59% |

Это известная часть usage по **64 завершённым запросам**, с явно включённым post-hoc повтором. Ещё один исходный запрос пары 2 оборван без final provider counters. Его стоимость UNKNOWN, не ноль; **полная стоимость всех попыток неизвестна**. Reasoning входит в output и повторно не прибавляется. Отдельной достоверной cache/billing-телеметрии нет. Ни экономия на успешно завершённых задачах, ни ускорение от CWS здесь не установлены.

## Проверки целостности и доставки

- Frozen inputs/runner/oracle manifest проверены до/после разбора; старый failed result SHA совпадает с lineage. Независимый oracle не менялся, конкретный SQL-дефект модели не подсказывался.
- Начальные provider requests побайтово одинаковы внутри каждого arm во всех четырёх завершённых сравнениях; начальные source snapshots одинаковы во всех восьми arm. Preset во всех `started.json` совпадает с frozen load config.
- Все шесть структурированных требований присутствуют в **64/64** завершённых provider requests.
- **56/56** результатов первых семи tools каждого arm с правильными tool_call_id и полным model-facing содержимым присутствуют в следующем реально отправленном provider JSON. Последние восемь tool results не отправлялись из-за cycle cap.
- Доставка JSON не доказывает корректность итогового LM Studio template rendering и не доказывает интерпретацию моделью. Следующий предмет аудита — этот путь и состояние runtime/cache/RNG; отсутствие доставки результатов harness в данной серии не выявлено.
- Повторяется важная отдельная проблема: Python probes могут печатать traceback внутри `except`, но завершаться с exit 0. `pipefail` исправляет статус pipeline при ненулевом Python exit, но не меняет подавление исключения самим Python. Unit tests возвращали реальные FAIL/exit 1.

Scope остаётся прежним: frozen verified recovery vs добавленный CWS, настоящие четыре native Pi tools и direct provider continuation. Новый lifecycle refresh, retrieval, граф/векторы и compaction в этой серии **NOT EXERCISED**. Background memory, mini-LLM и новые runtime-механизмы не добавлялись.

## Артефакты и валидация разбора

Машинная сводка со всеми попытками и provenance (original artifact not bundled; see [publication scope](../README.md)).

SHA-256 evidence index (original artifact not bundled; see [publication scope](../README.md)): 434 файла, 36724781 байт. Отдельный архив включает actual requests, raw SSE, model-facing tool results, начальные/финальные исходники, provider usage, original failed attempt и frozen manifests. Оригиналы не перезаписывались. Архивные SHA сверены после копирования.

Выполнены saved-artifact assertions для usage, request hashes, preset, исходников, tool pairing и requirement coverage. Полные CCE typecheck/tests/build при post-hoc разборе **NOT RUN**: production-код и frozen benchmark runner не менялись. Исторические проверки подготовки находятся в validation (original artifact not bundled; see [publication scope](../README.md)); ограничения повтора и неактивного live SSE mirror — в [отдельном отчёте](execution-retry.md).

Новые модельные эксперименты в ходе этого разбора не запускались. Следующий конкретный шаг — аудит final rendered prompt и backend/cache состояния на сохранённых трассах перед расширением Action Continuity. Частичный прогресс двух AB пока не основание заявлять coding advantage или экономию.
