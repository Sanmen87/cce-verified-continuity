import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, copyFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.ts';
import { NativeStore } from '../packages/core/src/native/store.ts';
import { Workspace, sha256 } from '../packages/core/src/workspace.ts';
import { TextLanguageAdapter } from '../packages/core/src/native/registry.ts';
test('native SQLite persists chunks, vectors, cache and memory without touching checkpoints; rejects future schema', async t => {
  const root = await fixture(t); const workspace = await Workspace.create(root);
  let store = await NativeStore.open(workspace, '.context-engine', 3, 'sqlite-vec');
  let open = true; t.after(() => { if (open) store.close(); });
  assert.equal(store.vector?.backend, 'sqlite-vec');
  const source = 'class Alpha: pass\n'; const parsed = await new TextLanguageAdapter().parse('crm/models.py', source, sha256(source));
  store.transaction(() => { store.replaceFile(parsed); store.vector!.replace([{ id: parsed.chunks[0]!.id, vector: new Float32Array([1, 0, 0]) }]); });
  assert.equal(store.keyword.search('Alpha', 5).length, 1);
  const filename = store.filename; store.close(); open = false;
  store = await NativeStore.open(workspace, '.context-engine', 3, 'sqlite-vec'); open = true;
  assert.equal(store.files().get('crm/models.py'), sha256(source));
  store.transaction(() => store.removeFile('crm/models.py')); assert.equal(store.vector!.search(new Float32Array([1, 0, 0]), 3).length, 0);
  store.close(); open = false; const db = new DatabaseSync(filename); db.exec('PRAGMA user_version=99'); db.close();
  const before = await readFile(filename); await assert.rejects(NativeStore.open(workspace, '.context-engine', 3), /unsupported/);
  assert.deepEqual(await readFile(filename), before);
});

test('native index rejects copied workspace identity and junction state directories', async t => {
  const first = await fixture(t), second = await fixture(t), linked = await fixture(t);
  const store = await NativeStore.open(await Workspace.create(first), '.context-engine'); const file = store.filename; store.close();
  await mkdir(path.join(second,'.context-engine'));
  await copyFile(file,path.join(second,'.context-engine/hybrid.db'));
  await assert.rejects(NativeStore.open(await Workspace.create(second),'.context-engine'),/bound to another workspace/);
  await symlink(path.join(first,'.context-engine'),path.join(linked,'.context-engine'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(NativeStore.open(await Workspace.create(linked),'.context-engine'),/Unsafe native index directory/);
});
