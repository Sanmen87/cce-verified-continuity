import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine,sha256} from '../packages/core/src/index.ts';
import {inspectRecoveryPacket,type RecoveryRequirement} from '../packages/core/src/lifecycle/recovery-integrity.ts';
import {registerLifecycle,type RecoveryDiagnostic} from '../packages/pi-extension/src/lifecycle.ts';
import type {TokenCounter} from '../packages/core/src/lifecycle/contracts.ts';
import {mandatoryTaskState} from '../packages/core/src/lifecycle/mandatory-state.ts';
import {providerPacket} from '../packages/pi-extension/src/provider-packet.ts';
import {forecastToolPressure,selectRecoveryPacket} from '../packages/pi-extension/src/recovery-packet.ts';
import type {VerifiedTaskState} from '../packages/core/src/lifecycle/mandatory-state.ts';
import type {ContextBudget} from '../packages/pi-extension/src/budget.ts';
import {recommendCompaction} from '../packages/core/src/lifecycle/compaction-plan.ts';
import {openAICompletionsApi,normalizeContext} from '@earendil-works/pi-ai/compat';
import type {ExtensionAPI,ExtensionToolContext,SessionEntry} from '@earendil-works/pi-coding-agent';
const clause='Preserve tenant isolation.';
const contract={id:'integrity',source:'user' as const,text:clause,requirements:[{id:'tenant',clause,needs:[],checks:[]}]};
const required:RecoveryRequirement[]=[{eventId:'goal',sha256:sha256(clause),text:clause}];
const model={api:'openai-completions' as const,provider:'fixture',baseUrl:'http://127.0.0.1:1/v1',id:'fixture-model',name:'No model',reasoning:false,input:['text' as const],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:65536,maxTokens:16384};
async function harness(t:test.TestContext,counter?:TokenCounter,recommendation?:'off'|'observe'|'assist'){
 const root=await mkdtemp(path.join(tmpdir(),'cce-recovery-integrity-'));await writeFile(path.join(root,'access.py'),'allowed=True\n');
 const engine=await ContextEngine.open(root,{sessionId:'integrity',taskContract:contract,config:{mode:'assist',quality:{coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,recoveryPolicy:'verified-state',handoffBudgetTokens:12000,...(recommendation?{currentWorkPolicy:{actionRecommendation:recommendation}}:{})}}});
 t.after(async()=>{engine.close();await rm(root,{recursive:true,force:true});});
 const handlers=new Map<string,(event:any,ctx:any)=>any>(),audits:RecoveryDiagnostic[]=[];
 const pi={on:(name:string,fn:any)=>handlers.set(name,fn),registerTool:()=>{},registerCommand:()=>{},getActiveTools:()=>[],getAllTools:()=>[]} as unknown as ExtensionAPI;
 const branch=[{type:'message',id:'goal',parentId:null,timestamp:new Date(0).toISOString(),message:{role:'user',content:clause,timestamp:0}}] as SessionEntry[];
 let known=true;
 const ctx={cwd:root,hasUI:false,model:{...model},getSystemPrompt:()=> 'HOST',getContextUsage:()=>known?{tokens:1000,contextWindow:65536}:undefined,
  sessionManager:{getSessionId:()=>engine.sessionId,getBranch:()=>branch,getLeafId:()=> 'goal',buildSessionProjection:()=>{if(!known)throw Error('Unknown projection');return{messages:[],entries:[]};}}} as unknown as ExtensionToolContext;
 registerLifecycle(pi,async()=>engine,{exposure:'direct',onRecoveryDiagnostic:d=>audits.push(d),...(counter?{counter}:{})});
 const emit=async(name:string,event:any)=>handlers.get(name)?.(event,ctx);
 return{engine,ctx,pi,audits,emit,known:(value:boolean)=>{known=value;}};
}
test('packet inspection excludes tool echoes, assistant claims, metadata and unsupported shapes',()=>{
 const attempt={status:'COMPLETE',text:'recovery: '+clause,coverage:'FULL'};
 assert.equal(inspectRecoveryPacket({messages:[{role:'user',content:attempt.text}]},required,attempt).status,'PRESENT_AT_INSPECTION');
 for(const role of ['tool','assistant'])assert.equal(inspectRecoveryPacket({messages:[{role,content:attempt.text}],metadata:attempt.text},required,attempt).requirements[0]!.presence,'MISSING');
 assert.equal(inspectRecoveryPacket({input:attempt.text},required,attempt).status,'DEGRADED');
 assert.equal(inspectRecoveryPacket({messages:[]},required).status,'DEGRADED');
});

