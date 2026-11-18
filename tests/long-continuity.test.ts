import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {ContextEngine,parseConfig} from '../packages/core/src/index.ts';import type {ExplicitTaskContract} from '../packages/core/src/quality/contracts.ts';
import {providerPacket} from '../packages/pi-extension/src/provider-packet.ts';import {compactionBudget,prospectiveProjection,validateCompactionPacket} from '../packages/pi-extension/src/compaction-budget.ts';
import type {ExtensionAPI,ExtensionToolContext,SessionBeforeCompactEvent} from '@earendil-works/pi-coding-agent';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {compileHandoff} from '../packages/core/src/lifecycle/compiler.ts';
const contract:ExplicitTaskContract={id:'long-task',source:'user',text:'Keep tenant isolation and preserve the original data.',requirements:[{id:'tenant',clause:'Keep tenant isolation',needs:[],checks:['check']},{id:'data',clause:'preserve the original data.',needs:[],checks:['check']}]};
const config={mode:'assist',quality:{coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,historyRecallEnabled:true,recoveryPolicy:'verified-state',compactionMode:'deterministic',handoffBudgetTokens:12000}};
test('offline replay 1/2/3/7/10/20 stays bounded while original compactions and provenance remain addressable',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-long-replay-'));await writeFile(path.join(root,'access.py'),'allowed=True\n');
 const engine=await ContextEngine.open(root,{sessionId:'replay',config,taskContract:contract,verificationChecks:[{id:'check',type:'custom-approved',source:'fixed-offline-adapter',execute:async()=>({exitCode:0,diagnostic:'Offline fixture only, not independent coding acceptance',executionId:'offline'})}]});t.after(()=>engine.close());
 const life=engine.lifecycle!,goal=await life.userRequirement('goal',contract.text),samples=[];let previous:string|undefined;
 for(let cycle=1;cycle<=20;cycle++){
  const source=await engine.workspace.read('access.py',65536);
  const changed=await life.ledger.append('replay','main',{externalId:'source-'+cycle,kind:'SOURCE_MODIFIED',origin:'host',text:'Observed unchanged fixture',sources:[{path:'access.py',sha256:source.sha256}],...(previous?{supersedes:previous}:{})});previous=changed.id;
  await life.runApprovedCheck('check');
  const archived=await life.ledger.append('replay','main',{externalId:'compaction-'+cycle,kind:'COMPACTION_COMPLETED',origin:'host',text:JSON.stringify({summary:'ARCHIVED_PRIOR_HANDOFF_'+cycle+'x'.repeat(12000),simulation:true})});
  const recovered=await life.recover(12000);assert.equal(recovered.handoff?.safeToCompact,true);assert.equal(recovered.handoff?.coverage,'FULL');assert.ok(recovered.text.includes(contract.text));assert.ok(!recovered.text.includes('ARCHIVED_PRIOR_HANDOFF_'));
  assert.equal((await life.ledger.original('replay','main',archived.id)).event.id,archived.id);
  if([1,2,3,7,10,20].includes(cycle))samples.push({cycle,tokens:recovered.tokens});
 }
 assert.ok(Math.max(...samples.map(s=>s.tokens))-Math.min(...samples.map(s=>s.tokens))<512,JSON.stringify(samples));
 assert.equal((await life.ledger.original('replay','main',goal.id)).text,contract.text);
 await writeFile(path.join(root,'access.py'),'allowed=False\n');const state=await life.taskState();assert.equal(state.checks[0]?.freshness,'STALE');assert.ok(state.requirements.every(r=>r.status==='NOT_CHECKED'));
});
test('historical test floods cannot displace an active contract or become inline instructions',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-long-facts-'));await writeFile(path.join(root,'access.py'),'allowed=True\n');const engine=await ContextEngine.open(root,{sessionId:'flood',config,taskContract:contract});t.after(()=>engine.close());const life=engine.lifecycle!;
 const goal=await life.userRequirement('goal',contract.text);await life.taskContract();
 for(let n=0;n<1050;n++)await life.ledger.append('flood','main',{externalId:'test-'+n,kind:'TEST_EXECUTED',origin:'host',text:'HISTORICAL_OUTPUT_MUST_NOT_RECUR '+n});
 const recovered=await life.recover(12000);assert.equal(recovered.handoff?.coverage,'FULL');assert.ok(!recovered.text.includes('HISTORICAL_OUTPUT_MUST_NOT_RECUR'));assert.ok(recovered.text.includes(contract.text));
 assert.equal((await life.ledger.original('flood','main',goal.id)).text,contract.text);assert.ok((await life.taskState()).omittedCounts.historicalWorkingSet.TEST_EXECUTED!>1000);
});
function packetHarness(){
 const pi={getActiveTools:()=>['read'],getAllTools:()=>[{name:'read',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}}}}]} as unknown as ExtensionAPI;
 const ctx={model:{id:'local',name:'Local fixture',api:'openai-completions',provider:'lmstudio',baseUrl:'http://127.0.0.1:1234/v1',reasoning:false,input:['text'],contextWindow:65536,maxTokens:16384,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},getSystemPrompt:()=> 'SYSTEM',getContextUsage:()=>({tokens:60000,contextWindow:65536})} as unknown as ExtensionToolContext;
 const user={type:'message',id:'goal',parentId:null,timestamp:new Date(0).toISOString(),message:{role:'user',content:'Original goal',timestamp:0}};
 const keep={...user,id:'keep',parentId:'goal',message:{role:'user',content:'Retained work',timestamp:1}};
 const old={type:'compaction',id:'old',parentId:'keep',timestamp:new Date(0).toISOString(),summary:'INACTIVE_SUMMARY'.repeat(2000),firstKeptEntryId:'keep',tokensBefore:50000,fromHook:true};
 const entries=[user,keep,old,{type:'message',id:'last',parentId:'old',timestamp:new Date(0).toISOString(),message:{role:'assistant',content:[{type:'text',text:'Continued code work'}],api:'openai-completions',provider:'lmstudio',model:'local',stopReason:'stop',timestamp:2,diagnostics:[{opaque:'OPAQUE_METADATA'.repeat(3000)}]}}];
 const event={branchEntries:entries,preparation:{firstKeptEntryId:'keep',tokensBefore:60000},reason:'manual',willRetry:false,signal:new AbortController().signal} as unknown as SessionBeforeCompactEvent;
 return{pi,ctx,event};
}

