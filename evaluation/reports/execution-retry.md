> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `cbc1c59f92d762939c6b98918ef59d08a74baad2de27ac5ab0af329eeb2f64e2` (source-99). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Execution Continuation: диагностический повтор после reload

19 ноября 2026, 00:41–00:50 МСК. По просьбе пользователя модель выгружена и заново загружена с тем же frozen preset; затем отдельно повторена пара 2 в порядке CWS → baseline. Исходная неудачная попытка не переписывалась и не заменялась этим результатом.

## Результат

| Метрика | CWS | Baseline |
|---|---:|---:|
| Independent acceptance | FAIL, 17/21 | FAIL, 17/21 |
| Завершённых provider cycles | 8 | 8 |
| Tool calls | 8 | 8 |
| Различных команд | 1 | 1 |
| Изменений исходников | 0 | 0 |
| Input tokens | 281126 | 275352 |
| Output tokens | 3744 | 3232 |
| Input + output | 284870 | 278584 |
| Reasoning, внутри output | 2248 | 1736 |
| Длительность arm с grading, секунд | 438,244 | 121,130 |

Оба варианта восемь раз вызвали один и тот же успешный `create` probe. Output и source hashes внутри каждого arm совпадают; инструмент возвращал exit 0. Проверок unit tests, чтения для исправления и изменений кода не было. Оба остановлены по прежнему лимиту 8 циклов, без MODEL_FINAL и без полного acceptance. Результат остался на исходных 17/21.

Все шесть структурированных требований присутствовали во всех 16 запросах. Доставка требований сама по себе не обеспечила полезное продолжение действий. В этом повторе преимущество CWS не показано. Суммарных токенов у CWS на 2,26% больше; экономия на завершённых задачах не измерена, поскольку задача не завершена ни в одном arm.

Проверены 14/14 результатов первых семи tool calls каждого arm: полный model-facing result с правильным tool_call_id побайтово присутствует в следующем реально отправленном provider JSON. Последний result каждого arm не отправлялся из-за лимита 8 циклов. Это подтверждает включение результатов в payload; корректность финального template rendering и интерпретация моделью отдельно не доказаны. Sidecar `tool-result-delivery.json` сохранён в retry root.

Односимвольный поток `?` не появился ни в одном из завершённых ответов. Это наблюдение после reload, а не установленная причина предыдущего сбоя или доказательство устранения проблемы модели/runtime.

## Условия и сохранность

- Модель IQ3_XXS, context 65536, native output 16384 и все frozen load parameters совпали после reload. Генерационные overrides отсутствуют.
- Начальный запрос CWS побайтово совпадает с запросом сбойной попытки. Input/control/private, protocol и manifest сохранены без изменений. `protocol.root` указывает на исходную фиксацию; retry pointer задаёт отдельное место исполнения.
- Новый root: `.bench/action-continuity/execution-retry-2026-11-18T21-36-58-838Z`. Пара 1 скопирована вместе с provenance для проверки зависимостей runner; это не новый trial и не дополнительная модельная генерация.
- Первоначальная пара 2 остаётся INCOMPLETE / NOT_EVALUATED в исходном root `.bench/action-continuity/execution-2026-11-16T19-04-33-026Z`. Её partial SSE содержит 11743 одинаковых ASCII `?`, tool calls отсутствуют; исходный 20-минутный watchdog сохранён. Provider usage этой попытки UNKNOWN, нулевые агрегаты не означают нулевую стоимость.
- Повтор является post-hoc диагностикой после явного вмешательства в состояние backend. Его нельзя молча подставлять вместо первоначальной пары в заранее зафиксированной серии.
- Пары 3–4 не запускались автоматически. Candidate containers завершены и удалены; новых вызовов модели при разборе не было.

Первый CWS запрос после холодной загрузки ждал body 300,089 секунды, первый baseline — 1,135 секунды. Cache между arm не контролировался; сравнение времени не доказывает ускорения baseline или CWS.

## Наблюдаемость

Для диагностики подготовлен внешний SSE mirror. Синтетическая проверка подтвердила неизменность request/response bytes, корректность UTF-8 на границе chunks и изоляцию ошибок записи. Однако при настоящем запуске Pi `configureHttpDispatcher` переинициализировал undici globals после preload и заменил перехватчик fetch. Live mirror **не был активен**; это ограничение отдельно записано в `observer-runtime-status.json`. Во время работающего benchmark его не исправляли и запуск не перезапускали. Неизменный runner сохранил реальные request/response SSE после завершения каждого запроса; наблюдение велось по этим артефактам и техническим логам LM Studio.

Typecheck/full CCE suite/build при этом операторском повторе **NOT RUN**: production CCE и frozen runner не менялись. Проверены frozen SHA до/после, исходный failed result SHA, точное равенство первого запроса, reload preset и синтетический observer. Ошибка первой inline-команды проверки observer была PowerShell/JavaScript quoting error до исполнения; проверка перенесена в отдельный `.mjs` и прошла без сетевых/model calls.

Машинный разбор и provenance (original artifact not bundled; see [publication scope](../README.md)), подтверждение запуска (original artifact not bundled; see [publication scope](../README.md)), [исходный протокол](../protocols/execution-continuation.md).

Следующий предмет разбора — одинаковые успешные действия без новых source/output evidence в обоих arm при подтверждённом включении результатов в последующие provider packets. Предыдущий отказ `?` и повтор успешного probe следует учитывать как разные наблюдения; расширять лимиты или объявлять исправление runtime по этому повтору оснований нет.