test('mandatory packing resolves five shared origins and preserves the sixth explicit exception',async t=>{
 const h=await harness(t),life=h.engine.lifecycle!;
 const requirements=Array.from({length:6},(_,i)=>({id:'r'+i,clause:'Keep invariant '+i,checks:[],needs:[]}));
 const initial=await life.taskState();
 await life.confirmContract({...contract,requirements,text:requirements.map(r=>r.clause).join('\n')},{sourceEventId:'new-contract',supersedes:initial.contract!.revisionId});
 const state=await life.taskState(),event=state.contract!.eventId;
 state.requirements[5]={...state.requirements[5]!,sourceEventId:'separate-user-event'};
 const original=(await life.ledger.original(h.engine.sessionId,'main',event)).text;
 const packed=mandatoryTaskState(state,event,original)!;
 assert.deepEqual(packed.requirements.slice(0,5),state.requirements.slice(0,5).map(({id,status})=>({id,status})));
 assert.deepEqual(packed.requirements[5],state.requirements[5]);
 assert.equal(mandatoryTaskState(state,'different-event',original),null);
 const mismatch=structuredClone(state);mismatch.requirements[2]!.clause='Changed outside the original';
 assert.equal(mandatoryTaskState(mismatch,event,original),null);
});

test('malformed contract elements and requirement rows safely refuse mandatory packing',async t=>{
 const h=await harness(t),state=await h.engine.lifecycle!.taskState(),event=state.contract!.eventId;
 const original=(await h.engine.lifecycle!.ledger.original(h.engine.sessionId,'main',event)).text;
 for(const row of [null,0,{}, {id:'tenant',clause,status:42}]){
   const invalid=structuredClone(state) as VerifiedTaskState;
   invalid.requirements=[row] as unknown as VerifiedTaskState['requirements'];
   assert.equal(mandatoryTaskState(invalid,event,original),null);
   const revision=JSON.parse(original);revision.contract.requirements=[row];
   const {revisionId:_,...fields}=revision;revision.revisionId=sha256(JSON.stringify(fields));
   const aligned={...state,contract:{...state.contract!,revisionId:revision.revisionId}};
   assert.equal(mandatoryTaskState(aligned,event,JSON.stringify(revision)),null);
 }
});

test('both recovery layouts retain one snapshot when the contract changes between attempts',async t=>{
 const h=await harness(t),life=h.engine.lifecycle!;
 const before=await life.taskState(),compile=await life.recoveryCompiler();
 const first=await compile(12000);
 const updated=await life.confirmContract({...contract,text:clause+' Also keep audit history.',
   requirements:[...contract.requirements,{id:'audit',clause:'Also keep audit history.',needs:[],checks:[]}]},
   {sourceEventId:'revision-after-first-attempt',supersedes:before.contract!.revisionId});
 const second=await compile(12000,true);
 assert.equal(second.handoff!.ledgerSequence,first.handoff!.ledgerSequence);
 const packed=JSON.parse(second.text.split('TASK STATE PROJECTION\n')[1]!.split('\n')[0]!);
 assert.equal(packed.contract.revisionId,before.contract!.revisionId);
 assert.notEqual(packed.contract.revisionId,updated.revision.revisionId);
 assert.equal(packed.requirements.length,1);
 const expected=await life.recoveryRequirements();
 const audit=inspectRecoveryPacket({messages:[{role:'user',content:second.text}]},expected.required,
   {status:second.status,text:second.text,coverage:second.handoff!.coverage!},expected.scopeComplete);
 assert.equal(audit.status,'DEGRADED');assert.ok(audit.reasons.includes('MANDATORY_REQUIREMENTS_MISSING'));
});