test('mandatory scope overflow cannot claim FULL even when all selected originals fit',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-mandatory-limit-')),engine=await ContextEngine.open(root,{sessionId:'limit',config});t.after(()=>engine.close());const life=engine.lifecycle!;
 await life.userRequirement('goal','Preserve every mandatory requirement.');
 await life.ledger.atomic(async()=>{for(let n=0;n<1024;n++)await life.ledger.append('limit','main',{externalId:'required-'+n,kind:'USER_REQUIREMENT',origin:'user',mandatory:true,text:'Required original '+n});});
 assert.equal(life.ledger.currentFacts('limit','main').mandatoryOverflow,true);
 // Deliberately roomy fixture accounting isolates the event-count boundary from
 // token overflow: the selected subset alone must never establish full coverage.
 const handoff=await compileHandoff(life.ledger,'limit','main',{budget:65536,taskState:{fixture:'explicit mandatory event limit'},counter:{source:'estimated:utf8-bytes',count:text=>Math.ceil(Buffer.byteLength(text)/64)}});
 assert.ok(handoff.mandatory.every(e=>e.status==='PRESERVED'));
 assert.equal(handoff.coverage,'INCOMPLETE');assert.equal(handoff.safeToCompact,false);assert.ok(handoff.issues.includes('MISSING_EVIDENCE'));
});
test('official Pi prospective serializer excludes inactive summaries and raw metadata without network or history mutation',async()=>{
 const h=packetHarness(),before=JSON.stringify(h),projection=prospectiveProjection(h.event)!;assert.ok(projection.entries.some(e=>e.sourceEntry.id==='old'&&e.messages.length===0));
 const packet=await providerPacket(h.pi,h.ctx,projection.messages);assert.equal(packet.serialization,'pi-openai-completions');assert.equal(packet.networkCalls,0);assert.ok(!JSON.stringify(packet.body).includes('INACTIVE_SUMMARY'));assert.ok(!JSON.stringify(packet.body).includes('OPAQUE_METADATA'));assert.equal(JSON.stringify(h),before);
 const counter={source:'model-tokenizer' as const,modelId:'local',count:(text:string)=>Math.ceil(text.length/4)};
 const base=parseConfig({lifecycle:{recoveryReserveTokens:0}}),reserved=parseConfig({lifecycle:{recoveryReserveTokens:2048}});
 const a=await compactionBudget(h.pi,h.ctx,base,h.event,counter),b=await compactionBudget(h.pi,h.ctx,reserved,h.event,counter);assert.ok(a&&b);assert.equal(b.recoveryReserveTokens,2048);assert.equal(a.packetTokens,b.packetTokens);assert.equal(a.inactiveSummaryCount,1);
 const valid=await validateCompactionPacket(h.pi,h.ctx,h.event,'Bounded handoff',b,counter);assert.equal(valid.fits,true);
 const overflow=await validateCompactionPacket(h.pi,h.ctx,h.event,'Huge'.repeat(100000),b,counter);assert.equal(overflow.fits,false);assert.equal(overflow.reason,'POST_COMPACTION_PACKET_OVERFLOW');assert.equal(h.ctx.model?.maxTokens,16384);
});

