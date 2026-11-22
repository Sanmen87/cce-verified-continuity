import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ContextEngine} from '../packages/core/src/index.ts';
import {observeExecution} from '../packages/core/src/quality/execution.ts';
import type {ApprovedCheck} from '../packages/core/src/quality/contracts.ts';

const traceback='Traceback (most recent call last):\n  File "probe.py", line 4, in <module>\nValueError: invalid result\n';
const contract={id:'integrity',source:'user' as const,text:'Preserve tenant isolation.',requirements:[{id:'tenant',clause:'Preserve tenant isolation.',needs:[],checks:['check']}]};
async function engineFor(t:test.TestContext,check:ApprovedCheck){
 const root=await mkdtemp(path.join(tmpdir(),'cce-verification-integrity-'));await writeFile(path.join(root,'access.py'),'allowed=True\n');
 const engine=await ContextEngine.open(root,{sessionId:'integrity',taskContract:contract,verificationChecks:[check],config:{mode:'assist',quality:{coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,recoveryPolicy:'verified-state'}}});
 t.after(async()=>{engine.close();await rm(root,{recursive:true,force:true});});return{root,engine,life:engine.lifecycle!};
}
test('Python exit 0 with traceback is an output contradiction and cannot become a trusted PASS',async t=>{
 const h=await engineFor(t,{id:'check',source:'unit-host',type:'unit-test',execute:async()=>({exitCode:0,diagnostic:traceback,executionId:'caught-exception'})});
 await h.life.userRequirement('goal',contract.text);
 await h.life.recordTool('probe','bash',{content:[{type:'text',text:traceback}],details:{exitCode:0}},{command:'never executed'},false);
 let state=await h.life.taskState();const native=state.currentWork!.observedNativeExecutions[0] as any;
 assert.equal(native.execution.processOutcome,'SUCCEEDED');assert.equal(native.execution.observedOutcome,'CONTRADICTORY');assert.equal(native.correctness,'UNVERIFIED');
 assert.ok(state.openIssues.some(i=>i.text.includes('TOOL_OUTPUT_CONTRADICTION')));assert.equal(state.checks.length,0);
 const receipt=await h.life.runApprovedCheck('check');assert.equal(receipt.status,'UNKNOWN');assert.equal(receipt.execution!.processOutcome,'SUCCEEDED');
 state=await h.life.taskState();assert.notEqual(state.requirements[0]!.status,'VERIFIED_PASS');assert.equal(state.currentWork!.confirmed.length,0);
});
test('approved explicit-result policy handles expected exceptions without a blanket traceback failure rule',async t=>{
 let outcome:'PASS'|'FAIL'|'UNKNOWN'|undefined='PASS',exitCode=0;
 const h=await engineFor(t,{id:'check',source:'structured-unit-host',type:'unit-test',resultPolicy:'explicit-result',execute:async()=>({exitCode,diagnostic:traceback,executionId:'expected-exception',...(outcome?{outcome}:{})})});
 const pass=await h.life.runApprovedCheck('check');assert.equal(pass.status,'PASS');
 await writeFile(path.join(h.root,'access.py'),'allowed=False\n');
 const stale=(await h.life.taskState()).checks[0]!;assert.equal(stale.freshness,'STALE');assert.equal(stale.status,'UNKNOWN');
 outcome=undefined;assert.equal((await h.life.runApprovedCheck('check')).status,'UNKNOWN');
 outcome='FAIL';assert.equal((await h.life.runApprovedCheck('check')).status,'FAIL');
 outcome='PASS';exitCode=1;assert.equal((await h.life.runApprovedCheck('check')).status,'UNKNOWN');
});
test('process completion and observed native output never constitute test success',()=>{
 assert.equal(observeExecution(0,false,'All tests passed').observedOutcome,'UNKNOWN');
 assert.equal(observeExecution(0,false,'Test name: test_Traceback_expected ... ok').observedOutcome,'UNKNOWN');
 assert.equal(observeExecution(0,false,'FAILED (failures=2, errors=1)').observedOutcome,'CONTRADICTORY');
 assert.equal(observeExecution(1,false,'').processOutcome,'FAILED');
 assert.equal(observeExecution(null,false,'').processOutcome,'UNKNOWN');
 assert.equal(observeExecution(0,false,'','watchdog').processOutcome,'UNKNOWN');
});

