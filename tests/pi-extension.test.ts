import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { registerCce } from '../packages/pi-extension/src/index.ts';
import { fixture } from './helpers.ts';
type Handler = (event: never, ctx: ExtensionContext) => unknown;
export function harness(root: string, config: unknown = {}) {
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
  const handlers = new Map<string, Handler>();
  const api = {
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => commands.set(name, command),
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    getAllTools: () => [...tools.values()].map(t => ({ name: t.name, parameters: t.parameters })),
    getActiveTools: () => [...tools.values()].filter(t => t.exposure === 'direct').map(t => t.name),
  } as unknown as ExtensionAPI;
  const ctx = { cwd: root, hasUI: false, sessionManager: { getSessionId: () => 'pi-test', buildSessionProjection: () => ({ messages: [] }) },
    getSystemPrompt: () => 'system',
    getContextUsage: () => ({ tokens: 100, contextWindow: 65536, percent: 1 }), model: { contextWindow: 65536 },
    ui: new Proxy({}, { get: () => { throw new Error('UI must not be called'); } }),
  } as unknown as ExtensionToolContext;
  registerCce(api, { config });
  return { tools, commands, ctx, emit: async (name: string, event: unknown = {}) => handlers.get(name)?.(event as never, ctx) };
}
test('Pi registers four tools/commands and observe-only preserves frozen messages and prompt', async t => {
  const root = await fixture(t); const h = harness(root); t.after(() => h.emit('session_shutdown'));
  assert.deepEqual([...h.tools.keys()], ['cce_search_code', 'cce_get_project_context', 'cce_save_checkpoint', 'cce_load_checkpoint']);
  assert.ok([...h.tools.values()].every(tool => tool.exposure === 'hidden'));
  assert.deepEqual([...h.commands.keys()], ['cce-status', 'cce-reindex', 'cce-checkpoint', 'cce-resume']);
  await h.emit('session_start', { reason: 'startup' });
  const messages = Object.freeze([Object.freeze({ role: 'assistant', content: Object.freeze([{ type: 'toolCall', id: '1' }]) }),
    Object.freeze({ role: 'toolResult', toolCallId: '1', content: Object.freeze([{ type: 'text', text: 'ok' }]) })]);
  const event = Object.freeze({ messages }); const before = JSON.stringify(event);
  assert.equal(await h.emit('context', event), undefined); assert.equal(JSON.stringify(event), before);
  const prompt = Object.freeze({ messageType: 'user', prompt: 'Deal', systemPrompt: 'system', systemPromptOptions: Object.freeze({}) });
  assert.equal(await h.emit('before_agent_start', prompt), undefined);
  const found = await h.tools.get('cce_search_code')!.execute('id', { query: 'Deal' }, undefined, undefined, h.ctx);
  assert.match(JSON.stringify(found.content), /crm\/models.py/);
  const input = { taskId: 'pi', goal: 'Inspect Deal', completed: [], pending: ['test'], testResults: [] };
  await h.tools.get('cce_save_checkpoint')!.execute('save', input, undefined, undefined, h.ctx);
  const loaded = await h.tools.get('cce_load_checkpoint')!.execute('load', { taskId: 'pi' }, undefined, undefined, h.ctx);
  assert.match(JSON.stringify(loaded.content), /trusted/);
  const bad = await h.tools.get('cce_search_code')!.execute('bad', { query: 'Deal', path: '../outside' }, undefined, undefined, h.ctx);
  assert.match(JSON.stringify(bad.content), /recoverable/);
  await h.emit('session_start', { reason: 'resume' });
  assert.equal(await h.emit('context', event), undefined);
});
test('assist injects bounded fresh snippets only when enabled and usage is available', async t => {
  const root = await fixture(t); const h = harness(root, { mode: 'assist' }); t.after(() => h.emit('session_shutdown'));
  assert.ok([...h.tools.values()].every(tool => tool.exposure === 'direct'));
  const event = Object.freeze({ messageType: 'user', prompt: 'Deal', systemPrompt: 'system', systemPromptOptions: Object.freeze({}) });
  const injected = await h.emit('before_agent_start', event) as { message: { content: string } } | undefined;
  assert.match(injected?.message.content ?? '', /crm\/models.py/);
  assert.ok(Buffer.byteLength(injected!.message.content) * 1.25 <= 4000);
  await writeFile(path.join(root, 'crm', 'models.py'), 'class Renamed: pass\n');
  assert.equal(await h.emit('before_agent_start', event), undefined);
  h.ctx.getContextUsage = () => undefined;
  assert.equal(await h.emit('before_agent_start', event), undefined);
});
test('checkpoints cannot cross Pi sessions and tool errors recover without UI', async t => {
  const root = await fixture(t); const h = harness(root); t.after(() => h.emit('session_shutdown'));
  await h.tools.get('cce_save_checkpoint')!.execute('save', { taskId: 'one', goal: 'Test', completed: [], pending: [], testResults: [] }, undefined, undefined, h.ctx);
  h.ctx.sessionManager.getSessionId = () => 'another-session';
  await h.emit('session_start', { reason: 'new' });
  const loaded = await h.tools.get('cce_load_checkpoint')!.execute('load', { taskId: 'one' }, undefined, undefined, h.ctx);
  assert.deepEqual(loaded.content, [{ type: 'text', text: 'null' }]);
  const broken = harness(root, { mode: 'invalid' }); t.after(() => broken.emit('session_shutdown'));
  const error = await broken.tools.get('cce_search_code')!.execute('search', { query: 'Deal' }, undefined, undefined, broken.ctx);
  assert.match(JSON.stringify(error), /recoverable/);
});

test('native Pi adapter exposes progressive disclosure and proposals, with confirmation only as a user command', async t => {
  const root = await fixture(t);
  const h = harness(root,{ mode:'assist', assist:{strategy:'tools-only'}, retrieval:{backend:'hybrid-native'} });
  t.after(() => h.emit('session_shutdown'));
  assert.equal(h.tools.size,8); assert.ok(h.commands.has('cce-confirm-memory'));
  assert.ok(![...h.tools.keys()].some(n=>n.includes('confirm')));
  const response = await h.tools.get('cce_search_code')!.execute('search',{query:'Deal'},undefined,undefined,h.ctx);
  const search = JSON.parse((response.content[0] as { text:string }).text) as { hits:Array<{chunkId:string;sha256:string;path:string}> };
  assert.ok(search.hits.length); const hit = search.hits[0]!;
  const expanded = await h.tools.get('cce_expand_chunk')!.execute('expand',{chunkId:hit.chunkId,limit:1},undefined,undefined,h.ctx);
  assert.match(JSON.stringify(expanded),/class Deal/);
  const proposed = await h.tools.get('cce_propose_memory')!.execute('memory',{kind:'code-area',text:'Deal source',evidence:[{path:hit.path,sha256:hit.sha256}]},undefined,undefined,h.ctx);
  assert.match(JSON.stringify(proposed),/proposed/);
  const recalled = await h.tools.get('cce_recall_memory')!.execute('recall',{query:'Deal'},undefined,undefined,h.ctx);
  assert.doesNotMatch(JSON.stringify(recalled),/Deal source/);
});
