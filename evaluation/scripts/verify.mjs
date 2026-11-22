// Offline artifact audit. Does not load a model, execute candidate code or use a network.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scenarios, gradeAnswer, inspectEvidence } from './mcp-scoring.mjs';
import {verifyCwsExecution} from './verify-cws-execution.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = async name => JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = await read('inventory.json');
for(const item of inventory.files) {
 assert.ok(!path.isAbsolute(item.file) && !item.file.split('/').includes('..'));
 const stat = await fs.lstat(path.join(root,item.file)); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
 assert.equal(sha(await fs.readFile(path.join(root,item.file))),item.sha256,'Changed evaluation file: '+item.file);
}
const fixture = await read('fixtures/mcp.json'), mcp = await read('results/mcp-retrieval.json');
let strictPass = 0, evidencePass = 0, adoption = 0;
for(const trial of mcp.results) {
 const scenario = scenarios.find(s=>s.id===trial.scenario); assert.ok(scenario);
 const checks = gradeAnswer(scenario,trial.answer); assert.deepEqual(checks,trial.checks);
 const correct = Object.values(checks).every(Boolean); assert.equal(correct,trial.correct); strictPass += Number(correct);
 const events = trial.bodies.map(body=>({type:'item.completed',item:{type:'mcp_tool_call',result:{content:[{type:'text',text:JSON.stringify(body)}]}}}));
 const evidence = inspectEvidence(scenario,events,[],fixture); assert.equal(evidence.allRequired,trial.evidenceAllRequired); evidencePass += Number(evidence.allRequired);
 assert.ok(evidence.validatedBodies.every(body=>body.valid));
 assert.equal(correct && evidence.allRequired,trial.taskSuccess);
 if(trial.arm==='cce' && trial.cceCalls>0) adoption++;
 assert.equal(trial.toolErrors,0);
 if(trial.usage.available) assert.equal(trial.usage.input-trial.usage.cachedInput,trial.usage.nonCachedInput);
}
assert.equal(mcp.results.length,12); assert.equal(strictPass,9); assert.equal(evidencePass,12); assert.equal(adoption,6);
assert.equal(mcp.results.filter(t=>t.arm==='baseline' && t.taskSuccess).length,5);
assert.equal(mcp.results.filter(t=>t.arm==='cce' && t.taskSuccess).length,4);
const execution = await read('results/execution-continuation.json'), {receipts} = await read('results/execution-usage-receipts.json');
assert.equal(receipts.length,64); assert.equal(execution.additionalFailedRequestWithUnknownUsage,1);
assert.match(execution.originalFailedPair2.providerUsage,/UNKNOWN/); assert.equal(execution.originalFailedPair2.baseline,'NOT_RUN');
assert.match(execution.completeSeriesTokenCost,/UNKNOWN/);
for(const pair of execution.records) for(const arm of pair.arms) {
 const counters = receipts.filter(r=>r.pair===pair.pair && r.arm===arm.arm); assert.equal(counters.length,arm.cycles);
 const sum = field => counters.reduce((n,r)=>n+r.usage[field],0);
 assert.equal(sum('prompt_tokens'),arm.inputTokens); assert.equal(sum('completion_tokens'),arm.outputTokens); assert.equal(sum('total_tokens'),arm.totalTokens);
 assert.equal(arm.totalTokens,arm.inputTokens+arm.outputTokens); assert.equal(arm.acceptance,'FAIL'); assert.equal(arm.passed===arm.total,false);
 for(const r of counters) { assert.equal(r.usage.total_tokens,r.usage.prompt_tokens+r.usage.completion_tokens); assert.ok((r.usage.completion_tokens_details?.reasoning_tokens??0)<=r.usage.completion_tokens); }
}
for(const mode of ['baseline','current-work']) {
 const arms = execution.records.flatMap(p=>p.arms).filter(a=>a.arm===mode), aggregate = execution.aggregates[mode];
 for(const field of ['inputTokens','outputTokens','totalTokens']) assert.equal(arms.reduce((n,a)=>n+a[field],0),aggregate[field]);
 assert.equal(aggregate.independentlyAcceptedTasks,0);
}
assert.equal(execution.delivery.length,56); assert.ok(execution.delivery.every(r=>r.exactModelResultPresent));
assert.equal(execution.integrity.sixRequirementsDeliveredInRequests,64);
const long = await read('results/long-task.json'); assert.equal(long.primaryAcceptance,'NOT_EVALUATED'); assert.equal(long.compactions.cycles.length,16);
assert.equal(long.compactions.cycles.filter(c=>c.strictOriginalCurrentRecovery).length,15); assert.equal(long.compactions.cycles.filter(c=>c.allSixStructuredInActualActiveContext).length,16);
assert.equal(long.compactions.cycles.filter(c=>c.fromExtension && c.reason==='threshold' && !c.fallback).length,16);
const cross=await read('results/cross-session-v2.json'); assert.equal(cross.acceptance,'NOT_EVALUATED'); assert.equal(cross.posthocPartial.grade.passed,17); assert.equal(cross.usage.unknownCalls,1);
const decision=await read('results/decision-replay.json'); assert.ok(decision.trials.every(t=>t.toolsExecuted===0 && t.independentCodingAcceptance==='NOT_EXERCISED'));
const pilot=await read('results/first-pilot.json'); assert.equal(pilot.runs.length,9); assert.equal(pilot.runs.filter(r=>r.acceptance.status==='PASS').length,3);
const cwsExecution=await verifyCwsExecution();
console.log(JSON.stringify({status:'PASS',scope:'OFFLINE_PUBLIC_ARTIFACT_AUDIT_NOT_LIVE_CODING',inventoryFiles:inventory.files.length,mcpTrials:12,mcpStrictPass:strictPass,mcpEvidencePass:evidencePass,executionUsageReceipts:64,executionFullyAcceptedTasks:0,cwsExecution,modelRequests:0}));
