import test from 'node:test';
import assert from 'node:assert/strict';
import {packWholeSources,type PackingCandidate}from '../packages/core/src/quality/packing.ts';
import {ContextEngine}from '../packages/core/src/index.ts';
import {nativeFixture}from './native-fixtures.ts';
import {writeFile}from 'node:fs/promises';
import path from 'node:path';
const candidate=(path:string,startLine:number,text:string,priority=1,required=false):PackingCandidate=>({source:{path,startLine,endLine:startLine+text.split('\n').length-1,text,sha256:'a'.repeat(64)},priority,required});
const countTokens=(text:string)=>Buffer.byteLength(text);
test('fix1 packing prioritizes explicit whole definitions with identical candidates/budgets; omission is not coverage',async()=>{
 const required=candidate('a.py',1,'def allow():\n    return True',1,true),noise=candidate('b.py',1,'print("noise")',100),candidates=[noise,required];
 const budgetTokens=countTokens(JSON.stringify([required.source]));
 const legacy=await packWholeSources(candidates,{policy:'legacy',budgetTokens,countTokens}),quality=await packWholeSources(candidates,{policy:'quality-aware',budgetTokens,countTokens});
 assert.equal(legacy.unpackedRequired.length,1);assert.equal(quality.unpackedRequired.length,0);assert.equal(quality.sources[0]!.text,required.source.text);assert.equal(quality.completeness,'UNVERIFIED');assert.ok(quality.usedTokens<=budgetTokens);
 assert.ok(quality.omitted.every(o=>!Object.hasOwn(o.source,'text')));
});
test('fix1 packing removes duplicate/overlapping source lines without cutting definitions or inventing gaps',async()=>{
 const a=candidate('a.ts',1,'a\nb\nc'),b=candidate('a.ts',3,'c\nd\ne'),nested=candidate('a.ts',2,'b\nc',1,true);
 const result=await packWholeSources([a,b,nested],{policy:'quality-aware',budgetTokens:2000,countTokens});
 assert.equal(result.sources.length,1);assert.equal(result.sources[0]!.text,'a\nb\nc\nd\ne');assert.deepEqual(result.unpackedRequired,[]);
 await assert.rejects(packWholeSources([a,candidate('a.ts',3,'WRONG\nd')],{policy:'quality-aware',budgetTokens:2000,countTokens}),/Conflicting/);
 const noRoom=await packWholeSources([nested],{policy:'quality-aware',budgetTokens:0,countTokens});assert.deepEqual(noRoom.sources,[]);assert.equal(noRoom.envelopeFits,false);assert.equal(noRoom.unpackedRequired.length,1);
});
test('fix1 production packing uses confirmed requirements and returns the whole required method within budget',async()=>{
 const root=await nativeFixture('typescript');await writeFile(path.join(root,'codec.ts'),'export class Codec {\n  encode(value: string) {\n    return value;\n  }\n'+('  // unrelated documentation\n'.repeat(200))+'}\n');
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},hybrid:{enableGraph:false},quality:{packing:'quality-aware',guardEnabled:true}},taskContract:{id:'encode-task',source:'user',text:'Implement encode.',requirements:[{id:'encode',clause:'Implement encode.',needs:[{id:'body',kind:'definition',symbol:'encode',path:'codec.ts',representation:'full',bodyRequired:true}],checks:[]}]}});
 try{await engine.native!.reindex();const chunks=engine.native!.store.chunks().filter(c=>c.path==='codec.ts'&&['encode','Codec'].includes(c.name));
  const built=await engine.buildContext({task:'Implement encode.',hits:chunks.map(c=>({path:c.path,startLine:c.startLine,endLine:c.endLine,sha256:c.fileHash,excerpt:c.signature,reason:'test preview',chunkId:c.id,representation:'preview' as const,score:c.name==='Codec'?100:1})),tokenBudget:1800,sessionBudgetKnown:true});
  assert.match(built.text,/return value/);assert.ok(built.estimatedTokens<=built.budget);assert.deepEqual(built.quality!.coveredRequirements,['encode']);assert.equal(built.quality!.completeness,'UNVERIFIED');
 }finally{engine.close();}
});
