# Pi 1.5 / alpha.2 candidate — результат

21 ноября 2026. Run `2026-11-21T18-49-35-900Z-bb6cd2f9`; [условия запуска](pi15-candidate-smoke-run.md). IQ3_XXS, окно 65792, Pi 1.5.0, кандидат CCE 0.1.0-alpha.2 из архивов, не опубликованный npm-выпуск. Сравнения с Pi-only нет.

**Primary: STOPPED / TRIAL_WATCHDOG. A принят 16/16; B не завершён, primary acceptance NOT_EVALUATED.** Отдельная post-hoc проверка неизменённого partial B прошла **21/21**. Это принятое независимыми тестами состояние кода, но не завершение B самой моделью и не основание переименовать исходный STOPPED в PASS.

## Код и непрерывность

| Наблюдение | Результат |
|---|---|
| A: contacts.create/get/list | Модель завершила этап; independent acceptance 16/16 PASS |
| B: contacts.update/archive | Snapshot после watchdog: independent post-hoc acceptance 21/21 PASS |
| Frozen public checker на partial B | PASS, phase 2; выполнен post-hoc отдельным host grader |
| Собственные unit tests модели на partial B | 30/30 PASS, post-hoc readonly Docker; это существующий regression suite, не доказательство полноты новых B-тестов |
| Session A → B | Разные session IDs; `cleanNativeTranscript=true`; handle ссылается на A |
| Старые receipts в первом B packet | `HISTORICAL_ONLY_RECHECK_REQUIRED`; live checks 0, VERIFIED_PASS requirements 0 |
| Все B packets | Актуальных VERIFIED_PASS requirements 0; исторический PASS не был повышен до текущего |
| Реальные compaction | **0**, покрытие NOT_EXERCISED |

A заняла примерно 32 минуты; B получила около 18 минут из общего 50-минутного watchdog. После переноса модель прочитала существующие файлы и внесла два успешных изменения в `crm/contacts.py` и `crm/service.py`. Последнее действие перед отменённым запросом — чтение `test_crm.py`; завершение этапа и повторная working verification B самой моделью не наблюдались.

Две edit-ошибки B — ENOENT для относительных `work/task/crm/contacts.py` и `work/task/crm/service.py`. Модель затем использовала `crm/contacts.py` и `crm/service.py` и применила изменения. Это исправленные моделью ошибки native paths; не ошибка CCE transport и не потеря раннего контракта.

Повтора одинакового Bash command/output без наблюдаемого edit в native histories A/B не обнаружено. Это не доказывает отсутствие любых повторных рассуждений или чтений; source-generation diagnostic не отслеживает все внешние изменения runtime.

## Доставка CCE

| Проверка каждого фактически сформированного запроса | Результат |
|---|---:|
| Final transport inspections, включая последний отменённый запрос | 26/26 |
| Полный исходный контракт и шесть обязательных clauses | 26/26 |
| Все шесть structured clauses в current recovery | 26/26 |
| Task State packing FULL | 26/26 |
| Hook SHA совпал с конечным transport SHA | 26/26 |
| DEGRADED / INCOMPLETE_BUDGET / missing recovery | 0 |
| Extension errors | 0 |

CCE работал **автоматически**, а не через добровольный retrieval модели. Во время модели зарегистрированы Bash 9, write 5, edit 8, read 9; model-invoked CCE tools — **0**. Host выполнил approved public check после A. Эти разные виды использования не смешиваются: отсутствие `cce_search` не означает отсутствие recovery.

В этом сценарии старые проблемы доставки B v2 не повторились. Проверены точные тела перед отправкой в локальный provider, а не только compiler output. Это не доказывает понимание моделью восстановленного текста, причинное преимущество над Pi-only или устойчивость после реальной compaction: её здесь не было.

## Затраты и завершение

| Метрика | A | B | Всего |
|---|---:|---:|---:|
| Provider attempts | 19 | 7 | 26 |
| Запросы с final usage | 19 | 6 | 25 |
| Input, известная нижняя граница | 467284 | 144131 | **611415** |
| Output, известная нижняя граница | 17042 | 9710 | **26752** |
| Reasoning внутри известного output | 10144 | 6651 | 16795 |

Reasoning уже включён в output; повторно не прибавляется. Последний B-запрос отменён общим watchdog и не имеет final usage. Полная стоимость неизвестна; cache telemetry UNAVAILABLE. Экономию токенов и преимущество без baseline этот запуск не измеряет.

Время: **21:49:46–22:39:48 МСК**, около 50 минут 2 секунд. Максимальные завершённые HTTP requests: A около 320 секунд, B около 350 секунд; 480-секундный idle timeout не срабатывал. Последняя отмена вызвана общим watchdog, не timeout модели или ошибкой расширения. После завершения LM Studio idle, queued 0.

Максимальный provider total по завершённым запросам: A 33234, B 30798 при окне 65792 и native reserve 16384. Отсутствие compaction здесь не является проверкой её исправления: порог естественной compaction не был exercised.

## Осталась проблема native shell evidence

Четыре Bash-вывода A содержали traceback. Это pipelines без явного `pipefail`; Pi показал `isError:false`, а отдельного exitCode в сохранённом native result нет. Среди выводов есть реальные unittest `FAILED (errors=16)` и `FAILED (failures=1)`. Нельзя называть это подтверждённым Python exit 0 или тестовым PASS.

В этом запуске модель использовала доступные ошибки, исправила код и в конце A получила собственное `Ran 30 tests / OK`; после этого host-approved check и независимые 16 cases прошли. Ложного trusted PASS из native вывода не обнаружено. Однако интерфейс native shell всё ещё может выглядеть успешным при ошибках внутри pipeline, а отсутствие exit metadata ограничивает классификацию process outcome. Это конкретный следующий участок доработки; runtime и candidate после этого анализа не исправлялись.

## Артефакты и проверки анализа

- Primary остаётся в `.bench/integrity-native/runs/2026-11-21T18-49-35-900Z-bb6cd2f9/result.json` со статусом STOPPED.
- Машинный post-hoc audit: `benchmarks/quality/integrity-native/2026-11-21T18-49-35-900Z-bb6cd2f9.posthoc-analysis.json`.
- Отдельные readonly public/unit checks: тот же run ID с суффиксом `.posthoc-working-checks.json`; native path/pipeline observations — `.terminal-notes.json`.
- Свежий isolated grader подтвердил те же frozen 21 acceptance cases; primary/result и partial source SHA проверены и не изменились. Oracle не монтировался в solver. Дополнительных модельных запросов и исправлений CRM не было.

Результат подтверждает coding feasibility и A→B recovery кандидата на Pi 1.5 в данном сценарии. Полный workflow B, реальная compaction, опубликованная npm-сборка, сравнение с Pi-only и экономия остаются отдельными непроверенными условиями.
