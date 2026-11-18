/** A deterministic presentation of existing Task State. Never a new authority. */
export interface WorkingStateInput {
  verification:string;
  requirements:readonly {id:string;status:string}[];
  checks:readonly {id:string;checkId:string;status:string;freshness:string}[];
  approvedVerification:{status:string;checks:readonly {id:string}[]};
  nativeObservations?:readonly unknown[];
}
export interface WorkingObjective {text:string;eventId:string;status:string}
export function currentWork(state:WorkingStateInput,objective:WorkingObjective|null){
  const bound=state.verification==='CURRENT_BINDING_REVALIDATED';
  const confirmed=bound?state.checks.filter(c=>c.freshness==='CURRENT'&&c.status==='PASS').map(c=>({kind:'approved_check' as const,checkId:c.checkId,receiptId:c.id,authority:'CURRENT_HOST_RECEIPT' as const})):[];
  const unresolved=state.requirements.filter(r=>!bound||r.status!=='VERIFIED_PASS').map(r=>({requirementId:r.id,status:bound?r.status:'UNKNOWN'}));
  const checkIds=state.approvedVerification.status==='AVAILABLE'?state.approvedVerification.checks.map(c=>c.id):[];
  const kind=unresolved.length?'verification':'report_results';
  return{schemaVersion:1,objective,confirmed,unresolved,observedNativeExecutions:state.nativeObservations??[],
    next_action:{kind,suggestion:unresolved.length?(checkIds.length?'Use available approved checks covering unresolved requirements. Unchanged fresh checks need not be repeated.':'Verification is unavailable or incomplete. Report that limitation; native output remains an observation.'):'Report observed results and remaining limitations. This is not an independent acceptance verdict.',
      checkIds,authority:'derived_recommendation' as const,automaticExecution:false},
    implementation:'UNKNOWN' as const,completion:'UNKNOWN' as const,independentAcceptance:'NOT_RUN' as const};
}

/** Optional details shrink before the current contract/status/recommendation.
 * The caller must label MINIMAL/omissions explicitly, never as full projection. */
export function minimalTaskState(input:unknown):Record<string,unknown>|null{
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const state=input as Record<string,unknown>;
  if(!Array.isArray(state.requirements)||!state.contract)return null;
  const keys=['schemaVersion','projectId','sessionId','branchId','throughSequence','contract','requirements','pendingRequirementIds','currentWork','verification','completion','independentAcceptance'];
  return{...Object.fromEntries(keys.filter(k=>Object.hasOwn(state,k)).map(k=>[k,state[k]])),projection:'MINIMAL',
    omittedSections:Object.keys(state).filter(k=>!keys.includes(k)),
    detailAuthority:'OMITTED_DETAILS_REQUIRE_SCOPED_RECALL'};
}
