> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `2723028925c7e2c08f81b78db2dd09185673f7db09ad40a7f86ce06caeb48ab3` (source-98). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Execution Continuation: frozen B v2 recovery vs Current Working State

16 ноября 2026. Статус: подготовка, **модельные прогоны NOT RUN**. Продолжение [decision replay](../reports/decision-replay.md), без изменения production CCE/Pi settings. Runtime CCE по-прежнему observe-only по умолчанию.

## Вопрос и границы

После настоящего результата unit tests использует ли локальная IQ3_XXS ошибки, меняет ли код и улучшает ли независимый acceptance? Правильный выбор команды отдельно от правильной обработки её вывода. Главная метрика — original independent B v2 phase 2 acceptance; отсутствие цикла, output и время вторичны.

Arm A: зафиксированный исторический verified recovery. Arm B: тот же recovery и история плюс derived Current Working State в одном существующем recovery message. Ни конкретный дефект, ни результаты hidden oracle не сообщаются кандидату. Никаких подсказок о конкретных строках SQL или нужном исправлении.

Это узкий execution harness: Pi 1.4.0 исполняет настоящие `read`, `bash`, `edit`, `write`, а контроллер продолжает frozen OpenAI-compatible provider history. В обоих вариантах одинаково оставлены только четыре native tool schemas; прежние CCE tool definitions удалены, backends CCE не имитируются. Исторические tool-call/tool-result пары и system prompt не переписываются. Это изменение loadout относительно старого replay фиксируется явно. Новый Pi event loop, retrieval, compaction и обновление CCE Ledger в этой серии **NOT EXERCISED**. Вывод ограничивается начальным представлением состояния и обработкой native execution evidence.

## Источник и фиксация

Один snapshot B v2, один контракт, тот же provider packet после первого успешного create probe, те же model generation parameters. В оба arm копируется один набор исходников, тестов и неизменных public checkers. Каждый trial начинает новый networkless container, файловые изменения между arm не переносятся.

Архив содержит финальный source export и события `source_changed`. После выбранного provider request новых наблюдаемых source changes нет; поэтому экспорт используется как исходный snapshot. Это **временная привязка по журналу**, не атомарный snapshot в момент запроса; ненаблюдаемые внешние изменения UNKNOWN. Оба arm получают побайтово одинаковый зафиксированный snapshot независимо от этой оговорки. Source bytes, public checkers, task contract, оба packets, model preset, runner и original oracle закрепляются SHA-256. Unborn HEAD CCE отмечается как отсутствие commit, заменяется manifest исходников.

Исторические primary results, session, Ledger и exports только читаются. Новый root `.bench/action-continuity/execution-*`, отдельный pointer `benchmarks/agent/action-continuity/execution.json`. Нет автоматического resume или повторного запуска уже занятой пары.

## Бюджеты и порядок

- Не более **8 provider cycles** и **16 native tool calls** на arm; число циклов — одинаковый экспериментальный лимит, не native Pi setting.
- Родные context 65536 / output 16384 и IQ3_XXS preset B v2; idle timeout 480 секунд. Перед генерацией и каждым циклом сверяется модель/preset. Автоматической загрузки/смены модели нет.
- Каждый tool не более 180 секунд; отдельный operational watchdog arm — 20 минут. Он не заменяет лимит циклов. Незавершение учитывается, не превращается в PASS.
- Четыре независимые пары: **AB, BA, BA, AB**. Каждый trial — свежая файловая среда. RNG независимость/seed не гарантируются; cache не очищается и не контролируется. Последовательность задана заранее.
- Сначала отдельный диагностический pair 1; следующие пары разрешены только отдельным явным запуском, после анализа среды. Отрицательный coding acceptance сам по себе не причина прекращать серию; transport/runner ошибки требуют разбора.
- История только дополняется полными assistant/tool pairs. Сериализованный JSON считается локальным tokenizer как proxy с запасом 2048 токенов; это не rendered provider count. При нехватке места `CAPACITY_GUARD_PROXY`, без удаления истории, искусственной compaction и изменения output cap. Provider overflow — ошибка, не успешный fallback.
- Inference retries отсутствуют. Failed requests сохраняются; usage без provider counters — UNKNOWN, не ноль. Reasoning — подмножество output, отдельно не прибавляется.

## Исполнение и exit codes

На host нет shell для модельных команд. Только фиксированный Docker launcher: pinned image, user 1000, network none, read-only root, no capabilities/no-new-privileges, лимиты CPU/RAM/PID и tmpfs. Монтируются только readonly input и control; Docker socket, repository, private oracle, credentials и host filesystem не монтируются. Источники и команды выполняются только внутри candidate container. Самостоятельно команды из checkpoints runner не исполняет: требуется новый tool call модели.

