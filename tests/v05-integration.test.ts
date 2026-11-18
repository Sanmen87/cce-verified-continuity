import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ContextEngine,parseConfig,sha256,estimateTokens} from '../packages/core/src/index.ts';
import {nativeFixture} from './native-fixtures.ts';
import {contextBudget} from '../packages/pi-extension/src/budget.ts';
import {registerCce} from '../packages/pi-extension/src/index.ts';
import type {ExplicitTaskContract} from '../packages/core/src/quality/contracts.ts';
import type {ExtensionAPI,ExtensionToolContext} from '@earendil-works/pi-coding-agent';

const task:ExplicitTaskContract={id:'codec',source:'user',text:'Implement encode.',requirements:[{id:'encode',clause:'Implement encode.',needs:[{id:'def',kind:'definition',symbol:'encode',path:'codec.ts',representation:'full',bodyRequired:true}],checks:[]}]};
test('v05 integration audits delivered TS source, expands progressively, and rejects changed SHA',async()=>{
  const root=await nativeFixture('typescript'),source='export class Codec {\n  encode(value: string) {\n    return value;\n  }\n}\n';
  await writeFile(path.join(root,'codec.ts'),source);
  const engine=await ContextEngine.open(root,{config:{retrieval:{backend:'hybrid-native'},hybrid:{enableVector:false},quality:{profile:'hybrid-quality',guardEnabled:true,coverageEnabled:true}},taskContract:task});
  try{
    const hits=(await engine.searchCode('Codec.encode')).hits;
    assert.ok(hits.some(h=>h.path==='codec.ts'));
    const built=await engine.buildContext({task:task.text,hits,tokenBudget:12000,sessionBudgetKnown:true});
    assert.equal(built.quality!.completeness,'UNVERIFIED');assert.match(built.text,/cceQuality/);assert.ok(built.estimatedTokens<=built.budget);
    const chunk=engine.native!.store.chunks().find(c=>c.path==='codec.ts'&&c.name==='encode')!;
    const request={chunkId:chunk.id,sha256:chunk.fileHash,reason:'Need the implementation of the explicit encode requirement',requirementId:'encode',budgetTokens:12000};
    const preview=await engine.quality!.expand({...request,stage:'preview'});assert.equal(preview.sources[0]!.representation,'preview');
    const full=await engine.quality!.expand({...request,stage:'definition'});assert.match((full.sources[0] as {text:string}).text,/return value/);
    assert.equal(full.estimatedTokens,estimateTokens(JSON.stringify(full),engine.config.context.tokenEstimateSafetyFactor));
    const cls=await engine.quality!.expand({...request,stage:'class'});assert.match((cls.sources[0] as {text:string}).text,/class Codec/);
    const partial=await engine.quality!.expand({...request,stage:'file',offset:1,limit:1});assert.equal(partial.truncated,true);assert.match(partial.omitted.join(''),/Explicit partial/);
    assert.equal((await engine.quality!.expand({...request,stage:'definition',budgetTokens:null})).status,'BUDGET_UNKNOWN');
    assert.equal((await engine.quality!.expand({...request,stage:'definition',budgetTokens:0})).sources.length,0);
    await engine.quality!.reportImplementation('encode',[{path:'codec.ts',sha256:sha256(source)}]);
    assert.equal(engine.quality!.tracker!.inspect(await engine.quality!.binding())[0]!.status,'IMPLEMENTED_UNVERIFIED');
    await writeFile(path.join(root,'codec.ts'),source+'// changed\n');
    await assert.rejects(engine.quality!.expand({...request,stage:'definition'}),/changed/);
    const cleaned=await engine.quality!.auditBuilt(built,true);assert.ok(!cleaned.included.some(s=>s.path==='codec.ts'));assert.match(cleaned.text,/"recommendedAction":"read-source"/);
  }finally{engine.close();}
});

test('v05 output reservation follows native model maxTokens without altering it',()=>{
  const tools:unknown[]=[],pi={getActiveTools:()=>[],getAllTools:()=>tools}as unknown as ExtensionAPI;
  const model={contextWindow:65536,maxTokens:16384};
  const ctx={model,getContextUsage:()=>({tokens:100,contextWindow:65536}),getSystemPrompt:()=>'',sessionManager:{buildSessionProjection:()=>({messages:[]})}}as unknown as ExtensionToolContext;
  const config=parseConfig();assert.equal(contextBudget(pi,ctx,config,12000).outputReserveTokens,16384);
  model.maxTokens=60000;assert.ok(contextBudget(pi,ctx,config,12000).textBudget<12000);assert.equal(model.maxTokens,60000);
});

test('v05 Pi quality tools are opt-in, leave native tools active and cannot accept PASS',async()=>{
  const root=await nativeFixture('typescript');
  for(const enabled of [false,true]){
    const tools:Parameters<ExtensionAPI['registerTool']>[0][]=[],handlers=new Map<string,(e:never,c:ExtensionToolContext)=>unknown>();
    const pi={registerTool:(v:typeof tools[number])=>tools.push(v),registerCommand:()=>{},on:(n:string,h:(e:never,c:ExtensionToolContext)=>unknown)=>handlers.set(n,h),getActiveTools:()=>['read','bash','edit','write',...tools.map(t=>t.name)],getAllTools:()=>tools}as unknown as ExtensionAPI;
    const ctx={cwd:root,hasUI:false,model:{contextWindow:65536,maxTokens:16384},getContextUsage:()=>({tokens:100,contextWindow:65536}),getSystemPrompt:()=>'',sessionManager:{getSessionId:()=>`quality-${enabled}`,buildSessionProjection:()=>({messages:[]})}}as unknown as ExtensionToolContext;
    registerCce(pi,{config:{mode:'assist',assist:{strategy:'tools-only'},retrieval:{backend:'hybrid-native'},quality:{guardEnabled:enabled,coverageEnabled:enabled}},...(enabled?{taskContract:task}:{})});
    try{
      assert.equal(tools.length,enabled?12:8);assert.ok(pi.getActiveTools().includes('read'));
      assert.ok(!tools.some(t=>t.name==='cce_run_approved_check'));
      if(enabled){
        const coverage=tools.find(t=>t.name==='cce_task_coverage')!,value=await coverage.execute('q',{},undefined,undefined,ctx);
        assert.match(JSON.stringify(value),/NOT_CHECKED/);assert.doesNotMatch(JSON.stringify(value),/VERIFIED_PASS/);
        const audit=await tools.find(t=>t.name==='cce_check_context')!.execute('q',{},undefined,undefined,ctx);assert.match(JSON.stringify(audit),/UNKNOWN/);
      }
    }finally{await handlers.get('session_shutdown')?.({}as never,ctx);}
  }
});
