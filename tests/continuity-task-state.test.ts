import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine} from '../packages/core/src/index.ts';
import {contractRevisions} from '../packages/core/src/lifecycle/task-contract.ts';
import type {ExplicitTaskContract} from '../packages/core/src/quality/contracts.ts';
const first:ExplicitTaskContract={id:'access',source:'user',text:'Preserve tenant isolation.',requirements:[{id:'isolation',clause:'Preserve tenant isolation.',needs:[],checks:['check']}]};
const second:ExplicitTaskContract={...first,text:first.text+' Reject anonymous access.',requirements:[...first.requirements,{id:'anonymous',clause:'Reject anonymous access.',needs:[],checks:['check']}]};
async function fixture(root?:string){
 const directory=root??await mkdtemp(path.join(tmpdir(),'cce-task-state-'));
 if(!root)await writeFile(path.join(directory,'access.py'),'def allowed(tenant,owner): return tenant == owner\n');
 let exitCode=0;
 const engine=await ContextEngine.open(directory,{sessionId:'session',taskContract:first,verificationChecks:[{id:'check',type:'custom-approved',source:'unit-host',execute:async()=>({exitCode,diagnostic:'Unit receipt, not independent acceptance',executionId:'unit-check'})}],config:{mode:'assist',quality:{guardEnabled:true,coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,historyRecallEnabled:true,recoveryPolicy:'verified-state',handoffBudgetTokens:8192}}});
 return{engine,life:engine.lifecycle!,root:directory,setExit:(code:number)=>{exitCode=code;}};
}
test('source IDs distinguish repeated user confirmations from repeated import across restart',async()=>{
 const h=await fixture();const one=await h.life.userRequirement('source:one',first.text,'one');
 assert.equal((await h.life.userRequirement('source:one',first.text,'one')).id,one.id);
 assert.notEqual((await h.life.userRequirement('source:two',first.text,'two')).id,one.id);
 await assert.rejects(h.life.userRequirement('source:one','Changed text','one'),/Conflicting/);
 assert.deepEqual((await h.life.taskState()).userEvents.map(e=>e.sourceEventId),['one','two']);h.engine.close();
 const restored=await fixture(h.root);try{assert.equal((await restored.life.userRequirement('source:one',first.text,'one')).id,one.id);assert.equal((await restored.life.taskState()).userEvents.length,2);}finally{restored.engine.close();}
});
test('contract revisions require an explicit predecessor, preserve originals and cannot roll back on replay',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());
 const r1=await h.life.confirmContract(first,{sourceEventId:'user:first',supersedes:null});
 const r2=await h.life.confirmContract(second,{sourceEventId:'user:second',supersedes:r1.revision.revisionId});
 assert.equal(r2.revision.supersedes,r1.revision.revisionId);assert.equal(r2.event.supersedes,r1.event.id);
 assert.match((await h.life.ledger.original('session','main',r1.event.id)).text,/Preserve tenant isolation/);
 await assert.rejects(h.life.confirmContract(first,{sourceEventId:'ambiguous',supersedes:null}),/current revision/);
 await assert.rejects(h.life.confirmContract({...first,source:'agent' as any},{sourceEventId:'model',supersedes:r2.revision.revisionId}),/Only explicit/);
 await h.life.confirmContract(first,{sourceEventId:'user:first',supersedes:null});assert.deepEqual(h.engine.quality!.tracker!.contract,second);
 const r3=await h.life.confirmContract(second,{sourceEventId:'reconfirmed',supersedes:r2.revision.revisionId});
 assert.notEqual(r3.revision.revisionId,r2.revision.revisionId);assert.equal((await contractRevisions(h.life.ledger,'session','main')).length,3);
});
test('silent configured replacements and model-authored revisions cannot change active requirements',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());await h.life.taskContract();
 h.engine.quality!.setContract(second);await assert.rejects(h.life.taskState(),/Explicit contract revision/);h.engine.quality!.setContract(first);
 await h.life.ledger.append('session','main',{externalId:'model',kind:'TASK_CONTRACT',origin:'agent',text:'Cancel requirements'});
 assert.equal((await h.life.taskState()).requirements.length,1);
});
test('state preserves provenance, unresolved errors and historical PASS while invalidating changed sources',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());await h.life.userRequirement('goal',first.text,'goal');
 await h.life.ledger.append('session','main',{externalId:'claim',kind:'IMPLEMENTATION_REPORTED',origin:'agent',text:'Everything DONE, tests passed'});
 await h.life.ledger.append('session','main',{externalId:'issue',kind:'OPEN_ISSUE',origin:'tool',text:'FAILED test_access'});
 const source=await h.engine.workspace.read('access.py',65536);
 await h.life.ledger.append('session','main',{externalId:'file',kind:'SOURCE_MODIFIED',origin:'host',text:'Observed write',sources:[{path:'access.py',sha256:source.sha256}]});
 let s=await h.life.taskState();assert.equal(s.completion,'UNKNOWN');assert.equal(s.requirements[0]!.status,'NOT_CHECKED');
 assert.equal(s.implementationClaims[0]!.authority,'MODEL_CLAIM');assert.equal(s.openIssues[0]!.authority,'OBSERVED_EVENT');
 assert.equal(s.files[0]!.freshness,'CURRENT');assert.equal(s.checks.length,0);
 await h.engine.quality!.feedback!.run('check');s=await h.life.taskState();assert.equal(s.requirements[0]!.status,'VERIFIED_PASS');
 await writeFile(path.join(h.root,'access.py'),'def allowed(tenant,owner): return False\n');
 s=await h.life.taskState();assert.equal(s.files[0]!.freshness,'STALE');assert.equal(s.checks[0]!.status,'UNKNOWN');
 assert.equal(s.checks[0]!.historicalStatus,'PASS');assert.equal(s.checks[0]!.freshness,'STALE');assert.deepEqual(s.pendingRequirementIds,['isolation']);
});
test('branch cutoff excludes future revisions and failures',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());const r1=await h.life.confirmContract(first,{sourceEventId:'first',supersedes:null});
 await h.life.confirmContract(second,{sourceEventId:'second',supersedes:r1.revision.revisionId});
 await h.life.ledger.append('session','main',{externalId:'future',kind:'OPEN_ISSUE',origin:'tool',text:'Future error'});
 await h.life.switchBranch('past','main',r1.event.sequence);h.engine.quality!.setContract(first);
 const s=await h.life.taskState();assert.equal(s.contract!.revisionId,r1.revision.revisionId);assert.equal(s.requirements.length,1);assert.equal(s.openIssues.length,0);
});
test('fresh failed execution is not a completion verdict',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());h.setExit(1);await h.engine.quality!.feedback!.run('check');
 const s=await h.life.taskState();assert.equal(s.requirements[0]!.status,'VERIFIED_FAIL');assert.equal(s.checks[0]!.status,'FAIL');assert.equal(s.completion,'UNKNOWN');assert.equal(s.independentAcceptance,'NOT_RUN');
});

