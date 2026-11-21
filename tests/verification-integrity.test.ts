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