test('automatic mandatory layout keeps trusted authority, stale binding and access limits after a source edit',async t=>{
 const h=await engineFor(t,{id:'check',source:'host-verifier',type:'unit-test',
   execute:async()=>({exitCode:0,diagnostic:'OK',executionId:'run-1'})});
 await h.life.userRequirement('goal',contract.text);
 const receipt=await h.life.runApprovedCheck('check');
 assert.equal(receipt.status,'PASS');
 for(const changed of [false,true]){
   if(changed)await writeFile(path.join(h.root,'access.py'),'allowed=False\n');
   const compile=await h.life.recoveryCompiler(undefined,changed?'HOST_ONLY':'IN_LOOP');
   const recovery=await compile(12000,true);
   assert.equal(recovery.status,'COMPLETE');
   assert.equal(recovery.handoff?.taskStatePacking,'MANDATORY');
   const state=JSON.parse(recovery.text.split('TASK STATE PROJECTION\n')[1]!.split('\n')[0]!);
   assert.equal(state.checks[0].id,receipt.id);assert.equal(state.checks[0].source,'host-verifier');
   assert.equal(state.checks[0].freshness,changed?'STALE':'CURRENT');
   assert.equal(state.checks[0].status,changed?'UNKNOWN':'PASS');assert.equal(state.checks[0].historicalStatus,'PASS');
   assert.equal(state.requirements[0].status==='VERIFIED_PASS',!changed);
   assert.equal(state.approvedVerification.executionAccess,changed?'HOST_ONLY':'IN_LOOP');
   assert.equal(state.completion,'UNKNOWN');assert.equal(state.independentAcceptance,'NOT_RUN');
 }
});

test('native missing exit metadata preserves process UNKNOWN while exposing test failure and non-verdict diagnostics',async t=>{
 const h=await engineFor(t,{id:'check',source:'unit-host',type:'unit-test',execute:async()=>({exitCode:0,diagnostic:'Host check passed',executionId:'host-check'})});
 await h.life.userRequirement('goal',contract.text);
 await h.life.recordTool('pipeline','bash',{content:[{type:'text',text:'Ran 30 tests\nFAILED (errors=16)\n'}],details:{}},{command:'never executed'},false);
 await h.life.recordTool('trace','bash',{content:[{type:'text',text:traceback}],details:{}},{command:'never executed'},false);
 const state=await h.life.taskState();const native=state.currentWork!.observedNativeExecutions as any[];
 const failed=native.find(r=>r.toolCallId==='pipeline').execution;
 assert.equal(failed.processOutcome,'UNKNOWN');assert.equal(failed.processStatus,'PROCESS_STATUS_UNKNOWN');assert.equal(failed.testOutcome,'FAIL');assert.equal(failed.observedOutcome,'FAIL');
 const trace=native.find(r=>r.toolCallId==='trace').execution;
 assert.equal(trace.processOutcome,'UNKNOWN');assert.equal(trace.testOutcome,'UNKNOWN');assert.equal(trace.observedOutcome,'DIAGNOSTIC');
 assert.ok(state.openIssues.some(r=>r.text.includes('TOOL_DIAGNOSTIC_OBSERVED')));
 assert.equal(state.checks.length,0);assert.equal(state.requirements[0]!.status,'NOT_CHECKED');
 const packet=await h.life.recover(12000);assert.ok(packet.text.includes('PROCESS_STATUS_UNKNOWN'));assert.ok(!packet.text.includes('Recover full original before treating this error as resolved'));
});
