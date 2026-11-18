import {sha256} from '../workspace.ts';
export interface ActionObservation {id:string;tool:string;input:unknown;outputSha256:string;sourceState:string;scope:string}
const canonical=(value:unknown)=>JSON.stringify(value,(_key,v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
/** Passive grouping, not a stop policy or a judgement that a check was useless.
 * Source equality says nothing about unobserved external state or polling. */
export function repeatedActions(observations:readonly ActionObservation[],threshold=3){
  if(!Number.isSafeInteger(threshold)||threshold<2)throw Error('Invalid repeat threshold');
  const groups=new Map<string,ActionObservation[]>();
  for(const row of observations){const key=sha256(canonical([row.scope,row.tool,row.input,row.outputSha256,row.sourceState]));const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
  return [...groups].filter(([,rows])=>rows.length>=threshold).map(([fingerprint,rows])=>({fingerprint,ids:rows.map(r=>r.id),calls:rows.length,additionalCalls:rows.length-1,
    classification:'REPEATED_WITHOUT_OBSERVED_SOURCE_CHANGE' as const,authority:'DIAGNOSTIC_ONLY' as const,externalState:'UNKNOWN' as const,
    redundant:'NOT_ESTABLISHED' as const,intervention:'NONE' as const}));
}
