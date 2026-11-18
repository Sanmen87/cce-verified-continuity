import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir}from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath}from 'node:url';
import {DefaultResourceLoader,SettingsManager}from '@earendil-works/pi-coding-agent';
import {fixture}from './helpers.ts';

test('Pi discovers the installed local CCE package without host dependency warnings',async t=>{
  const cwd=await fixture(t),agentDir=path.join(cwd,'agent');await mkdir(agentDir);
  const source=fileURLToPath(new URL('../packages/pi-extension/',import.meta.url));
  const loader=new DefaultResourceLoader({cwd,agentDir,settingsManager:SettingsManager.inMemory({packages:[source]}),
    disabledBuiltinExtensions:['mcp','codemode'],noSkills:true,noThemes:true,noPromptTemplates:true,noContextFiles:true});
  await loader.reload();const loaded=loader.getExtensions();
  assert.deepEqual(loaded.errors,[]);assert.deepEqual(loaded.warnings??[],[]);
  assert.ok(loaded.extensions.some(e=>e.tools.has('cce_search_code')));
  assert.ok(loaded.extensions.some(e=>e.commands.has('cce-status')));
});