Одинаковый Bash backend обоих arm запускает `bash --noprofile --norc -o pipefail -c COMMAND`. Поэтому `python ... 2>&1 | tail -20` возвращает ненулевой статус при Python failure. Модель получает настоящий Pi tool result, `isError`, exitCode, signal/termination, источник до/после и `correctness=UNVERIFIED`. Host сохраняет stdout/stderr до native truncation, raw native/model-facing result и SHA исходников. Exit 0 сам по себе не доказывает PASS: явные `|| true`, shell overrides и swallowed exceptions не нейтрализуются автоматически, их разбирают по трассе. Tail по-прежнему может убрать ранние строки; полнота stderr до shell pipeline не обещается.

При timeout/output quota tool остаётся ошибкой. Уничтожается process group; полученный ранее `0` не используется вместо termination. Новые свидетельства о проверке не превращаются автоматически в verified receipt. Старый recovery остаётся историческим snapshot, а не текущим подтверждением изменённого кода.

## Независимый oracle и метрики

Оригинальные `crmCases`, comparator и B v2 candidate RPC не меняются. Hidden expected values остаются на host; grader исполняет код в отдельном контейнере, не передаёт candidate код oracle/expected outputs. Initial grade и final grade хранятся только у контроллера и не добавляются в prompt. Final acceptance относится к последнему успешно экспортированному финальному source snapshot; если tool завис и финальное состояние не захвачено, primary NOT_EVALUATED. Неполное выполнение и acceptance записываются раздельно. Новый запуск после model final не производится автоматически даже при FAIL.

Для каждого trial сохранить:

| Измерение | Evidence |
|---|---|
| Первое, второе и третье действия | Полные tool args, native result, exit code и порядок |
| Доставка ошибок | Actual next provider packet с tool result; наличие в payload отдельно от правильной интерпретации |
| Продолжение после ошибки | Последующие read/edit/write/check, diff по SHA, итоговый oracle; смысл действия размечается post hoc |
| Повторы probes | Одинаковые args/output/source SHA; статус DIAGNOSTIC_ONLY, не автоматический запрет или утверждение о бессмысленности |
| Прогресс | Initial/final original cases passed, source changes; изменение файла не доказательство исправления |
| Acceptance | Original independent phase 2, завершение и корректность раздельно |
| Стоимость | Provider attempts и usage coverage; input/output/reasoning, headers/first body timing, tool calls/errors, время |
| Recovery completeness | Контракт/структурированные требования в actual packet каждого запроса; frozen receipts не считаются актуальными |

Изменение количества output-токенов не считается преимуществом без сопоставимого acceptance. С одной парой нельзя заявлять причинное улучшение; четыре пары на одном snapshot всё ещё локальная диагностика. Warm cache не позволяет интерпретировать суммарное время как ускорение от CWS. Compactions в этом сценарии отсутствуют.

## Подготовка, проверка и будущий запуск

Подготовка и проверки не обращаются к LLM:

```powershell
node --test scripts/benchmark/continuity/action-continuity/execution/shared.test.mjs
node scripts/benchmark/continuity/action-continuity/execution/preflight.mjs
node scripts/benchmark/continuity/action-continuity/execution/prepare.mjs
node scripts/benchmark/continuity/action-continuity/execution/run.mjs
```

Последняя команда только печатает PREPARED_NOT_RUN. Контейнерный preflight использует синтетические данные: non-root/network/mount denial, failing Python pipeline exit 7, successful pipeline, read/write/edit, timeout/output quota и unsupported tool. SDK [createCodingTools](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/tools/index.ts) и [BashOperations](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/tools/bash.ts) сверены с официальным pinned Pi 1.4.0 и установленными declarations. Зависимости не обновляются.

Только после отдельного разрешения запуск диагностической пары:

```powershell
node scripts/benchmark/continuity/action-continuity/execution/run.mjs --run --pair 1
```

**Сейчас эта команда не выполняется.** Пары 2–4 отдельно и по порядку, после оценки pair 1. Для остановки создать `STOP` в подготовленном root; проверяется между запросами, текущий запрос ограничен idle/arm watchdog. Live watch: следить за `pair-N/<arm>/*.result.json`, `tool-*.json`, `.transport.json`; общий pair result появляется после обоих arm либо прерывания. Старые status scripts относятся к старым сериям.
