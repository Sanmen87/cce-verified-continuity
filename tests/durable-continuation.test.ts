import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {fixture} from './helpers.ts';import {ContextEngine} from '../packages/core/src/index.ts';import type {ExplicitTaskContract} from '../packages/core/src/quality/contracts.ts';
import {inspectRecoveryPacket} from '../packages/core/src/lifecycle/recovery-integrity.ts';
import {providerPacket} from '../packages/pi-extension/src/provider-packet.ts';
import type {ExtensionAPI,ExtensionToolContext} from '@earendil-works/pi-coding-agent';
const contract:ExplicitTaskContract={id:'crm-task',source:'user',text:'Preserve tenant isolation.',requirements:[{id:'tenant',clause:'Preserve tenant isolation.',needs:[{id:'models',kind:'source',path:'crm/models.py',representation:'full'}],checks:['check']}]};
const config={mode:'assist',quality:{coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,historyRecallEnabled:true,recoveryPolicy:'verified-state',handoffBudgetTokens:12000}};
const check={id:'check',type:'custom-approved' as const,source:'trusted-unit-adapter',execute:async()=>({exitCode:0,diagnostic:'Actual fixed host adapter',executionId:'fixed-check'})};
async function session(root:string,id:string,task?:ExplicitTaskContract){return ContextEngine.open(root,{sessionId:id,config,...(task?{taskContract:task}:{}),verificationChecks:[check]});}
async function seed(root:string){const a=await session(root,'A',contract),life=a.lifecycle!;await life.userRequirement('goal',contract.text);const observed=await a.workspace.read('crm/models.py',65536);await life.ledger.append('A','main',{externalId:'write',kind:'SOURCE_MODIFIED',origin:'host',text:'Observed source change, not correctness',sources:[{path:'crm/models.py',sha256:observed.sha256}]});await life.runApprovedCheck('check');return{a,handle:await life.saveContinuation(contract.id)};}

