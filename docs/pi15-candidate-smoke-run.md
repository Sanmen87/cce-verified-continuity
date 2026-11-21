# Pi 1.5 / alpha.2 candidate — живой диагностический запуск

21 ноября 2026. По явному выбору пользователя тестируется **кандидат из npm-архивов**, не опубликованный выпуск. [Published smoke protocol](pi15-continuity-smoke-protocol.md) остаётся отдельным экспериментом; его результаты этим запуском не подменяются.

Run: `2026-11-21T18-49-35-900Z-bb6cd2f9`. Каталог: `.bench/integrity-native/runs/2026-11-21T18-49-35-900Z-bb6cd2f9`. Старт модели 21:49 МСК; общий operational watchdog 50 минут, deadline около **22:39 МСК**. Это запись старта, не terminal result.

Terminal дополнение: [результаты и отдельный post-hoc acceptance](pi15-candidate-smoke-results.md). Primary STOPPED/watchdog; A 16/16 PASS, partial B 21/21 PASS; compaction NOT_EXERCISED.

## Условия

- Чистая установка трёх архивов `0.1.0-alpha.2` и Pi **1.5.0** в отдельный Docker image; development checkout не монтируется в solver.
- Image `sha256:f8435a26c961aae1013e2cf6db603eadcab4a92ee30828be9bdebe913fb3e71f`. SHA архивов и Dockerfile сохранены в `benchmarks/agent/integrity-native/image.json`.
- Загруженная IQ3_XXS, фактическое окно **65792**. Исходное объявление окна Pi и фактическое значение сохранены отдельно; disposable profile отражает реальное окно. Пользовательские Pi/LM Studio настройки не изменялись, native output/compaction настройки сохранены, idle timeout 480 секунд.
- `--network none`, non-root UID, read-only root/input/control, без Docker socket, host mount и hidden oracle; ограничены память, CPU, PID и tmpfs. Модель доступна только через allowlisted host file relay.
- A реализует contacts.create/get/list. Независимый oracle принимает A до разрешения B. B получает новый native session ID и пустой transcript, продолжает contacts.update/archive через CCE continuation handle в том же workspace.
- Compaction только естественная. Если задача закончится без 3–4 compaction, покрытие отмечается NOT_EXERCISED; сообщения ради порога не добавляются.
- Broker проверяет финальное тело provider request после serialization/hooks и до отправки в LM Studio. Hook SHA сопоставляется с фактическим transport SHA; обязательные шесть clauses и полный ранний контракт проверяются отдельно. Наличие текста не означает понимание моделью или coding acceptance.

## Проверки до генерации

Четыре независимых calibration controls: reference PASS и tenant-regression FAIL для обеих фаз. Zero-generation preflight **9/9 PASS**: read-only input, отсутствие oracle/socket/host mount, non-root, настоящий Bash/Python, recovery в SDK packet, отсутствие генерации и реальный FAIL незавершённой fixture. Первый live packet содержит original contract и все шесть обязательных clauses.

Первый Docker build не прошёл: BuildKit интерпретировал image ID в FROM как registry reference. Использован локальный tag с предварительной проверкой того же image SHA; этот preflight failure не считается LLM attempt.

## Наблюдение

Из корня проекта:

```powershell
node scripts/benchmark/continuity/integrity-native/status.mjs --watch
```

`controllerAlive` и свежий `heartbeatAgeSeconds` показывают жизнь контроллера. `WAITING_HEADERS` / `WAITING_BODY` означают ожидание сервера; `STREAMING` и растущий `responseBytes` показывают поступление ответа. Долгое ожидание само по себе не доказывает зависание. `lastEventAgeSeconds` относится к событиям Pi, не к heartbeat.

Ctrl+C останавливает только монитор. Для явной остановки самого run:

```powershell
$runInfo = Get-Content benchmarks/agent/integrity-native/latest.json -Raw | ConvertFrom-Json
New-Item -ItemType File -Path (Join-Path $runInfo.root 'STOP')
```

Авторитетный итог — `result.json` в run root. `status.json` и `exchange/progress.json` — текущие наблюдения; `host-events.jsonl` содержит final transport audit, а `broker-receipt.json` — фактический usage завершённых запросов. Provider bodies, raw output и сессии приватные; не публиковать каталог целиком.

Следующий шаг после завершения: раздельно оценить A/B acceptance, compaction coverage, delivery integrity, receipt freshness и затраты. Candidate smoke не является сравнением с Pi-only и не подтверждает совместимость ещё не опубликованного npm-выпуска.
