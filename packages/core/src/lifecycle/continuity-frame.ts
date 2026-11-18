import { sha256 } from '../workspace.ts';
import type { ExplicitTaskContract } from '../quality/contracts.ts';
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
/** Experimental transport representation; no store, host injection or default change. */
export function continuityBase(input:{projectId:string;taskScope:string;checkpointId:string;contractRevision:string;sourceEventId:string;contract:ExplicitTaskContract}){
  const record=structuredClone({schemaVersion:1,projectId:input.projectId,taskScope:input.taskScope,checkpointId:input.checkpointId,contractRevision:input.contractRevision,sourceEventId:input.sourceEventId,contract:input.contract});
  return{...record,baseRevision:sha256(stable(record))};
}
export type ContinuityBase=ReturnType<typeof continuityBase>;
export function continuityDelta(base:ContinuityBase,currentWork:unknown,sourceBinding:string){
  const record={schemaVersion:1,baseRevision:base.baseRevision,currentWork,sourceBinding};
  return{...record,deltaRevision:sha256(stable(record))};
}
export const baseText=(base:ContinuityBase)=>'CCE CONTINUITY BASE v1\n'+stable(base);
export const deltaText=(delta:ReturnType<typeof continuityDelta>)=>'CCE CURRENT WORKING DELTA v1\n'+stable(delta);
/** Inspect the actual serialized packet, not a remembered checkpoint ID. A text
 * echo inside an assistant/tool result cannot establish base presence. */
export function inspectContinuityPacket(payload:unknown,base:ContinuityBase,delta:ReturnType<typeof continuityDelta>){
  const packet=payload&&typeof payload==='object'?payload as Record<string,unknown>:{};
  const supported=Array.isArray(packet.messages);
  const texts=(supported?packet.messages as unknown[]:[]).flatMap(message=>{
    if(!message||typeof message!=='object')return[];const m=message as Record<string,unknown>;
    if(m.role!=='user')return[];
    return typeof m.content==='string'?[m.content]:Array.isArray(m.content)?m.content.flatMap(p=>p&&typeof p==='object'&&(p as Record<string,unknown>).type==='text'&&typeof (p as Record<string,unknown>).text==='string'?[(p as {text:string}).text]:[]):[];
  });
  const basePresent=texts.includes(baseText(base)),deltaPresent=texts.includes(deltaText(delta)),revisionMatches=base.baseRevision===delta.baseRevision;
  const {baseRevision,...baseRecord}=base,{deltaRevision,...deltaRecord}=delta;
  const fingerprintsMatch=baseRevision===sha256(stable(baseRecord))&&deltaRevision===sha256(stable(deltaRecord));
  const status=!supported?'UNSUPPORTED_PACKET':!fingerprintsMatch?'INVALID_FINGERPRINT':!revisionMatches?'REVISION_MISMATCH':!basePresent?'MISSING_BASE':!deltaPresent?'MISSING_DELTA':'PRESENT_IN_PACKET';
  return{status,basePresent,deltaPresent,revisionMatches,providerDelivery:'UNKNOWN' as const};
}
