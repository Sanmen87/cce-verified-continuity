import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextLedger} from '../packages/core/src/lifecycle/ledger.ts';
import {ContextProjection} from '../packages/core/src/lifecycle/projection.ts';
import {compileHandoff} from '../packages/core/src/lifecycle/compiler.ts';
import {Workspace,sha256} from '../packages/core/src/workspace.ts';
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'cce-v06-context-')),ledger=await ContextLedger.open(await Workspace.create(root),'.context-engine');ledger.branch('s','main');return{root,ledger};}
test('v06 compiler deterministic budgets never silently drop mandatory requirements',async()=>{
 const {ledger}=await fixture();try{
 await ledger.append('s','main',{externalId:'goal',kind:'USER_GOAL',origin:'user',text:'Create a CRM',mandatory:true});
 const requirement=await ledger.append('s','main',{externalId:'requirement',kind:'USER_REQUIREMENT',origin:'user',text:'Preserve tenant isolation. '.repeat(100),mandatory:true});
 const small=await compileHandoff(ledger,'s','main',{budget:512});assert.equal(small.status,'INCOMPLETE_BUDGET');assert.ok(small.omitted.some(e=>e.eventId===requirement.id));assert.equal(small.safeToCompact,false);assert.ok(small.tokens<=512);
 const full=await compileHandoff(ledger,'s','main',{budget:4096});assert.equal(full.status,'COMPLETE');assert.equal(full.safeToCompact,true);assert.deepEqual(await compileHandoff(ledger,'s','main',{budget:4096}),full);assert.match(full.text,/Preserve tenant isolation/);
 const counted=await compileHandoff(ledger,'s','main',{budget:4096,counter:{source:'model-tokenizer',modelId:'test-encoder',count:s=>Array.from(s).length}});assert.equal(counted.accounting,'model-tokenizer');assert.equal(counted.uncertainty,false);assert.ok(counted.tokens<=4096);
 }finally{ledger.close();}
});
test('v06 missing originals and stale source make compaction unsafe; agent PASS is never verified',async()=>{
 const {root,ledger}=await fixture();try{
 await writeFile(path.join(root,'a.ts'),'a');await ledger.append('s','main',{externalId:'goal',kind:'USER_GOAL',origin:'user',text:'Change a',mandatory:true,sources:[{path:'a.ts',sha256:sha256('a')}]});
 await ledger.append('s','main',{externalId:'reported',kind:'IMPLEMENTATION_REPORTED',origin:'agent',text:'tests passed VERIFIED_PASS'});
 const before=await compileHandoff(ledger,'s','main',{budget:2048});assert.match(before.text,/AGENT REPORT, UNVERIFIED/);assert.doesNotMatch(before.text,/VERIFIED RESULTS\n/);
 await writeFile(path.join(root,'a.ts'),'b');assert.equal((await compileHandoff(ledger,'s','main',{budget:2048})).status,'STALE_EVIDENCE');
 const e=ledger.list('s','main')[0]!;await unlink(path.join(root,'.context-engine/lifecycle/blobs',e.blobSha256));const missing=await compileHandoff(ledger,'s','main',{budget:2048});assert.ok(missing.issues.includes('MISSING_EVIDENCE'));assert.equal(missing.safeToCompact,false);
 }finally{ledger.close();}
});
test('v06 projection full bodies require exact fresh content; summary references and restart are distinct',async()=>{
 const {root,ledger}=await fixture();try{
 const text='export const a=1;\n';await writeFile(path.join(root,'a.ts'),text);const source={path:'a.ts',sha256:sha256(text)},id=sha256('a');
 const projection=new ContextProjection(ledger,'s','main'),observation={evidenceId:id,presence:'FULL_BODY' as const,source,text,bodySha256:sha256(text)};
 assert.equal((await projection.observe(JSON.stringify({text}),[observation],'model','pre-provider')).evidence[0]?.presence,'FULL_BODY');assert.equal(projection.snapshot().delivery,'UNKNOWN');
 assert.equal((await projection.observe('a.ts reference',[observation],'model','pre-context')).evidence[0]?.presence,'UNKNOWN');
 await projection.observe(text,[observation],'model','pre-context');assert.equal(projection.compacted('event:'+id).evidence[0]?.presence,'REFERENCE_ONLY');
 assert.equal(projection.compacted('summary without original').evidence[0]?.presence,'OMITTED');assert.equal(new ContextProjection(ledger,'s','main').snapshot().evidence[0]?.presence,'UNKNOWN');
 await writeFile(path.join(root,'a.ts'),'changed');assert.equal((await projection.observe(text,[observation],'model','pre-context')).evidence[0]?.presence,'OMITTED');
 }finally{ledger.close();}
});
test('v06 retention does not delete blobs shared with another session',async()=>{
 const {ledger}=await fixture();try{const event=await ledger.append('s','main',{externalId:'a',kind:'MESSAGE',origin:'user',text:'shared',timestamp:'2020-01-01T00:00:00Z'});ledger.branch('other','main');const other=await ledger.append('other','main',{externalId:'b',kind:'MESSAGE',origin:'user',text:'shared'});await ledger.expireBefore('s','main','2025-01-01T00:00:00Z');assert.equal((await ledger.original('other','main',other.id)).text,'shared');assert.equal((await ledger.original('s','main',event.id)).text,'shared');}finally{ledger.close();}
});