test('durable A→clean B reuses original contract version, reads back checkpoint and never restores serialized PASS',async t=>{
 const root=await fixture(t),{a,handle}=await seed(root),revision=(await a.lifecycle!.taskState()).contract!.revisionId;
 assert.equal((await a.lifecycle!.taskState()).requirements[0]!.status,'VERIFIED_PASS');a.close();
 const b=await session(root,'B');t.after(()=>b.close());assert.equal((await b.lifecycle!.taskState()).requirements.length,0);
 const startup=await b.lifecycle!.restoreContinuation(handle);assert.ok(startup);assert.equal(startup.contractRevisionId,revision);assert.equal(startup.receiptAuthority,'HISTORICAL_ONLY_RECHECK_REQUIRED');
 let state=await b.lifecycle!.taskState();assert.equal(state.contract!.revisionId,revision);assert.equal(state.requirements[0]!.status,'NOT_CHECKED');assert.equal(state.checks.length,0);assert.equal(state.completion,'UNKNOWN');
 const recovery=await b.lifecycle!.recover(12000);assert.ok(recovery.text.includes(contract.text));
 const model={api:'openai-completions',provider:'fixture',baseUrl:'http://127.0.0.1:1/v1',id:'fixture',name:'No inference',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:65536,maxTokens:16384};
 const packet=await providerPacket({getAllTools:()=>[],getActiveTools:()=>[]} as unknown as ExtensionAPI,{model,getSystemPrompt:()=>''} as unknown as ExtensionToolContext,[{role:'user',content:recovery.text,timestamp:0}]);
 const expected=await b.lifecycle!.recoveryRequirements();const audit=inspectRecoveryPacket(packet.body,expected.required,{status:recovery.status,text:recovery.text,coverage:recovery.handoff?.coverage??'UNKNOWN'},expected.scopeComplete);
 assert.equal(audit.status,'PRESENT_AT_INSPECTION');assert.equal(audit.providerDelivery,'UNKNOWN');assert.equal(packet.networkCalls,0);
 await b.lifecycle!.runApprovedCheck('check');assert.equal((await b.lifecycle!.taskState()).requirements[0]!.status,'VERIFIED_PASS');
 await b.lifecycle!.restoreContinuation(handle);state=await b.lifecycle!.taskState();assert.equal(state.requirements[0]!.status,'VERIFIED_PASS');
});
test('outside edits between sessions stale source evidence and skip stale indexed symbols; project memory is reused',async t=>{
 const root=await fixture(t),a=await ContextEngine.open(root,{sessionId:'A',config:{...config,retrieval:{backend:'hybrid-native'},hybrid:{enableVector:false}},taskContract:contract,verificationChecks:[check]});
 await a.reindex();await a.lifecycle!.userRequirement('goal',contract.text);const handle=await a.lifecycle!.saveContinuation(contract.id),chunkCount=a.native!.store.chunkCount();a.close();
 const b=await ContextEngine.open(root,{sessionId:'B',config:{...config,retrieval:{backend:'hybrid-native'},hybrid:{enableVector:false}}});t.after(()=>b.close());
 assert.equal(b.native!.store.chunkCount(),chunkCount);let startup=await b.lifecycle!.restoreContinuation(handle);assert.ok(startup!.projectMemory.projectMap.find(f=>f.path==='crm/models.py')?.symbols.length);
 await fs.writeFile(path.join(root,'crm/models.py'),'class RenamedOutsideCCE: pass\n');startup=await b.lifecycle!.continuationState();
 assert.equal(startup!.historicalReceiptFreshness,'STALE');assert.equal(startup!.projectMemory.projectMap.find(f=>f.path==='crm/models.py')?.indexFresh,false);assert.deepEqual(startup!.projectMemory.projectMap.find(f=>f.path==='crm/models.py')?.symbols,[]);
 assert.equal((await b.lifecycle!.taskState()).requirements[0]!.status,'NOT_CHECKED');
});
test('new task/project, damaged handle and non-clean target cannot acquire old mandatory requirements',async t=>{
 const root=await fixture(t),{a,handle}=await seed(root);a.close();
 const b=await session(root,'B');t.after(()=>b.close());await assert.rejects(b.lifecycle!.restoreContinuation({...handle,sha256:'0'.repeat(64)}),/integrity/);assert.equal((await b.lifecycle!.taskState()).requirements.length,0);
 await assert.rejects(b.lifecycle!.restoreContinuation({...handle,taskId:'different-task'}),/scope/);
 const c=await session(root,'C',{...contract,id:'new-task'});t.after(()=>c.close());await assert.rejects(c.lifecycle!.restoreContinuation(handle),/another task/);
 const other=await fixture(t),d=await session(other,'D');t.after(()=>d.close());await assert.rejects(d.lifecycle!.restoreContinuation(handle),/project mismatch/);
 await b.lifecycle!.userRequirement('new','A new independent task');await assert.rejects(b.lifecycle!.restoreContinuation(handle),/clean task session/);
 const e=await session(root,'E');t.after(()=>e.close());assert.equal((await e.lifecycle!.taskState()).requirements.length,0);
});
test('expired/corrupt original refuses the whole checkpoint without partial target adoption',async t=>{
 const root=await fixture(t),{a,handle}=await seed(root),goal=a.lifecycle!.ledger.currentFacts('A','main').events.find(e=>e.kind==='USER_GOAL')!;a.close();
 const file=path.join(root,'.context-engine/lifecycle/blobs',goal.blobSha256);await fs.writeFile(file,'tampered original');
 const b=await session(root,'B');t.after(()=>b.close());await assert.rejects(b.lifecycle!.restoreContinuation(handle),/Corrupt/);assert.equal(b.lifecycle!.ledger.currentFacts('B','main').mandatoryCount,0);
});
test('atomic import rolls back metadata and denies an unrelated task reading a partial transaction',async t=>{
 const root=await fixture(t),engine=await session(root,'atomic');t.after(()=>engine.close());const ledger=engine.lifecycle!.ledger;
 await assert.rejects(ledger.atomic(async()=>{await ledger.append('atomic','main',{externalId:'partial',kind:'USER_REQUIREMENT',origin:'user',mandatory:true,text:'Must not become visible'});throw Error('Injected import failure');}),/Injected/);
 assert.equal(ledger.currentFacts('atomic','main').mandatoryCount,0);
 let release!:()=>void,entered!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
 const writing=ledger.atomic(async()=>{await ledger.append('atomic','main',{externalId:'atomic-visible',kind:'USER_REQUIREMENT',origin:'user',mandatory:true,text:'Only after commit'});entered();await pending;});
 await ready;assert.throws(()=>ledger.currentFacts('atomic','main'),/busy/);release();await writing;assert.equal(ledger.currentFacts('atomic','main').mandatoryCount,1);
});
test('separate process restart delivers bounded continuation without opening the old native transcript',async t=>{
 const root=await fixture(t),{a,handle}=await seed(root);a.close();await fs.writeFile(path.join(root,'handle.json'),JSON.stringify(handle));
 const engineUrl=pathToFileURL(path.resolve('packages/core/src/index.ts')).href;
 const program=`import fs from'node:fs/promises';import{ContextEngine}from ${JSON.stringify(engineUrl)};const root=process.argv[1];const e=await ContextEngine.open(root,{sessionId:'fresh-process-B',config:${JSON.stringify(config)}});try{await e.lifecycle.restoreContinuation(JSON.parse(await fs.readFile(root+'/handle.json','utf8')));const s=await e.lifecycle.taskState(),r=await e.lifecycle.recover(12000);process.stdout.write(JSON.stringify({requirements:s.requirements,checks:s.checks,revision:s.contract.revisionId,hasOriginal:r.text.includes('Preserve tenant isolation.'),source:s.continuation.source.sourceSessionId}));}finally{e.close();}`;
 const output=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',program,root],{windowsHide:true,timeout:30000,maxBuffer:65536});
 const restored=JSON.parse(output.stdout);assert.equal(restored.hasOriginal,true);assert.equal(restored.requirements[0].status,'NOT_CHECKED');assert.equal(restored.checks.length,0);assert.equal(restored.source,'A');assert.equal(typeof restored.revision,'string');
});
