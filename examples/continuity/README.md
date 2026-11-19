# Short continuity demo / короткая демонстрация

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run demo:continuity
```

Node >=22.19.0, Git and ripgrep are required. No model, LM Studio, Docker or npm login is needed. All project changes occur in a newly created OS temporary directory. The demo does not read or modify your CRM, Pi settings or agent credentials. Generated artifacts are left in that temporary directory for inspection.

The script uses **real Pi 1.5.0 `AgentSession.compact()` and the production CCE lifecycle hook**. The transcript and code edits are authored, scripted fixtures. This demonstrates a working mechanism, not autonomous LLM coding or a causal advantage over Pi alone. Model generation and fetch are blocked and asserted unused; the OpenAI-compatible serializer stops before transport. Token accounting is a conservative estimate, not measured provider usage.

1. The original user contract has four requirements: implement archive, preserve tenant isolation, retain original rows/data, and hide archived contacts from active lists. It is entered once. The incomplete fixture must fail the separate public checker.
2. A scripted implementation passes the checker and creates a current CCE receipt. A deliberately faulty edit then breaks tenant isolation; the checker must fail, and the old receipt must become `STALE` with current status `UNKNOWN`. These are negative controls, not ignored failures.
3. A real manual Pi compaction invokes the CCE hook. The demo uses a **temporary in-memory** `keepRecentTokens=32` setting so this tiny transcript is compactable, with no filler history. Global/native benchmark settings are unchanged. Assertions require `fromHook=true`, a COMPLETE CCE handoff and no native fallback. The original user turn leaves the retained raw tail but remains in original history; the actual compaction summary contains all four requirements and Task State with stale checks.
4. Without submitting the contract again, the script applies the completed fixture and reruns the public checker. A separate Node process, whose test code imports neither CCE nor Pi, must pass all six cases. CCE statuses become current, but this is **public demo acceptance**, not hidden CRM benchmark acceptance.

Expected output excerpt (CCE also prints a diagnostic record):

```text
1. TASK: archive contacts; preserve tenant isolation, original data and active-list rules.
2. COMPACTION: real Pi SDK + CCE hook; 4/4 requirements and Task State retained; old PASS is STALE.
3. CONTINUE (scripted): separate acceptance 6/6 PASS; original contract was not entered again.
Model requests: 0. This demonstrates the mechanism, not autonomous LLM coding.
```

Inspect the printed artifacts directory: `session-before.json`, `session-after.json`, `original-session-entries.json`, `task-state-after.json`, `cce-diagnostics.json`, `result.json` and TAP logs. A failed assertion, unexpected model attempt, missing requirement, current receipt on changed source, native fallback or failing final case yields a nonzero exit. Commands come from this fixed script, never from recovery text or retrieved project files.

Русский: это воспроизводимая проверка механизма на авторской CRM-миниатюре. Compaction и CCE-hook настоящие; реплики и правки заранее написаны скриптом. Сначала два отрицательных контроля подтверждают, что checker замечает незавершённую реализацию и нарушение tenant isolation. Затем проверяются сохранение четырёх требований, устаревание старого PASS и отдельный итоговый тест 6/6. Поведение LLM и hidden acceptance здесь не измеряются. Исходный контракт не вводится повторно, реальные файлы пользователя не меняются.
