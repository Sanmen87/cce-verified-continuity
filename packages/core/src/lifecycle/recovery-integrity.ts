import {sha256} from '../workspace.ts';

export interface RecoveryRequirement {eventId:string;sha256:string;text?:string}
export interface RecoveryAttempt {
  status:string; text?:string; coverage?:string; taskStatePacking?:string;
}
/** Only message text sent in user/system channels counts. Tool output, tool
 * schemas, assistant claims and arbitrary JSON metadata cannot prove recovery. */
function packetTexts(payload:unknown):string[]|null {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const messages=(payload as Record<string,unknown>).messages;if(!Array.isArray(messages))return null;
  const texts:string[]=[];
  for(const value of messages){
    if(!value||typeof value!=='object'||Array.isArray(value))continue;
    const message=value as Record<string,unknown>;if(!['user','system','developer'].includes(String(message.role)))continue;
    if(typeof message.content==='string')texts.push(message.content);
    else if(Array.isArray(message.content))for(const part of message.content){
      if(part&&typeof part==='object'&&(part.type==='text'||part.type==='input_text')&&typeof part.text==='string')texts.push(part.text);
    }
  }
  return texts;
}
/** Host-independent inspection; this does not claim provider receipt, semantic
 * understanding, or visibility of mutations made after the inspection point. */
export function inspectRecoveryPacket(payload:unknown,required:readonly RecoveryRequirement[],attempt?:RecoveryAttempt,scopeComplete=true){
  const texts=packetTexts(payload),reasons:string[]=[];
  const requirements=required.map(r=>({eventId:r.eventId,sha256:r.sha256,presence:r.text===undefined||texts===null?'UNKNOWN' as const:texts.some(t=>t.includes(r.text!)||t.includes(JSON.stringify(r.text)))?'PRESENT' as const:'MISSING' as const}));
  const recoveryPresence=!attempt?.text||texts===null?'UNKNOWN':texts.some(t=>t.includes(attempt.text!))?'PRESENT':'MISSING';
  if(texts===null)reasons.push('UNSUPPORTED_PACKET_SHAPE');
  if(!scopeComplete)reasons.push('REQUIREMENT_SCOPE_INCOMPLETE');
  if(!requirements.length)reasons.push('NO_MANDATORY_REQUIREMENTS');
  if(requirements.some(r=>r.presence==='UNKNOWN'))reasons.push('REQUIREMENTS_UNAVAILABLE');
  if(requirements.some(r=>r.presence==='MISSING'))reasons.push('MANDATORY_REQUIREMENTS_MISSING');
  if(!attempt)reasons.push('NO_RECOVERY_ATTEMPT');
  else if(attempt.status!=='COMPLETE')reasons.push(attempt.status);
  if(attempt?.text&&recoveryPresence==='MISSING')reasons.push('PREPARED_RECOVERY_MISSING');
  if(!attempt?.text)reasons.push('NO_RECOVERY_TEXT');
  if(attempt?.coverage&&attempt.coverage!=='FULL')reasons.push('RECOVERY_COVERAGE_INCOMPLETE');
  return {schemaVersion:1,status:reasons.length?'DEGRADED' as const:'PRESENT_AT_INSPECTION' as const,
    reasons,requirements,recoveryPresence,recoverySha256:attempt?.text?sha256(attempt.text):null,
    taskStatePacking:attempt?.taskStatePacking??'UNKNOWN',providerDelivery:'UNKNOWN' as const,semanticCompleteness:'UNVERIFIED' as const};
}
export type RecoveryPacketInspection=ReturnType<typeof inspectRecoveryPacket>;
