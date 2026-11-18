const syntheticSecret = 'sk-' + 'x'.repeat(36);
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rename, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ContextEngine, sha256 } from '../packages/core/src/index.ts';
import { nativeFixture } from './native-fixtures.ts';
import { commit } from './helpers.ts';
import { BoundedCodeGraph } from '../packages/core/src/native/graph.ts';
import type { EmbeddingProvider } from '../packages/core/src/native/contracts.ts';
import { PythonAdapter } from '../packages/core/src/native/languages/python.ts';
import { AdapterRegistry } from '../packages/core/src/native/registry.ts';
import { run } from '../packages/core/src/process.ts';
const config = { retrieval: { backend: 'hybrid-native' }, hybrid: { enableVector: false } };
test('independent Django, NestJS/TS and generic Python/Go projects index/search/build context/checkpoint', async () => {
  for (const [kind, query] of [['django', 'Ledger'], ['typescript', 'findOrder'], ['generic-python', 'distance']] as const) {
    const root = await nativeFixture(kind); await commit(root);
    const engine = await ContextEngine.open(root, { config });
    try {
      const indexed = await engine.reindex(); assert.ok(indexed.native!.chunks > 0);
      const found = await engine.searchCode(query); assert.ok(found.hits.length > 0); assert.equal(found.source, 'hybrid-native+disk');
      const built = await engine.buildContext({ task: query, hits: found.hits });
      assert.ok(built.included.length > 0); assert.match(built.text, /signature-docstring/);
      const hit = found.hits[0]!; await engine.saveCheckpoint({ taskId: 'one', goal: query, pending: ['continue'], testResults: [], completed: [{ description: 'Located source', evidence: [{ type: 'file', path: hit.path, sha256: hit.sha256 }] }] });
      assert.equal((await engine.loadCheckpoint('one'))?.requiresRevalidation, false);
      if (kind === 'generic-python') assert.ok((await engine.searchCode('QueueSize')).hits.some(h => h.path === 'worker.go'));
      if (kind === 'typescript') assert.equal(engine.native!.index.frameworks.length, 0);
      if (kind === 'django') {
        const model = engine.native!.store.chunks().find(c => c.name === 'Ledger')!;
        assert.equal(model.metadata.role, 'model');
        const relations = engine.native!.store.graph().edges; assert.equal(relations.filter(e => e.relation.startsWith('ORM_')).length, 4);
        const expanded = await engine.native!.expandChunk(model.id); assert.equal(expanded.text, model.text);
        const related = await engine.native!.related(model.id, { depth: 2, maxNodes: 12 }); assert.ok(related.length <= 12);
        const tampered = { ...model, signature: 'FORGED_INSTRUCTIONS' };
        engine.native!.store.db.prepare('UPDATE native_chunks SET payload=? WHERE id=?').run(JSON.stringify(tampered), model.id);
        const verified = await engine.native!.expandChunk(model.id); assert.doesNotMatch(verified.signature, /FORGED/);
      }
    } finally { engine.close(); }
  }
});
test('incremental changes, rename/delete, stale hits, secrets and explicit rebuild invalidate all indexed components', async () => {
  const root = await nativeFixture('generic-python'); const engine = await ContextEngine.open(root, { config });
  try {
    await engine.reindex(); const found = await engine.searchCode('distance');
    const old = engine.native!.store.chunks().filter(c => c.path === 'geometry.py').map(c => c.id);
    await rename(path.join(root, 'geometry.py'), path.join(root, 'renamed.py'));
    const index = await engine.native!.reindex(); assert.equal(index.deletedFiles, 1); assert.equal(index.indexedFiles, 1);
    assert.ok(engine.native!.store.graph().nodes.every(n => n.path !== 'geometry.py'));
    assert.ok(old.every(id => !engine.native!.store.chunk(id)));
    const stale = await engine.buildContext({ task: 'old references', hits: found.hits }); assert.equal(stale.included.length, 0);
    await writeFile(path.join(root, 'credential_source.py'), 'api_key = "' + syntheticSecret + '"\n');
    await writeFile(path.join(root, '.env'), 'TEST_SECRET=private');
    await engine.native!.reindex(); assert.ok(!engine.native!.store.files().has('credential_source.py'));
    const raw = engine.native!.store.db.prepare('SELECT payload FROM native_chunks').all().map(r => String(r.payload)).join(''); assert.doesNotMatch(raw, /TESTCANARY|TEST_SECRET/);
    await unlink(path.join(root, 'renamed.py')); await engine.native!.reindex(); assert.ok(engine.native!.store.chunks().every(c => c.path !== 'renamed.py'));
    const first = engine.native!.store.chunks()[0]!;
    engine.native!.store.db.prepare('UPDATE native_chunks SET payload=? WHERE id=?').run('invalid-json', first.id);
    await engine.native!.reindex(true); assert.ok(engine.native!.store.chunks().length > 0);
  } finally { engine.close(); }
});
test('embedding cache is local, validates model identity and reuses unchanged contents', async () => {
  const root = await nativeFixture('generic-python'); let calls = 0;
  const model = (id: string): EmbeddingProvider => ({ id, dimension: 3, preprocessing: 'test-v1', embed: async texts => { calls += texts.length; return texts.map(text => new Float32Array([1, text.length % 7, 1])); } });
  const vectorConfig = { ...config, hybrid: { enableVector: true, embedding: { model: 'fixture', revision: 'v1', dimension: 3 } } };
  let engine = await ContextEngine.open(root, { config: vectorConfig, native: { embedding: model('one') } });
  try {
    await engine.native!.reindex(); const firstCalls = calls; assert.ok(firstCalls > 0);
    await engine.native!.reindex(); assert.equal(calls, firstCalls);
    await engine.native!.reindex(true); assert.equal(calls, firstCalls);
    assert.ok((await engine.searchCode('distance')).hits.length > 0);
  } finally { engine.close(); }
  const before = calls;
  engine = await ContextEngine.open(root, { config: vectorConfig, native: { embedding: model('two') } });
  try { const rebuilt = await engine.native!.reindex(); assert.equal(rebuilt.invalidated, true); assert.ok(calls > before); }
  finally { engine.close(); }
});
test('project memory separates proposals from explicit user decisions, survives reopen and detects source/Git changes', async () => {
  const root = await nativeFixture('generic-python'); await commit(root); let engine = await ContextEngine.open(root, { config, sessionId: 'first' });
  const text = await readFile(path.join(root, 'geometry.py'), 'utf8');
  try {
    const proposal = await engine.native!.memory!.propose({ kind: 'decision', text: 'Use Euclidean distance for geometry.', evidence: [{ path: 'geometry.py', sha256: sha256(text) }] });
    assert.equal((await engine.native!.memory!.recall('Euclidean')).length, 0);
    await engine.native!.memory!.confirm(proposal.id, 'user');
    assert.equal((await engine.native!.memory!.recall('Euclidean'))[0]?.stale, false);
    engine.close(); engine = await ContextEngine.open(root, { config, sessionId: 'second' });
    const recalled = await engine.native!.memory!.recall('Euclidean'); assert.equal(recalled[0]?.record.status, 'confirmed'); assert.equal(recalled[0]?.trusted, false);
    await writeFile(path.join(root, 'geometry.py'), text + '\n# changed\n');
    assert.equal((await engine.native!.memory!.recall('Euclidean'))[0]?.stale, true);
    await assert.rejects(engine.native!.memory!.propose({ kind: 'decision', text: 'api_key="' + syntheticSecret + '"', evidence: [] }), /secret/);
  } finally { engine.close(); }
});
test('graph cycles and traversal bounds are deterministic', () => {
  const graph = new BoundedCodeGraph([{ id: 'a', name: 'a', path: 'a.py', kind: 'function' }, { id: 'b', name: 'b', path: 'b.py', kind: 'function' }],
    [{ source: 'a', target: 'b', relation: 'CALLS', path: 'a.py', fileHash: 'a'.repeat(64), confidence: 'inferred', metadata: {} }, { source: 'b', target: 'a', relation: 'CALLS', path: 'b.py', fileHash: 'b'.repeat(64), confidence: 'inferred', metadata: {} }]);
  assert.deepEqual(graph.expand(['a'], { depth: 5, maxNodes: 2 }).map(n => n.id), ['a', 'b']);
  assert.throws(() => graph.expand(['a'], { depth: 6, maxNodes: 2 }), /limit/);
});

