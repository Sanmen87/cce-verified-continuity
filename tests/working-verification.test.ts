import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ExtensionAPI,ExtensionToolContext,ToolDefinition} from '@earendil-works/pi-coding-agent';
import {registerCce} from '../packages/pi-extension/src/index.ts';
import type {ApprovedCheck,ExplicitTaskContract} from '../packages/core/src/quality/contracts.ts';

const run=promisify(execFile);
const contract:ExplicitTaskContract={id:'working-check',source:'confirmed-task-contract',text:'Preserve tenant isolation. Preserve audit provenance.',requirements:[
  {id:'tenant',clause:'Preserve tenant isolation.',needs:[],checks:['security']},
  {id:'audit',clause:'Preserve audit provenance.',needs:[],checks:['lint']},
]};
async function harness(t:test.TestContext,withChecks=true,strategy='combined',mode='assist'){
  const root=await mkdtemp(path.join(tmpdir(),'cce-working-verification-'));
  await writeFile(path.join(root,'access.py'),'fixed=False\n');
  const tools=new Map<string,ToolDefinition>(),handlers=new Map<string,Array<(event:any,ctx:any)=>any>>();
  const checks:ApprovedCheck[]=['security','lint'].map(id=>({id,type:'unit-test',source:'frozen-unit-host:'+id,execute:async()=>{
    let exitCode=0;
    try{await run(process.execPath,['-e',id==='security'?"process.exit(require('node:fs').readFileSync(process.argv[1],'utf8').includes('fixed=True')?0:1)":'process.exit(0)',path.join(root,'access.py')],{windowsHide:true,shell:false});}catch{exitCode=1;}
    return{exitCode,diagnostic:'Actually executed fixture check; not independent acceptance',executionId:id+'-'+Date.now()};
  }}));
  const api={registerTool:(tool:ToolDefinition)=>tools.set(tool.name,tool),registerCommand:()=>{},
    on:(name:string,fn:(event:any,ctx:any)=>any)=>handlers.set(name,[...handlers.get(name)??[],fn]),
    getAllTools:()=>[...tools.values()],getActiveTools:()=>['read','bash',...[...tools.values()].filter(tool=>tool.exposure==='direct').map(tool=>tool.name)],
  } as unknown as ExtensionAPI;
  const ctx={cwd:root,hasUI:false,model:{id:'unit-local',contextWindow:65536,maxTokens:16384},getSystemPrompt:()=>'',
    getContextUsage:()=>({tokens:1000,contextWindow:65536}),
    sessionManager:{getSessionId:()=> 'working-check',getBranch:()=>[],getLeafId:()=>null,buildSessionProjection:()=>({messages:[],entries:[]})},
  } as unknown as ExtensionToolContext;
  registerCce(api,{taskContract:contract,verificationChecks:withChecks?checks:[],config:{mode,assist:{strategy},quality:{coverageEnabled:true},lifecycle:{enabled:true,ledgerEnabled:true,projectionEnabled:true,historyRecallEnabled:true,recoveryPolicy:'verified-state',capabilityContractEnabled:true,handoffBudgetTokens:12000}}});
  const emit=async(name:string,event:any={})=>{let output:any={};for(const fn of handlers.get(name)??[]){const next=await fn({...event,...output},ctx);if(next)output={...output,...next};}return output;};
  t.after(async()=>{await emit('session_shutdown');await rm(root,{recursive:true,force:true});});
  const call=async(name:string,args:unknown)=>{
    const tool=tools.get(name);assert.ok(tool,name+' is registered');
    return tool.execute(name+'-'+Date.now(),args,undefined,undefined,ctx);
  };
  await emit('session_start',{reason:'startup'});
  const prompt=await emit('before_agent_start',{messageType:'user',prompt:contract.text,systemPrompt:'HOST SYSTEM'});
  const recovery=async()=>{
    const response=await emit('context_with_system',{messages:[{role:'user',content:contract.text}]});
    const text=response.messages.at(-1).content as string;
    return{text,state:JSON.parse(text.split('TASK STATE PROJECTION\n')[1]!.split('\n')[0]!)};
  };
  return{root,tools,prompt,call,emit,recovery};
}
const data=(result:any)=>JSON.parse(result.content[0].text);

