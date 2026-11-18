import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExtensionAPI, ExtensionToolContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { ContextEngine } from '../packages/core/src/index.ts';
import { estimateTokens } from '../packages/core/src/context.ts';
import { parseConfig } from '../packages/core/src/config.ts';
import { registerLifecycle } from '../packages/pi-extension/src/lifecycle.ts';
import { prepareTaskRecovery } from '../packages/core/src/lifecycle/recovery.ts';
import type { ExplicitTaskContract } from '../packages/core/src/quality/contracts.ts';
import type { TokenCounter } from '../packages/core/src/lifecycle/contracts.ts';

const contract: ExplicitTaskContract = {
  id: 'tenant-task', source: 'user', text: 'Preserve tenant isolation.',
  requirements: [{ id: 'tenant', clause: 'Preserve tenant isolation.', needs: [], checks: ['check'] }],
};
async function harness(options: { mode?: 'assist' | 'observe-only'; policy?: string; strategy?: string; budget?: number; hidden?: boolean; root?: string;counter?:TokenCounter } = {}) {
  const root = options.root ?? await mkdtemp(path.join(tmpdir(), 'cce-continuity-'));
  if (!options.root) await writeFile(path.join(root, 'access.py'), 'def allowed(tenant, owner):\n    return tenant == owner\n');
  const engine = await ContextEngine.open(root, {
    sessionId: 'local-session', taskContract: contract,
    verificationChecks: [{ id: 'check', type: 'custom-approved', source: 'unit-host',
      execute: async () => ({ exitCode: 0, diagnostic: 'Unit host receipt, not independent coding acceptance', executionId: 'unit-check' }) }],
    config: { mode: options.mode ?? 'assist', assist: { strategy: options.strategy ?? 'combined' },
      quality: { guardEnabled: true, coverageEnabled: true },
      lifecycle: { enabled: true, ledgerEnabled: true, projectionEnabled: true, historyRecallEnabled: true,
        capabilityContractEnabled: true, compactionMode: 'deterministic',
        recoveryPolicy: options.policy ?? 'verified-state', handoffBudgetTokens: options.budget ?? 4096 } },
  });
  const handlers = new Map<string, (e: any, c: ExtensionToolContext) => any>();
  const tools = new Map<string, Parameters<ExtensionAPI['registerTool']>[0]>();
  let branch: SessionEntry[] = [], leaf: string | null = null, known = true, occupied = 1000;
  const model = { id: 'local-test-model', contextWindow: 65536, maxTokens: 16384 };
  const pi = {
    registerCommand: () => {}, registerTool: (t: Parameters<ExtensionAPI['registerTool']>[0]) => tools.set(t.name, t),
    on: (name: string, handler: (e: any, c: ExtensionToolContext) => any) => handlers.set(name, handler),
    getActiveTools: () => ['read', 'edit', 'write', 'bash', ...tools.keys()], getAllTools: () => [...tools.values()],
  } as unknown as ExtensionAPI;
  const ctx = { cwd: root, hasUI: false, model, getContextUsage: () => known ? { tokens: occupied, contextWindow: 65536 } : undefined,
    getSystemPrompt: () => 'HOST SYSTEM',
    sessionManager: { getSessionId: () => engine.sessionId, getBranch: () => branch, getLeafId: () => leaf,
      buildSessionProjection: () => { if (!known) throw Error('Unknown occupancy'); return { messages: [], entries: [] }; } },
  } as unknown as ExtensionToolContext;
  registerLifecycle(pi, async () => engine, { exposure: options.hidden ? 'hidden' : 'direct',...(options.counter?{counter:options.counter}:{}) });
  let userSequence=0;
  const emit = async (name: string, event: any) => {
    const result=await handlers.get(name)?.(event,ctx);
    // Pi persists the submitted user message after before_agent_start and before provider context.
    if(name==='before_agent_start'&&event.messageType==='user'){
      const id='submitted-'+(++userSequence);branch=[...branch,user(id,event.prompt,leaf)];leaf=id;
    }
    return result;
  };
  return { root, engine, model, ctx, emit,
    setBranch: (entries: SessionEntry[], id: string | null) => { branch = entries; leaf = id; },
    usage: (isKnown: boolean, tokens = 1000) => { known = isKnown; occupied = tokens; } };
}
const user = (id: string, text: string, parentId: string | null = null) => ({
  type: 'message', id, parentId, timestamp: '2026-11-11T00:00:00Z',
  message: { role: 'user', content: text, timestamp: 0 },
}) as unknown as SessionEntry;
const preparation = {
  firstKeptEntryId: 'keep', messagesToSummarize: [], turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 60000,
  settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }, fileOps: { read: new Set(), edited: new Set() },
};
const compactEvent = { preparation, branchEntries: [], reason: 'manual', willRetry: false, signal: new AbortController().signal };
const contentOf = (response: any) => response.messages.at(-1).content as string;

