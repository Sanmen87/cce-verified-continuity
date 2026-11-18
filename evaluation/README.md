# CCE evaluations / результаты экспериментов

English summary: public reports include negative results. This bundle supports offline checking of reported arithmetic, immutable public files, the original synthetic MCP scoring and captured source bodies. It is **not** a complete replay of private native coding trials and does not establish general coding advantage or token savings.

Публичный набор подготовлен 19 ноября 2026. Исторические оригиналы сохранены отдельно и не переписывались. Отчёты — явно помеченные производные копии: удалены локальные абсолютные пути и ссылки на не включённые архивы. Даты, статусы, ошибки и исходные оценки сохранены. Формулировки NOT RUN относятся к дате исходного отчёта.

| Серия | Главный результат | Что этот результат не доказывает |
|---|---|---|
| [Первый пилот](reports/first-pilot.md), 9 runs | Задача A принята 3/3, B/C не завершены; токены по calls опубликованы | Это ограниченный tool-loadout с экспериментальными caps, не unrestricted native Pi; экономия на FAIL не является успехом |
| [Retrieval v0.4](reports/retrieval-v04.md) | Recall@10 TS 55,56%, Elara 69,44%; 36 запросов | Меньший payload не равен экономии provider tokens; coding не проверялся |
| [Retrieval v0.5-fix2](reports/retrieval-v05-fix2.md) | Фиксированные regression/independent cohorts; последний final12 не показал дополнительного gain | Другие cohorts и версии нельзя смешивать с v0.4 в одну причинную оценку |
| [MCP retrieval](reports/mcp-retrieval.md), 12 trials | Strict baseline 5/6, CCE 4/6; evidence 12/12, CCE adoption 6/6 | Три FAIL связаны с known-path контрактом; нет coding/lifecycle и контроля cache |
| [Long Task A](reports/long-task.md) | 16 естественных compaction; contract 16/16, полный current recovery 15/16; фаза 7 принята 60/60 | Вся задача STOPPED/NOT_EVALUATED; partial 63/68 не полный PASS; нет Pi-only контроля |
| [Cross-Session B v2](reports/cross-session-v2.md) | STOPPED/NOT_EVALUATED; post-hoc partial FAIL 17/21 | Доставка recovery не равна успешному продолжению; полная стоимость UNKNOWN |
| [Decision replay](reports/decision-replay.md) | Полезная проверка выбрана 2/2 каждым arm | Команды не исполнялись; нельзя заключать об исправлении кода или устранении циклов |
| [Execution continuation](reports/execution-continuation.md) | Ни одной полной принятой задачи; CWS 20/21 только в двух AB, 17/21 в BA; известные tokens +3,59% | Один snapshot, post-hoc retry, backend reload и неконтролируемые cache/RNG; причинное преимущество не доказано |

## Структура и воспроизводимость

- `protocols/`: производные зафиксированных протоколов; исторический протокол не переписывается под новый результат.
- `reports/`: результаты и разбор ошибок, включая отрицательные и прерванные попытки.
- `results/`: производные машинные сводки без prompts, reasoning и приватных путей; UNKNOWN не заменяется нулём.
- `fixtures/mcp.json`, `scripts/mcp-scoring.mjs`: авторская синтетическая fixture и неизменённый исходный scorer для read-only MCP series. В публичных results включены только клиентские source bodies, проверенные против этой fixture.
- `results/execution-usage-receipts.json`: 64 набора provider counters. При экспорте сверены с последними usage frames сохранённых SSE и request SHA. Reasoning является частью output, повторно не прибавляется.
- `provenance.json`: hashes и размеры исходных отчётов/артефактов, из которых получены публичные поля; оригиналы не выдаются за публично доступные файлы.
- `inventory.json`: SHA-256 публичных файлов; обнаруживает изменение после подготовки, но не является подписью или внешней аттестацией.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:evaluation
npm run test:public
```

`test:evaluation` не использует API модели, Codex, Pi generation или GPU. Пересчитывает strict grade и source evidence 12 MCP trials, суммы 64 usage receipts, pass counts, известные/неизвестные попытки и критерии compaction; проверяет inventory. Ненулевой exit означает нарушение опубликованных проверок. Это **saved-artifact audit**, не новый live benchmark.

Что независимо не воспроизводится из этого набора: CRM acceptance grading, полный source diff кандидата, actual active provider payload, final rendered prompt и поведение backend/cache. Для этого нужны отдельно подготовленные и проверенные на публикацию coding fixture/runner/oracle и новые blind cases. Закрытые acceptance tests не становятся публичным development checker. Извлечённые receipts не заменяют raw evidence или billing telemetry. Сводки не являются независимым подтверждением собственных assertions harness.

Для нового native опыта нужны отдельный зафиксированный протокол, исходные snapshots/версии/параметры модели, независимые клоны и oracle, одинаковые ограничения и изоляция. Нельзя подставить текущий release commit вместо отсутствовавшего historical CCE HEAD или считать alpha Pi 1.5.0 окружением старого Pi 1.4.0 прогона. Новые live runs в ходе подготовки публикации **NOT RUN**.

## Политика публикации

Полный `.bench` не входит в source export, npm или GitHub Release assets. Не публикуются raw sessions, private source snapshots, prompts/reasoning, credentials, LM Studio logs и hidden acceptance code. Исследовательские оригиналы и полный SHA index остаются локально. Данные внутри `evaluation/` могут публиковаться на GitHub вместе с кодом; в npm tarballs этот каталог не включается.

Малые выборки и отрицательные результаты — часть отчёта, а не доказательство эффективности. Основная метрика остаётся долей полностью принятых задач по независимому acceptance; токены и время сравниваются только с учётом завершения и полноты telemetry.
