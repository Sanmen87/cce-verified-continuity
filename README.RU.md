# Code Context Engine — 0.1.0-alpha.1

**Русский** · [English](README.md)

CCE помогает локальным LLM продолжать разработку после compaction и возобновления сессии: сохраняет требования пользователя, историю действий и проверяемое состояние задачи, находит актуальный код и передаёт ограниченный recovery с происхождением сведений.

## Короткая демонстрация

1. **Задача:** добавить архивирование контактов CRM, сохранив tenant isolation, исходные записи и правила активного списка.
2. **Compaction:** CCE сохраняет четыре исходных требования и Task State; прежний PASS помечается STALE после изменения кода.
3. **Продолжение:** без повторного ввода контракта скрипт применяет завершённую реализацию; отдельный публичный тест проходит **6/6**.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run demo:continuity
```

[Воспроизводимый короткий пример](examples/continuity/README.md): настоящие ручная compaction Pi SDK и production CCE-hook, без модели и GPU. Реплики и правки заданы скриптом: проверяются механизм восстановления и отдельные тесты миниатюры, **а не самостоятельное написание кода LLM**. Исходная история сохраняется; до/после можно посмотреть в созданных артефактах.

Ядро написано на TypeScript и не зависит от Pi, Codex или сервера модели. Pi — первый адаптер lifecycle; coding-агенты могут меняться. MCP предоставляет retrieval и журнал вызовов, но сам по себе не реализует перенос lifecycle между агентами.

**Экспериментальная alpha.** Общее преимущество в разработке, экономия токенов и автоматическое предотвращение циклов модели не доказаны. SHA подтверждает тождество содержимого, но не правильность кода. Слова модели не заменяют независимые тесты.

## Установка и запуск

Нужны Node.js **>=22.19.0**, npm, Git и ripgrep. Pi adapter проверен с **Pi 1.5.0**. Python 3 нужен для некоторых development tests и опциональной проверки схем. Для установки, индексации и smoke не нужны LM Studio или загруженная модель.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run test:public
npm run build
npm run smoke:pi
node dist/packages/core/src/cli.js status .
pi -e ./packages/pi-extension
```

В PowerShell используйте `npm.cmd` и `pi.cmd`, если execution policy блокирует `.ps1` shims. Инструкция установки архивов и настройки: [QUICKSTART](QUICKSTART.md).

По умолчанию включён **observe-only**, lifecycle выключен. Для assist/recovery нужно явно выбрать доверенный `CCE_CONFIG`. [Пошаговый гайд по включению lifecycle](docs/lifecycle-setup.ru.md): готовый конфиг, запуск на Windows/Linux, проверка подключения, compaction и отключение. История и пары tool-call/tool-result сохраняются. CWS включён внутри включённого lifecycle; `lifecycle.currentWorkEnabled: false` отключает его рекомендации, сохраняя контракт и обязательный recovery.

| Модуль | Назначение и границы |
|---|---|
| Project Memory / AST / FTS / graph | Поиск актуальных сущностей и статических связей; hybrid backend включается явно |
| Task Contract / Ledger / Task State | Версионированные требования, события, происхождение и свежесть подтверждений |
| Pi compaction / recovery | Автоматическая доставка обязательного состояния при явно включённом lifecycle; native fallback учитывается отдельно |
| Durable continuation | Явный checkpoint/handle, проверка workspace и возможностей адаптера; ограничения документированы |
| CWS / Action Continuity | Детерминированная рекомендация следующего действия; не даёт разрешения на исполнение и не гарантирует отсутствие цикла |
| Vector retrieval | Experimental, выключен по умолчанию; нужен явно настроенный локальный endpoint/model, улучшение русского поиска не заявлено |

## Эксперименты и результаты

[Публичный набор исследований](evaluation/README.md) включает методологию, успешные и неудачные результаты, машинные сводки, 64 извлечённых usage receipts и evidence 12 MCP trials на авторской синтетической fixture. Исходные оценки не пересмотрены; post-hoc повторы отделены от primary schedule.

```sh
npm run test:evaluation
```

Эта команда **не обращается к модели**: перепроверяет опубликованные hashes, арифметику, исходный MCP scoring и доставленные source ranges. Она не воспроизводит независимое CRM grading: hidden acceptance tests, сырые prompts/reasoning/SSE и приватные архивы не публикуются. Unit/integration tests CCE доступны через `npm run test:public`. Границы воспроизводимости указаны в каждом отчёте.

Рабочие workspace-пакеты private. `npm run release:pack` создаёт три npm-архива с compiled ESM, типами, exports и лицензиями; `npm run release:clean-install` проверяет их вне checkout. Владелец подтвердил npm scope `@sanmen87`: пакеты называются `@sanmen87/core`, `@sanmen87/pi-extension`, `@sanmen87/mcp`. Версия alpha — `0.1.0-alpha.1`, тег распространения — `alpha`. [Установка из npm](QUICKSTART.md#install-the-alpha-from-npm); также доступен публичный [GitHub repository](https://github.com/Sanmen87/cce-verified-continuity), исходники и собранные архивы.

[Архитектура](release/docs/architecture.md) · [Ограничения](release/docs/limitations.md) · [Публикация](release/docs/publishing.md) · [Changelog](CHANGELOG.md) · [Apache-2.0](LICENSE) · [Сторонние лицензии](THIRD_PARTY_NOTICES.md)
