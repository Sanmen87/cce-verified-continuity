> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `48dfc6a7d954425ae84ca86265780a15244553efa3d7d139d3f3242618d9be7c` (source-91). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# CCE MCP Retrieval Evaluation — 12-run diagnostic

Протокол до измерений, 11 ноября 2026 года. Алгоритмы поиска, схемы MCP и формат CCE-ответов сохраняются без изменений. Три сценария × два режима × два повтора = **12 новых независимых Codex-сессий**. Это проверка повторяемости и выбора инструментов; coding и lifecycle не входят.

## Фиксированные условия

- Модель: запрашивается `gpt-6.1-sol`, reasoning `low`, выбранные CLI параметры одинаковы для обоих режимов. Разрешение alias и версия весов не раскрываются — UNKNOWN.
- Два общих workspace tools; CCE arm дополнительно получает неизменённые `cce_search` и `cce_expand`. Векторы, lifecycle, web, shell, apps и subagents выключены. Code-mode host включён для исполнения MCP.
- Один и тот же авторский корпус из восьми небольших файлов. Каждый trial получает собственную копию, новую сессию и пустой `.context-engine`. Индекс CCE **холодный**; preflight работает на отдельных копиях. OS cache и provider cache не очищаются и не называются холодными.
- Версии CLI, Node и MCP SDK, task/fixture/source hashes, schema catalogs и план записываются в `protocol.json`; SHA протокола сохраняется до первой генерации. Изменение исполняемых исходников останавливает серию.
- До 180 секунд на trial. Автоматических повторов нет. Транспорт/недоступный tool host/таймаут останавливают остаток серии с BLOCKED_INFRA; обычные неверные ответы сохраняются и не мешают следующим trials. Неустановленная причина таймаута помечается UNKNOWN.
- Передаётся только публичный авторский fixture. Проверка вне workspace, shell отсутствует. Это не обещание OS-изоляции для произвольного coding-агента.

## Сценарии и критерии

| Сценарий | Что проверяется | Обязательное source evidence |
| --- | --- | --- |
| `known-path` | По явно данному пути вычислить четыре случая правила доставки | Тело функции в `src/domain/rules.ts` |
| `unknown-definition` | Найти актуальное правило, обоих production callers и вычислить четыре случая | Тело правила и import/call диапазоны в quote/preview |
| `historical-decoy` | По import chain выбрать одно из одноимённых определений и вычислить два случая | Правило и import/call диапазон quote |

Точные prompts, ожидаемые JSON-ответы, пути и диапазоны заданы в `evaluation.mjs` и замораживаются в протоколе. В baseline/CСE предъявляется одинаковый prompt сценария. Правильность JSON оценивается отдельно от полноты evidence. Первичный task success требует обоих условий и неизменённых исходников.

Сценарии первого повтора идут known → unknown → decoy, в каждой паре **A → B**. Во втором повторе сценарии идут в обратном порядке, пары **B → A**. A = baseline, B = CCE. Два повтора не достаточны для статистического доказательства экономии.

Прямое чтение известного пути уместно; CCE-вызов не обязателен и не даёт баллов. Чтение historical decoy для исключения допустимо. Ошибка — назвать его действующим источником. Поисковый preview/reference не засчитывается как полное тело. Evidence проверяется по фактическому client tool result: путь, SHA-256, исходный текст и покрытие заранее заданного диапазона.

## Измерения

- Все 12 результатов, JSON-ответы, отдельные checks, обязательные диапазоны, неверно заявленные источники.
- Последовательность tools, длительность, ошибки, stale SHA и фактические server metadata logs. «Необходимость каждого вызова» не угадывается автоматически.
- Байты/estimated tokens возвращённых **полных ответов сервера** отдельно для search, source и listing; исходные source-body bytes в client results отдельно.
- Реальные `tools/list` catalogs: размер, SHA и консервативная UTF-8 оценка. Это не точный размер внутренней model-facing сериализации Codex.
- Codex CLI usage: input, cached input, non-cached input, output, исходные поля. При отсутствии/несогласованности — UNKNOWN. Число внутренних LLM-запросов и точный model-visible контекст — UNKNOWN.
- Физические чтения индексатора не измеряются и не заменяются числом workspace_read_file. Серверный ответ не объявляется гарантированно переданным модели байт-в-байт.
- Парные разности показываются для всех завершённых пар, но вывод об экономии допустим только при успешности и достаточном evidence в обоих arms. Падения и пропущенные результаты остаются видимыми. Стоимость в деньгах не рассчитывается из этих полей.

Полные сырые CLI и MCP логи сохраняются. Ничего из расходов сервера не вычитается из input для «вычисления чистой стоимости CCE».

## Команды

```powershell
# Подготовка и zero-generation preflight
npm.cmd run bench:codex:study

# Новая серия из 12 облачных запусков
npm.cmd run bench:codex:study -- --start

# Наблюдение
npm.cmd run bench:codex:study:status -- --watch
```

Артефакты хранятся отдельно в `.bench/codex-retrieval/<id>/`, pointer — `benchmarks/agent/codex-retrieval/latest.json`, итоговый receipt — `benchmarks/quality/codex-retrieval/<id>.json`. Старые micro-pair/Pi/CRM результаты не перезаписываются. Следующая format ablation и coding/lifecycle не запускаются этой командой.

Завершённая серия описана в [результатах](../reports/mcp-retrieval.md). CLI режимы, JSONL и reported usage сверены с [официальной документацией](https://learn.chatgpt.com/docs/non-interactive-mode); фактическая проверенная версия указана в protocol.json.
