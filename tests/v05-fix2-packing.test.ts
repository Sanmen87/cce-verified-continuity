import test from 'node:test';
import assert from 'node:assert/strict';
import {ContextEngine,sha256}from '../packages/core/src/index.ts';
import {nativeFixture}from './native-fixtures.ts';
import {writeFile}from 'node:fs/promises';
import path from 'node:path';
test('fix2 packing traces identify exact omitted bodies; references/previews never count as full coverage',async()=>{
 const root=await nativeFixture('generic-python'),source='def required():\n    return "'+('large'.repeat(300))+'"\n';await writeFile(path.join(root,'required.py'),source);
 const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},quality:{packing:'quality-aware',guardEnabled:true},hybrid:{enableGraph:false}},taskContract:{id:'task',source:'user',text:'Inspect required.',requirements:[{id:'r',clause:'Inspect required.',needs:[{id:'body',kind:'definition',symbol:'required',representation:'full'}],checks:[]}]}});
 try{await engine.native!.reindex();const c=engine.native!.store.chunks().find(c=>c.name==='required'&&c.kind==='function')!,hit={path:c.path,startLine:c.startLine,endLine:c.endLine,sha256:c.fileHash,chunkId:c.id,excerpt:c.signature,representation:'preview' as const,score:1,reason:'signature only'};
  const small=await engine.buildContext({task:'Inspect required.',hits:[hit],tokenBudget:600,sessionBudgetKnown:true});const omission=small.omitted.find(o=>o.code==='OMITTED_BY_TOKEN_BUDGET')!;assert.equal(omission.sha256,c.fileHash);assert.equal(omission.startLine,c.startLine);assert.deepEqual(small.quality!.coveredRequirements,[]);assert.equal(small.quality!.completeness,'UNVERIFIED');
  const full=await engine.buildContext({task:'Inspect required.',hits:[hit],tokenBudget:6000,sessionBudgetKnown:true});assert.deepEqual(full.quality!.coveredRequirements,['r']);assert.ok(full.estimatedTokens<=full.budget);
  await writeFile(path.join(root,'required.py'),source+'# changed\n');assert.notEqual(sha256(source+'# changed\n'),c.fileHash);const stale=await engine.buildContext({task:'Inspect required.',hits:[hit],tokenBudget:6000,sessionBudgetKnown:true});assert.deepEqual(stale.included,[]);assert.deepEqual(stale.quality!.coveredRequirements,[]);
 }finally{engine.close();}
});