test('prospective system and tool state matches native appendCompaction without adding a second prompt',async()=>{
 const h=packetHarness(),timestamp=new Date(0).toISOString();
 const head={type:'message',id:'system',parentId:null,timestamp,message:{role:'system',content:'TRANSCRIPT_SYSTEM_ONLY',sections:{policy:'SECTION_CURRENT'},toolsAdded:h.pi.getAllTools(),timestamp:0}};
 const delta={type:'message',id:'delta',parentId:'last',timestamp,message:{role:'system',content:'SYSTEM_DELTA_ONCE',sections:{policy:'SECTION_PATCHED'},toolsRemoved:[{name:'read'}],toolsAdded:[{name:'verify',description:'Approved check',parameters:{type:'object',properties:{}}}],timestamp:1}};
 const entries=[head,...h.event.branchEntries.map((e,i)=>e.type==='compaction'?{...e,systemMessage:head.message}:i===0?{...e,parentId:'system'}:e),delta] as unknown as SessionBeforeCompactEvent['branchEntries'];
 const event={...h.event,branchEntries:entries};
 const manager=SessionManager.inMemory('/fixture',{},entries);
 manager.appendCompaction('Current handoff',event.preparation.firstKeptEntryId,event.preparation.tokensBefore,undefined,true);
 const native=await providerPacket(h.pi,h.ctx,manager.buildSessionProjection().messages);
 const future=await providerPacket(h.pi,h.ctx,prospectiveProjection(event,'Current handoff')!.messages);
 assert.deepEqual(future.body,native.body);
 const serialized=JSON.stringify(future.body);
 assert.equal(serialized.split('TRANSCRIPT_SYSTEM_ONLY').length-1,1);
 assert.equal(serialized.split('SYSTEM_DELTA_ONCE').length-1,1);
 assert.ok(serialized.includes('SECTION_PATCHED'));assert.ok(!serialized.includes('SECTION_CURRENT'));
 assert.ok(serialized.includes('verify'));assert.ok(!serialized.includes('"name":"read"'));
 assert.equal(future.networkCalls,0);
});

test('a genuinely oversized retained tool turn exhausts capacity without dropping the tool pair',async()=>{
 const h=packetHarness(),timestamp=new Date(0).toISOString(),large='CURRENT_RETAINED_SOURCE '.repeat(16000);
 const call={type:'message',id:'large-call',parentId:'last',timestamp,message:{role:'assistant',content:[{type:'toolCall',id:'retained-read',name:'read',arguments:{path:'large.py'}}],api:'openai-completions',provider:'lmstudio',model:'local',stopReason:'toolUse',timestamp:3}};
 const result={type:'message',id:'large-result',parentId:'large-call',timestamp,message:{role:'toolResult',toolCallId:'retained-read',toolName:'read',content:[{type:'text',text:large}],isError:false,timestamp:4}};
 const event={...h.event,branchEntries:[...h.event.branchEntries,call,result]} as unknown as SessionBeforeCompactEvent,before=JSON.stringify(event);
 const counter={source:'model-tokenizer' as const,modelId:'local',count:(text:string)=>Math.ceil(text.length/4)};
 const budget=await compactionBudget(h.pi,h.ctx,parseConfig({lifecycle:{recoveryReserveTokens:2048}}),event,counter);assert.ok(budget);assert.equal(budget.textBudget,0);
 const fit=await validateCompactionPacket(h.pi,h.ctx,event,'Small recovery cannot shrink a retained turn.',budget,counter);assert.equal(fit.fits,false);
 const projected=prospectiveProjection(event)!;assert.ok(projected.messages.some(m=>m.role==='toolResult'&&m.toolCallId==='retained-read'));assert.ok(JSON.stringify(projected.messages).includes('CURRENT_RETAINED_SOURCE'));assert.equal(JSON.stringify(event),before);
});