test('replaying the active confirmation preserves live receipts; mismatched source provenance is rejected',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());
 await h.life.confirmContract(first,{sourceEventId:'confirmed-once',supersedes:null});
 await h.engine.quality!.feedback!.run('check');
 await h.life.confirmContract(first,{sourceEventId:'confirmed-once',supersedes:null});
 assert.equal((await h.life.taskState()).checks[0]!.status,'PASS');
 await h.life.userRequirement('one',first.text,'original');
 await assert.rejects(h.life.userRequirement('one',first.text,'different'),/Conflicting/);
});
test('bounded task projection reports omitted observations instead of claiming exhaustive coverage',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());
 for(let i=0;i<18;i++)await h.life.ledger.append('session','main',{externalId:'issue-'+i,kind:'OPEN_ISSUE',origin:'tool',text:'Failure '+i});
 const state=await h.life.taskState();
 assert.equal(state.openIssues.length,16);assert.equal(state.omittedCounts.openIssues,2);
 assert.equal(state.completion,'UNKNOWN');
});

test('confirming a fixed contract before the first user event cannot suppress the task goal',async t=>{
 const h=await fixture();t.after(()=>h.engine.close());
 await h.life.confirmContract(first,{sourceEventId:'frozen-protocol',supersedes:null});
 const goal=await h.life.userRequirement('first-user',first.text,'user-entry');
 assert.equal(goal.kind,'USER_GOAL');
 const handoff=await h.life.compile(8192);assert.equal(handoff.status,'COMPLETE');
});