test('adaptive recovery boundary matrix uses fixed facts across windows and controlled history occupancy',async t=>{
 const h=await harness(t),life=h.engine.lifecycle!;
 await life.userRequirement('matrix-goal',clause);
 await life.recordTool('large-observation','bash',{content:[{type:'text',text:'Historical observation '.repeat(250)}],details:{}},{},false);
 const counter:TokenCounter={source:'model-tokenizer',modelId:model.id,count:text=>Math.ceil(text.length/4)};
 const compile=await life.recoveryCompiler(counter);
 const full=await compile(12000),mandatory=await compile(12000,true);
 assert.equal(full.handoff!.taskStatePacking,'FULL');
 assert.equal(mandatory.handoff!.taskStatePacking,'MANDATORY');
 assert.ok(full.tokens>mandatory.tokens);
 const counts={FULL:0,MANDATORY:0,DEGRADED:0};let cases=0;
 for(const window of [16384,32768,65792,81920,131072]){
   const exact=window-16384-512-mandatory.tokens;
   for(const history of [...new Set([0,4000,16000,32000,48000,90000,Math.max(0,exact),Math.max(0,exact+1)])]){
     const available=Math.max(0,window-16384-history);
     const capacity:ContextBudget={windowTokens:window,outputReserveTokens:16384,availableTokens:available,
       textBudget:Math.max(0,Math.min(12000,available-2048)),historyKnown:true,source:'model-tokenizer',
       occupiedTokens:history,historyTokens:history,overheadTokens:0,envelopeTokens:2048,anchorVerified:false,anchoredTrailingTokens:null};
     const measure=async(r:Awaited<ReturnType<typeof compile>>)=>({tokens:history+r.tokens,
       serialization:'pi-openai-completions',sha256:sha256(r.text),recoveryPresent:true});
     const result=await selectRecoveryPacket(capacity,12000,compile,measure,true);
     assert.deepEqual(await selectRecoveryPacket(capacity,12000,compile,measure,true),result);
     const successful=result.recovery?.status==='COMPLETE';
     assert.equal(successful,history+mandatory.tokens+16384+512<=window);
     if(successful){
       assert.equal(result.recovery!.handoff!.coverage,'FULL');
       counts[result.recovery!.handoff!.taskStatePacking as 'FULL'|'MANDATORY']++;
     }else counts.DEGRADED++;
     cases++;
   }
 }
 assert.ok(counts.FULL>0 && counts.MANDATORY>0 && counts.DEGRADED>0);
 t.diagnostic(JSON.stringify({cases,counts,accounting:'SYNTHETIC_DETERMINISTIC_COUNTER',generationCalls:0}));
 const capacity:ContextBudget={windowTokens:65536,outputReserveTokens:16384,availableTokens:8000,textBudget:6000,
   historyKnown:true,source:'model-tokenizer',occupiedTokens:41152,historyTokens:41152,overheadTokens:0,
   envelopeTokens:2048,anchorVerified:false,anchoredTrailingTokens:null};
 const faults=[
   {measure:async()=>{throw Error('Tokenizer failed');},reason:'PACKET_MEASUREMENT_UNKNOWN'},
   {measure:async()=>({tokens:43000,serialization:'unsupported',sha256:'unused',recoveryPresent:false}),reason:'UNSUPPORTED_SERIALIZER'},
   {measure:async()=>({tokens:43000,serialization:'pi-openai-completions',sha256:'unused',recoveryPresent:false}),reason:undefined},
 ];
 for(const fault of faults){
   const result=await selectRecoveryPacket(capacity,12000,compile,fault.measure,true);
   assert.equal(result.recovery,null);
   if(fault.reason)assert.equal(result.reviewReason,fault.reason);
 }
 const estimated=await selectRecoveryPacket({...capacity,source:'estimated'},12000,compile,undefined,false);
 assert.ok(estimated.recovery?.text);assert.equal(estimated.measurement,null);
});

