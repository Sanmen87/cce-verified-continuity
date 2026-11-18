import {randomUUID} from 'node:crypto';
import type {ContextLifecycle} from './service.ts';
import type {ContextEvent} from './contracts.ts';
import {contractRevisions} from './task-contract.ts';
import {validateTaskContract} from '../quality/tracker.ts';
import {sha256} from '../workspace.ts';import {boundedString,object} from '../config.ts';

export interface ContinuationHandle {projectId:string;taskId:string;sourceSessionId:string;sourceBranchId:string;checkpointId:string;sha256:string}
interface Manifest {schemaVersion:1;type:'CCE_DURABLE_CONTINUATION';projectId:string;taskId:string;sourceSessionId:string;sourceBranchId:string;throughSequence:number;createdAt:string;
  contractRevisionId:string;contractSha256:string;events:Array<{id:string;recordHash:string;blobSha256:string}>;files:Record<string,string|null>;omittedFileCount:number}
const digest=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid continuation hash');return value;};
export function validateContinuationHandle(value:unknown):ContinuationHandle{const v=object(value);return{projectId:digest(v.projectId),taskId:boundedString(v.taskId,128),sourceSessionId:boundedString(v.sourceSessionId,256),sourceBranchId:boundedString(v.sourceBranchId,256),checkpointId:digest(v.checkpointId),sha256:digest(v.sha256)};}
export async function saveContinuation(life:ContextLifecycle,taskId:string):Promise<ContinuationHandle>{
  await life.taskContract();const {ledger,engine,branchId}=life,session=engine.sessionId;
  const revisions=await contractRevisions(ledger,session,branchId),active=revisions.at(-1);if(!active||active.revision.contractId!==boundedString(taskId,128))throw Error('Continuation requires the active explicit task');
  const working=ledger.currentFacts(session,branchId);if(working.mandatoryOverflow)throw Error('Continuation mandatory event limit');
  const events=[];for(const event of working.events){await ledger.original(session,branchId,event.id);events.push({id:event.id,recordHash:event.recordHash,blobSha256:event.blobSha256});}
  const needed=[...new Set([...active.revision.contract.requirements.flatMap(r=>r.needs.flatMap(n=>n.path?[n.path]:[])),...working.events.flatMap(e=>e.sources.map(s=>s.path))])];
  const files:Record<string,string|null>={};for(const file of needed.slice(0,64)){engine.workspace.normalize(file);try{files[file]=(await engine.workspace.read(file,engine.config.retrieval.maxFileBytes)).sha256;}catch{files[file]=null;}}
  const manifest:Manifest={schemaVersion:1,type:'CCE_DURABLE_CONTINUATION',projectId:engine.workspace.projectId,taskId,sourceSessionId:session,sourceBranchId:branchId,throughSequence:ledger.latestSequence(session,branchId),createdAt:new Date().toISOString(),contractRevisionId:active.revision.revisionId,contractSha256:sha256(JSON.stringify(active.revision.contract)),events,files,omittedFileCount:Math.max(0,needed.length-64)};
  const text=JSON.stringify(manifest),saved=await ledger.append(session,branchId,{externalId:'continuation:'+randomUUID(),kind:'MESSAGE',origin:'host',text});
  if((await ledger.original(session,branchId,saved.id)).text!==text)throw Error('Continuation read-back failed');
  return{projectId:engine.workspace.projectId,taskId,sourceSessionId:session,sourceBranchId:branchId,checkpointId:saved.id,sha256:sha256(text)};
}
async function inspect(life:ContextLifecycle,value:ContinuationHandle){
  const handle=validateContinuationHandle(value),{engine,ledger}=life;if(handle.projectId!==engine.workspace.projectId)throw Error('Continuation project mismatch');
  const saved=await ledger.original(handle.sourceSessionId,handle.sourceBranchId,handle.checkpointId);
  if(saved.event.origin!=='host'||saved.event.kind!=='MESSAGE'||sha256(saved.text)!==handle.sha256)throw Error('Continuation integrity mismatch');
  const m=JSON.parse(saved.text) as Manifest;
  if(m.schemaVersion!==1||m.type!=='CCE_DURABLE_CONTINUATION'||m.projectId!==handle.projectId||m.taskId!==handle.taskId||m.sourceSessionId!==handle.sourceSessionId||m.sourceBranchId!==handle.sourceBranchId||!Number.isSafeInteger(m.throughSequence)||m.throughSequence>=saved.event.sequence||!Array.isArray(m.events)||m.events.length>2048)throw Error('Invalid continuation scope/manifest');
  const originals:Array<{event:ContextEvent;text:string}>=[],seen=new Set();
  for(const reference of m.events){if(seen.has(reference.id))throw Error('Duplicate continuation reference');seen.add(reference.id);const original=await ledger.original(m.sourceSessionId,m.sourceBranchId,reference.id);if(original.event.sequence>m.throughSequence||original.event.recordHash!==reference.recordHash||original.event.blobSha256!==reference.blobSha256)throw Error('Continuation event binding mismatch');originals.push(original);}
  const revisions=await contractRevisions(ledger,m.sourceSessionId,m.sourceBranchId);const active=revisions.filter(r=>r.event.sequence<=m.throughSequence).at(-1);
  if(!active||active.revision.revisionId!==m.contractRevisionId||!seen.has(active.event.id)||sha256(JSON.stringify(active.revision.contract))!==m.contractSha256||active.revision.contractId!==m.taskId)throw Error('Continuation contract mismatch');
  const expected=ledger.currentFacts(m.sourceSessionId,m.sourceBranchId,m.throughSequence);if(expected.mandatoryOverflow||expected.events.some(e=>e.mandatory&&!seen.has(e.id)))throw Error('Continuation mandatory coverage incomplete');
  for(const [file,hash]of Object.entries(object(m.files))){engine.workspace.normalize(file);if(hash!==null)digest(hash);}
  if(Object.keys(m.files).length>64||!Number.isSafeInteger(m.omittedFileCount)||m.omittedFileCount<0)throw Error('Continuation file scope limit');
  return{handle,manifest:m,originals,contract:validateTaskContract(active.revision.contract)};
}
export async function restoreContinuation(life:ContextLifecycle,value:ContinuationHandle){
  if(life.engine.config.mode!=='assist'||life.engine.config.lifecycle.recoveryPolicy!=='verified-state')throw Error('Continuation adoption requires explicit assist/verified-state');
  const checked=await inspect(life,value),{engine,ledger,branchId}=life;
  if(checked.handle.sourceSessionId===engine.sessionId)throw Error('Continuation requires a different clean session');
  if(!engine.quality)throw Error('Continuation requires task-state coverage support');
  const tracker=engine.quality.tracker;
  if(tracker&&JSON.stringify(tracker.contract)!==JSON.stringify(checked.contract))throw Error('Continuation cannot replace another task');
  const importId=sha256(JSON.stringify([engine.workspace.projectId,engine.sessionId,branchId,'continuation-import:'+checked.handle.checkpointId]));
  const existing=ledger.get(engine.sessionId,branchId,importId);
  if(!existing&&ledger.currentFacts(engine.sessionId,branchId).events.some(e=>e.mandatory))throw Error('Continuation target must be a clean task session');
  if(!existing){
    const mapping=new Map<string,string>();
    await ledger.atomic(async()=>{
      for(const {event,text}of checked.originals){const supersedes=event.supersedes?mapping.get(event.supersedes):undefined;
        const copy=await ledger.append(engine.sessionId,branchId,{externalId:'continuation-fact:'+event.id,kind:event.kind,origin:event.origin,text,timestamp:event.timestamp,sources:event.sources,mandatory:event.mandatory,...(event.messageId?{messageId:event.messageId}:{}),...(event.toolCallId?{toolCallId:event.toolCallId}:{}),...(supersedes?{supersedes}:{}),...(event.exitCode!==undefined?{exitCode:event.exitCode}:{}),...(event.isError!==undefined?{isError:event.isError}:{})});mapping.set(event.id,copy.id);}
      await ledger.append(engine.sessionId,branchId,{externalId:'continuation-import:'+checked.handle.checkpointId,kind:'MESSAGE',origin:'host',text:JSON.stringify({type:'CCE_CONTINUATION_IMPORTED',handle:checked.handle,throughSequence:checked.manifest.throughSequence,mapping:[...mapping],receiptAuthority:'HISTORICAL_ONLY'})});
      const active=(await contractRevisions(ledger,engine.sessionId,branchId)).at(-1);if(active?.revision.revisionId!==checked.manifest.contractRevisionId)throw Error('Imported contract version changed');
    });
  }else{const data=JSON.parse((await ledger.original(engine.sessionId,branchId,existing.id)).text);if(JSON.stringify(data.handle)!==JSON.stringify(checked.handle))throw Error('Conflicting continuation activation');}
  if(!existing||!tracker)engine.quality.setContract(checked.contract);
  return{handle:checked.handle,manifest:checked.manifest};
}
export async function continuationView(life:ContextLifecycle,manifest:Manifest,handle:ContinuationHandle){
  const files=[];for(const [file,oldHash]of Object.entries(manifest.files)){
    let currentHash:string|null=null;try{currentHash=(await life.engine.workspace.read(file,life.engine.config.retrieval.maxFileBytes)).sha256;}catch{}
    files.push({path:file,savedSha256:oldHash,currentSha256:currentHash,freshness:currentHash===null?'MISSING':currentHash===oldHash?'CURRENT':'STALE'});
  }
  const native=life.engine.native,indexed=native?.store.files(),headers=native?.store.chunkHeaders()??[];
  const projectMap=files.slice(0,8).map(file=>({path:file.path,sha256:file.currentSha256,indexFresh:!!file.currentSha256&&indexed?.get(file.path)===file.currentSha256,
    symbols:file.currentSha256&&indexed?.get(file.path)===file.currentSha256?headers.filter(c=>c.path===file.path&&c.fileHash===file.currentSha256).slice(0,8).map(c=>({id:c.id,name:c.qualifiedName,kind:c.kind,startLine:c.startLine})):[]}));
  return{scope:'EXPLICIT_TASK_CONTINUATION',source:handle,contractRevisionId:manifest.contractRevisionId,receiptAuthority:'HISTORICAL_ONLY_RECHECK_REQUIRED',historicalReceiptFreshness:files.some(f=>f.freshness!=='CURRENT')?'STALE':'UNKNOWN',files:files.slice(0,16),omittedFileCount:Math.max(0,files.length-16)+manifest.omittedFileCount,projectMemory:{backend:native?'EXISTING_NATIVE_INDEX':'SOURCE_REFERENCES_ONLY',projectMap,omittedFiles:Math.max(0,files.length-8)+manifest.omittedFileCount,bodyRepresentation:'REFERENCE_ONLY',dependencies:'EXISTING_RETRIEVAL_ON_DEMAND'}};
}
