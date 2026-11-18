export const EVENT_KINDS = ['USER_GOAL','USER_REQUIREMENT','TASK_CONTRACT','TASK_DECISION','SOURCE_OBSERVED','SOURCE_MODIFIED','TOOL_RESULT','TEST_EXECUTED','IMPLEMENTATION_REPORTED','DEPENDENCY_DISCOVERED','COMPACTION_STARTED','COMPACTION_COMPLETED','COMPACTION_FAILED','CONTEXT_RESTORED','OPEN_ISSUE','NEXT_STEP','MESSAGE','NARRATIVE','RETENTION'] as const;
export type ContextEventKind = typeof EVENT_KINDS[number];
export type EventOrigin = 'user' | 'agent' | 'tool' | 'host' | 'unknown';
export interface SourceReference { path:string; sha256:string; startLine?:number; endLine?:number }
export interface EventInput {
  externalId:string; kind:ContextEventKind; text:string; origin:EventOrigin;
  timestamp?:string; sources?:SourceReference[]; toolCallId?:string; messageId?:string;
  mandatory?:boolean; supersedes?:string; exitCode?:number|null; isError?:boolean;
}
export interface ContextEvent {
  id:string; sequence:number; projectId:string; sessionId:string; branchId:string;
  kind:ContextEventKind; origin:EventOrigin; timestamp:string; title:string;
  blobSha256:string; bytes:number; sources:SourceReference[]; mandatory:boolean;
  toolCallId?:string; messageId?:string; supersedes?:string; exitCode?:number|null; isError?:boolean;
  previousHash:string; recordHash:string; trust:'UNTRUSTED_DATA'; historical:true;
}
export type EvidencePresence = 'FULL_BODY'|'PARTIAL_BODY'|'REFERENCE_ONLY'|'OMITTED'|'UNKNOWN';
export interface EvidenceObservation { evidenceId:string; presence:EvidencePresence; source?:SourceReference; bodySha256?:string; text?:string }
export interface WindowManifest {
  schemaVersion:1; projectId:string; sessionId:string; branchId:string; projectionId:string;
  generation:number; modelId:string|null; observation:'unknown'|'pre-provider'|'pre-context'|'compacted';
  delivery:'UNKNOWN'; payloadSha256:string|null; evidence:EvidenceObservation[];
}
export type HandoffStatus='COMPLETE'|'INCOMPLETE_BUDGET'|'MISSING_EVIDENCE'|'STALE_EVIDENCE'|'UNVERIFIED';
export interface TokenCounter { source:'model-tokenizer'|'estimated:utf8-bytes'; modelId?:string; count:(text:string)=>number|Promise<number> }
export interface CompiledHandoff {
  text:string; status:HandoffStatus; issues:HandoffStatus[]; tokens:number; budget:number;
  accounting:TokenCounter['source']; uncertainty:boolean; included:string[];
  omitted:Array<{eventId:string;reason:string}>; mandatory:Array<{eventId:string;status:'PRESERVED'|'REFERENCED'|'OMITTED'|'STALE'|'UNVERIFIED'}>;
  ledgerSequence:number; safeToCompact:boolean;
  narratives?:Array<{id:string;text:string}>;
  coverage?:'FULL'|'REFERENCE_ONLY'|'INCOMPLETE';
  taskStatePacking?:'FULL'|'MINIMAL'|'ABSENT'|'NOT_REQUESTED';
}
export interface MiniCompressor {
  compress(input:{narratives:Array<{id:string;text:string}>;signal:AbortSignal}):Promise<unknown>;
}
