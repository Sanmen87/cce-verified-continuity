import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine} from '../packages/core/src/index.ts';
import {registerLifecycle,CAPABILITY_INSTRUCTIONS} from '../packages/pi-extension/src/lifecycle.ts';
import type {ExtensionAPI,ExtensionToolContext,SessionEntry} from '@earendil-works/pi-coding-agent';
import type {ExplicitTaskContract} from '../packages/core/src/quality/contracts.ts';
import {handoffCapacity} from '../packages/pi-extension/src/compaction-budget.ts';
const contract:ExplicitTaskContract={id:'task',source:'user',text:'Update a.ts.',requirements:[{id:'a',clause:'Update a.ts.',needs:[{id:'source',kind:'source',path:'a.ts',representation:'full'}],checks:[]}]};
async function harness(mode:'observe-only'|'assist'='assist',sufficiency='observe',toolExposure?:'direct'|'hidden'){
 const root=await mkdtemp(path.join(tmpdir(),'cce-v06-pi-'));await writeFile(path.join(root,'a.ts'),'export const a=1;\n');
 const engine=await ContextEngine.open(root,{sessionId:'pi',taskContract:contract,config:{mode,quality:{guardEnabled:true,coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,historyRecallEnabled:true,capabilityContractEnabled:true,compactionMode:'deterministic',handoffBudgetTokens:4096,sufficiencyMode:sufficiency}}});
 const tools=new Map<string,Parameters<ExtensionAPI['registerTool']>[0]>(),handlers=new Map<string,(e:any,c:ExtensionToolContext)=>any>();
 let branch:SessionEntry[]=[],leaf:string|null=null;
 const pi={registerCommand:()=>{},registerTool:(t:Parameters<ExtensionAPI['registerTool']>[0])=>tools.set(t.name,t),on:(n:string,h:(e:any,c:ExtensionToolContext)=>any)=>handlers.set(n,h),getActiveTools:()=>['read','bash','edit','write',...tools.keys()],getAllTools:()=>[...tools.values()]} as unknown as ExtensionAPI;
 const model={id:'test-local',contextWindow:65536,maxTokens:16384};
 const ctx={cwd:root,hasUI:false,model,getContextUsage:()=>({tokens:1000,contextWindow:65536}),getSystemPrompt:()=> 'USER SYSTEM',sessionManager:{getSessionId:()=> 'pi',getBranch:()=>branch,getLeafId:()=>leaf,buildSessionProjection:()=>({messages:[]})}} as unknown as ExtensionToolContext;
 registerLifecycle(pi,async()=>engine,{exposure:toolExposure??(mode==='assist'?'direct':'hidden')});
 const emit=(n:string,e:unknown)=>handlers.get(n)?.(e,ctx);
 return{root,engine,tools,ctx,model,emit,setBranch:(b:SessionEntry[],l:string|null)=>{branch=b;leaf=l;}};
}
const preparation={firstKeptEntryId:'keep',messagesToSummarize:[],turnPrefixMessages:[],isSplitTurn:false,tokensBefore:60000,settings:{enabled:true,reserveTokens:16384,keepRecentTokens:20000},fileOps:{read:new Set(),edited:new Set()}};
const keptEntries=[{type:'message',id:'keep',parentId:null,timestamp:'2026-11-01T00:00:00Z',message:{role:'user',content:'Keep this recent message.',timestamp:0}}];
test('v06 Pi compaction keeps native cut/settings, distinguishes failure and repeated success; instructions survive',async()=>{
 const h=await harness();try{
 await h.emit('session_start',{reason:'startup'});
 const event={messageType:'user',prompt:'Update a.ts.',systemPrompt:'USER SYSTEM'};const prompt=await h.emit('before_agent_start',event);assert.equal(prompt.systemPrompt,'USER SYSTEM\n\n'+CAPABILITY_INSTRUCTIONS);
 assert.equal((await h.emit('before_agent_start',{...event,systemPrompt:prompt.systemPrompt})).systemPrompt,prompt.systemPrompt);
 const signal=new AbortController().signal;
 const custom=await h.emit('session_before_compact',{preparation,branchEntries:keptEntries,reason:'manual',willRetry:false,signal});assert.equal(custom.compaction.firstKeptEntryId,'keep');assert.equal(custom.compaction.tokensBefore,60000);assert.deepEqual(h.model,{id:'test-local',contextWindow:65536,maxTokens:16384});
 const generation=h.engine.lifecycle!.projection.snapshot().generation;
 await h.emit('session_compact_failed',{reason:'manual',aborted:true,willRetry:false,fromExtension:true});assert.equal(h.engine.lifecycle!.projection.snapshot().generation,generation);assert.equal(h.engine.lifecycle!.ledger.list('pi','main').filter(e=>e.kind==='COMPACTION_COMPLETED').length,0);
 for(const reason of ['threshold','overflow']){const next=await h.emit('session_before_compact',{preparation,branchEntries:keptEntries,reason,willRetry:reason==='overflow',signal});await h.emit('session_compact',{reason,fromExtension:true,compactionEntry:{id:reason,...next.compaction}});}
 assert.equal(h.engine.lifecycle!.projection.snapshot().generation,generation+2);assert.ok(h.tools.has('cce_expand'));assert.match((await h.emit('before_agent_start',event)).systemPrompt,/CCE CONTEXT RECOVERY/);
 assert.equal(await h.emit('session_before_compact',{preparation,branchEntries:keptEntries,reason:'manual',willRetry:false,signal,customInstructions:'Focus on failures'}),undefined);
 }finally{h.engine.close();}
});
test('v06 observe-only never changes prompt, compaction, tool results or generation settings',async()=>{
 const h=await harness('observe-only');try{
 assert.ok([...h.tools.values()].every(t=>t.exposure==='hidden'));assert.equal(await h.emit('before_agent_start',{messageType:'user',prompt:'Update a.ts.',systemPrompt:'unchanged'}),undefined);
 assert.equal(await h.emit('session_before_compact',{preparation,branchEntries:keptEntries,reason:'manual',willRetry:false,signal:new AbortController().signal}),undefined);
 assert.equal(await h.emit('tool_result',{toolName:'bash',toolCallId:'x',input:{command:'not executed'},content:[{type:'text',text:'tests failed'}],details:{exitCode:1},isError:true}),undefined);
 }finally{h.engine.close();}
});
test('v06 real tool handlers search/expand/history; guarded edits require current full projected evidence',async()=>{
 const h=await harness('assist','guarded');try{
 await h.emit('before_agent_start',{messageType:'user',prompt:'Update a.ts.',systemPrompt:''});
 const invoke=async(name:string,p:unknown)=>h.tools.get(name)!.execute('call',p,undefined,undefined,h.ctx);
 const found=await invoke('cce_search',{query:'a.ts',scope:'source',max_tokens:4096});assert.match(JSON.stringify(found),/a.ts/);
 assert.equal((await h.emit('tool_call',{toolName:'edit',input:{path:'a.ts'}})).block,true);
 assert.equal((await h.emit('tool_call',{toolName:'edit',input:{path:path.join(h.root,'a.ts')}})).block,true);
 assert.equal(await h.emit('tool_call',{toolName:'edit',input:{path:'unrelated.ts'}}),undefined);
 const expanded=await invoke('cce_expand',{path:'a.ts',max_tokens:4096});assert.match(JSON.stringify(expanded),/FULL_BODY/);
 await h.emit('context_with_system',{messages:[{role:'toolResult',content:expanded.content}]});
 assert.equal(await h.emit('tool_call',{toolName:'edit',input:{path:'a.ts'}}),undefined);
 await writeFile(path.join(h.root,'a.ts'),'export const a=2;');assert.equal((await h.emit('tool_call',{toolName:'edit',input:{path:'a.ts'}})).block,true);
 const search=await invoke('cce_history',{query:'Update',max_tokens:4096});assert.match(JSON.stringify(search),/USER_GOAL/);
 }finally{h.engine.close();}
});
test('v06 branch switch and process restart preserve cutoff; model claims never become execution receipts',async()=>{
 const h=await harness();try{
 const one={type:'message',id:'one',parentId:null,timestamp:'2026-11-01T00:00:00Z',message:{role:'user',content:'first'}} as unknown as SessionEntry;
 const two={type:'message',id:'two',parentId:'one',timestamp:'2026-11-01T00:01:00Z',message:{role:'assistant',content:[{type:'text',text:'tests passed'}]}} as unknown as SessionEntry;
 h.setBranch([one,two],'two');await h.emit('session_start',{reason:'startup'});
 const future=h.engine.lifecycle!.ledger.list('pi','main').find(e=>e.messageId==='two')!;
 h.setBranch([one],'one');await h.emit('session_tree',{});const fork=h.engine.lifecycle!.branchId;assert.notEqual(fork,'main');assert.equal(h.engine.lifecycle!.ledger.get('pi',fork,future.id),null);
 assert.equal(h.engine.lifecycle!.ledger.activeBranch('pi')?.branch,fork);
 const summary=await h.engine.lifecycle!.compile(4096);assert.doesNotMatch(summary.text,/VERIFIED RESULTS\n/);
 }finally{h.engine.close();}
});
test('v06 output externalization keeps errors native and preserves successful originals with recall IDs',async()=>{
 const h=await harness();try{
 h.engine.config.lifecycle.externalizeToolOutputs=true;h.engine.config.lifecycle.externalizeMinBytes=1024;
 const content=[{type:'text',text:'success log '.repeat(200)}];const output=await h.emit('tool_result',{toolName:'bash',toolCallId:'success',input:{command:'never executed by this harness'},content,details:{exitCode:0},isError:false});assert.match(JSON.stringify(output),/REFERENCE_ONLY/);
 const event=h.engine.lifecycle!.ledger.list('pi','main').find(e=>e.toolCallId==='success')!;assert.match((await h.engine.lifecycle!.ledger.original('pi','main',event.id)).text,/success log/);
 for(const [id,exitCode,isError,text]of [['failed',1,true,'FAILED test_permission'],['suspicious',0,false,'Traceback: Error during verification']] as const){const result=await h.emit('tool_result',{toolName:'bash',toolCallId:id,input:{command:'not executed'},content:[{type:'text',text:text+' diagnostic '.repeat(200)}],details:{exitCode},isError});assert.equal(result,undefined);}
 const payload=Object.freeze({model:'test-local',max_tokens:16384,messages:Object.freeze([{role:'user',content:'Check source'}])}),before=JSON.stringify(payload);await h.emit('before_provider_request',{payload});assert.equal(JSON.stringify(payload),before);
 const telemetry=h.engine.lifecycle!.ledger.list('pi','main').find(e=>e.title.includes('CCE_REQUEST_OBSERVATION'));assert.ok(telemetry);const data=JSON.parse((await h.engine.lifecycle!.ledger.original('pi','main',telemetry.id)).text);assert.equal(data.delivery,'UNKNOWN');assert.equal(data.providerUsage,null);assert.ok(!('messages' in data));
 }finally{h.engine.close();}
});
test('v06 failed tool diagnostics survive handoff as unresolved data, not a test receipt',async()=>{
 const h=await harness();try{
 await h.emit('before_agent_start',{messageType:'user',prompt:'Fix permissions.',systemPrompt:''});
 await h.emit('tool_result',{toolName:'bash',toolCallId:'failed-check',input:{command:'not executed'},content:[{type:'text',text:'setup\nFAILED test_permissions: expected 403, got 200\n'+('ordinary log\n'.repeat(200))}],details:{exitCode:1},isError:true});
 const compiled=await h.engine.lifecycle!.compile(12000);assert.match(compiled.text,/OPEN ISSUES/);assert.match(compiled.text,/TOOL_ERROR_OBSERVED/);assert.match(compiled.text,/test_permissions/);assert.doesNotMatch(compiled.text,/CURRENT HOST VERIFICATION VIEW/);assert.match(compiled.text,/originalEventId/);
 }finally{h.engine.close();}
});
test('v06 hidden recovery tools never advertise unavailable capabilities in auto-context-only exposure',async()=>{
 const h=await harness('assist','observe','hidden');try{assert.ok([...h.tools.values()].every(t=>t.exposure==='hidden'));assert.equal(await h.emit('before_agent_start',{messageType:'user',prompt:'Inspect source.',systemPrompt:'USER'}),undefined);}finally{h.engine.close();}
});
test('v06 prospective compaction budget supports32K/64K/128K without double output reserve',()=>{
 for(const windowTokens of [32768,65536,131072])assert.equal(handoffCapacity({windowTokens,outputReserveTokens:16384,keptTokens:8000,fixedTokens:2000,requested:65536}),Math.min(65536,windowTokens-16384-8000-2000-512));
 assert.equal(handoffCapacity({windowTokens:32768,outputReserveTokens:16384,keptTokens:20000,fixedTokens:2000,requested:4096}),0);
});
test('v06 custom compaction falls back when retained history fills the prospective window',async()=>{
 const h=await harness();try{
 await h.emit('before_agent_start',{messageType:'user',prompt:'Preserve task.',systemPrompt:'USER'});h.model.contextWindow=32768;
 const entries=[{...keptEntries[0],message:{role:'user',content:'recent context '.repeat(20000),timestamp:0}}],before=JSON.stringify(preparation.settings);
 const result=await h.emit('session_before_compact',{preparation,branchEntries:entries,reason:'overflow',willRetry:true,signal:new AbortController().signal});assert.equal(result,undefined);assert.equal(JSON.stringify(preparation.settings),before);assert.equal(h.model.maxTokens,16384);
 }finally{h.engine.close();}
});
