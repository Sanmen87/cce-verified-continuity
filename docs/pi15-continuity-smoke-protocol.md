# Pi 1.5 Published Continuity Smoke — протокол

Дата подготовки: 21 ноября 2026. Статус **PREPARED / NOT RUN**. Это compatibility/feasibility smoke, не сравнительный benchmark и не доказательство преимущества над Pi-only.

## Gate до первого запроса

- Выбран точный **опубликованный** npm prerelease с Recovery/Verification Integrity fixes, а не development checkout и не перезаписанная `0.1.0-alpha.1`. Зафиксировать версии всех пакетов, registry integrity, commit SHA и source inventory.
- Чистая установка в новом Docker workspace с Pi **1.5.0**, Node >=22.19.0. Не использовать старую image с другой версией Pi без проверки.
- Рабочая IQ3_XXS с прежним frozen preset и окном 65536. Сохранить model/quantization/backend/chat-template metadata и параметры Pi. Не уменьшать окно или keepRecent и не добавлять искусственный текст ради compaction.
- Native defaults генерации и compaction сохраняются. Общий operational watchdog **50 минут на A+B**, timeout первого body frame **480 секунд**. Watchdog не является успешным завершением задачи. По истечении остановить дочерние процессы/контейнер и сохранить partial отдельно.
- Docker isolation preflight: shell работает; candidate не читает host, соседний workspace, Docker socket, hidden oracle и управляющие ключи. Проверить read-only input, writable task root, process/output/resource limits. Никакого несандбоксированного fallback.
- Transport guard сохраняет конечный сериализованный provider body и сверяет mandatory recovery **после всех преобразований**. Наблюдение extension hook не заменяет эту проверку. У transport guard есть только разрешённые requirements/checkpoint metadata, не hidden acceptance.
- Логи и provider bodies хранятся локально в приватном каталоге нового run; нельзя выкладывать их целиком в GitHub. Не логировать credentials.

## Задача и независимость проверки

Небольшой авторский CRM-проект с tenant isolation, архивированием без физического удаления, active-list semantics и JSON serialization. Сначала зафиксировать точный пользовательский контракт, исходники, публичные working checks и отдельный acceptance oracle, затем дать задачу модели.

Public checker может проверять общие API-инварианты. Hidden oracle не монтируется в candidate и запускается отдельно после его остановки на read-only source snapshot. Не раскрывать модели частные failing cases. Историческую тестовую CRM не редактировать.

## A — задача с естественной compaction

Модель самостоятельно пишет и проверяет код. Целевое покрытие — 3–4 естественные compaction, но корректное завершение раньше допустимо: отсутствующее покрытие записать **NOT_EXERCISED**, без искусственного удлинения истории.

Для каждого фактически отправленного запроса сохранять request ID, final packet SHA и приватный body, contract revision, mandatory presence/omissions, recovery status, source hashes, tool-call/result pairs, process/output observations и approved receipts. Отдельно учитывать hook inspection, transport inspection и HTTP/backend outcome; receipt сервера не равен пониманию модели.

После каждой compaction сохранять native projection до/после, `fromExtension`, fallback reason/capacity, восстановленный state и последующие действия агента. Учитывать только завершённые compaction, а не попытки hook. Native fallback не считать успешным CCE handoff.

## B — чистая сессия

После принятого этапа A сохранить checkpoint/handle. Закрыть A, открыть B с новым native session ID и пустым transcript в том же проверенном workspace. Выполнить официальный `cce-continuity-resume`; сохранить read-back manifest и provenance.

Дать следующий этап проекта без повторного ввода старого контракта. Проверить его присутствие в каждом final packet B, первые действия модели, число повторных project reads, source changes и результат следующего независимого acceptance. Исторические PASS остаются историческими до свежих checks.

Если A не завершена/не принята либо checkpoint невалиден, B не запускать как успешную continuation: записать конкретный gate failure и сохранить partial A.

## Метрики и исходы

Раздельно: delivery integrity, compaction coverage, A acceptance, B acceptance, receipt freshness, tool errors/contradictory outputs, повторные действия без новых observed sources, provider tokens/TTFT, время и неизвестный расход прерванных запросов.

Успех compatibility smoke требует принятого кода после реально exercised compaction и принятого B с восстановленным контрактом без старого transcript. Результат с меньшим расходом, но незавершённой задачей, не считается эффективностью. Без естественной compaction этот компонент остаётся NOT_EXERCISED даже при coding PASS.

Новый run получает отдельный каталог и manifest. Старые B v2/CWS scores и raw evidence не изменяются. Повтор после инфраструктурной ошибки — новый attempt с отдельным статусом, не замена неудачи.
