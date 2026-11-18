> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `529a83a12f15e2d0e7174a33134b1399b07c5db7bbd7b4945b7d674893439dba` (source-94). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Cross-Session B v2 — результат после watchdog

14 ноября 2026. Run `2026-11-13T20-50-46-804Z-a6c8efcc`; [протокол](../protocols/cross-session-v2.md), предварительная валидация (original artifact not bundled; see [publication scope](../README.md)).

**Primary: STOPPED / TRIAL_WATCHDOG / acceptance NOT_EVALUATED.** Модель не завершила phase2 за50 минут. Независимая post-hoc оценка сохранённого partial: **17/21, FAIL**, evaluated21, invalid responses0. Это отдельный результат частичного кода, не завершённый acceptance.

## Основные метрики

| Метрика | Значение |
|---|---:|
| Start → finish, МСК | 13 ноября23:53:33 → 14 ноября00:43:36 |
| Длительность controller | 50 мин3 с |
| LLM attempts / known usage / unknown |26 /25 /1 |
| Input lower bound |741 180 |
| Output lower bound |20 704 |
| HTTP request timeouts |0 |
| Отменённые запросы |1, CANCELLED при общем watchdog |
| CCE extension errors |0 |
| Compactions |0 |
| Tools модели |read7, edit5, bash17 |
| CCE tool calls / public checker executions |0 /0 |
| Независимый partial grader |17/21, все21 evaluated |

Input/output — provider counters25 завершённых запросов; расход прерванного26-го неизвестен, cache UNAVAILABLE. Без завершённой задачи и Pi-only контроля экономия/causal advantage не установлены.

## Что не работает в partial

Исходные hidden cases не менялись. Четыре FAIL: update возвращает500 вместо200; archive возвращает500 вместо200; после этого get/list продолжают показывать запись, которая должна была быть архивирована. Ошибок сериализации в этих21 ответах нет; это не означает, что весь API корректен.

Непосредственная причина update подтверждена отдельным ограниченным Docker probe без прав записи в candidate: код составляет `UPDATE contacts SET %s ...`, но не подставляет подготовленный `set_clause`. SQLite выбрасывает `OperationalError: near "%": syntax error`. Обработчик перехватывает только `IntegrityError`, поэтому открытая транзакция остаётся незакрытой. Следующий archive на той же connection получает `cannot start a transaction within a transaction`. Facade скрывает исключения за500/internal_error, состояние записи остаётся прежним. Это объясняет связанный набор четырёх hidden FAIL.

Код модели не исправлялся, новое обучение/генерация не выполнялись. Frozen grader отработал штатно, сохранил individual results и оценил все21 case. В отличие от B v1, общий batch не оборвался на несериализуемом значении.

## Почему не закончила модель

Наблюдаемая последовательность, МСК14 ноября:

| Время | Действие |
|---|---|
| 00:00–00:08 | Изменения contacts/service/tests |
| 00:08 | Единственный запуск собственных unittest:49 tests,8 failures,27 errors |
| 00:11–00:21 | Локальные probes create; сначала неполный setup, затем выявлено отсутствие колонки archived в реальной схеме |
| 00:23:14 | Модель исправила схему; последнее наблюдаемое изменение source |
| 00:25:17–00:42:26 |10 одинаковых проверок create, каждая возвращает одинаковый успешный результат |
| 00:43:33 | Общий watchdog инициирует остановку |

Одинаковая probe-команда встречается11 раз: один раз до исправления со schema error и10 раз после него с идентичным успешным stdout. После первого успешного подтверждения следуют ещё9 повторов без новых source changes. Unittest повторно не запускался, update/archive не диагностировались. Последние примерно20 минут после schema edit не сопровождались разработкой.

Все26 queued provider payloads различаются по SHA, message history растёт от4 до58 сообщений; новые tool results присутствуют в следующих запросах. Это не побайтовый повтор одного transport request. При этом различие JSON payloads ещё не доказывает правильность token-level chat template backend.

Видимый текст модели часто снова утверждает, что нужно выяснить старую причину500, даже после успешного create probe. Это наблюдаемый цикл действий; первопричина между моделью, шаблоном/форматом сообщений и CCE recovery **не изолирована**. Утверждать, что виновата только модель или только CCE, нельзя.

## Публичная проверка была доступна, но не выполнена

