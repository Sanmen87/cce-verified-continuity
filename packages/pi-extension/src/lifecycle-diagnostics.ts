import {sha256} from '../../core/src/workspace.ts';
import {containsSecret} from '../../core/src/native/secrets.ts';
export interface LifecycleDiagnostic {
  schemaVersion:1; at:string; attemptId:string; sessionId:string|null; branchId:string|null;
  reason:string; outcome:'NATIVE_FALLBACK'|'CCE_HANDOFF'|'OBSERVE'|'APPLIED_NATIVE'|'APPLIED_CCE'|'FAILED';
  stage:string; trigger:string; willRetry:boolean; firstKeptEntryId:string|null;
  budget?:unknown; budgetInputs?:unknown; handoff?:unknown; error?:ReturnType<typeof diagnosticError>;
}
export function diagnosticError(error:unknown){
  const e=error instanceof Error?error:new Error('Non-Error exception'),raw=e.message;
  const message=containsSecret(raw)?'[potential secret omitted]':raw.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[redacted]@').slice(0,384);
  const code='code'in e&&typeof e.code==='string'?e.code.slice(0,64):null;
  return{name:e.name.slice(0,64),code,message,messageSha256:sha256(raw),truncated:raw.length>384,untrusted:true};
}
export class CounterFailure extends Error {
  readonly code='TOKEN_COUNTER_FAILED';
  readonly stage:string;readonly inputBytes:number;readonly inputSha256:string;
  constructor(stage:string,inputBytes:number,inputSha256:string,cause:unknown){super('Token counter failed at '+stage,{cause});this.name='CounterFailure';this.stage=stage;this.inputBytes=inputBytes;this.inputSha256=inputSha256;}
}
