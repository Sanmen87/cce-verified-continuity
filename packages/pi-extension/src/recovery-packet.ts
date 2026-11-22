import type { RecoveredTaskState } from '../../core/src/lifecycle/recovery.ts';
import {estimateTokens} from '../../core/src/context.ts';
import type { ContextBudget } from './budget.ts';

export const recoveryPacketSafety = 512;
type Measurement = {tokens:number; serialization:string; sha256:string; recoveryPresent:boolean};
type Selection = {
  recovery:RecoveredTaskState|null; measurement:Measurement|null; reason:string;
  review:'NOT_NEEDED'|'UNAVAILABLE'|'MANDATORY_INCOMPLETE'|'PACKET_REJECTED'|'PACKET_ACCEPTED';
  reviewReason?:string;
  candidateMeasurement?:Measurement;
};
export function remainingPacketTokens(tokens:number,window:number,outputReserve:number){
  if(!Number.isSafeInteger(tokens)||tokens<=0)throw Error('Invalid serialized packet count');
  return window-outputReserve-recoveryPacketSafety-tokens;
}
/** A diagnostic scenario only. No future tool result is known at this point. */
export function forecastToolPressure(headroom:number|null,messages:readonly {role:string}[],estimateFactor:number){
  const lastResult=messages.findLast(m=>m.role==='toolResult');
  const repeatLastToolResultEstimatedTokens=lastResult?estimateTokens(JSON.stringify(lastResult),estimateFactor):null;
  const forecast=headroom===null||repeatLastToolResultEstimatedTokens===null?'UNKNOWN':
    repeatLastToolResultEstimatedTokens>headroom?'PRESSURE':'WITHIN_HEADROOM';
  return {headroom,repeatLastToolResultEstimatedTokens,forecast,
    source:lastResult?'LAST_TOOL_RESULT_UTF8_ESTIMATE':'NO_TOOL_RESULT',
    certainty:'SCENARIO_ONLY',estimateFactor,actualNextPacketTokens:null};
}

/** The envelope is a first-pass estimate. Only an inspected supported SDK body
 * and matching tokenizer can admit a mandatory candidate outside that estimate. */
export async function selectRecoveryPacket(capacity:ContextBudget,hardLimit:number,
  compile:(budget:number,mandatoryOnly?:boolean)=>Promise<RecoveredTaskState>,
  measure:((recovery:RecoveredTaskState)=>Promise<Measurement>)|undefined,
  supportedSerializer:boolean):Promise<Selection>{
  const normal=capacity.textBudget>0 && capacity.historyKnown?await compile(capacity.textBudget):null;
  const fits=(m:Measurement)=>remainingPacketTokens(m.tokens,capacity.windowTokens,capacity.outputReserveTokens)>=0;
  let measured:Measurement|null=null;
  try {if(normal?.text && measure){measured=await measure(normal);fits(measured);}}
  catch {return {recovery:null,measurement:null,reason:'PACKET_MEASUREMENT_UNKNOWN',review:'UNAVAILABLE',reviewReason:'PACKET_MEASUREMENT_UNKNOWN'};}
  if(measured && measured.serialization!=='pi-openai-completions')
    return {recovery:null,measurement:null,reason:'UNSUPPORTED_SERIALIZER',review:'UNAVAILABLE',reviewReason:'UNSUPPORTED_SERIALIZER'};
  const accepted=normal?.text && (!measured || (fits(measured) && measured.recoveryPresent))?normal:null;
  const reason=accepted?'INJECTED':measured?'SKIPPED_PACKET_CAPACITY':capacity.historyKnown?'SKIPPED_BUDGET_EXHAUSTED':'SKIPPED_BUDGET_UNKNOWN';
  const fallback={recovery:accepted,measurement:accepted?measured:null,reason};
  if(accepted && !supportedSerializer)
    return {...fallback,review:'UNAVAILABLE',reviewReason:'UNSUPPORTED_SERIALIZER'};
  if(accepted && accepted.status!=='INCOMPLETE_BUDGET')
    return {...fallback,review:'NOT_NEEDED'};
  if(!measure || !supportedSerializer || !capacity.historyKnown || capacity.source!=='model-tokenizer' ||
      capacity.availableTokens<=recoveryPacketSafety || hardLimit<1 ||
      (hardLimit<=capacity.textBudget && (!measured || fits(measured))))
    return {...fallback,review:'UNAVAILABLE'};
  let candidate:RecoveredTaskState;
  try {candidate=await compile(hardLimit,true);}catch{return {...fallback,review:'UNAVAILABLE',reviewReason:'MANDATORY_CANDIDATE_BUILD_FAILED'};}
  if(!candidate.text || candidate.status!=='COMPLETE' || candidate.handoff?.coverage!=='FULL' ||
      candidate.handoff.taskStatePacking!=='MANDATORY')return {...fallback,review:'MANDATORY_INCOMPLETE',reviewReason:
        candidate.handoff?.omitted.length?'MANDATORY_ORIGINALS_OMITTED':candidate.status==='INCOMPLETE_BUDGET'?'MANDATORY_LAYOUT_UNAVAILABLE_WITHIN_LIMIT':candidate.status};
  let packet:Measurement;
  try {
    packet=await measure(candidate);
    if(packet.serialization!=='pi-openai-completions')return {...fallback,review:'UNAVAILABLE',reviewReason:'UNSUPPORTED_SERIALIZER'};
    if(!packet.recoveryPresent)return {...fallback,review:'PACKET_REJECTED',reviewReason:'PREPARED_RECOVERY_MISSING',candidateMeasurement:packet};
    if(!fits(packet))return {...fallback,review:'PACKET_REJECTED',reviewReason:'MANDATORY_PACKET_EXCEEDS_CAPACITY',candidateMeasurement:packet};
  }catch{return {...fallback,review:'UNAVAILABLE',reviewReason:'MANDATORY_PACKET_COUNT_UNKNOWN'};}
  return {recovery:candidate,measurement:packet,reason:'INJECTED',review:'PACKET_ACCEPTED',candidateMeasurement:packet};
}
