import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine,sha256} from '../packages/core/src/index.ts';
import {registerCce} from '../packages/pi-extension/src/index.ts';
import {registerLifecycle,RECOVERY_ROUTING_POLICY} from '../packages/pi-extension/src/lifecycle.ts';
import type {LifecycleDiagnostic} from '../packages/pi-extension/src/lifecycle-diagnostics.ts';
import type {ExtensionAPI,ExtensionToolContext} from '@earendil-works/pi-coding-agent';

test('fix1 checkpoints canonicalize allowed absolute paths; reject external, traversal, excluded, stale evidence',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-fix1-path-')),outside=await mkdtemp(path.join(tmpdir(),'cce-fix1-outside-'));await writeFile(path.join(root,'a.ts'),'export const a=1;');await writeFile(path.join(outside,'outside.ts'),'canary');await writeFile(path.join(root,'.env'),'secret');
 const cce=await ContextEngine.open(root);t.after(()=>cce.close());const input={taskId:'absolute',goal:'Check',completed:[{description:'Observed file',evidence:[{type:'file' as const,path:path.join(root,'a.ts'),sha256:sha256('export const a=1;')}]}],pending:[],testResults:[]},before=JSON.stringify(input);
 const checkpoint=await cce.saveCheckpoint(input);assert.equal(checkpoint.completed[0]!.evidence[0]!.path,'a.ts');assert.equal(JSON.stringify(input),before);
 assert.ok(!(await cce.loadCheckpoint('absolute'))?.warnings.some(w=>w.startsWith('File changed:')));
 const save=(p:string,hash=input.completed[0]!.evidence[0]!.sha256)=>cce.saveCheckpoint({...input,completed:[{description:'Observed',evidence:[{type:'file',path:p,sha256:hash}]}]});
 await assert.rejects(save(path.join(outside,'outside.ts')),/outside this workspace/);await assert.rejects(save(root+'/../a.ts'),/traversal/);await assert.rejects(save('\\\\server\\share\\a.ts'),/UNC/);await assert.rejects(save('.env'),/non-excluded/);await assert.rejects(save('a.ts','0'.repeat(64)),/Stale/);
 await symlink(outside,path.join(root,'escape'),process.platform==='win32'?'junction':'dir');await assert.rejects(save(path.join(root,'escape/outside.ts')));
});
test('fix1 Pi checkpoint failures expose actionable safe codes and isError=true',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-fix1-tool-'));await writeFile(path.join(root,'a.ts'),'source');
 const tools=new Map<string,any>(),handlers=new Map<string,any>();const pi={registerTool:(d:any)=>tools.set(d.name,d),registerCommand:()=>{},on:(n:string,h:any)=>handlers.set(n,h)} as unknown as ExtensionAPI;
 const ctx={cwd:root,hasUI:false,sessionManager:{getSessionId:()=> 'test'}} as unknown as ExtensionToolContext;registerCce(pi);t.after(()=>handlers.get('session_shutdown')?.({},ctx));
 const input={taskId:'one',goal:'Check',completed:[{description:'Observed',evidence:[{type:'file',path:path.join(root,'a.ts'),sha256:'0'.repeat(64)}]}],pending:[],testResults:[]};
 const result=await tools.get('cce_save_checkpoint').execute('x',input,undefined,undefined,ctx);assert.equal(result.isError,true);assert.match(JSON.stringify(result),/STALE_FILE_HASH/);assert.doesNotMatch(JSON.stringify(result),new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
async function lifecycleHarness(policy='legacy',mode='assist',budget=4096,counter?:{source:'model-tokenizer';modelId:string;count:(text:string)=>number}){
 const root=await mkdtemp(path.join(tmpdir(),'cce-fix1-life-'));await writeFile(path.join(root,'a.ts'),'export const a=1;');
 const engine=await ContextEngine.open(root,{sessionId:'test',config:{mode,lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,capabilityContractEnabled:true,historyRecallEnabled:true,compactionMode:'deterministic',recoveryPolicy:policy,handoffBudgetTokens:budget}}});
 const handlers=new Map<string,any>(),tools:any[]=[],diagnostics:LifecycleDiagnostic[]=[];
 const pi={registerCommand:()=>{},registerTool:(d:any)=>tools.push(d),on:(n:string,h:any)=>handlers.set(n,h),getActiveTools:()=>['read','bash'],getAllTools:()=>[]} as unknown as ExtensionAPI;
 const ctx={cwd:root,hasUI:false,model:{id:'test-model',contextWindow:65536,maxTokens:16384},getContextUsage:()=>({tokens:1000,contextWindow:65536}),getSystemPrompt:()=> 'SYSTEM',sessionManager:{getSessionId:()=> 'test',getBranch:()=>[],getLeafId:()=>null,buildSessionProjection:()=>({messages:[]})}} as unknown as ExtensionToolContext;
 registerLifecycle(pi,async()=>engine,{exposure:mode==='assist'?'direct':'hidden',...(counter?{counter}:{}),onDiagnostic:d=>diagnostics.push(d)});
 await handlers.get('before_agent_start')({messageType:'user',prompt:'Update a.ts.',systemPrompt:'SYSTEM'},ctx);
 const compact={reason:'manual',willRetry:false,signal:new AbortController().signal,branchEntries:[{type:'message',id:'keep',parentId:null,timestamp:new Date().toISOString(),message:{role:'user',content:'Recent text.',timestamp:0}}],preparation:{firstKeptEntryId:'keep',messagesToSummarize:[],turnPrefixMessages:[],isSplitTurn:false,tokensBefore:60000,settings:{enabled:true,reserveTokens:16384,keepRecentTokens:20000},fileOps:{read:new Set(),edited:new Set()}}};
 return{engine,handlers,ctx,compact,diagnostics,emit:(n:string,e:any)=>handlers.get(n)?.(e,ctx)};
}
test('fix1 compaction emits precise tokenizer stage/cause without changing native settings',async t=>{
 const h=await lifecycleHarness('legacy','assist',4096,{source:'model-tokenizer',modelId:'test-model',count:()=>{throw new Error('backend tokenizer unavailable');}});t.after(()=>h.engine.close());const before=JSON.stringify(h.ctx.model);
 assert.equal(await h.emit('session_before_compact',h.compact),undefined);assert.equal(h.diagnostics.length,1);const d=h.diagnostics[0]!;assert.equal(d.reason,'TOKENIZER_ERROR');assert.equal(d.stage,'budget');assert.match(JSON.stringify(d.handoff),/retained-history/);assert.equal(d.error?.message,'backend tokenizer unavailable');assert.equal(JSON.stringify(h.ctx.model),before);
});
test('fix1 fallback reasons distinguish incomplete budget, cancellation, custom instructions and unknown boundary',async t=>{
 const h=await lifecycleHarness('legacy','assist',1);t.after(()=>h.engine.close());
 await h.emit('session_before_compact',h.compact);assert.equal(h.diagnostics.at(-1)?.reason,'HANDOFF_INCOMPLETE_BUDGET');
 await h.emit('session_before_compact',{...h.compact,customInstructions:'Focus on migrations'});assert.equal(h.diagnostics.at(-1)?.reason,'USER_COMPACTION_INSTRUCTIONS');
 const controller=new AbortController();controller.abort();await h.emit('session_before_compact',{...h.compact,signal:controller.signal});assert.equal(h.diagnostics.at(-1)?.reason,'CANCELLED');
 await h.emit('session_before_compact',{...h.compact,branchEntries:[]});assert.equal(h.diagnostics.at(-1)?.reason,'UNKNOWN_KEPT_BOUNDARY');
});
test('fix1 explicit policy and one bounded post-compaction hint preserve all original messages',async t=>{
 const h=await lifecycleHarness('explicit-hint');t.after(()=>h.engine.close());const prompt=await h.emit('before_agent_start',{messageType:'user',prompt:'Continue',systemPrompt:'SYSTEM'});assert.match(prompt.systemPrompt,/exact path is known/);assert.ok(prompt.systemPrompt.includes(RECOVERY_ROUTING_POLICY));
 await h.emit('session_compact',{reason:'manual',fromExtension:false,compactionEntry:{id:'compacted',summary:'Native summary',firstKeptEntryId:'keep',tokensBefore:60000}});
 const messages=Object.freeze([{role:'system',content:'SYSTEM'},{role:'assistant',content:[{type:'toolCall',id:'call',name:'read',arguments:{path:'a.ts'}}]},{role:'toolResult',toolCallId:'call',toolName:'read',content:[{type:'text',text:'body'}],isError:false,timestamp:0}]),before=JSON.stringify(messages);
 const result=await h.emit('context_with_system',{messages});assert.equal(result.messages.length,messages.length+1);assert.equal(JSON.stringify(result.messages.slice(0,-1)),before);assert.equal(JSON.stringify(messages),before);assert.match(JSON.stringify(result.messages.at(-1)),/CCE CONTEXT STATUS/);assert.equal(await h.emit('context_with_system',{messages}),undefined);
});
test('fix1 observe-only suppresses routing instructions and hints even when configured',async t=>{
 const h=await lifecycleHarness('explicit-hint','observe-only');t.after(()=>h.engine.close());assert.equal(await h.emit('before_agent_start',{messageType:'user',prompt:'Continue',systemPrompt:'SYSTEM'}),undefined);
 await h.emit('session_compact',{reason:'manual',fromExtension:false,compactionEntry:{id:'one',summary:'Summary',firstKeptEntryId:'keep',tokensBefore:60000}});assert.equal(await h.emit('context_with_system',{messages:[]}),undefined);
});
test('fix1 Pi imports preserve the raw user entry without duplicating its mandatory prompt',async t=>{
 const h=await lifecycleHarness();t.after(()=>h.engine.close());const entries=[{...h.compact.branchEntries[0],message:{role:'user',content:'Update a.ts.',timestamp:0}}];
 await h.emit('session_before_compact',{...h.compact,branchEntries:entries});const ledger=h.engine.lifecycle!.ledger,events=ledger.list('test','main');assert.equal(events.filter(e=>e.mandatory&&e.origin==='user').length,1);const raw=events.find(e=>e.messageId==='keep')!;assert.equal(raw.kind,'MESSAGE');assert.match((await ledger.original('test','main',raw.id)).text,/Update a.ts/);
});
test('fix1 current source observations supersede old hashes while keeping exact historical originals',async t=>{
 const h=await lifecycleHarness();t.after(()=>h.engine.close());const file=path.join(h.engine.workspace.root,'a.ts');
 for(const [id,text]of [['one','export const a=1;'],['two','export const a=2;']]){await writeFile(file,text!);await h.emit('tool_result',{toolName:'write',toolCallId:id,input:{path:file},content:[{type:'text',text:'written'}],details:{},isError:false});}
 const life=h.engine.lifecycle!,modified=life.ledger.facts('test','main').filter(e=>e.kind==='SOURCE_MODIFIED');assert.equal(modified.length,2);assert.equal(modified[1]!.supersedes,modified[0]!.id);assert.equal(modified[1]!.origin,'host');
 const handoff=await life.compile(12000);assert.equal(handoff.status,'COMPLETE');assert.ok(handoff.included.includes(modified[1]!.id));assert.ok(!handoff.included.includes(modified[0]!.id));assert.ok(await life.ledger.original('test','main',modified[0]!.id));assert.doesNotMatch(handoff.text,/VERIFIED_PASS/);
});
