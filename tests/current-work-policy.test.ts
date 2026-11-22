import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine,parseConfig} from '../packages/core/src/index.ts';
import {currentWork,presentCurrentWork,type CurrentWorkDiagnostic} from '../packages/core/src/lifecycle/current-work.ts';
import {sha256} from '../packages/core/src/workspace.ts';
const state={verification:'CURRENT_BINDING_REVALIDATED',requirements:[{id:'tenant',status:'NOT_CHECKED'}],checks:[],approvedVerification:{status:'AVAILABLE',checks:[{id:'public-check'}]}};
test('current work policy retains state in all modes and exposes shadow recommendation only to host callback',()=>{
 const full=currentWork(state,null),{next_action,...facts}=full;
 for(const mode of ['off','observe','assist'] as const){
  const seen:CurrentWorkDiagnostic[]=[];
  const result=presentCurrentWork(state,null,{stateProjection:true,actionRecommendation:mode},view=>seen.push(view));
  assert.deepEqual(result,mode==='assist'?full:facts);
  assert.deepEqual(seen,[{mode,includedInProjection:mode==='assist',providerDelivery:'UNKNOWN',recommendation:mode==='off'?null:next_action,projectionSha256:sha256(JSON.stringify(result))}]);
 }
 assert.doesNotThrow(()=>presentCurrentWork(state,null,{stateProjection:true,actionRecommendation:'observe'},()=>{throw Error('Observer unavailable');}));
});
test('current work configuration preserves existing defaults and rejects unsupported policies',()=>{
 assert.deepEqual(parseConfig().lifecycle.currentWorkPolicy,{stateProjection:true,actionRecommendation:'assist'});
 assert.equal(parseConfig().mode,'observe-only');assert.equal(parseConfig().lifecycle.enabled,false);
 for(const patch of [{stateProjection:false},{actionRecommendation:'automatic'},{unknown:true}])assert.throws(()=>parseConfig({lifecycle:{currentWorkPolicy:patch}}));
});
test('observe recovery never serializes shadow next_action in task state, full recovery or Ledger',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cce-cws-policy-'));await writeFile(path.join(root,'model.ts'),'export const tenant=1;\n');
 const contract={id:'task',source:'user' as const,text:'Keep tenant isolation.',requirements:[{id:'tenant',clause:'Keep tenant isolation.',needs:[],checks:[]}]};
 const engine=await ContextEngine.open(root,{sessionId:'policy',taskContract:contract,config:{mode:'assist',quality:{coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,recoveryPolicy:'verified-state',currentWorkPolicy:{actionRecommendation:'observe'}}}});t.after(()=>engine.close());
 const life=engine.lifecycle!;await life.userRequirement('goal','Continue CRM');
 const diagnostics:CurrentWorkDiagnostic[]=[];
 const compile=await life.recoveryCompiler(undefined,'IN_LOOP',view=>diagnostics.push(view));
 const recovery=await compile(12000);
 assert.equal(diagnostics.length,1);assert.ok(diagnostics[0]?.recommendation);
 assert.equal(JSON.stringify(await life.taskState()).includes('next_action'),false);
 assert.equal(JSON.stringify(recovery).includes('next_action'),false);
 for(const event of life.ledger.list('policy','main',{limit:1024}))assert.equal((await life.ledger.original('policy','main',event.id)).text.includes('derived_recommendation'),false);
});
