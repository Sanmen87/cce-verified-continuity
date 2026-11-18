import test from 'node:test';
import assert from 'node:assert/strict';
import {contextBudget,recoveryBudget} from '../packages/pi-extension/src/budget.ts';
import {parseConfig,ContextEngine} from '../packages/core/src/index.ts';
import {registerLifecycle} from '../packages/pi-extension/src/lifecycle.ts';
import {fixture} from './helpers.ts';
import type {ExtensionAPI,ExtensionToolContext} from '@earendil-works/pi-coding-agent';

function harness(){
 const usage={input:25837,output:111,cacheRead:0,cacheWrite:0,totalTokens:25948,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const assistant={role:'assistant',content:[{type:'text',text:'Locate earlier requirements.'}],model:'local',usage,stopReason:'toolUse',timestamp:2,diagnostics:[{opaque:'x'.repeat(90000)}]};
 const fresh={type:'message',id:'fresh',parentId:'cut',timestamp:'2026-01-01T00:00:02Z',message:assistant};
 const branch:any[]=[{type:'compaction',id:'cut',parentId:null,timestamp:'2026-01-01T00:00:01Z'},fresh];
 const projection={messages:[assistant],entries:[{sourceEntry:fresh,messages:[assistant]}]};
 const pi={getActiveTools:()=>['cce_history'],getAllTools:()=>[{name:'cce_history',description:'Find history'}]} as unknown as ExtensionAPI;
 const ctx={model:{id:'local',contextWindow:65536,maxTokens:16384},getContextUsage:()=>({tokens:26000,contextWindow:65536,percent:40}),getSystemPrompt:()=> 'SYSTEM',sessionManager:{buildSessionProjection:()=>projection,getBranch:()=>branch}} as unknown as ExtensionToolContext;
 return {pi,ctx,branch,projection,assistant};
}

test('budget fix uses current Pi provider anchor instead of raw metadata byte inflation',()=>{
 const h=harness(),before=JSON.stringify(h.projection),result=contextBudget(h.pi,h.ctx,parseConfig(),2048);
 assert.ok(result.historyTokens>100000);assert.equal(result.source,'pi-usage');assert.equal(result.anchorVerified,true);assert.equal(result.occupiedTokens,26000);assert.equal(result.textBudget,2048);assert.equal(JSON.stringify(h.projection),before);
});

test('cold post-compaction recovery can use the matching host model tokenizer without reviving a stale provider anchor',async()=>{
 const h=harness(),config=parseConfig(),before=JSON.stringify(h.projection);h.branch.push({type:'compaction',id:'new-cut'});
 assert.equal(contextBudget(h.pi,h.ctx,config,2048).textBudget,0);
 const counter={source:'model-tokenizer' as const,modelId:'local',count:(text:string)=>Math.ceil(text.length/4)};
 const budget=await recoveryBudget(h.pi,h.ctx,config,2048,counter);
 assert.equal(budget.source,'model-tokenizer');assert.equal(budget.anchorVerified,false);assert.equal(budget.textBudget,2048);
 assert.ok(budget.occupiedTokens+budget.outputReserveTokens+budget.envelopeTokens+budget.textBudget<=budget.windowTokens);
 assert.equal(JSON.stringify(h.projection),before);
 h.ctx.model={...h.ctx.model!,maxTokens:60000};assert.equal((await recoveryBudget(h.pi,h.ctx,config,2048,counter)).textBudget,0);
});

test('recovery token accounting retains byte guard for missing, mismatched, invalid and failed counters',async()=>{
 const h=harness(),config=parseConfig();h.branch.push({type:'compaction',id:'new-cut'});
 const counter={source:'model-tokenizer' as const,modelId:'local',count:async()=>{throw Error('Tokenizer offline');}};
 for(const candidate of [undefined,counter,{...counter,modelId:'other'},{...counter,count:()=>NaN},{...counter,count:()=>0}]){
  const budget=await recoveryBudget(h.pi,h.ctx,config,2048,candidate);assert.equal(budget.source,'estimated');assert.equal(budget.textBudget,0);
 }
 const changing={...counter,count:(text:string)=>{h.projection.messages.push({...h.assistant,diagnostics:[]});return Math.ceil(text.length/4);}};
 assert.equal((await recoveryBudget(h.pi,h.ctx,config,2048,changing)).source,'estimated');
});

test('valid live provider anchors remain fallback when current-packet tokenizer is unavailable',async()=>{
 const h=harness();let counts=0;const budget=await recoveryBudget(h.pi,h.ctx,parseConfig(),2048,{source:'model-tokenizer',modelId:'local',count:()=>{counts++;throw Error('Tokenizer unavailable');}});
 assert.equal(budget.source,'pi-usage');assert.equal(budget.occupiedTokens,26000);assert.equal(counts,1);
});

test('budget fix still rejects real full windows, smaller model windows and larger native output reserves',()=>{
 const h=harness(),config=parseConfig();h.ctx.getContextUsage=()=>({tokens:48000,contextWindow:65536,percent:74});assert.equal(contextBudget(h.pi,h.ctx,config,2048).textBudget,0);
 h.ctx.getContextUsage=()=>({tokens:26000,contextWindow:65536,percent:40});h.ctx.model={...h.ctx.model!,contextWindow:40000};assert.equal(contextBudget(h.pi,h.ctx,config,2048).textBudget,0);
 h.ctx.model={...h.ctx.model!,contextWindow:65536,maxTokens:60000};assert.equal(contextBudget(h.pi,h.ctx,config,2048).textBudget,0);assert.equal(h.ctx.model.maxTokens,60000);
 h.ctx.model={...h.ctx.model!,maxTokens:16384};assert.equal(contextBudget(h.pi,h.ctx,config,2048,'x'.repeat(20000)).textBudget,0);
});

test('budget fix refuses stale anchors after compaction/edit, model changes and inconsistent usage',()=>{
 for(const kind of ['compaction','context_edit']){const h=harness();h.branch.push({type:kind,id:'later',parentId:'fresh',timestamp:'2026-01-01T00:00:03Z'});const b=contextBudget(h.pi,h.ctx,parseConfig(),2048);assert.equal(b.anchorVerified,false);assert.equal(b.textBudget,0);}
 const h=harness();h.ctx.model={...h.ctx.model!,id:'different'};assert.equal(contextBudget(h.pi,h.ctx,parseConfig(),2048).textBudget,0);
 h.ctx.model={...h.ctx.model!,id:'local'};h.ctx.getContextUsage=()=>({tokens:100,contextWindow:65536,percent:1});assert.equal(contextBudget(h.pi,h.ctx,parseConfig(),2048).anchorVerified,false);
 h.ctx.getContextUsage=()=>({tokens:26000,contextWindow:65536,percent:40});h.assistant.usage.totalTokens=1;assert.equal(contextBudget(h.pi,h.ctx,parseConfig(),2048).anchorVerified,false);h.assistant.usage.totalTokens=25948;
 h.projection.entries=[];assert.equal(contextBudget(h.pi,h.ctx,parseConfig(),2048).anchorVerified,false);
});

test('budget fix includes Pi trailing context growth and retains unknown-state fail-closed behavior',()=>{
 const h=harness();h.ctx.getContextUsage=()=>({tokens:50000,contextWindow:65536,percent:77});assert.equal(contextBudget(h.pi,h.ctx,parseConfig(),2048).textBudget,0);
 h.ctx.getContextUsage=()=>({tokens:null,contextWindow:65536,percent:null});h.ctx.sessionManager.buildSessionProjection=()=>{throw Error('unknown projection');};const b=contextBudget(h.pi,h.ctx,parseConfig(),2048);assert.equal(b.historyKnown,false);assert.equal(b.textBudget,0);
});

test('budget fix independently bounds unmeasured trailing tool data without double-counting Pi tail estimates',()=>{
 const h=harness(),projection={...h.projection,messages:[...h.projection.messages,{role:'toolResult',toolCallId:'parallel',toolName:'read',content:[{type:'text',text:'new source'}],isError:false,timestamp:3}]};
 h.ctx.sessionManager.buildSessionProjection=()=>projection as unknown as ReturnType<ExtensionToolContext['sessionManager']['buildSessionProjection']>;
 let b=contextBudget(h.pi,h.ctx,parseConfig(),2048);assert.equal(b.anchorVerified,true);assert.ok(b.anchoredTrailingTokens!>0);assert.ok(b.occupiedTokens>25948);
 h.ctx.getContextUsage=()=>({tokens:30000,contextWindow:65536,percent:46});b=contextBudget(h.pi,h.ctx,parseConfig(),2048);assert.equal(b.occupiedTokens,30000);
 const tail=projection.messages.at(-1)! as {content:Array<{text:string}>};tail.content[0]!.text='x'.repeat(50000);b=contextBudget(h.pi,h.ctx,parseConfig(),2048);assert.equal(b.textBudget,0);assert.ok(b.occupiedTokens>65536);
});

test('budget fix history calls return bounded data and distinguish unknown from exhausted refusals',async t=>{
 const root=await fixture(t),engine=await ContextEngine.open(root,{sessionId:'budget-test',config:{mode:'assist',lifecycle:{enabled:true,ledgerEnabled:true,historyRecallEnabled:true}}});t.after(()=>engine.close());
 await engine.lifecycle!.userRequirement('original','Tenant identity comes from trusted benchmark headers.');
 const h=harness(),tools=new Map<string,any>();h.pi.registerTool=tool=>{tools.set(tool.name,tool);};h.pi.registerCommand=()=>{};h.pi.on=(()=>()=>{}) as ExtensionAPI['on'];
 registerLifecycle(h.pi,async()=>engine,{exposure:'direct'});
 const call=()=>tools.get('cce_history').execute('recall',{level:'search',query:'tenant'},undefined,undefined,h.ctx);
 const found=await call();assert.notEqual(found.isError,true);assert.match(JSON.stringify(found),/FOUND/);assert.equal(found.details.sessionBudget.source,'pi-usage');assert.ok(Buffer.byteLength(found.content[0].text)*1.25<=found.details.budget);
 h.ctx.getContextUsage=()=>({tokens:65000,contextWindow:65536,percent:99});const full=await call();assert.equal(full.isError,true);assert.equal(JSON.parse(full.content[0].text).code,'SESSION_BUDGET_EXHAUSTED');assert.equal(full.details.sessionBudget.textBudget,0);
 h.ctx.getContextUsage=()=>undefined;h.ctx.sessionManager.buildSessionProjection=()=>{throw Error('unknown');};const unknown=await call();assert.equal(unknown.isError,true);assert.equal(JSON.parse(unknown.content[0].text).code,'SESSION_BUDGET_UNKNOWN');
});