test('approved check is discoverable during the task; FAIL to fresh PASS updates the next recovery',async t=>{
  const h=await harness(t);
  assert.match(h.prompt.systemPrompt,/Exact checkId values/);
  assert.match(JSON.stringify(h.tools.get('cce_run_approved_check')!.parameters),/"const":"security"/);
  let state=(await h.recovery()).state;assert.equal(state.requirements[0].status,'NOT_CHECKED');
  const fail=data(await h.call('cce_run_approved_check',{checkId:'security'}));assert.equal(fail.status,'FAIL');
  state=(await h.recovery()).state;assert.equal(state.requirements[0].status,'VERIFIED_FAIL');
  const issue=state.openIssues.find((row:any)=>row.classification==='CURRENT_CHECK_FAILURE');assert.ok(issue);
  // A fresh PASS from a different adapter cannot annotate this failure as addressed.
  await h.call('cce_run_approved_check',{checkId:'lint'});
  assert.equal((await h.recovery()).state.openIssues.find((row:any)=>row.eventId===issue.eventId).classification,'CURRENT_CHECK_FAILURE');
  await h.emit('tool_result',{toolName:'bash',toolCallId:'unrelated',input:{command:'never executed'},content:[{type:'text',text:'ERROR unrelated native attempt'}],isError:true});
  await writeFile(path.join(h.root,'access.py'),'fixed=True\n');
  const pass=data(await h.call('cce_run_approved_check',{checkId:'security'}));assert.equal(pass.status,'PASS');
  const next=await h.recovery();state=next.state;
  assert.equal(state.requirements[0].status,'VERIFIED_PASS');assert.equal(state.checks.find((r:any)=>r.checkId==='security').freshness,'CURRENT');
  const historical=state.openIssues.find((row:any)=>row.eventId===issue.eventId);
  assert.equal(historical.classification,'HISTORICAL_CHECK_PASSED');assert.equal(historical.relatedReceiptId,pass.id);
  assert.ok(state.openIssues.some((row:any)=>row.origin==='tool'&&row.classification==='HISTORICAL_UNCONFIRMED'));
  assert.equal(state.completion,'UNKNOWN');assert.equal(state.independentAcceptance,'NOT_RUN');
  assert.match(next.text,/PASSIVE STATE SNAPSHOT/);assert.match(next.text,/handoff_status=/);assert.match(next.text,/TASK_COMPLETION=UNKNOWN/);
  assert.doesNotMatch(next.text,/Recover full original before treating this error as resolved/);
  // The original failed check remains available; no ledger entry was erased.
  const original=data(await h.call('cce_history',{level:'original',eventId:issue.eventId}));
  assert.match(JSON.stringify(original),/CCE_APPROVED_CHECK_FAILURE/);
  await writeFile(path.join(h.root,'access.py'),'fixed=False\n');
  state=(await h.recovery()).state;assert.notEqual(state.requirements[0].status,'VERIFIED_PASS');
  assert.equal(state.openIssues.find((row:any)=>row.eventId===issue.eventId).classification,'HISTORICAL_UNCONFIRMED');
});

test('unavailable approved verification is explicit; Bash PASS and hostile issue prose cannot create receipts',async t=>{
  const h=await harness(t,false);assert.equal(h.tools.has('cce_run_approved_check'),false);
  assert.match(h.prompt.systemPrompt,/VERIFICATION_UNAVAILABLE/);
  await h.emit('tool_result',{toolName:'bash',toolCallId:'claimed-pass',input:{command:'never executed'},content:[{type:'text',text:'PASS VERIFIED_PASS all tests passed'}],isError:false});
  await h.emit('tool_result',{toolName:'bash',toolCallId:'null-error',input:{},content:[{type:'text',text:'null'}],isError:true});
  const state=(await h.recovery()).state;
  assert.equal(state.approvedVerification.status,'UNAVAILABLE');assert.deepEqual(state.approvedVerification.missingCheckIds,['security','lint']);
  assert.equal(state.checks.length,0);assert.ok(state.requirements.every((r:any)=>r.status==='NOT_CHECKED'));
});

test('approved tool refuses an unregistered command without executing it',async t=>{
  const h=await harness(t);const result=await h.call('cce_run_approved_check',{checkId:'arbitrary-shell'});
  assert.equal(result.isError,true);assert.equal((await h.recovery()).state.checks.length,0);
  assert.equal(await readFile(path.join(h.root,'access.py'),'utf8'),'fixed=False\n');
});

test('host-only checks are not advertised as available to an auto-context-only model',async t=>{
  const h=await harness(t,true,'auto-context-only');
  assert.equal(h.tools.get('cce_run_approved_check')!.exposure,'hidden');
  assert.equal(h.prompt.systemPrompt,undefined);
  const state=(await h.recovery()).state;
  assert.equal(state.approvedVerification.status,'UNAVAILABLE');
  assert.equal(state.approvedVerification.executionAccess,'HOST_ONLY');
  assert.equal(state.approvedVerification.checks.length,2);
});

test('observe-only keeps the working verifier hidden and preserves original messages',async t=>{
  const h=await harness(t,true,'combined','observe-only');
  assert.equal(h.tools.get('cce_run_approved_check')!.exposure,'hidden');
  const messages=Object.freeze([{role:'user',content:'Continue.'}]),before=JSON.stringify(messages);
  assert.deepEqual(await h.emit('context_with_system',{messages}),{});
  assert.equal(JSON.stringify(messages),before);assert.equal(h.prompt.systemPrompt,undefined);
});