// Only the base-packet occupancy and packet counts are synthetic. Both message
// conversion and the outgoing body use the installed Pi serializer.
function boundaryCounter(extra:number|'unknown'=0):TokenCounter{
 return {source:'model-tokenizer',modelId:model.id,count:text=>{
   if(text.startsWith('{')){
     const body=JSON.parse(text);
     if(body.messages && body.model){
       if(body.addedByLaterHook)return 50000;
       if(!text.includes('CCE AUTOMATIC TASK RECOVERY'))return 48000;
       if(extra==='unknown')throw Error('Tokenizer unavailable for candidate');
       return 48640+extra;
     }
   }
   return Math.ceil(text.length/3);
 }};
}
test('mandatory packet review admits the exact boundary and diagnoses later payload growth',async t=>{
 const h=await harness(t,boundaryCounter());h.engine.config.context.windowTokens=65536;
 h.engine.config.context.reserveTokens=16384;
 const recovered=await h.emit('context_with_system',{messages:[]});
 assert.ok(recovered?.messages);
 const packet=await providerPacket(h.pi,h.ctx,recovered.messages);
 await h.emit('before_provider_request',{payload:packet.body});
 assert.equal(h.audits.at(-1)!.taskStatePacking,'MANDATORY');
 assert.equal(h.audits.at(-1)!.status,'PRESENT_AT_INSPECTION');
 await h.emit('before_provider_request',{payload:{...packet.body as object,addedByLaterHook:true}});
 assert.ok(h.audits.at(-1)!.reasons.includes('FINAL_PACKET_CAPACITY_EXCEEDED'));
 await h.emit('before_provider_request',{payload:{...packet.body as object,max_completion_tokens:16385}});
 assert.ok(h.audits.at(-1)!.reasons.includes('FINAL_PACKET_CAPACITY_EXCEEDED'));
});
test('next-tool pressure is a separate scenario with unknown inputs and an inclusive boundary',()=>{
 const messages=[{role:'toolResult',content:'One observation.'},{role:'user',content:'Continue.'}];
 const cost=forecastToolPressure(null,messages,1).repeatLastToolResultEstimatedTokens!;
 assert.ok(cost>0);
 assert.equal(forecastToolPressure(null,messages,1).forecast,'UNKNOWN');
 assert.equal(forecastToolPressure(0,[],1).forecast,'UNKNOWN');
 assert.equal(forecastToolPressure(cost,messages,1).forecast,'WITHIN_HEADROOM');
 assert.equal(forecastToolPressure(cost-1,messages,1).forecast,'PRESSURE');
 assert.equal(forecastToolPressure(cost-1,messages,1).certainty,'SCENARIO_ONLY');
 assert.equal(forecastToolPressure(cost-1,messages,1).source,'LAST_TOOL_RESULT_UTF8_ESTIMATE');
});

test('advisory compaction planning distinguishes current fit, future pressure and unknown components',()=>{
 const input={windowTokens:65536,outputReserveTokens:16384,safetyTokens:512,
   fixedPacketTokens:2000,mandatoryRecoveryTokens:3500,historyTokens:43000,nextActionTokens:3364,
   accounting:'model-tokenizer' as const};
 const pressure=recommendCompaction(input);
 assert.equal(pressure.packetFit,'FITS');assert.equal(pressure.continuationHeadroom,140);
 assert.equal(pressure.compactionRecommendation,'COMPACT_RECOMMENDED');
 assert.equal(pressure.targetRetainedTokens,39776);assert.equal(pressure.application,'ADVISORY_ONLY');
 assert.equal(recommendCompaction({...input,historyTokens:39776}).compactionRecommendation,'NO_COMPACTION_NEEDED');
 assert.equal(recommendCompaction({...input,nextActionTokens:null}).compactionRecommendation,'UNKNOWN');
 assert.equal(recommendCompaction({...input,mandatoryRecoveryTokens:null}).packetFit,'UNKNOWN');
 assert.equal(recommendCompaction({...input,windowTokens:16000}).compactionRecommendation,'INSUFFICIENT_CAPACITY');
 let previous=0;
 for(const windowTokens of [32768,65536,81920,131072]){
   const plan=recommendCompaction({...input,windowTokens});
   if(plan.targetRetainedTokens!==null){assert.ok(plan.targetRetainedTokens>=previous);previous=plan.targetRetainedTokens;}
 }
 assert.throws(()=>recommendCompaction({...input,historyTokens:NaN}));
});
test('mandatory packet review cannot salvage a contract larger than the explicit recovery limit',async t=>{
 const h=await harness(t,boundaryCounter());h.engine.config.context.windowTokens=65536;
 h.engine.config.lifecycle.handoffBudgetTokens=256;
 await h.engine.lifecycle!.userRequirement('long','Preserve tenant isolation. '.repeat(400));
 const result=await h.emit('context_with_system',{messages:[]});
 await h.emit('before_provider_request',{payload:{messages:result?.messages??[]}});
 assert.equal(h.audits.at(-1)!.status,'DEGRADED');
 assert.ok(h.audits.at(-1)!.reasons.length>0);
});

