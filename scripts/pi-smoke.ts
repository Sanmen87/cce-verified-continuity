import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
const directory = await mkdtemp(path.join(tmpdir(), 'cce-smoke-'));
const cwd = path.join(directory, 'project'); const agentDir = path.join(directory, 'agent');
await mkdir(cwd); await mkdir(agentDir);
await writeFile(path.join(cwd, 'model.ts'), 'export class Deal {}\n');
let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
try {
  const settingsManager = SettingsManager.inMemory({});
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
    additionalExtensionPaths: [fileURLToPath(new URL('../packages/pi-extension/src/index.ts', import.meta.url))],
    noExtensions: true, disabledBuiltinExtensions: ['mcp', 'codemode'], noSkills: true,
    noThemes: true, noPromptTemplates: true, noContextFiles: true });
  await loader.reload();
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'),
    modelsStorePath: path.join(agentDir, 'models-cache'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const created = await createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager, modelRuntime,
    sessionManager: SessionManager.inMemory(cwd), tools: ['read', 'cce_*'] });
  session = created.session;
  assert.deepEqual(created.extensionsResult.errors, []);
  const baselineLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, disabledBuiltinExtensions: ['mcp', 'codemode'], noSkills: true,
    noThemes: true, noPromptTemplates: true, noContextFiles: true });
  await baselineLoader.reload();
  const baseline = await createAgentSession({ cwd, agentDir, resourceLoader: baselineLoader, settingsManager,
    modelRuntime, sessionManager: SessionManager.inMemory(cwd), tools: ['read'] });
  try {
    assert.deepEqual(session.getActiveToolNames(), baseline.session.getActiveToolNames());
    assert.equal(session.systemPrompt, baseline.session.systemPrompt,
      'observe-only must preserve the actual system prompt');
  } finally { baseline.session.dispose(); }
  const names = session.getAllTools().map(tool => tool.name);
  for (const name of ['cce_search_code', 'cce_get_project_context', 'cce_save_checkpoint', 'cce_load_checkpoint']) assert.ok(names.includes(name), name);
  assert.ok(session.getActiveToolNames().every(name => !name.startsWith('cce_')),
    'observe-only must not declare CCE tools to the model');
  const commands = session.extensionRunner.getRegisteredCommands().map(command => command.name);
  for (const name of ['cce-status', 'cce-reindex', 'cce-checkpoint', 'cce-resume']) assert.ok(commands.includes(name), name);
  const errors: string[] = [];
  session.extensionRunner.onError(error => errors.push(error.error));
  await session.extensionRunner.emit({ type: 'session_start', reason: 'startup' });
  const context = session.extensionRunner.createToolContext('smoke', undefined);
  const registered = created.extensionsResult.extensions.flatMap(e => [...e.tools.values()]);
  const search = registered.find(t => t.definition.name === 'cce_search_code')!.definition;
  const found = await search.execute('smoke', { query: 'Deal' }, undefined, undefined, context);
  assert.match(JSON.stringify(found.content), /model.ts/);
  const command = session.extensionRunner.getCommand('cce-checkpoint');
  assert.ok(command);
  await command.handler('smoke', session.extensionRunner.createCommandContext());
  const load = registered.find(t => t.definition.name === 'cce_load_checkpoint')!.definition;
  const loaded = await load.execute('load', { taskId: 'smoke' }, undefined, undefined, context);
  assert.match(JSON.stringify(loaded.content), /smoke/);
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  assert.deepEqual(errors, []);
  console.log('PASS: real installed Pi loader, unchanged observe-only prompt/tools, tool/command calls, session lifecycle; no LLM call');
} finally {
  await session?.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session?.dispose();
  if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('cce-smoke-')) throw new Error('Unsafe cleanup path');
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