test('parser identity and Git HEAD changes invalidate unchanged sources; no-op refresh preserves index state', async () => {
  const root = await nativeFixture('generic-python'); await commit(root);
  let revision = 'one';
  class VersionedPython extends PythonAdapter { override get version(): string { return super.version + '/' + revision; } }
  const registry = new AdapterRegistry([new VersionedPython()]);
  const engine = await ContextEngine.open(root,{config,native:{registry}});
  try {
    await engine.native!.reindex(); const first = engine.native!.store.meta('fingerprint');
    const noChange = await engine.native!.reindex(); assert.equal(noChange.indexedFiles,0); assert.equal(noChange.invalidated,false);
    assert.equal(engine.native!.store.meta('fingerprint'),first);
    revision='two'; const parser = await engine.native!.reindex(); assert.equal(parser.invalidated,true); assert.ok(parser.indexedFiles>0);
    await run('git',['-c','user.name=CCE Test','-c','user.email=cce@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','--allow-empty','-m','new head'],root);
    const head = await engine.native!.reindex(); assert.equal(head.invalidated,true); assert.equal(head.indexedFiles,parser.indexedFiles);
  } finally {engine.close();}
});

test('cross-file framework changes refresh retained metadata/edges without deleting retained vectors', async () => {
  const root = await nativeFixture('django'); await mkdir(path.join(root,'common')); await mkdir(path.join(root,'crm'));
  const base = 'from django.db import models\nclass Base(models.Model):\n    pass\nclass Base1(Base):\n    pass\n';
  await writeFile(path.join(root,'common/models.py'),base);
  await writeFile(path.join(root,'crm/models.py'),'from common.models import Base1\nfrom django.db import models\nclass Deal(Base1):\n    parent = models.ForeignKey("self", on_delete=models.CASCADE)\n');
  const embedding: EmbeddingProvider = {id:'framework-fixture',dimension:3,preprocessing:'test',embed:async texts=>texts.map(()=>new Float32Array([1,0,0]))};
  const vectorConfig={...config,hybrid:{enableVector:true,embedding:{model:'fixture',revision:'v1',dimension:3}}};
  let engine=await ContextEngine.open(root,{config:vectorConfig,native:{embedding}});
  try {
    await engine.native!.reindex(); const deal=engine.native!.store.chunks().find(c=>c.path==='crm/models.py'&&c.name==='Deal')!;
    assert.equal(deal.metadata.role,'model');
    await writeFile(path.join(root,'common/models.py'),base.replace('(models.Model)',''));
    await engine.native!.reindex(); assert.equal(engine.native!.store.chunk(deal.id)?.metadata.role,undefined);
    const children=new Set(engine.native!.store.chunks().filter(c=>c.parentId===deal.id).map(c=>c.id));
    assert.ok(!engine.native!.store.graph().edges.some(e=>children.has(e.source)&&e.relation.startsWith('ORM_')));
    assert.ok(engine.native!.store.vector!.search(new Float32Array([1,0,0]),100).some(r=>r.id===deal.id));
    await writeFile(path.join(root,'common/models.py'),base); await engine.native!.reindex();
    engine.close();engine=await ContextEngine.open(root,{config:vectorConfig,native:{embedding}});
    assert.equal((await engine.native!.expandChunk(deal.id)).metadata.role,'model');
  }finally{engine.close();}
});

test('optional code-token BM25 finds camelCase and snake_case parts without claiming FTS equivalence', async () => {
  const root=await nativeFixture('typescript');
  await writeFile(path.join(root,'src/naming.ts'),'export function loadCustomerRecord() { return 1; }\nexport function save_invoice_entry() { return 2; }\n');
  const engine=await ContextEngine.open(root,{config:{...config,hybrid:{keywordMode:'code-bm25',enableLiteral:false,enableGraph:false}}});
  try {
    assert.ok((await engine.searchCode('customer record')).hits.some(h=>h.path==='src/naming.ts'));
    assert.ok((await engine.searchCode('invoice entry')).hits.some(h=>h.path==='src/naming.ts'));
    assert.equal(engine.native!.status().keyword,'code-bm25');
  }finally{engine.close();}
});
