> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `2d69268743bf88de0fbc87387c77190ddb40af413ef7b2f6763be45b159a61ea` (source-96). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Current Working State: decision replay AB/BA

16 ноября 2026. Run `run-2026-11-16T17-51-49-059Z`, протокол/валидация (original artifact not bundled; see [publication scope](../README.md)). Реальная локальная IQ3_XXS, окно 65536, native max_completion_tokens=16384, idle timeout 480 секунд. Прямой replay сохранённого Pi-generated provider packet. Полная Pi coding-сессия здесь не запускалась.

**Все 4 запроса завершились штатно. Оба варианта выбрали проверки 2/2; повтор create probe — 0/2 в каждом. Причинное преимущество Current Working State не установлено.** Код и инструменты не исполнялись; independent coding acceptance NOT_EXERCISED.

## Что выбрала модель

| Порядок | Вариант | Выбранные действия | Input | Output | Reasoning, внутри output | До первого body, с | Всего, с |
|---|---|---|---:|---:|---:|---:|---:|
|1 |baseline |unittest discover |34614 |390 |281 |331,083 |343,245 |
|2 |Current Working State |unittest discover |35110 |176 |79 |12,887 |18,722 |
|3 |Current Working State |unittest discover и public-check phase2 |35110 |208 |64 |0,242 |7,081 |
|4 |baseline |unittest discover |34614 |390 |281 |1,134 |13,365 |

Controller завершился приблизительно за 6 мин 23 с, около 20:58:11 МСК. Transport errors=0, HTTP 200 у 4/4, finish_reason=tool_calls у 4/4, toolsExecuted=0. Watchdog не потребовался. Окно модели было приведено с 65792 к зафиксированным 65536 до генерации; preflight/reload не входят в 4 trials. Путь GGUF, размер, архитектура, quantization и context дополнительно совпали с B v2.

В одном Current Working State ответе предложен и публичный checker. Все действия выбраны через bash, `cce_run_approved_check` не выбран. Данные CCE доставлялись автоматически внутри existing recovery, отдельного retrieval adoption этим экспериментом не измеряется.

Предложенные команды включают `... | tail -20`. Если их выполнять, pipeline способен скрыть Python exit code без pipefail. Здесь это только записанный выбор; нет выполненных тестов, новых receipts, изменений кода или основания утверждать PASS. Следующий coding follow-up должен учитывать это ограничение.

## Почему не доказано устранение цикла

Source request `138ac7b1e0be4dfeb89152ee5a95b46d` выбран сразу после первого успешного create probe в B v2. В исходной сессии его ответом был ещё один такой же probe. Новый baseline body побайтово идентичен: SHA `28fd5e4154ee96cab5816b80383b60678d2ece6aaa3d4192d9865679e128fdcb`, provider prompt tokens=34614 совпали и с историческим запросом.

Однако оба новых baseline ответа выбрали unit tests. Следовательно, baseline replay сам не воспроизвёл исторический следующий повтор. Нельзя утверждать, что Current Working State вывел модель из цикла, когда контроль тоже не вошёл в него. RNG/backend state длинной исходной сессии не восстановлен; это один snapshot и две генерации на arm. Причина изменения baseline поведения не установлена.

Эксперимент показывает более узкий факт: оба представления позволяют модели выбрать полезный проверочный шаг; добавление Current Working State в этих двух ответах этому не помешало. Продолжила ли бы модель исправлять ошибки после результатов проверок, неизвестно, поскольку инструменты не запускались.

## Токены

| Сумма двух ответов | baseline | Current Working State | Изменение |
|---|---:|---:|---:|
|Input |69228 |70220 |+1,43% |
|Output |780 |384 |−50,77% |
|Input + output |70008 |70604 |+0,85% |
|Reasoning, подмножество output |562 |143 |−74,56% |

Current Working State добавил 496 input-токенов на запрос. Сокращение output и reasoning — диагностический сигнал на маленькой выборке. Суммарного уменьшения токенов нет; экономия на успешно завершённых coding-задачах NOT MEASURED. Reasoning не прибавляется к output повторно. Cache usage отдельно UNAVAILABLE.

## Время и ожидание

Первый запрос после reload ждал первого body 331 секунду; следующие занимали от 0,242 до 12,887 секунды до body. Поэтому суммы 356,610 с baseline против 25,803 с Current Working State нельзя интерпретировать как ускорение от CCE: порядок запросов смешивает эффект варианта с начальной обработкой и возможным повторным использованием cache. Cache не контролировался, отдельного счётчика его использования нет.

Текущий timeout 480 секунд не оборвал первый запрос. Время до body измерено от начала fetch, а header timestamps отдельно не сохранены; строгий вывод о срабатывании старого 300-секундного idle timeout требует такого измерения или контрольного запуска. Compaction отсутствует, исправление prefill после неё не проверялось. f_keep и изолированные prefill tokens/s для этого replay не измерены.

## Фиксация и доказательства

Оба исходных variants и runner закреплены SHA; system/tools/roles/generation параметры совпадают, отличается ровно одно сообщение: добавлен derived Current Working State внутри существующего recovery. Hidden SQL-дефект и independent grade не раскрывались модели. Порядок AB/BA соблюдён, 4 attempts без экспериментальных retries.

- Машинный анализ всех 4 trials (original artifact not bundled; see [publication scope](../README.md)).
- Отдельное сравнение с историческим действием baseline (original artifact not bundled; see [publication scope](../README.md)).
- Evidence index с SHA-256 (original artifact not bundled; see [publication scope](../README.md)): 22 файла, 1 152 051 байт, включая raw requests/SSE/results, preset и source variants.
- Дополнительный historical comparison index (original artifact not bundled; see [publication scope](../README.md)).

Analysis повторно сверил request hashes, native usage/finish с raw SSE, отсутствие ошибок/исполненных tools и исходный B v2 primary SHA. Старый STOPPED/partial 17/21 не изменён. Production-код/настройки этим разбором не менялись; новые LLM calls не запускались. Полные CCE tests/typecheck/build **NOT RUN** при post-hoc анализе; выполнены syntax/SHA/artifact-link проверки анализатора.

Следующий конкретный шаг — короткое изолированное coding-продолжение с фактическим выполнением выбранных проверок, наблюдением последующих исправлений и независимым acceptance. Его протокол должен отделить next-action selection от успешного завершения; один этот replay не оправдывает новый длинный benchmark и не доказывает эффективность Current Working State.
