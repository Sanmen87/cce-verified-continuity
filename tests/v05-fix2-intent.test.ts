import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectiveGraphPlanner}from '../packages/core/src/quality/graph-planner.ts';
import {ContextEngine}from '../packages/core/src/index.ts';
import {nativeFixture}from './native-fixtures.ts';
import {writeFile}from 'node:fs/promises';
import path from 'node:path';
test('fix2 relationship planner requires structural roots, keeps strict directions and leaves unknown unverified',()=>{
 const p=new SelectiveGraphPlanner('relationships'),old=new SelectiveGraphPlanner();
 for(const q of ['Where are Alpha and Beta connected?','Как связаны Alpha и Beta?','Alpha Beta relationship','Which components interact?']){
  assert.equal(old.plan(q,['a','b']).mode,'skip');const result=p.plan(q,['a','b']);assert.equal(result.intent,'relationship');assert.equal(result.direction,'both');assert.equal(result.maxDepth,1);assert.equal(result.maxEdges,128);assert.equal(result.maxNodes,30);assert.equal(p.plan(q,['a']).mode,'skip');
 }
 for(const q of ['Who calls Alpha?','Alpha вызывается из каких функций?','Alpha is called from Beta'])assert.equal(p.plan(q,['a']).direction,'incoming');
 assert.equal(p.plan('What does Alpha call?',['a']).direction,'outgoing');assert.deepEqual(p.targets('What does Alpha call?'),['Alpha']);
 assert.equal(p.plan('Какие части проекта затрагивает изменение Alpha?',['a']).direction,'incoming');
 for(const q of ['Alpha','Find class Alpha','Найди реализацию Alpha'])assert.equal(p.plan(q,['a']).mode,'skip');assert.equal(p.plan('Why was this project created?',['a','b']).intent,'unknown');
});
test('fix2 called-by grammar distinguishes requested callees from a called subject and preserves old outgoing queries',()=>{
 const p=new SelectiveGraphPlanner('relationships'),old=new SelectiveGraphPlanner();
 for(const q of ['Which functions are called by Signal.connected_to?','Which methods are called from Alpha?','Who is called by Alpha?','Что вызывается из Alpha?','Какие функции вызываются из Alpha?']){assert.equal(p.plan(q,['a']).direction,'outgoing',q);assert.equal(p.plan(q,['a']).intent,'calls');}
 const classic='Which functions are called by Signal.connected_to?';assert.equal(old.plan(classic,['a']).direction,p.plan(classic,['a']).direction);assert.deepEqual(p.targets(classic),['Signal.connected_to']);
 for(const q of ['Alpha is called by which functions?','Alpha is called from Beta','Alpha вызывается из каких функций?','Which functions call Alpha?','Which method calls Alpha?','What calls Alpha?']){assert.equal(p.plan(q,['a']).direction,'incoming',q);assert.deepEqual(p.targets(q),['Alpha'],q);}
 assert.equal(p.plan('Find callers of Alpha and its relationship to Beta',['a','b']).direction,'incoming');
});
test('fix2 implicit lookup uses named structural symbols, bounded SQL and generation-bound caches without graph scans',async()=>{
 const root=await nativeFixture('generic-python');await writeFile(path.join(root,'relations.py'),'class Alpha:\n    def run(self):\n        return Beta()\nclass Beta:\n    pass\n');
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},quality:{profile:'hybrid-quality'},hybrid:{intentPolicy:'relationships',graphStrategy:'selective',symbolResolution:'scoped',enableVector:false,lazyHydration:true}}});
 try{const n=engine.native!;await n.reindex();n.store.graph=()=>{throw new Error('Full graph forbidden');};await n.searchChunks('Alpha Beta relationship');assert.equal(n.lastTrace!.graph!.plan.intent,'relationship');assert.ok(n.lastTrace!.graph!.result);assert.equal(n.lastTrace!.graph!.result!.completeness,'UNVERIFIED');
  await n.searchChunks('Alpha Beta relationship');assert.equal(n.lastTrace!.graph!.result!.cacheHit,true);assert.equal(n.lastTrace!.graph!.result!.sqlQueries,0);
  await n.searchChunks('Unknown Ghost relationship');assert.equal(n.lastTrace!.graph!.plan.mode,'skip');assert.equal(n.lastTrace!.graph!.result,null);
 }finally{engine.close();}
});
test('fix2 relationship grounding uses compact indexed definitions even when neither is a scored candidate',async()=>{
 const root=await nativeFixture('generic-python');await writeFile(path.join(root,'entities.py'),'class Alpha:\n    pass\nclass Beta:\n    pass\n');await writeFile(path.join(root,'links.py'),'from entities import Alpha, Beta\ndef link():\n    return Alpha(Beta())\ndef inspect_link():\n    return Alpha(Beta())\n');
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},quality:{profile:'hybrid-quality'},hybrid:{intentPolicy:'relationships',graphStrategy:'selective',symbolResolution:'scoped',enableVector:false,enableLiteral:false,lazyHydration:true}}});
 try{const n=engine.native!;await n.reindex();const ids=n.store.chunks().filter(c=>c.path==='links.py'&&c.kind==='function').map(c=>c.id);n.store.keyword.search=()=>ids.map((id,i)=>({id,score:2-i}));n.store.graph=()=>{throw new Error('No full graph');};
  await n.searchChunks('alpha beta relationship');assert.equal(n.lastTrace!.graph!.plan.intent,'relationship');assert.ok(n.lastTrace!.graph!.result);assert.ok(n.lastTrace!.candidates.every(c=>!c.name.endsWith('.Alpha')&&!c.name.endsWith('.Beta')));
  assert.ok(n.lastTrace!.graph!.plan.seeds.every(id=>ids.includes(id)));assert.ok(n.lastTrace!.graph!.result!.sqlQueries>0);
 }finally{engine.close();}
});
test('fix2 unresolved relationship placeholders consume edge work but cannot evict resolved source nodes',async()=>{
 const root=await nativeFixture('generic-python');await writeFile(path.join(root,'bounded.py'),'def target():\n    return 1\ndef seed():\n    return '+[...Array.from({length:40},(_,i)=>`unknown_${i}()`),'target()'].join(' + ')+'\n');
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},hybrid:{symbolResolution:'scoped',graphStrategy:'selective'}}});
 try{const n=engine.native!;await n.reindex();const chunks=n.store.chunks(),seed=chunks.find(c=>c.name==='seed'&&c.kind==='function')!,target=chunks.find(c=>c.name==='target'&&c.path==='bounded.py')!;n.store.graph=()=>{throw new Error('No full scan');};
  const plan={mode:'selective',intent:'relationship',direction:'outgoing',relations:['CALLS'],seeds:[seed.id],maxDepth:1,maxNodes:4,maxEdges:128,maxBonusChunks:3,reason:'Bounded relationship evidence'}as const;
  const result=await n.graphQuery.execute(plan);assert.ok(result.nodes.some(node=>node.id===target.id));assert.ok(result.nodes.every(node=>node.path!==null));assert.ok(result.visitedEdges>=40&&result.visitedEdges<=128);assert.ok(result.visitedNodes<=4);assert.equal(result.completeness,'UNVERIFIED');
  const limited=await n.graphQuery.execute({...plan,maxEdges:2});assert.ok(limited.visitedEdges<=2);assert.equal(limited.stopReason,'max-edges');
 }finally{engine.close();}
});
test('fix2 explicit caller target binds to an indexed definition outside scored candidates without altering scores',async()=>{
 const root=await nativeFixture('generic-python');await writeFile(path.join(root,'helpers.py'),'def target():\n    return 1\n');await writeFile(path.join(root,'caller.py'),'from helpers import target\ndef caller():\n    return target()\n');
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},quality:{profile:'hybrid-quality'},hybrid:{intentPolicy:'relationships',graphStrategy:'selective',symbolResolution:'scoped',enableVector:false,enableLiteral:false,lazyHydration:true}}});
 try{const n=engine.native!;await n.reindex();const target=n.store.chunks().find(c=>c.name==='target'&&c.kind==='function')!,caller=n.store.chunks().find(c=>c.name==='caller'&&c.kind==='function')!;n.store.keyword.search=()=>[{id:caller.id,score:1}];await n.searchChunks('Who calls target?');assert.ok(!n.lastTrace!.candidates.some(c=>c.id===target.id));assert.deepEqual(n.lastTrace!.graph!.plan.seeds,[target.id]);assert.ok(n.lastTrace!.graph!.result!.edges.some(e=>e.source===caller.id&&e.target===target.id));
 }finally{engine.close();}
});