test('partial fallback records the rejected mandatory packet and preserves its failure reason',async t=>{
 const counter:TokenCounter={source:'model-tokenizer',modelId:model.id,count:text=>{
  if(text.startsWith('{')){
   const body=JSON.parse(text);
   if(body.messages && body.model){
    if(!text.includes('CCE AUTOMATIC TASK RECOVERY'))return 46404;
    return text.includes('MANDATORY')?48641:48000;
   }
  }
  return Math.ceil(text.length/3);
 }};
 const h=await harness(t,counter);
 h.engine.config.context.windowTokens=65536;h.engine.config.context.reserveTokens=16384;
 const result=await h.emit('context_with_system',{messages:[]});
 assert.ok(result?.messages);
 const records=h.engine.lifecycle!.ledger.search(h.engine.sessionId,'main','CCE_AUTOMATIC_RECOVERY_OBSERVATION');
 const record=JSON.parse((await h.engine.lifecycle!.ledger.original(h.engine.sessionId,'main',records.at(-1)!.id)).text);
 assert.equal(record.status,'INJECTED');
 assert.equal(record.budgetReason,'MANDATORY_PACKET_EXCEEDS_CAPACITY');
 assert.equal(record.mandatoryPacket.tokens,48641);
 assert.equal(record.mandatoryPacket.headroom,-1);
 assert.equal(record.pressure.recoveryComplete,false);
 const packet=await providerPacket(h.pi,h.ctx,result.messages);
 await h.emit('before_provider_request',{payload:packet.body});
 assert.ok(h.audits.at(-1)!.reasons.includes('MANDATORY_PACKET_EXCEEDS_CAPACITY'));
});
test('one token over capacity or an unavailable count explicitly degrades the reviewed packet',async t=>{
 for(const extra of [1,'unknown'] as const){
   const h=await harness(t,boundaryCounter(extra));h.engine.config.context.windowTokens=65536;
   h.engine.config.context.reserveTokens=16384;
   const result=await h.emit('context_with_system',{messages:[]});assert.equal(result,undefined);
   await h.emit('before_provider_request',{payload:{messages:[]}});
   const audit=h.audits.at(-1)!;assert.equal(audit.status,'DEGRADED');
   assert.ok(audit.reasons.includes(extra===1?'MANDATORY_PACKET_EXCEEDS_CAPACITY':'MANDATORY_PACKET_COUNT_UNKNOWN'));
 }
});
test('all original clauses present does not upgrade partial Task State to complete recovery',()=>{
 const text='CCE AUTOMATIC TASK RECOVERY v1\nhandoff_status=INCOMPLETE_BUDGET\n'+clause;
 const audit=inspectRecoveryPacket({messages:[{role:'user',content:text}]},required,{status:'INCOMPLETE_BUDGET',text,coverage:'INCOMPLETE',taskStatePacking:'MINIMAL'});
 assert.equal(audit.requirements[0]!.presence,'PRESENT');assert.equal(audit.status,'DEGRADED');
 assert.ok(audit.reasons.includes('INCOMPLETE_BUDGET'));assert.ok(audit.reasons.includes('RECOVERY_COVERAGE_INCOMPLETE'));
});
test('missing recovery analogous to B v2 request 8 is explicitly DEGRADED at each provider attempt',async t=>{
 const h=await harness(t);
 for(let request=0;request<2;request++)await h.emit('before_provider_request',{payload:{messages:[{role:'user',content:'Continue.'}]}});
 assert.equal(h.audits.length,2);assert.notEqual(h.audits[0]!.requestId,h.audits[1]!.requestId);
 for(const audit of h.audits){assert.equal(audit.status,'DEGRADED');assert.ok(audit.reasons.includes('NO_RECOVERY_ATTEMPT'));assert.ok(audit.reasons.includes('MANDATORY_REQUIREMENTS_MISSING'));assert.equal(audit.finalTransportVerification,'UNAVAILABLE');}
 // Recovery is initialized even if the host did not emit session_start first.
 const recovered=await h.emit('context_with_system',{messages:[]});assert.match(recovered.messages.at(-1).content,/Preserve tenant isolation/);
});
test('small and unknown capacity cannot silently report complete recovery; later capacity can recover',async t=>{
 const h=await harness(t);await h.emit('session_start',{reason:'resume'});
 for(const budget of [1,256,12000]){
  h.engine.config.lifecycle.handoffBudgetTokens=budget;
  const result=await h.emit('context_with_system',{messages:[]});
  const text=result?.messages?.at(-1)?.content??'';
  await h.emit('before_provider_request',{payload:{messages:text?[{role:'user',content:text}]:[]}});
  const audit=h.audits.at(-1)!;
  if(budget<12000){assert.equal(audit.status,'DEGRADED');assert.ok(audit.reasons.length>0);}else assert.equal(audit.status,'PRESENT_AT_INSPECTION');
 }
 h.known(false);await h.emit('context_with_system',{messages:[]});await h.emit('before_provider_request',{payload:{messages:[]}});
 assert.ok(h.audits.at(-1)!.reasons.includes('SKIPPED_BUDGET_UNKNOWN'));
});
test('last SDK-serialized transport body is inspected after all payload hooks, with downstream removal negative control',async t=>{
 const h=await harness(t);await h.emit('session_start',{reason:'resume'});
 const context=await h.emit('context_with_system',{messages:[]});
 const recovery=context.messages.at(-1).content as string;
 const expected=await h.engine.lifecycle!.recoveryRequirements();
 for(const removeAfterCce of [false,true]){
  let finalBody:unknown;
  const stream=openAICompletionsApi().stream(model,normalizeContext({messages:[{role:'user',content:recovery,timestamp:0}]}),{
   apiKey:'fixture-not-a-credential',maxRetries:0,
   onPayload:async payload=>{
    await h.emit('before_provider_request',{payload});
    return removeAfterCce?{...(payload as Record<string,unknown>),messages:[{role:'user',content:'Recovery was removed by a later extension.'}]}:payload;
   },
   fetch:async(_url,init)=>{finalBody=JSON.parse(String(init?.body));throw Error('Stopped at actual transport boundary; no network or model');},
  });
  await stream.result();assert.ok(finalBody,'Final transport was not reached');
  const final=inspectRecoveryPacket(finalBody,expected.required,{status:'COMPLETE',text:recovery,coverage:'FULL'},expected.scopeComplete);
  assert.equal(final.status,removeAfterCce?'DEGRADED':'PRESENT_AT_INSPECTION');
  if(removeAfterCce)assert.ok(final.reasons.includes('PREPARED_RECOVERY_MISSING'));
  assert.equal(h.audits.at(-1)!.finalTransportVerification,'UNAVAILABLE');assert.equal(final.providerDelivery,'UNKNOWN');
 }
});

