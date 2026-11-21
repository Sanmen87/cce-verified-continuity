# Shell evidence → Pi 1.5 compaction → B completion

Подготовлено 21 ноября 2026 до новых запросов к LLM. Предыдущий run `2026-11-21T18-49-35-900Z-bb6cd2f9` и его STOPPED/primary/post-hoc оценки не меняются. Тестируется новая сборка неопубликованного кандидата alpha.2; source и archive hashes закреплены отдельно.

## Исправление shell evidence

Process outcome не выводится из `isError:false`. При отсутствии кода возвращается PROCESS_STATUS_UNKNOWN; стандартный unittest/pytest FAIL остаётся наблюдаемым testOutcome FAIL; traceback без такого verdict — DIAGNOSTIC при неизвестном процессе. Ни один native output не выдаёт trusted receipt. Для ожидаемых исключений approved adapter использует explicit-result policy.

Реальные фиксированные команды в network-none Docker проверили: pipeline без pipefail (outer exit 0 / receipt UNKNOWN), с pipefail (outer exit 1 / FAIL), подавленное Python-исключение (exit 0 / UNKNOWN), direct unit-test FAIL и structured approved PASS с ожидаемым исключением. Проверены неизвестные native codes и stale receipt после изменения marker. Команды не загружаются из истории и не принимаются от модели.

Полный suite 248/248, typecheck/build/real Pi loader smoke PASS; новые архивы прошли три clean installs на Node 22.19. Pi host declaration workaround TS1543 остаётся документированным. Observe-only и native output/history не переписываются.

## Общие условия двух живых тестов

- Pi 1.5.0; IQ3_XXS, фактическое окно 65792, те же frozen model settings; output max 16384, native keepRecent 20000/reserve 16384 не меняются.
- Каждый тест — независимый clone состояния из исходного run. Source snapshot, native session JSONL, scoped Ledger и continuation handle проверяются SHA. Новые runtime записи пишутся только в копии. Git history реконструируется отдельно, исходные Git objects не экспортировались; прежние receipts требуют свежей проверки, тождество старого worktree не имитируется.
- Новый Docker image состоит из собранных npm-архивов. Не монтируются development checkout, host, socket или hidden oracle. non-root, network none, resource limits; source передаётся только локальной модели через allowlisted relay.
- Не более **20 минут на каждый** живой тест; idle timeout 480 секунд. Тесты идут последовательно, без параллельной генерации и без автоматических экспериментальных retries. Пользовательская остановка или инфраструктурная ошибка останавливает очередь.
- Финальный provider body проверяется после hooks на original contract/6 clauses; сохраняются body SHA, core inspection, source/check receipts и provider usage. Логи приватные.

## 1. Live compaction + coding continuation

Seed — принятая A с её настоящей историей. Native Pi prepareCompaction подтвердил split-turn cut с выходом original user entry из retained tail при unchanged keepRecent=20000. Без искусственных сообщений.

До продолжения вызвать настоящий `session.compact()` без custom instructions, записать fromExtension, reason, capacity, полные проекции до/после и сохранность raw history. Это **manual native SDK compaction**, а не достижение автоматического threshold. Прежние/synthetic compaction не засчитываются.

Далее настоящая модель получает исходный следующий этап contacts.update/archive без повторения ранних правил. Проверить фактический post-compaction packet, изменения кода и independent phase-two acceptance. Seed A обязан пройти phase 1 и не пройти phase 2 до генерации — так отсутствие coding gap не выдаётся за разработку после compaction.

## 2. B completion

Отдельный seed — неизменённый partial B, прошедший post-hoc 21/21. Восстанавливаются его собственные native history и Ledger, а не только исходники. Ошибочный/неполный tool-call/result seed отвергается. Продолжение той же сохранённой B не называется новым A→B переносом.

Нейтральный prompt: «Продолжи текущую задачу. Выполни доступные проверки, учти их результаты и заверши работу с точным описанием сделанного и оставшихся ограничений». Модели не сообщается post-hoc 21/21, скрытые cases или конкретный предполагаемый дефект.

## Метрики и критерии

Разделять: agentReturned/MODEL_FINAL, независимый кодовый acceptance, automatic recovery, native process observations и модельный approved receipt. Host after-task checker не считается проверкой, самостоятельно вызванной моделью.

Strict workflow PASS: нормальное завершение моделью + independent PASS + model-invoked approved PASS на том же финальном binding + отсутствие recovery degradation. Для compaction дополнительно нужны настоящий CCE handoff, raw goal вне retained tail, сохранённая original history и дальнейшая генерация/разработка. Если код принят и модель вернула ответ, но нет актуального model-invoked receipt, результат CODE_ACCEPTED_WORKFLOW_NOT_FULLY_VERIFIED; native observation не переименовывается в trusted PASS.

Расход прерванного запроса UNKNOWN, не 0. Нет Pi-only контроля или причинного вывода об экономии. Эти прогоны не заменяют published-package validation. Решение о выпуске alpha.2 принимается по отдельным release checks и точным ограничениям полученных результатов.

## Монитор

```powershell
node scripts/benchmark/continuity/integrity-native/status.mjs --compaction --watch
node scripts/benchmark/continuity/integrity-native/status.mjs --completion --watch
Get-Content benchmarks/agent/integrity-resume/queue.json
```

Перед live запуском оба zero-generation preflight должны пройти с тем же frozen signature. Окончательный результат каждого теста — его собственный result.json, а не последняя строка монитора.
