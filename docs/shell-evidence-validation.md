# Shell evidence integrity — 21 ноября 2026

Неизвестный process exit code не выводится из `isError:false`. `observeExecution` теперь отдельно показывает processOutcome/PROCESS_STATUS_UNKNOWN, testOutcome и диагностические сигналы. Unit-test FAIL в выводе остаётся наблюдаемым FAIL при неизвестном процессе; traceback сам по себе остаётся DIAGNOSTIC, не универсальным verdict. Все native результаты — OUTPUT_OBSERVATION_ONLY.

Lifecycle сохраняет такие наблюдения в scoped history и Task State/CWS; сообщения являются пассивными данными, не командой бесконечно повторять проверку. Native tool output, история и tool-call/result pairs не переписываются; observe-only default не меняется.

## Проверки без LLM

Фиксированные авторские Python fixtures выполнялись в network-none, non-root, read-only Docker. Произвольные команды из retrieved code/history не принимаются.

| Case | Наблюдаемый outer exit | Результат approved adapter |
|---|---:|---|
| unittest FAIL через tail без pipefail | 0 | UNKNOWN, не PASS |
| тот же pipeline с Bash pipefail | 1 | FAIL |
| подавленное Python-исключение / traceback | 0 | UNKNOWN |
| прямой unittest FAIL | 1 | FAIL |
| structured checker с ожидаемым исключением | 0 | PASS по explicit-result policy |

Outer exit — код внешней команды/pipeline, не автоматическое доказательство кода Python subprocess. Для native result без metadata сохраняется PROCESS_STATUS_UNKNOWN, даже когда тестовый FAIL виден в тексте. Ни один такой результат не создаёт trusted receipt. Проверены scoped diagnostic records, отсутствие повышения requirements в VERIFIED_PASS и STALE/UNKNOWN после изменения источника, ранее прошедшего approved check.

`node --experimental-strip-types scripts/benchmark/continuity/integrity-native/shell-regression.mjs` — PASS; model requests 0. Эта интеграционная проверка требует Docker и не добавляет Docker-зависимость в обычный public CI suite. Отчёт сохраняется локально в `benchmarks/agent/integrity-native/shell-regression.json`.

Это внутренний Docker-скрипт исследовательского стенда, не часть curated public-source export. Публичный `tests/verification-integrity.test.ts` воспроизводит классификацию и границы доверия без Docker; полный benchmark/raw evidence не публикуется.

Полный CCE suite **248/248 PASS**, targeted verification suite **9/9 PASS**, typecheck/build/real Pi 1.5 loader smoke PASS. Новая сборка alpha.2 прошла три чистые установки на Windows/Node 22.19 и 12 Linux/Node 22.19 checks, включая public tests, build и clean install. Известное Pi upstream TS1543-исключение для host declarations остаётся документированным.

Эти изменения не превращают CCE в универсальный terminal parser, не добавляют shell tool и не подтверждают правильность произвольного процесса по одному слову в выводе. Trusted PASS требует зарегистрированного approved adapter, корректного исхода и актуального project/source/Git binding. Следующие живые проверки описаны в [отдельном протоколе](pi15-resume-smokes-protocol.md).