test('continuity policy is opt-in; native defaults and previous policies stay unchanged', () => {
  assert.equal(parseConfig().lifecycle.recoveryPolicy, 'legacy');
  assert.equal(parseConfig().mode, 'observe-only');
  for (const recoveryPolicy of ['legacy', 'explicit', 'explicit-hint', 'verified-state'])
    assert.equal(parseConfig({ lifecycle: { recoveryPolicy } }).lifecycle.recoveryPolicy, recoveryPolicy);
  assert.throws(() => parseConfig({ lifecycle: { recoveryPolicy: 'invented' } }));
});

test('automatic recovery restores original constraints at resume without a history call, preserving the transcript', async t => {
  const h = await harness(); t.after(() => h.engine.close());
  h.setBranch([user('goal', 'Implement access rules; preserve tenant isolation.')], 'goal');
  await h.emit('session_start', { reason: 'resume' });
  const messages = Object.freeze([
    Object.freeze({ role: 'assistant', content: [{ type: 'toolCall', id: 'pair', name: 'read', arguments: {} }] }),
    Object.freeze({ role: 'toolResult', toolCallId: 'pair', content: [{ type: 'text', text: 'Current source' }] }),
  ]);
  const before = JSON.stringify(messages);
  for (let request = 0; request < 2; request++) {
    const response = await h.emit('context_with_system', { messages });
    assert.match(contentOf(response), /preserve tenant isolation/);
    assert.equal(response.messages.length, messages.length + 1);
    assert.strictEqual(response.messages[0], messages[0]); assert.strictEqual(response.messages[1], messages[1]);
    assert.equal(response.messages.at(-1).details.delivery, 'UNKNOWN');
  }
  assert.equal(JSON.stringify(messages), before);
  const observations = h.engine.lifecycle!.ledger.search('local-session', 'main', 'CCE_AUTOMATIC_RECOVERY_OBSERVATION');
  assert.equal(observations.length, 2);
  for (const event of observations) {
    const data = JSON.parse((await h.engine.lifecycle!.ledger.original('local-session', 'main', event.id)).text);
    assert.equal(data.status, 'INJECTED'); assert.equal(data.delivery, 'UNKNOWN');
    assert.ok(data.mandatory.every((item: any) => item.status === 'PRESERVED'));
    assert.ok(!('text' in data));
  }
});

test('native fallback recovers constraints only after completed compaction; attempts are not counted', async t => {
  const h = await harness(); t.after(() => h.engine.close());
  await h.emit('before_agent_start', { messageType: 'user', prompt: 'Preserve tenant isolation.', systemPrompt: '' });
  assert.equal(await h.emit('session_before_compact', { ...compactEvent, customInstructions: 'Use native summary' }), undefined);
  const initial=await h.emit('context_with_system', { messages: [] });
  assert.equal(initial.messages.at(-1).details.compactionId,null);
  const ledger = h.engine.lifecycle!.ledger;
  assert.equal(ledger.list('local-session', 'main').filter(e => e.kind === 'COMPACTION_COMPLETED').length, 0);
  await h.emit('session_compact', { reason: 'manual', fromExtension: false,
    compactionEntry: { id: 'native-complete', summary: 'An incomplete native summary.', firstKeptEntryId: 'keep' } });
  const response = await h.emit('context_with_system', { messages: [] });
  assert.match(contentOf(response), /Preserve tenant isolation/);
  assert.equal(response.messages.at(-1).details.trigger, 'compaction');
  assert.equal(ledger.list('local-session', 'main').filter(e => e.kind === 'COMPACTION_COMPLETED').length, 1);
  const audit = ledger.search('local-session', 'main', 'UNVERIFIED_NATIVE_SUMMARY')[0]!;
  assert.ok(audit);
});