Модель прочитала `/input/public-check.py`, однако среди17 bash calls нет её запуска; approved-check tools также не вызывались. Host boundary check тоже не выполнен: он запускается после нормального завершения phase, а сессия была прервана watchdog. Следовательно, новый JSON-инвариант прошёл предварительные regression controls, но **его применение самой моделью в этом trial NOT_EXERCISED**.

Tool errors0 не означают PASS тестов: unittest запускался через `... | tail -60`, чей exit code может быть0 при падении Python; часть probe-команд ловила исключения и печатала traceback, также завершаясь с0. Ошибки в текстовом выводе были доступны модели, но не стали актуальными approved verification receipts.

## CCE: успешный startup и неполная последующая доставка

Первый успешный provider request содержит original contract и project map. Authority — `HISTORICAL_ONLY_RECHECK_REQUIRED`, live checks0; старый native transcript не импортирован. Это подтверждает startup A→B delivery, но не весь последующий цикл.

Дополнительный аудит каждого из25 завершённых provider requests:

| Доставка | Число |
|---|---:|
| Полные6 structured clauses в current recovery |19/25 |
| INCOMPLETE_BUDGET без полной structured projection |5/25 |
| Automatic recovery отсутствует |1/25 |
| Полный original contract text и6 verbatim clauses |24/25 |

В запросах2,4,21,23,25 recovery явно помечен INCOMPLETE_BUDGET, но полный original text сохранён. Запрос8 (`4479a51a34d249e8820ad25756578b96`) не содержит automatic recovery, structured clauses или exact original text. Отсутствие verbatim не приравнивается к доказанной семантической потере всех правил; однако обязательную доставку CCE в этом запросе подтвердить нельзя.

Таким образом, startup `contractDelivered=true` из terminal evidence нельзя распространять на все запросы. Это отдельная проблема устойчивости budget/delivery CCE даже без compaction. Её механизм и влияние на последующий цикл требуют аудита; runtime этим разбором не менялся.

## Повторные чтения

Native reads: attempted7, successful7, project reads6, unique project paths5. Одна повторная path — contacts.py; одинаковых range без наблюдаемого изменения source0, unknown range metadata0. Самостоятельных scan commands не зарегистрировано.

Это не доказательство отсутствия повторного изучения: shell reads UNKNOWN без syscall tracing. Главный явно наблюдаемый повтор здесь — исполнение одной и той же probe-команды, а не native read. Исторический B v1 не является чистым контрольным сравнением: v2 меняет public feedback/executor, а один trial не даёт оценки преимущества.

## Таймаут и следующий шаг

Нативный HTTP idle timeout480 секунд не сработал; единственный broker error — CANCELLED из-за общего watchdog, через65,2 секунды последнего запроса. Успешные provider calls длились не более243 секунд. Compaction0: проблема длинного post-compaction prefill ночного A этим экспериментом не проверена.

Увеличение общего watchdog не устраняет обнаруженный цикл. Следующий конкретный шаг — проверить причины пропуска recovery в request8 и INCOMPLETE_BUDGET, затем сопоставить prompt/template/tool-result/recovery вокруг первого повтора после успешного create. До нового длинного coding trial нужен короткий контролируемый диагностический тест выбора следующего действия. Новые runtime fixes и модельные trials здесь **NOT RUN**.

## Доказательства

- Оригинальный terminal result (original artifact not bundled; see [publication scope](../README.md)).
- Отдельный post-hoc анализ, command groups и isolated SQL probe (original artifact not bundled; see [publication scope](../README.md)).
- Per-request delivery audit (original artifact not bundled; see [publication scope](../README.md)).
- Основной evidence index (original artifact not bundled; see [publication scope](../README.md)):47 файлов,3 703 040 байт; requests/broker/native history/events/partial snapshot/frozen public checker/grade/probe.
- Дополнительный индекс delivery audit (original artifact not bundled; see [publication scope](../README.md)).

Evidence copies проверены по SHA-256, primary SHA неизменён. Изолированный SQL probe действительно выполнен; post-hoc анализ не редактировал candidate/acceptance. Production changes отсутствуют; повторные полные CCE tests/typecheck/build при этом анализе **NOT RUN**. Результаты предварительных проверок B v2 сохранены отдельно и не подменяют coding verdict.
