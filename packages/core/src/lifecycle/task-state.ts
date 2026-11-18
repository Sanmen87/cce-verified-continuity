import { containsSecret } from '../native/secrets.ts';
import type { ContextLifecycle } from './service.ts';
import { contractRevisions } from './task-contract.ts';
import { currentWork } from './current-work.ts';

/** A projection of scoped observations, not a generated summary or a completion verdict. */
export async function projectTaskState(life: ContextLifecycle, verificationAccess?:'IN_LOOP'|'HOST_ONLY') {
  const { engine, ledger, branchId } = life, session = engine.sessionId;
  const revisions = await contractRevisions(ledger, session, branchId), active = revisions.at(-1);
  const window=ledger.currentFacts(session,branchId),facts = window.events, superseded = new Set(facts.filter(e => ['user','host'].includes(e.origin)).flatMap(e => e.supersedes ? [e.supersedes] : []));
  const current = facts.filter(e => !superseded.has(e.id));
  const binding = engine.quality ? await engine.quality.binding() : undefined;
  const tracker = engine.quality?.tracker;
  const contractMatches = Boolean(active && tracker && JSON.stringify(active.revision.contract) === JSON.stringify(tracker.contract));
  const checked = binding && contractMatches ? tracker!.inspect(binding) : [];
  const receipts = binding && contractMatches ? tracker!.inspectReceipts(binding) : [];
  const approved = contractMatches ? engine.quality?.feedback?.availableChecks() ?? [] : [];
  const requiredChecks = [...new Set(active?.revision.contract.requirements.flatMap(r=>r.checks) ?? [])];
  const missingChecks = requiredChecks.filter(id=>!approved.some(check=>check.id===id));
  const text = async (id: string) => {
    try { const original = (await ledger.original(session, branchId, id)).text;
      return containsSecret(original) ? { text: '[Potential secret omitted]', status: 'UNKNOWN' } :
        { text: original.slice(0, 1024), status: original.length > 1024 ? 'PARTIAL' : 'OBSERVED' };
    } catch { return { text: '[Original unavailable]', status: 'UNKNOWN' }; }
  };
  const observations = async (kinds: string[]) => Promise.all(current.filter(e => kinds.includes(e.kind)).slice(-16).map(async e => ({
    eventId: e.id, origin: e.origin, ...(await text(e.id)), authority: e.origin === 'agent' ? 'MODEL_CLAIM' : 'OBSERVED_EVENT',
  })));
  const detailOf=async(id:string):Promise<Record<string,unknown>>=>{
    try{const original=(await ledger.original(session,branchId,id)).text;if(containsSecret(original))return{};
      const value:unknown=JSON.parse(original);return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
    }catch{return{};}
  };
  const executions=await Promise.all(current.filter(e=>e.kind==='TEST_EXECUTED'&&e.origin==='host').map(async e=>({sequence:e.sequence,detail:await detailOf(e.id)})));
  const openIssues=await Promise.all(current.filter(e=>e.kind==='OPEN_ISSUE').slice(-16).map(async e=>{
    const display=await text(e.id);
    const detail=await detailOf(e.id);
    // A tool's prose cannot link itself to a trusted check or close another issue.
    const linked=e.origin==='host'&&detail.type==='CCE_APPROVED_CHECK_FAILURE'&&detail.contractSha256===tracker?.contractSha256;
    const receipt=linked?receipts.find(r=>r.checkId===detail.checkId&&r.source===detail.source&&r.freshness==='CURRENT'):undefined;
    let classification:'HISTORICAL_UNCONFIRMED'|'CURRENT_CHECK_FAILURE'|'HISTORICAL_CHECK_PASSED'='HISTORICAL_UNCONFIRMED';
    if(receipt?.status==='FAIL'&&receipt.id===detail.receiptId)classification='CURRENT_CHECK_FAILURE';
    if(receipt?.status==='PASS'&&executions.some(event=>event.sequence>e.sequence&&event.detail.type==='CCE_APPROVED_CHECK'&&event.detail.receiptId===receipt.id&&event.detail.contractSha256===tracker?.contractSha256))classification='HISTORICAL_CHECK_PASSED';
    // The full record remains in the ledger; old imperative nextAction text is not repeated as current work.
    if(detail.status==='TOOL_ERROR_OBSERVED'){
      const {nextAction:_,...passive}=detail;display.text=JSON.stringify(passive).slice(0,1024);
    }
    return{eventId:e.id,origin:e.origin,...display,authority:e.origin==='agent'?'MODEL_CLAIM':'OBSERVED_EVENT',historical:true,
      classification,relatedCheckId:linked?detail.checkId:null,relatedReceiptId:classification==='HISTORICAL_CHECK_PASSED'?receipt!.id:null};
  }));
  const sourceEvents = current.filter(e => ['SOURCE_MODIFIED','SOURCE_OBSERVED'].includes(e.kind) && ['host','tool'].includes(e.origin));
  const sources = new Map(sourceEvents.flatMap(e => e.sources.map(source => [source.path, { eventId: e.id, source }] as const)));
  const files = await Promise.all([...sources.values()].slice(-32).map(async ({ eventId, source }) => ({
    eventId, ...source, freshness: await ledger.freshness(source),
  })));
  const requirements = active?.revision.contract.requirements.map(r => ({
    id: r.id, clause: r.clause, sourceEventId: active.revision.sourceEventId, revisionId: active.revision.revisionId,
    eventId: active.event.id, status: checked.find(c => c.id === r.id)?.status ?? 'UNKNOWN',
  })) ?? [];
  const nativeObservations=[];
  for(const e of current.filter(e=>e.kind==='TOOL_RESULT'&&e.origin==='tool')){
    const detail=await detailOf(e.id);if(detail.toolName!=='bash')continue;
    const result=detail.result&&typeof detail.result==='object'?detail.result as Record<string,unknown>:{};
    const output=Array.isArray(result.content)?result.content.flatMap(part=>part&&typeof part==='object'&&typeof (part as Record<string,unknown>).text==='string'?[(part as {text:string}).text]:[]).join('\n'):'';
    const preview=output.length>256?output.slice(0,128)+'\n[output preview shortened]\n'+output.slice(-128):output;
    nativeObservations.push({eventId:e.id,originalSha256:e.blobSha256,tool:'bash',toolCallId:e.toolCallId??null,exitCode:e.exitCode??null,isError:e.isError??null,
      outputPreview:preview,partial:output.length>256,authority:'NATIVE_OUTPUT_OBSERVATION_ONLY',correctness:'UNVERIFIED',freshness:'NOT_A_VERIFICATION_RECEIPT'});
  }
  const state={
    schemaVersion: 1, projectId: engine.workspace.projectId, sessionId: session, branchId,
    throughSequence: ledger.latestSequence(session, branchId),
    continuation:await life.continuationState(),
    completeness: window.mandatoryOverflow ? 'INCOMPLETE_EVENT_LIMIT' : 'SCOPED_OBSERVATIONS',
    contract: active ? { id: active.revision.contractId, revisionId: active.revision.revisionId,
      sourceEventId: active.revision.sourceEventId, supersedes: active.revision.supersedes,
      confirmation: active.revision.confirmation, eventId: active.event.id } : null,
    requirements, pendingRequirementIds: requirements.filter(r => r.status !== 'VERIFIED_PASS').map(r => r.id),
    userEvents: current.filter(e => ['USER_GOAL','USER_REQUIREMENT'].includes(e.kind) && e.origin === 'user').slice(-16)
      .map(e => ({ eventId: e.id, sourceEventId: e.messageId ?? null, originalSha256: e.blobSha256 })),
    implementationClaims: await observations(['IMPLEMENTATION_REPORTED']),
    decisions: await observations(['TASK_DECISION']),
    implementationEvidence:'CHANGE_OBSERVED_IS_NOT_IMPLEMENTED',
    nextSteps: await observations(['NEXT_STEP']), openIssues,
    files, checks: receipts,
    approvedVerification: {scope:'REGISTERED_HOST_ADAPTERS',status:!requiredChecks.length?'NOT_REQUIRED':missingChecks.length||verificationAccess==='HOST_ONLY'?'UNAVAILABLE':'AVAILABLE',
      executionAccess:verificationAccess??'HOST_ADAPTERS_ONLY_KNOWN',checks:approved,missingCheckIds:missingChecks,nativeToolOutput:'OBSERVATION_ONLY'},
    verification: contractMatches ? 'CURRENT_BINDING_REVALIDATED' : 'UNKNOWN',
    omittedCounts: {
      historicalWorkingSet:Object.fromEntries(Object.entries(window.omitted).filter(([,count])=>count>0)),
      userEvents: Math.max(0,current.filter(e=>['USER_GOAL','USER_REQUIREMENT'].includes(e.kind)&&e.origin==='user').length-16),
      implementationClaims: Math.max(0,current.filter(e=>e.kind==='IMPLEMENTATION_REPORTED').length-16),
      nextSteps: Math.max(0,current.filter(e=>e.kind==='NEXT_STEP').length-16),
      openIssues: Math.max(0,current.filter(e=>e.kind==='OPEN_ISSUE').length-16),files: Math.max(0,sources.size-32),
    },
    scopeLimits: { eventLimit: 1024, observationsPerKind: 16, files: 32, textCharacters: 1024 },
    completion: 'UNKNOWN', independentAcceptance: 'NOT_RUN',
  };
  const latestUser=current.filter(e=>e.origin==='user'&&['USER_GOAL','USER_REQUIREMENT'].includes(e.kind)).at(-1);
  const objective=latestUser?{...(await text(latestUser.id)),eventId:latestUser.id}:null;
  return{...state,...(engine.config.lifecycle.currentWorkEnabled?{currentWork:currentWork({...state,nativeObservations:nativeObservations.slice(-4)},objective)}:{})};
}