test('configured native compaction records actual completion and enables automatic recovery', async t => {
  const h = await harness(); t.after(() => h.engine.close());
  h.engine.config.lifecycle.compactionMode = 'native';
  await h.emit('before_agent_start', { messageType: 'user', prompt: 'Preserve tenant isolation.', systemPrompt: '' });
  assert.equal(await h.emit('session_before_compact', compactEvent), undefined);
  await h.emit('session_compact_failed', { reason: 'manual', aborted: true, willRetry: false, fromExtension: false });
  assert.equal(h.engine.lifecycle!.ledger.list('local-session', 'main').filter(e => e.kind === 'COMPACTION_COMPLETED').length, 0);
  await h.emit('session_compact', { reason: 'manual', fromExtension: false,
    compactionEntry: { id: 'configured-native', summary: 'Native summary.', firstKeptEntryId: 'keep' } });
  assert.match(contentOf(await h.emit('context_with_system', { messages: [] })), /Preserve tenant isolation/);
});

test('recovery refreshes external edits and never promotes agent claims or persisted PASS after restart', async t => {
  const h = await harness(); let closed = false; t.after(() => { if (!closed) h.engine.close(); });
  h.setBranch([user('goal', 'Preserve tenant isolation.')], 'goal');
  await h.emit('session_start', { reason: 'startup' });
  await h.engine.quality!.feedback!.run('check');
  assert.match(contentOf(await h.emit('context_with_system', { messages: [] })), /CURRENT HOST VERIFICATION VIEW.*VERIFIED_PASS/);
  await writeFile(path.join(h.root, 'access.py'), 'def allowed(tenant, owner):\n    return False\n');
  await h.emit('tool_result', { toolName: 'bash', toolCallId: 'external-change', input: { command: 'never executed by test' },
    content: [{ type: 'text', text: 'Model says all tests passed.' }], details: { exitCode: 0 }, isError: false });
  const next = contentOf(await h.emit('context_with_system', { messages: [] }));
  assert.doesNotMatch(next, /VERIFIED_PASS/);
  // Reopen the same scoped store. Historical model/tool text cannot manufacture a live trusted receipt.
  h.engine.close(); closed = true;
  const resumed = await harness({ root: h.root }); t.after(() => resumed.engine.close());
  resumed.setBranch([user('goal', 'Preserve tenant isolation.')], 'goal');
  await resumed.emit('session_start', { reason: 'resume' });
  assert.doesNotMatch(contentOf(await resumed.emit('context_with_system', { messages: [] })), /VERIFIED_PASS/);
});

test('small/unknown/exhausted budgets explicitly retain incomplete recovery and retry when capacity returns', async t => {
  const h = await harness({ budget: 512 }); t.after(() => h.engine.close());
  h.setBranch([user('goal', 'Preserve tenant isolation. '.repeat(200))], 'goal');
  await h.emit('session_start', { reason: 'resume' });
  const response = await h.emit('context_with_system', { messages: [] });
  assert.equal(response.messages.at(-1).details.status, 'INCOMPLETE_BUDGET');
  assert.match(contentOf(response), /status=INCOMPLETE_BUDGET/);
  assert.ok(estimateTokens(contentOf(response), 1.25) <= 512);
  h.usage(false);
  assert.equal(await h.emit('context_with_system', { messages: [] }), undefined);
  h.usage(true, 65000);
  assert.equal(await h.emit('context_with_system', { messages: [] }), undefined);
  h.usage(true);
  assert.ok(await h.emit('context_with_system', { messages: [] }));
  const ledger = h.engine.lifecycle!.ledger;
  assert.ok(ledger.search('local-session', 'main', 'SKIPPED_BUDGET_UNKNOWN').length);
  assert.ok(ledger.search('local-session', 'main', 'SKIPPED_BUDGET_EXHAUSTED').length);
  assert.equal((await h.engine.lifecycle!.recover(1)).text, '');
});
test('recovery exceptions are explicit incomplete observations and cannot reuse an old owned block',async t=>{
 let broken=false;const h=await harness({counter:{source:'model-tokenizer',modelId:'local-test-model',count:text=>broken?NaN:Math.ceil(Buffer.byteLength(text)/4)}});t.after(()=>h.engine.close());
 h.setBranch([user('goal','Preserve tenant isolation.')],'goal');await h.emit('session_start',{reason:'resume'});
 const first=await h.emit('context_with_system',{messages:[]});assert.ok(first.messages.length);
 broken=true;const second=await h.emit('context_with_system',{messages:first.messages});assert.equal(second.messages.length,0);
 const records=h.engine.lifecycle!.ledger.search('local-session','main','RECOVERY_ERROR');assert.ok(records.length);
 const original=await h.engine.lifecycle!.ledger.original('local-session','main',records.at(-1)!.id);assert.match(original.text,/"coverage":"INCOMPLETE"/);assert.match(original.text,/"stage":"COMPILE"/);
});

