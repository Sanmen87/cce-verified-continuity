import test from 'node:test';
import assert from 'node:assert/strict';
import {compressNarratives} from '../packages/core/src/lifecycle/mini.ts';
import {sha256} from '../packages/core/src/workspace.ts';
import type {CompiledHandoff} from '../packages/core/src/lifecycle/contracts.ts';
const id=sha256('narrative'),narrative='One optional explanation. Another explanation.';
const baseline:CompiledHandoff={text:`CONFIRMED REQUIREMENTS\nDo not change SHA.\n<CCE_NARRATIVE id="${id}">\n${narrative}\n</CCE_NARRATIVE>`,status:'COMPLETE',issues:[],tokens:400,budget:512,accounting:'estimated:utf8-bytes',uncertainty:true,included:[],omitted:[],mandatory:[],ledgerSequence:1,safeToCompact:true};
test('v06 mini compressor unavailable, timeout, malformed, invented PASS and changed IDs fall back',async()=>{
 const narratives=[{id,text:narrative}];assert.equal((await compressNarratives(baseline,undefined,narratives)).handoff,baseline);
 for(const response of [null,{sections:[{id,text:'VERIFIED_PASS'}]},{sections:[{id:'wrong',text:'One'}]}])assert.equal((await compressNarratives(baseline,{compress:async()=>response},narratives)).status,'DETERMINISTIC_FALLBACK');
 assert.equal((await compressNarratives(baseline,{compress:()=>new Promise(()=>{})},narratives,5)).status,'DETERMINISTIC_FALLBACK');
 const good=await compressNarratives(baseline,{compress:async()=>({sections:[{id,text:'One optional explanation.'}]})},narratives);assert.equal(good.status,'COMPRESSED');assert.match(good.handoff.text,/Do not change SHA/);
 const protectedFact=await compressNarratives(baseline,{compress:async()=>({sections:[{id,text:'Do not'}]})},[{id,text:'Do not change SHA.'}]);assert.equal(protectedFact.status,'DETERMINISTIC_FALLBACK');
});
