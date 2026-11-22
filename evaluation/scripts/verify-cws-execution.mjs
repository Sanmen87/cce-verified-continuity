import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=async name=>JSON.parse(await fs.readFile(new URL('../'+name,import.meta.url),'utf8'));
export async function verifyCwsExecution(){
 const data=await read('results/cws-recommendation-execution.json'),{receipts}=await read('results/cws-execution-usage-receipts.json');
 assert.equal(data.trials.length,4);assert.equal(receipts.length,32);assert.equal(data.window,81920);assert.equal(data.pi,'1.5.0');
 assert.deepEqual(data.trials.map(t=>[t.pair,t.arm]),[[1,'A'],[1,'B'],[2,'B'],[2,'A']]);
 const keys=new Set();for(const receipt of receipts){const key=JSON.stringify([receipt.pair,receipt.arm,receipt.ordinal]);assert.ok(!keys.has(key));keys.add(key);const u=receipt.usage;assert.equal(u.total_tokens,u.prompt_tokens+u.completion_tokens);assert.ok(u.completion_tokens_details.reasoning_tokens<=u.completion_tokens);}
 const packets=data.trials.flatMap(t=>t.packets);assert.equal(packets.length,32);assert.equal(packets.filter(p=>p.packing==='FULL').length,29);assert.equal(packets.filter(p=>p.packing==='MANDATORY').length,3);
 assert.ok(packets.every(p=>p.requirements===6&&p.stageBPromptPresent));
 for(const trial of data.trials){
  const counters=receipts.filter(r=>r.pair===trial.pair&&r.arm===trial.arm);assert.equal(counters.length,8);assert.equal(trial.modelCalls,8);assert.equal(trial.cycles.completed,8);assert.equal(trial.cycles.incomplete,0);
  const sum=f=>counters.reduce((n,r)=>n+f(r.usage),0);
  assert.equal(sum(u=>u.prompt_tokens),trial.input);assert.equal(sum(u=>u.completion_tokens),trial.output);assert.equal(sum(u=>u.completion_tokens_details.reasoning_tokens),trial.reasoning);
  for(const r of counters)assert.equal(r.payloadSha256,trial.packets[r.ordinal-1].payloadSha256);
  assert.equal(trial.acceptance,trial.pair===1?'PASS':'FAIL');assert.equal(trial.passed,trial.pair===1?21:20);assert.equal(trial.total,21);assert.equal(trial.delta,trial.passed-17);
  assert.equal(trial.agentReturned,false);assert.equal(trial.strictWorkflowPassed,false);assert.equal(trial.modelApprovedChecks,0);assert.equal(trial.status,'CYCLE_BUDGET_EXHAUSTED');assert.equal(trial.errors,0);
  assert.ok(trial.packets.every(p=>trial.arm==='B'?!p.recommendation:p.packing==='MANDATORY'?!p.recommendation:p.recommendation));
 }
 for(const arm of ['A','B']){const rows=data.trials.filter(t=>t.arm===arm),total=data.totals[arm];assert.equal(rows.filter(t=>t.acceptance==='PASS').length,1);assert.equal(total.fullAcceptancePasses,1);assert.equal(total.trials,2);assert.equal(total.passedCases,41);assert.equal(total.totalCases,42);
  for(const k of ['input','output','reasoning','durationMinutes'])assert.equal(rows.reduce((n,t)=>n+t[k],0),total[k]);
  assert.equal(rows.flatMap(t=>t.packets).filter(p=>p.recommendation).length,total.recommendationPackets);
 }
 for(const k of ['input','output','reasoning','durationMinutes'])assert.equal(data.relativeBversusAPercent[k],(data.totals.B[k]/data.totals.A[k]-1)*100);
 assert.equal(data.totals.A.recommendationPackets,13);assert.equal(data.totals.B.recommendationPackets,0);
 return{trials:4,providerUsageReceipts:32,fullAcceptance:{A:'1/2',B:'1/2'},packets:{FULL:29,MANDATORY:3},modelRequests:0};
}
