import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile}from 'node:fs/promises';
import path from 'node:path';
import {ContextEngine}from '../packages/core/src/index.ts';
import {nativeFixture}from './native-fixtures.ts';
test('fix1 lazy headers preserve exact scores, selected bodies, Unicode scoring prefix and source freshness',async()=>{
 const root=await nativeFixture('typescript');await writeFile(path.join(root,'long.ts'),'export function giant() {\n  const payload = "'+('😀'.repeat(6000))+' needleSuffix";\n  return payload;\n}\n');
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},quality:{profile:'hybrid-quality'},hybrid:{enableGraph:false,graphStrategy:'off'}}});
 try{
  await engine.native!.reindex();const now=Date.now()/1000;
  for(const query of ['findOrder','class OrdersService','needleSuffix','giant']){
   engine.config.hybrid.lazyHydration=false;const full=await engine.native!.searchChunks(query,{scoringNow:now});const fullTrace=engine.native!.lastTrace!;
   engine.config.hybrid.lazyHydration=true;const lazy=await engine.native!.searchChunks(query,{scoringNow:now});
   assert.deepEqual(lazy,full);assert.deepEqual(engine.native!.lastTrace!.candidates,fullTrace.candidates);assert.equal(engine.native!.lastTrace!.hydration!.mode,'lazy');
  }
  const hit=(await engine.searchCode('giant')).hits.find(h=>h.path==='long.ts')!;assert.ok(hit);
  await writeFile(path.join(root,'long.ts'),'export function replaced() { return 9; }\n');
  const built=await engine.buildContext({task:'old reference',hits:[hit]});assert.equal(built.included.length,0);
  await engine.native!.index.refresh();assert.ok(!engine.native!.store.chunkHeaders().some(c=>c.name==='giant'));
  engine.config.hybrid.keywordMode='code-bm25';await engine.native!.searchChunks('replaced');assert.equal(engine.native!.lastTrace!.hydration!.mode,'full');
 }finally{engine.close();}
});
test('fix1 SQL header migration is rebuildable and atomic with source/graph generation',async()=>{
 const root=await nativeFixture('generic-python'),engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},hybrid:{lazyHydration:true}}});
 try{
  const n=engine.native!;await n.reindex();const before=n.store.generation();
  n.store.db.exec('DELETE FROM native_chunk_headers');n.store.setMeta('headersVersion','0');await n.index.refresh();
  assert.equal(n.store.chunkHeaders().length,n.store.chunkCount());assert.notEqual(n.store.generation(),before);
  const generation=n.store.generation(),count=n.store.chunkHeaders().length;
  assert.throws(()=>n.store.transaction(()=>{n.store.removeFile(n.store.chunkHeaders()[0]!.path);throw new Error('rollback');}),/rollback/);
  assert.equal(n.store.generation(),generation);assert.equal(n.store.chunkHeaders().length,count);
 }finally{engine.close();}
});
