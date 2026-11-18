> Public derivative, 2026-11-19. Private machine paths and unavailable artifact links removed; historical scores/statuses unchanged. Original hash: `f515604d60a7b9b3fdfd10bcb6acbdef0f2fa9f8b36b7079e2f6e196cdb125eb` (source-86). Statements such as NOT RUN describe the original report date. See [scope and reproducibility](../README.md).

# Analysis of the first local pilot

The experiment uses real Pi 1.4.0 requests to the already loaded local LM Studio
model. It is a single-repeat pilot, with a common workspace-only file-tool allowlist,
not an unrestricted default-shell Pi test. Main results and machine evidence are in
[benchmark-results](first-pilot.md).

The completed A pair establishes observe-only's behavior in the actual provider
request: baseline and observe-only have the same system-message hash, tool set,
46,889 total provider input tokens, 2,259 output tokens and six requests. Both pass
all three independent dependency-discovery checks. The timing difference is not
evidence of optimization: the server's prefix cache and desktop activity were not
controlled, and there is one sample per arm.

In A assist, the model independently called a CCE tool once. Its result is linked
by toolCallId to provider requests 2–6. Automatic CCE context was also present in
all six requests. The actual base system-message hash stayed identical to the
other A arms; assist differs in declared tools and added context. It passed the
same oracle with 29,882 input and 1,544 output tokens. These observed reductions
support further investigation on A only. They do not separate automatic context
from explicit retrieval, nor establish that other tasks improve.

For B and C, success must be interpreted with the evaluator's scope. B's pure
predicate can be tested without importing the entire Django application; admin
integration is inspected statically. C's persistent-model behavior needs real
database tests. The B runs all hit 14 requests without producing the predicate;
their acceptance is FAIL, independent of any test environment issue. C runs are
judged on artifacts and real DB tests when available. Missing artifacts are FAIL,
not an infrastructure excuse. Output/request limits are separate stop reasons.
The final results are definitive within the declared budgets: B and C fail in all
three modes. C observe-only ends at the 2048 output limit; the other code runs hit
14 requests. C baseline leaves a partial Deal.save/history-model change without a
migration/export/tests. Its original suite has 16 errors in addition to the five
pre-existing notification failures (388 tests ran; class setup errors prevent
some cases from executing). It attempts history insertion on initial saves with
a non-null stage and references a missing database table. This observed regression
is separate from the known original async-mail test race. Other B/C arms do not
modify application source. Lower input on failed tasks is not a success metric.

Counters are measured as reported by the inference provider via Pi. The exported
UTF-8 byte estimate is deliberately separate and may greatly overestimate actual
model tokens. The provider does not necessarily expose cache usage: UNKNOWN must
not be interpreted as zero. The request observer supplies experiment/task/mode
identity, source hashes, sampling parameters and request/result links that the
v0.1 aggregate SQLite metrics lacked.

Original CRM setup initially hit App Control denials on native DLL imports. Later
normal imports passed, without changing policy or installed packages. The third
untouched-suite attempt ran 393 tests: five failures and four skipped. All failures
assert immediate email delivery through a background queue. A separate diagnostic
waiting for that existing queue passed all five, confirming an async notification
test race on this host. The original result remains FAIL; the diagnostic is not
an original-suite PASS. CRM source was unchanged, and no CCE extension was loaded.

The separate checkpoint/resume experiment uses a predeclared two-turn stop, verified
file/hash evidence and a saved Pi session ID. It then starts a new Node/Pi process,
checks Git/worktree/file freshness and resumes the same session. Its concrete
outcome is PASS: after two real provider turns, a separate Pi process restored the
same session and pending state with no freshness warnings; six further requests
completed A and passed the same oracle. A synthetic abort generated a third raw
turn_end event in the initial counter; the exported record preserves this detail
and uses two actual requests for the stop point. This result is separate from the
main A token comparison and establishes one simple-task restart, not general reliability.

The next required experiment is a repeated, controlled comparison after stabilizing
the upstream test baseline and resource budgets. See next-iteration (original artifact not bundled; see [publication scope](../README.md)) for specific code and
environment work. No general claim that CCE saves tokens, improves code correctness
or restores complex tasks reliably is justified by this pilot alone.
