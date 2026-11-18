import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAdapters}from '../packages/core/src/native/defaults.ts';
import {buildGraph}from '../packages/core/src/native/graph.ts';
import {sha256,ContextEngine}from '../packages/core/src/index.ts';
import {nativeFixture}from './native-fixtures.ts';
import {writeFile}from 'node:fs/promises';
import path from 'node:path';
async function graph(sources:Record<string,string>,scoped=true){const registry=defaultAdapters(scoped),chunks=(await Promise.all(Object.entries(sources).map(([p,s])=>registry.language(p).parse(p,s,sha256(s))))).flatMap(p=>p.chunks);const g=buildGraph(chunks,p=>registry.language(p),[],{resolution:scoped?'scoped':'legacy'});return{...g,chunks,call:(name:string,expression:string)=>g.edges.filter(e=>e.relation==='CALLS'&&chunks.find(c=>c.id===e.source)?.qualifiedName===name&&(e.metadata.expression===expression||(e.metadata.expressions as string[]|undefined)?.includes(expression))).map(e=>({edge:e,target:g.nodes.find(n=>n.id===e.target)!}))};}
test('fix2 Python module/function collision resolves the imported definition, preserving import module edges',async()=>{
 const sources={'target.py':'def target():\n    return 1\n','caller.py':'from target import target\ndef caller():\n    return target()\n'};
 const old=await graph(sources,false),fixed=await graph(sources);
 assert.equal(old.call('caller.caller','target')[0]!.target.kind,'module');
 assert.equal(fixed.call('caller.caller','target')[0]!.target.kind,'function');assert.equal(fixed.call('caller.caller','target')[0]!.target.name,'target.target');
 assert.ok(fixed.edges.some(e=>e.relation==='IMPORTS'&&fixed.nodes.find(n=>n.id===e.target)?.kind==='module'));
});
test('fix2 TS/JS bindings follow named/default exports, aliases, namespaces and bounded reexports',async()=>{
 const g=await graph({'core.ts':'export function perform(){ return 1; }\nexport default function main(){return 2;}\nfunction privateFn(){return 3;}\n','barrel.ts':"export {perform as execute} from './core.js';\nexport {default as primary} from './core.js';\n",'entry.js':"import {execute as go, primary} from './barrel.js';\nimport * as api from './core.js';\nexport function run(){return go()+primary()+api.perform()+api.privateFn();}\n"});
 for(const expression of ['go','primary','api.perform'])assert.equal(g.call('entry.run',expression)[0]!.target.kind,'function',expression);
 assert.equal(g.call('entry.run','go')[0]!.target.name,'core.perform');assert.equal(g.call('entry.run','primary')[0]!.target.name,'core.main');
 assert.equal(g.call('entry.run','api.privateFn')[0]!.target.kind,'unresolved');
 const cycles=await graph({'a.ts':"export {x} from './b';",'b.ts':"export {x} from './a';",'call.ts':"import {x} from './a'; function run(){ x(); }"});assert.equal(cycles.call('call.run','x')[0]!.target.kind,'unresolved');
});
test('fix2 lexical scope wins; nested methods, parameter shadows and unrelated global names remain sound',async()=>{
 const g=await graph({'work.py':'def target():\n    return 1\ndef outer():\n    def target():\n        return 2\n    return target()\ndef dynamic(target):\n    return target()\nclass One:\n    def target(self):\n        return 3\n    def run(self):\n        return self.target()\nclass Two:\n    def target(self):\n        return 4\n','other.py':'def outsider():\n    return 5\n','caller.py':'def call(obj):\n    return obj.target() + outsider()\n'});
 assert.equal(g.call('work.outer','target')[0]!.target.name,'work.outer.target');assert.equal(g.call('work.One.run','self.target')[0]!.target.name,'work.One.target');
 assert.equal(g.call('work.dynamic','target')[0]!.target.kind,'unresolved');for(const expr of ['obj.target','outsider'])assert.equal(g.call('caller.call',expr)[0]!.target.kind,'unresolved');
});
test('fix2 ambiguous/wildcard/dynamic bindings do not manufacture resolved edges',async()=>{
 const g=await graph({'a.ts':'export function same(){return 1;}','b.ts':'export function same(){return 2;}','all.ts':"export * from './a'; export * from './b';",'run.ts':"import {same} from './all';\nfunction run(obj:any){same();obj.same();import('./a');}\n"});
 assert.equal(g.call('run.run','same')[0]!.target.kind,'unresolved');assert.equal(g.call('run.run','obj.same')[0]!.target.kind,'unresolved');assert.equal(g.call('run.run','import')[0]!.target.kind,'unresolved');
});
test('fix2 resolver identity migrates atomically and graph cache never serves stale target source',async()=>{
 const root=await nativeFixture('generic-python');await writeFile(path.join(root,'target.py'),'def target():\n    return 1\n');await writeFile(path.join(root,'caller.py'),'from target import target\ndef caller():\n    return target()\n');
 const config={retrieval:{backend:'hybrid-native'},quality:{profile:'hybrid-quality'},hybrid:{symbolResolution:'scoped',graphStrategy:'selective'}};
 const engine=await ContextEngine.open(root,{config});try{const n=engine.native!;await n.reindex();const target=n.store.chunks().find(c=>c.kind==='function'&&c.name==='target')!;const first=await n.relatedEvidence(target.id);assert.equal(first.completeness,'UNVERIFIED');const before=n.store.generation();await writeFile(path.join(root,'target.py'),'def target():\n    return 2\n');const again=await n.relatedEvidence(target.id);assert.notEqual(again.generation,before);assert.equal(again.cacheHit,false);assert.equal(again.completeness,'UNVERIFIED');}finally{engine.close();}
});
test('fix2 changing resolver policy on an existing index invalidates graph generation without editing source',async()=>{
 const root=await nativeFixture('generic-python');await writeFile(path.join(root,'target.py'),'def target():\n    return 1\ndef caller():\n    return target()\n');
 const config={retrieval:{backend:'hybrid-native'},hybrid:{symbolResolution:'legacy'}};
 let engine=await ContextEngine.open(root,{config}),before:string;
 try{await engine.native!.reindex();before=engine.native!.store.generation();const g=engine.native!.store.graph(),source=engine.native!.store.chunks().find(c=>c.name==='caller')!;assert.ok(g.edges.some(e=>e.source===source.id&&e.relation==='CALLS'&&g.nodes.find(n=>n.id===e.target)?.kind==='module'));}finally{engine.close();}
 engine=await ContextEngine.open(root,{config:{...config,hybrid:{symbolResolution:'scoped'}}});try{const result=await engine.native!.reindex();assert.equal(result.invalidated,true);assert.notEqual(engine.native!.store.generation(),before!);const g=engine.native!.store.graph(),source=engine.native!.store.chunks().find(c=>c.name==='caller')!;assert.ok(g.edges.some(e=>e.source===source.id&&e.relation==='CALLS'&&g.nodes.find(n=>n.id===e.target)?.kind==='function'));}finally{engine.close();}
});

