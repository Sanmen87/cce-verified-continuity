import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine,sha256} from '../packages/core/src/index.ts';
import {inspectRecoveryPacket,type RecoveryRequirement} from '../packages/core/src/lifecycle/recovery-integrity.ts';
import {registerLifecycle,type RecoveryDiagnostic} from '../packages/pi-extension/src/lifecycle.ts';
import {openAICompletionsApi,normalizeContext} from '@earendil-works/pi-ai/compat';
import type {ExtensionAPI,ExtensionToolContext,SessionEntry} from '@earendil-works/pi-coding-agent';
const clause='Preserve tenant isolation.';
const contract={id:'integrity',source:'user' as const,text:clause,requirements:[{id:'tenant',clause,needs:[],checks:[]}]};
const required:RecoveryRequirement[]=[{eventId:'goal',sha256:sha256(clause),text:clause}];
const model={api:'openai-completions' as const,provider:'fixture',baseUrl:'http://127.0.0.1:1/v1',id:'fixture-model',name:'No model',reasoning:false,input:['text' as const],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:65536,maxTokens:16384};
async function harness(t:test.TestContext){
 const root=await mkdtemp(path.join(tmpdir(),'cce-recovery-integrity-'));await writeFile(path.join(root,'access.py'),'allowed=True\n');
 const engine=await ContextEngine.open(root,{sessionId:'integrity',taskContract:contract,config:{mode:'assist',quality:{coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,recoveryPolicy:'verified-state',handoffBudgetTokens:12000}}});
 t.after(async()=>{engine.close();await rm(root,{recursive:true,force:true});});
 const handlers=new Map<string,(event:any,ctx:any)=>any>(),audits:RecoveryDiagnostic[]=[];
 const pi={on:(name:string,fn:any)=>handlers.set(name,fn),registerTool:()=>{},registerCommand:()=>{},getActiveTools:()=>[],getAllTools:()=>[]} as unknown as ExtensionAPI;
 const branch=[{type:'message',id:'goal',parentId:null,timestamp:new Date(0).toISOString(),message:{role:'user',content:clause,timestamp:0}}] as SessionEntry[];
 let known=true;
 const ctx={cwd:root,hasUI:false,model:{...model},getSystemPrompt:()=> 'HOST',getContextUsage:()=>known?{tokens:1000,contextWindow:65536}:undefined,
  sessionManager:{getSessionId:()=>engine.sessionId,getBranch:()=>branch,getLeafId:()=> 'goal',buildSessionProjection:()=>{if(!known)throw Error('Unknown projection');return{messages:[],entries:[]};}}} as unknown as ExtensionToolContext;
 registerLifecycle(pi,async()=>engine,{exposure:'direct',onRecoveryDiagnostic:d=>audits.push(d)});
 const emit=async(name:string,event:any)=>handlers.get(name)?.(event,ctx);
 return{engine,ctx,audits,emit,known:(value:boolean)=>{known=value;}};
}
test('packet inspection excludes tool echoes, assistant claims, metadata and unsupported shapes',()=>{
 const attempt={status:'COMPLETE',text:'recovery: '+clause,coverage:'FULL'};
 assert.equal(inspectRecoveryPacket({messages:[{role:'user',content:attempt.text}]},required,attempt).status,'PRESENT_AT_INSPECTION');
 for(const role of ['tool','assistant'])assert.equal(inspectRecoveryPacket({messages:[{role,content:attempt.text}],metadata:attempt.text},required,attempt).requirements[0]!.presence,'MISSING');
 assert.equal(inspectRecoveryPacket({input:attempt.text},required,attempt).status,'DEGRADED');
 assert.equal(inspectRecoveryPacket({messages:[]},required).status,'DEGRADED');
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
