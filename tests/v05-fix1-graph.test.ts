import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink,rename}from 'node:fs/promises';
import path from 'node:path';
import {nativeFixture}from './native-fixtures.ts';
import {ContextEngine}from '../packages/core/src/index.ts';
import {DatabaseSync}from 'node:sqlite';
import {SelectiveGraphPlanner}from '../packages/core/src/quality/graph-planner.ts';
const planner=new SelectiveGraphPlanner();
const config={retrieval:{backend:'hybrid-native'},quality:{profile:'hybrid-quality'},hybrid:{enableVector:false,enableLiteral:false,graphStrategy:'selective'}};
test('fix1 RU/EN intent has strict direction; unknown intent remains explicit and definition lookup skips graph',()=>{
  for(const q of ['кто вызывает target','Find callers of target']){const p=planner.plan(q,[]);assert.equal(p.direction,'incoming');assert.deepEqual(p.relations,['CALLS']);}
  for(const q of ['от чего зависит target','dependencies of target'])assert.equal(planner.plan(q,[]).intent,'dependency');
  for(const q of ['найди реализацию target','Find class Target','Target'])assert.equal(planner.plan(q,[]).mode,'skip');
  assert.equal(planner.plan('What is this project for?',[]).intent,'unknown');assert.match(planner.plan('What is this project for?',[]).reason,/unverified/);
  assert.equal(planner.plan('От чего наследуется Target?',[]).intent,'inheritance');assert.equal(planner.plan('Что затронет изменение target?',[]).direction,'incoming');
  assert.deepEqual(planner.targets('Find callers of Serializer.dump_payload'),['Serializer.dump_payload']);assert.deepEqual(planner.targets('Кто вызывает target?'),['target']);
});
async function project(){
 const root=await nativeFixture('generic-python');
 await writeFile(path.join(root,'fix1_helpers.py'),'def target():\n    return outgoing()\n\ndef outgoing():\n    return 7\n');
 await writeFile(path.join(root,'caller.py'),'from fix1_helpers import target\ndef caller():\n    return target()\n');
 const engine=await ContextEngine.open(root,{config});await engine.native!.reindex();return{root,engine};
}
test('fix1 SQL incoming never returns outgoing edges; indexes are used and skip touches no graph tables',async()=>{
 const {engine}=await project();try{
  const n=engine.native!,target=n.store.chunks().find(c=>c.name==='target'&&c.kind==='function')!;
  const result=await n.graphQuery.execute(planner.plan('кто вызывает target',[target.id]));
  assert.ok(result.edges.some(e=>n.store.chunk(e.source)?.name==='caller'));assert.ok(result.edges.every(e=>e.target===target.id));assert.equal(result.edges.some(e=>n.store.chunk(e.target)?.name==='outgoing'),false);
  const plan=n.store.db.prepare("EXPLAIN QUERY PLAN SELECT payload FROM native_edges WHERE target=? AND relation IN (?) ORDER BY relation,source LIMIT ?").all(target.id,'CALLS',30);
  assert.match(JSON.stringify(plan),/native_edges_in/);
  n.store.graph=()=>{throw new Error('Full graph read forbidden');};n.store.graphNode=()=>{throw new Error('Skip read graph nodes');};let neighborCalls=0;const original=n.store.graphNeighbors.bind(n.store);n.store.graphNeighbors=(...args)=>{neighborCalls++;return original(...args);};
  const hits=await n.searchChunks('target');assert.ok(hits.length);assert.equal(neighborCalls,0);assert.equal(n.lastTrace!.graph!.plan.mode,'skip');
 }finally{engine.close();}
});
test('fix1 graph roots bind explicit lowercase/qualified targets and bounded related calls do not force rebuild',async()=>{
 const {engine}=await project();try{
  const n=engine.native!,now=Date.now()/1000,target=n.store.chunks().find(c=>c.kind==='function'&&c.name==='target')!;
  await n.searchChunks('Find callers of target',{scoringNow:now});assert.deepEqual(n.lastTrace!.graph!.plan.seeds,[target.id]);
  const generation=n.store.generation();n.store.graph=()=>{throw new Error('Whole graph read forbidden');};
  const related=await n.relatedEvidence(target.id,{relations:['CALLS']});assert.ok(related.edges.every(e=>e.source===target.id));assert.equal(n.store.generation(),generation);assert.equal(n.index.lastResult!.indexedFiles,0);
  const again=await n.relatedEvidence(target.id,{relations:['CALLS']});assert.equal(again.cacheHit,true);assert.equal(again.sqlQueries,0);
 }finally{engine.close();}
});
test('fix1 cache is generation-bound; uncommitted changes, rename/delete and edge-source races reject stale data',async()=>{
 const {engine,root}=await project();try{
  const n=engine.native!,target=n.store.chunks().find(c=>c.name==='target'&&c.kind==='function')!,plan=planner.plan('callers of target',[target.id]);
  const a=await n.graphQuery.execute(plan),b=await n.graphQuery.execute(plan);assert.equal(a.cacheHit,false);assert.equal(b.cacheHit,true);assert.equal(b.sqlQueries,0);
  const generation=n.store.generation();await writeFile(path.join(root,'caller.py'),'def caller():\n    return 0\n');
  const changed=await n.graphQuery.execute(plan);assert.notEqual(changed.generation,generation);assert.equal(changed.cacheHit,false);assert.equal(changed.edges.some(e=>n.store.chunk(e.source)?.name==='caller'),false);
  await writeFile(path.join(root,'caller.py'),'from fix1_helpers import target\ndef caller():\n    return target()\n');await n.index.refresh();
  const raced=await n.graphQuery.execute(plan);assert.ok(raced.edges.length);await writeFile(path.join(root,'caller.py'),'# changed source but target unchanged\n');
  const stale=await n.graphQuery.execute(plan,{snapshotRefreshed:true});assert.equal(stale.stopReason,'stale-index');assert.deepEqual(stale.edges,[]);
  await n.index.refresh();await rename(path.join(root,'caller.py'),path.join(root,'renamed.py'));const renamed=await n.graphQuery.execute(plan);assert.equal(renamed.cacheHit,false);
  await unlink(path.join(root,'renamed.py'));const deleted=await n.graphQuery.execute(plan);assert.equal(deleted.cacheHit,false);
  const before=n.store.generation();assert.throws(()=>n.store.transaction(()=>{n.store.setMeta('sourceSnapshot','broken');throw new Error('rollback');}),/rollback/);assert.equal(n.store.generation(),before);assert.notEqual(n.store.meta('sourceSnapshot'),'broken');
 }finally{engine.close();}
});
test('fix1 graph work limits, cancellation and SQL parameter validation are fail-closed',async()=>{
 const {engine}=await project();try{
  const n=engine.native!,target=n.store.chunks().find(c=>c.name==='target'&&c.kind==='function')!,plan=planner.plan('callers of target',[target.id]);
  const edgeBound=await n.graphQuery.execute({...plan,maxEdges:1});assert.ok(edgeBound.visitedEdges<=1);assert.equal(edgeBound.stopReason,'max-edges');
  const nodeBound=await n.graphQuery.execute({...plan,maxNodes:1});assert.ok(nodeBound.visitedNodes<=1);assert.equal(nodeBound.stopReason,'max-nodes');
  const abort=new AbortController();abort.abort();const aborted=await n.graphQuery.execute(plan,{signal:abort.signal});assert.equal(aborted.stopReason,'aborted');assert.deepEqual(aborted.edges,[]);
  const work=await n.graphQuery.execute({...plan,reason:'uncached work bound'},{maxWorkMs:0});assert.equal(work.stopReason,'work-budget');assert.deepEqual(work.edges,[]);
  assert.throws(()=>n.store.graphNeighbors(target.id,'incoming',["CALLS'); DROP TABLE native_edges;--"as never],1),/Invalid/);
  await assert.rejects(n.graphQuery.execute({...plan,maxEdges:-1}),/Invalid/);
 }finally{engine.close();}
});
test('fix1 graph generation and graph writes commit atomically for independent readers',async()=>{
 const {engine}=await project();const store=engine.native!.store,reader=new DatabaseSync(store.filename,{readOnly:true});
 try{const before=store.generation(),count=Number(reader.prepare('SELECT count(*) AS n FROM native_edges').get()!.n);
  store.transaction(()=>{store.replaceGraph([],[]);assert.equal(reader.prepare("SELECT value FROM native_meta WHERE key='indexGeneration'").get()!.value,before.split(':').at(-1));assert.equal(Number(reader.prepare('SELECT count(*) AS n FROM native_edges').get()!.n),count);});
  assert.notEqual(store.generation(),before);assert.equal(Number(reader.prepare('SELECT count(*) AS n FROM native_edges').get()!.n),0);
 }finally{reader.close();engine.close();}
});
test('fix1 selective Guard dependency audit uses bounded SQL and does not force a rebuild',async()=>{
 const first=await project();first.engine.close();const engine=await ContextEngine.open(first.root,{config:{...config,hybrid:{...config.hybrid,enableCompression:false},quality:{...config.quality,guardEnabled:true}},taskContract:{id:'dependency',source:'user',text:'Inspect target and outgoing.',requirements:[{id:'call',clause:'Inspect target and outgoing.',needs:[{id:'edge',kind:'dependency',symbol:'target',targetSymbol:'outgoing',relation:'CALLS',representation:'full'}],checks:[]}]}});
 try{const n=engine.native!;await n.reindex();const generation=n.store.generation(),chunks=n.store.chunks().filter(c=>c.kind==='function'&&['target','outgoing'].includes(c.name));
  n.store.graph=()=>{throw new Error('No whole-graph materialization for selective audit');};const refresh=n.index.refresh.bind(n.index);n.index.refresh=force=>{assert.notEqual(force,true);return refresh(force);};
  const built=await engine.buildContext({task:'Inspect target and outgoing.',hits:chunks.map(c=>({path:c.path,startLine:c.startLine,endLine:c.endLine,sha256:c.fileHash,excerpt:c.text,representation:'full' as const,chunkId:c.id,score:1,reason:'current source'})),sessionBudgetKnown:true});
  assert.equal(n.store.generation(),generation);assert.deepEqual(built.quality!.coveredRequirements,['call']);assert.equal(built.quality!.completeness,'UNVERIFIED');
 }finally{engine.close();}
});
