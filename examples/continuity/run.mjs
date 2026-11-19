// Real Pi SDK compaction + production CCE hook; transcript/edits are scripted.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { SessionManager, SettingsManager, DefaultResourceLoader, ModelRuntime, createAgentSession } from '@earendil-works/pi-coding-agent';
import { ContextEngine, sha256 } from '../../packages/core/src/index.ts';
import { conservativeCounter } from '../../packages/core/src/lifecycle/compiler.ts';
import { registerLifecycle } from '../../packages/pi-extension/src/lifecycle.ts';
const execute = promisify(execFile), here = path.dirname(fileURLToPath(import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cce-continuity-demo-'));
const project = path.join(root, 'project'), agentDir = path.join(root, 'agent');
await fs.mkdir(project); await fs.mkdir(agentDir);
const moduleFile = path.join(project, 'contacts.mjs'), checker = path.join(here, 'acceptance.test.mjs');
const checkerSha256 = sha256(await fs.readFile(checker));
const apply = name => fs.copyFile(path.join(here, 'fixtures', 'contacts.' + name + '.mjs'), moduleFile);
await apply('before');
const checks = [];
async function acceptance(label) {
 assert.equal(sha256(await fs.readFile(checker)), checkerSha256, 'Acceptance code changed');
 let stdout, stderr, exitCode;
 try {
  ({ stdout, stderr } = await execute(process.execPath, ['--test', '--test-reporter=tap', checker], {
   cwd: project, shell: false, windowsHide: true, timeout: 15000, maxBuffer: 131072,
   env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', CCE_DEMO_MODULE: moduleFile },
  })); exitCode = 0;
 } catch (error) {
  if (typeof error.code !== 'number' || error.killed || error.signal) throw error;
  ({ stdout, stderr } = error); exitCode = error.code;
 }
 const tests = Number(/^# tests (\d+)$/m.exec(stdout)?.[1]), passed = Number(/^# pass (\d+)$/m.exec(stdout)?.[1]);
 assert.equal(tests, 6, 'Acceptance did not evaluate all six public cases');
 const record = { label, exitCode, tests, passed, checkerSha256, sourceSha256: sha256(await fs.readFile(moduleFile)) };
 await fs.writeFile(path.join(root, label + '.tap'), stdout + stderr); checks.push(record);
 return record;
}
const contract = {
 id: 'archive-contacts-demo', source: 'user',
 text: 'Add archiveContact. Preserve tenant isolation. Retain original rows and data. Exclude archived contacts from active lists.',
 requirements: [
  { id: 'archive', clause: 'Add archiveContact.' },
  { id: 'tenant', clause: 'Preserve tenant isolation.' },
  { id: 'retain', clause: 'Retain original rows and data.' },
  { id: 'active', clause: 'Exclude archived contacts from active lists.' },
 ].map(requirement => ({ ...requirement, needs: [], checks: ['public-acceptance'] })),
};
const manager = SessionManager.inMemory(project);
const goalId = manager.appendMessage({ role: 'user', content: contract.text, timestamp: Date.now() });
const scriptedStatus = text => manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '[Scripted demo] ' + text }],
 api: 'openai-completions', provider: 'lmstudio', model: 'cce-offline-demo', timestamp: Date.now(), stopReason: 'stop',
 usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
scriptedStatus('The contacts module and public checker are available. The implementation is incomplete.');
manager.appendMessage({ role: 'user', content: 'Continue work on the existing contacts module.', timestamp: Date.now() });
scriptedStatus('Preserve the contract while implementing the archive operation.');
manager.appendMessage({ role: 'user', content: 'Check the current source before continuing.', timestamp: Date.now() });
const config = { mode: 'assist', quality: { coverageEnabled: true }, lifecycle: {
 enabled: true, ledgerEnabled: true, projectionEnabled: true, historyRecallEnabled: true,
 recoveryPolicy: 'verified-state', compactionMode: 'deterministic', handoffBudgetTokens: 12000,
} };
let session, engine, generationAttempts = 0, networkAttempts = 0;
const diagnostics = [], originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkAttempts++; throw Error('Demo network access is disabled'); };
try {
 engine = await ContextEngine.open(project, { sessionId: manager.getSessionId(), config, taskContract: contract,
  verificationChecks: [{ id: 'public-acceptance', type: 'unit-test', source: 'demo-checker-sha256:' + checkerSha256,
   execute: async () => { const check = await acceptance('cce-check-' + checks.length); return {
    exitCode: check.exitCode, diagnostic: 'Public authored demo acceptance: ' + check.passed + '/6', executionId: check.label,
   }; },
  }],
 });
 const settings = SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 32 } });
 const loader = new DefaultResourceLoader({ cwd: project, agentDir, settingsManager: settings,
  noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
  disabledBuiltinExtensions: ['mcp', 'codemode'],
  extensionFactories: [api => registerLifecycle(api, async () => engine, { counter: conservativeCounter, onDiagnostic: event => diagnostics.push(event) })],
 });
 await loader.reload();
 const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null,
  modelsStorePath: path.join(agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
 for (const method of ['stream', 'streamSimple', 'complete', 'completeSimple']) runtime[method] = () => {
  generationAttempts++; throw Error('Model generation is disabled; a native fallback must fail this demo');
 };
 const model = { api: 'openai-completions', provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1/v1',
  id: 'cce-offline-demo', name: 'Offline metadata only', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 65536, maxTokens: 4096 };
 const created = await createAgentSession({ cwd: project, agentDir, sessionManager: manager, settingsManager: settings,
  resourceLoader: loader, modelRuntime: runtime, model, noTools: 'all' });
 session = created.session; assert.deepEqual(created.extensionsResult.errors, []);
 const life = engine.lifecycle; assert.ok(life);
 console.log('1. TASK: archive contacts; preserve tenant isolation, original data and active-list rules.');
 const missing = await acceptance('incomplete-control'); assert.notEqual(missing.exitCode, 0);
 await apply('complete'); assert.equal((await life.runApprovedCheck('public-acceptance')).status, 'PASS');
 assert.equal((await life.taskState()).checks[0].freshness, 'CURRENT');
 await apply('regression'); const broken = await acceptance('regression-control'); assert.notEqual(broken.exitCode, 0);
 const stale = await life.taskState();
 assert.ok(stale.checks.some(check => check.freshness === 'STALE' && check.historicalStatus === 'PASS' && check.status === 'UNKNOWN'));
 const before = manager.buildSessionProjection();
 const originalEntries = manager.getEntries();
 const compact = await session.compact();
 const entry = manager.getEntries().filter(item => item.type === 'compaction').at(-1);
 assert.equal(entry.fromHook, true); assert.equal(compact.details?.handoffStatus, 'COMPLETE');
 assert.ok(diagnostics.some(event => event.outcome === 'CCE_HANDOFF'));
 assert.ok(!diagnostics.some(event => event.outcome === 'NATIVE_FALLBACK'));
 const after = manager.buildSessionProjection();
 assert.ok(!after.messages.some(message => message.role === 'user' && message.content === contract.text), 'Original user turn must be outside the retained tail');
 assert.equal(manager.getEntry(goalId).message.content, contract.text, 'Original history was not preserved');
 assert.ok(compact.summary.includes(contract.text));
 const stateLine = compact.summary.split('TASK STATE PROJECTION\n')[1]?.split('\n')[0]; assert.ok(stateLine);
 const recoveredState = JSON.parse(stateLine);
 assert.deepEqual(recoveredState.requirements.map(requirement => requirement.id).sort(), contract.requirements.map(requirement => requirement.id).sort());
 assert.ok(recoveredState.checks.some(check => check.freshness === 'STALE' && check.historicalStatus === 'PASS' && check.status === 'UNKNOWN'));
 console.log('2. COMPACTION: real Pi SDK + CCE hook; 4/4 requirements and Task State retained; old PASS is STALE.');
 // A fixed, authored edit demonstrates continuation; recovered text never becomes executable code.
 await apply('complete');
 assert.equal((await life.runApprovedCheck('public-acceptance')).status, 'PASS');
 const finalState = await life.taskState(); assert.ok(finalState.requirements.every(requirement => requirement.status === 'VERIFIED_PASS'));
 const independent = await acceptance('separate-acceptance'); assert.equal(independent.exitCode, 0); assert.equal(independent.passed, 6);
 console.log('3. CONTINUE (scripted): separate acceptance 6/6 PASS; original contract was not entered again.');
 assert.equal(generationAttempts, 0); assert.equal(networkAttempts, 0);
 await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ status: 'PASS', scope: 'SCRIPTED_MECHANISM_DEMO_NOT_LLM_BENCHMARK',
  requirementsRestored: recoveredState.requirements.length, checks, generationAttempts, networkAttempts,
  actualPiCompaction: true, fromExtension: entry.fromHook, tokenAccounting: 'estimated:utf8-bytes',
  independentHiddenAcceptance: 'NOT_EXERCISED', originalHistoryPreserved: true,
 }, null, 2) + '\n');
 for (const [name, value] of [['session-before', before], ['session-after', after], ['original-session-entries', originalEntries], ['task-state-after', finalState], ['cce-diagnostics', diagnostics]]) {
  await fs.writeFile(path.join(root, name + '.json'), JSON.stringify(value, null, 2) + '\n');
 }
 console.log('Model requests: 0. This demonstrates the mechanism, not autonomous LLM coding.');
 console.log('Artifacts: ' + root);
} finally { globalThis.fetch = originalFetch; session?.dispose(); engine?.close(); }