test('off and observe omit only the current recommendation at the final SDK transport boundary while keeping contract and CWS',async t=>{
 for(const mode of ['off','observe','assist'] as const){
  const h=await harness(t,undefined,mode);await h.emit('session_start',{reason:'resume'});
  const context=await h.emit('context_with_system',{messages:[]});const recovery=context.messages.at(-1).content as string;
  let finalBody:unknown;
  const stream=openAICompletionsApi().stream(model,normalizeContext({messages:[{role:'user',content:recovery,timestamp:0}]}),{
   apiKey:'fixture-not-a-credential',maxRetries:0,
   onPayload:async payload=>{await h.emit('before_provider_request',{payload});},
   fetch:async(_url,init)=>{finalBody=JSON.parse(String(init?.body));throw Error('Captured final packet; no inference');},
  });
  await stream.result();assert.ok(finalBody);
  const text=JSON.stringify(finalBody);assert.ok(text.includes('currentWork'));assert.ok(text.includes(clause));
  assert.equal(text.includes('next_action'),mode==='assist');
  const expected=await h.engine.lifecycle!.recoveryRequirements();
  assert.equal(inspectRecoveryPacket(finalBody,expected.required,{status:'COMPLETE',text:recovery,coverage:'FULL'},expected.scopeComplete).status,'PRESENT_AT_INSPECTION');
 }
});