test('branch recovery respects cutoff; another workspace cannot supply this task state', async t => {
  const h = await harness(); t.after(() => h.engine.close());
  const first = user('first', 'Preserve tenant isolation.'), future = user('future', 'Future branch secret requirement.', 'first');
  h.setBranch([first, future], 'future'); await h.emit('session_start', { reason: 'resume' });
  assert.match(contentOf(await h.emit('context_with_system', { messages: [] })), /Future branch secret requirement/);
  h.setBranch([first], 'first'); await h.emit('session_tree', {});
  assert.doesNotMatch(contentOf(await h.emit('context_with_system', { messages: [] })), /Future branch secret requirement/);
  const other = await harness(); t.after(() => other.engine.close());
  other.setBranch([user('other', 'Other workspace task.')], 'other'); await other.emit('session_start', { reason: 'resume' });
  assert.doesNotMatch(contentOf(await other.emit('context_with_system', { messages: [] })), /Future branch secret requirement/);
  assert.notEqual(other.engine.workspace.projectId, h.engine.workspace.projectId);
});

test('automatic recovery preserves observe-only/tools-only/legacy behavior, and supports auto-context-only without advertising tools', async t => {
  for (const options of [{ mode: 'observe-only' as const }, { strategy: 'tools-only' }, { policy: 'legacy' }, { policy: 'explicit' }]) {
    const h = await harness(options); t.after(() => h.engine.close());
    h.setBranch([user('goal', 'Preserve tenant isolation.')], 'goal'); await h.emit('session_start', { reason: 'resume' });
    assert.equal(await h.emit('context_with_system', { messages: [] }), undefined);
  }
  const h = await harness({ strategy: 'auto-context-only', hidden: true }); t.after(() => h.engine.close());
  h.setBranch([user('goal', 'Preserve tenant isolation.')], 'goal'); await h.emit('session_start', { reason: 'resume' });
  assert.match(contentOf(await h.emit('context_with_system', { messages: [] })), /Preserve tenant isolation/);
  assert.equal(await h.emit('before_agent_start', { messageType: 'user', prompt: 'Continue.', systemPrompt: 'HOST' }), undefined);
});

test('agent-independent recovery validates counters and envelopes instead of clipping mandatory text', async () => {
  let calls = 0;
  const compile = async () => { calls++; throw Error('Must not compile when no header fits'); };
  const empty = await prepareTaskRecovery(compile, 1);
  assert.equal(empty.status, 'INCOMPLETE_BUDGET'); assert.equal(empty.text, ''); assert.equal(calls, 0);
  await assert.rejects(prepareTaskRecovery(compile, 1024, { source: 'model-tokenizer', modelId: 'test', count: () => NaN }), /Invalid recovery token count/);
});

test('injection replaces only its own ephemeral block and updates for new user entries',async t=>{
 const h=await harness();t.after(()=>h.engine.close());h.setBranch([user('goal','Preserve tenant isolation.')],'goal');await h.emit('session_start',{reason:'resume'});
 const first=await h.emit('context_with_system',{messages:[{role:'user',content:'Continue.'}]});
 const old=first.messages.at(-1),owner=old.details.recoveryOwner,historical={role:'custom',customType:'cce-task-recovery',content:'Historical block',details:{}};
 await h.emit('before_agent_start',{messageType:'user',prompt:'Do not add network calls.',systemPrompt:''});
 const input=[...first.messages,historical],before=JSON.stringify(input),second=await h.emit('context_with_system',{messages:input});
 assert.equal(JSON.stringify(input),before);assert.equal(second.messages.filter((m:any)=>m.details?.recoveryOwner===owner).length,1);
 assert.ok(second.messages.includes(historical));assert.ok(!second.messages.includes(old));assert.match(contentOf(second),/Do not add network calls/);
 h.usage(false);const skipped=await h.emit('context_with_system',{messages:second.messages});
 assert.equal(skipped.messages.filter((m:any)=>m.details?.recoveryOwner===owner).length,0);assert.ok(skipped.messages.includes(historical));
});
test('Pi imports stable entry IDs without collapsing equal user messages',async t=>{
 const h=await harness();t.after(()=>h.engine.close());h.setBranch([user('one','Same requirement.'),user('two','Same requirement.','one')],'two');
 await h.emit('session_start',{reason:'resume'});await h.emit('context_with_system',{messages:[]});
 assert.deepEqual((await h.engine.lifecycle!.taskState()).userEvents.map(e=>e.sourceEventId),['one','two']);
 await h.emit('session_start',{reason:'resume'});await h.emit('context_with_system',{messages:[]});assert.equal((await h.engine.lifecycle!.taskState()).userEvents.length,2);
});
