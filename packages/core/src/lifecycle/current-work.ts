import type {CurrentWorkPolicy} from '../config.ts';
import {sha256} from '../workspace.ts';
/** A deterministic presentation of existing Task State. Never a new authority. */
export interface WorkingStateInput {
  verification:string;
  requirements:readonly {id:string;status:string}[];
  checks:readonly {id:string;checkId:string;status:string;freshness:string}[];
  approvedVerification:{status:string;checks:readonly {id:string}[]};
  nativeObservations?:readonly unknown[];
}
export interface WorkingObjective {text:string;eventId:string;status:string}
function stateProjection(state:WorkingStateInput,objective:WorkingObjective|null){
  const bound=state.verification==='CURRENT_BINDING_REVALIDATED';
  const confirmed=bound?state.checks.filter(c=>c.freshness==='CURRENT'&&c.status==='PASS').map(c=>({kind:'approved_check' as const,checkId:c.checkId,receiptId:c.id,authority:'CURRENT_HOST_RECEIPT' as const})):[];
  const unresolved=state.requirements.filter(r=>!bound||r.status!=='VERIFIED_PASS').map(r=>({requirementId:r.id,status:bound?r.status:'UNKNOWN'}));
  return{schemaVersion:1,objective,confirmed,unresolved,observedNativeExecutions:state.nativeObservations??[],
    implementation:'UNKNOWN' as const,completion:'UNKNOWN' as const,independentAcceptance:'NOT_RUN' as const};
}
function recommend(state:WorkingStateInput,unresolved:boolean){
  const checkIds=state.approvedVerification.status==='AVAILABLE'?state.approvedVerification.checks.map(c=>c.id):[];
  return{kind:unresolved?'verification':'report_results',suggestion:unresolved?(checkIds.length?'Use available approved checks covering unresolved requirements. Unchanged fresh checks need not be repeated.':'Verification is unavailable or incomplete. Report that limitation; native output remains an observation.'):'Report observed results and remaining limitations. This is not an independent acceptance verdict.',
    checkIds,authority:'derived_recommendation' as const,automaticExecution:false};
}
export function currentWork(state:WorkingStateInput,objective:WorkingObjective|null){
  const projection=stateProjection(state,objective);
  return{...projection,next_action:recommend(state,projection.unresolved.length>0)};
}

export interface CurrentWorkDiagnostic {
  mode:CurrentWorkPolicy['actionRecommendation'];
  includedInProjection:boolean;
  providerDelivery:'UNKNOWN';
  recommendation:ReturnType<typeof currentWork>['next_action']|null;
  projectionSha256:string;
  scope?:{projectId:string;sessionId:string;branchId:string;throughSequence:number};
}
/** Shadow recommendations leave only through a trusted callback, never model-visible state or Ledger. */
export function presentCurrentWork(state:WorkingStateInput,objective:WorkingObjective|null,policy:CurrentWorkPolicy,onDiagnostic?:(view:CurrentWorkDiagnostic)=>void){
  const projection=stateProjection(state,objective);
  const recommendation=policy.actionRecommendation==='off'?null:recommend(state,projection.unresolved.length>0);
  const result={...projection,...(policy.actionRecommendation==='assist'&&recommendation?{next_action:recommendation}:{})};
  try{onDiagnostic?.({mode:policy.actionRecommendation,includedInProjection:policy.actionRecommendation==='assist',providerDelivery:'UNKNOWN',recommendation,projectionSha256:sha256(JSON.stringify(result))});}catch{/* Observations cannot control recovery. */}
  return result;
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
