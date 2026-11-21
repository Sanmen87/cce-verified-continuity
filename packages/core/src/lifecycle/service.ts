import type { ContextEngine } from '../index.ts';
import { sha256 } from '../workspace.ts';
import { integer, boundedString } from '../config.ts';
import { containsSecret } from '../native/secrets.ts';
import { ContextLedger } from './ledger.ts';
import { ContextProjection } from './projection.ts';
import { compileHandoff, conservativeCounter } from './compiler.ts';
import type { ContextEvent, EvidenceObservation, SourceReference, TokenCounter } from './contracts.ts';
import { schemaEvidence } from './schema-evidence.ts';
import { prepareTaskRecovery } from './recovery.ts';
import { confirmTaskContract, contractRevisions } from './task-contract.ts';
import { projectTaskState } from './task-state.ts';
import type { ExplicitTaskContract } from '../quality/contracts.ts';
import { observeExecution } from '../quality/execution.ts';
import pathModule from 'node:path';
import {realpath} from 'node:fs/promises';
import {checkpointPath} from '../checkpoint-path.ts';
import {saveContinuation as persistContinuation,restoreContinuation as adoptContinuation,continuationView,type ContinuationHandle} from './continuation.ts';
export class ContextLifecycle {
  readonly engine:ContextEngine; readonly ledger:ContextLedger; branchId='main'; projection:ContextProjection;
  private observations=new Map<string,EvidenceObservation>();
  private resumed:Awaited<ReturnType<typeof adoptContinuation>>|undefined;
  saveContinuation(taskId:string){return persistContinuation(this,taskId);}
  async restoreContinuation(handle:ContinuationHandle){this.resumed=await adoptContinuation(this,handle);return this.continuationState();}
  async continuationState(){return this.resumed?continuationView(this,this.resumed.manifest,this.resumed.handle):null;}
  private async historyOriginal(eventId:string){
    if(this.ledger.get(this.engine.sessionId,this.branchId,eventId))return this.ledger.original(this.engine.sessionId,this.branchId,eventId);
    if(this.resumed){const {manifest}=this.resumed,event=this.ledger.get(manifest.sourceSessionId,manifest.sourceBranchId,eventId);if(event&&event.sequence<=manifest.throughSequence)return this.ledger.original(manifest.sourceSessionId,manifest.sourceBranchId,eventId);}
    throw Error('History event not found or access denied');
  }
  private constructor(engine:ContextEngine,ledger:ContextLedger){this.engine=engine;this.ledger=ledger;this.branchId=ledger.activeBranch(engine.sessionId)?.branch??'main';ledger.branch(engine.sessionId,this.branchId);this.projection=new ContextProjection(ledger,engine.sessionId,this.branchId);}
  static async open(engine:ContextEngine){const c=engine.config.lifecycle;return new ContextLifecycle(engine,await ContextLedger.open(engine.workspace,engine.config.storage.stateDir,{maxBlobBytes:c.maxBlobBytes,maxStoreBytes:c.maxStoreBytes}));}
  async switchBranch(id:string,parent?:string,cutoff?:number){this.ledger.branch(this.engine.sessionId,id,parent,cutoff);this.branchId=id;this.projection=new ContextProjection(this.ledger,this.engine.sessionId,id);this.observations.clear();}
  async userRequirement(externalId:string,text:string,sourceEventId?:string){
    if(sourceEventId!==undefined)boundedString(sourceEventId,256);
    const session=this.engine.sessionId,existing=this.ledger.get(session,this.branchId,sha256(JSON.stringify([this.engine.workspace.projectId,session,this.branchId,externalId])));
    if(existing){if(existing.blobSha256!==sha256(text)||existing.origin!=='user'||sourceEventId!==undefined&&existing.messageId!==sourceEventId)throw Error('Conflicting user event');return existing;}
    const first=this.engine.config.lifecycle.recoveryPolicy==='verified-state'?!this.ledger.facts(session,this.branchId).some(e=>e.kind==='USER_GOAL'&&e.origin==='user'):!this.ledger.list(session,this.branchId,{mandatory:true,limit:1}).length;
    return this.ledger.append(session,this.branchId,{externalId,kind:first?'USER_GOAL':'USER_REQUIREMENT',origin:'user',text,mandatory:true,...(sourceEventId?{messageId:sourceEventId}:{})});
  }
  async confirmContract(contract:ExplicitTaskContract,confirmation:{sourceEventId:string;supersedes:string|null}){
    const revision=await confirmTaskContract(this.ledger,this.engine.sessionId,this.branchId,contract,confirmation);
    if(revision.created&&(await contractRevisions(this.ledger,this.engine.sessionId,this.branchId)).at(-1)?.revision.revisionId===revision.revision.revisionId)this.engine.quality?.setContract(contract);
    return revision;
  }
  async taskState(){await this.taskContract();return projectTaskState(this);}
  async recoveryRequirements(){
    await this.taskContract();
    const events=this.ledger.list(this.engine.sessionId,this.branchId,{mandatory:true,limit:1024});
    const superseded=new Set(events.filter(e=>e.origin==='user'||e.origin==='host').flatMap(e=>e.supersedes?[e.supersedes]:[]));
    const required=await Promise.all(events.filter(e=>!superseded.has(e.id)).map(async e=>{
      try{const original=(await this.ledger.original(this.engine.sessionId,this.branchId,e.id)).text;
        return {eventId:e.id,sha256:e.blobSha256,...(!containsSecret(original)?{text:original}:{})};
      }catch{return {eventId:e.id,sha256:e.blobSha256};}
    }));
    return {required,scopeComplete:events.length<1024};
  }
  async runApprovedCheck(checkId:string){
    await this.taskContract();
    const quality=this.engine.quality;
    if(!quality?.feedback||!quality.tracker)throw Error('No task-bound verification adapter');
    const receipt=await quality.feedback.run(checkId);
    const view={type:'CCE_APPROVED_CHECK',receiptId:receipt.id,checkId:receipt.checkId,status:receipt.status,
      source:receipt.source,requirementIds:receipt.requirementIds,contractSha256:quality.tracker.contractSha256,
      diagnostic:receipt.diagnostic,finishedAt:receipt.finishedAt};
    await this.ledger.append(this.engine.sessionId,this.branchId,{externalId:'approved-check:'+receipt.id,kind:'TEST_EXECUTED',origin:'host',text:JSON.stringify(view)});
    if(receipt.status==='FAIL')await this.ledger.append(this.engine.sessionId,this.branchId,{
      externalId:'approved-check-issue:'+receipt.id,kind:'OPEN_ISSUE',origin:'host',isError:true,
      text:JSON.stringify({...view,type:'CCE_APPROVED_CHECK_FAILURE',historical:true}),
    });
    return receipt;
  }
  async taskContract(){const task=this.engine.quality?.tracker?.contract;if(!task)return;
    if(this.engine.config.lifecycle.recoveryPolicy==='verified-state'){
      const active=(await contractRevisions(this.ledger,this.engine.sessionId,this.branchId)).at(-1);
      if(active){if(JSON.stringify(active.revision.contract)!==JSON.stringify(task))throw Error('Explicit contract revision confirmation required');return;}
      await confirmTaskContract(this.ledger,this.engine.sessionId,this.branchId,task,{sourceEventId:'configured:'+sha256(JSON.stringify(task)),supersedes:null});
      return;
    }
    for(const r of task.requirements)await this.ledger.append(this.engine.sessionId,this.branchId,{externalId:'contract:'+sha256(task.id+':'+r.id+':'+r.clause),kind:'USER_REQUIREMENT',origin:'user',text:r.clause,mandatory:true});
  }
  async compile(budget=this.engine.config.lifecycle.handoffBudgetTokens,counter?:TokenCounter,throughSequence?:number,verificationAccess?:'IN_LOOP'|'HOST_ONLY'){await this.taskContract();const binding=this.engine.quality?.tracker?await this.engine.quality.binding():undefined,states=binding?this.engine.quality!.tracker!.inspect(binding):[];const current=states.filter(r=>r.status==='VERIFIED_PASS'||r.status==='VERIFIED_FAIL');return compileHandoff(this.ledger,this.engine.sessionId,this.branchId,{budget,configurationGeneration:sha256(JSON.stringify(this.engine.config.lifecycle)),...(counter?{counter}:{}),...(throughSequence!==undefined?{throughSequence}:{}),...(this.engine.config.lifecycle.recoveryPolicy==='verified-state'?{taskState:await projectTaskState(this,verificationAccess)}:{}),...(current.length?{currentVerification:{requirements:current.map(r=>({id:r.id,status:r.status,checks:r.checks})),...(this.engine.config.lifecycle.recoveryPolicy==='verified-state'?{}:{binding})}}:{})});}
  async recover(budget:number,counter:TokenCounter=conservativeCounter,verificationAccess?:'IN_LOOP'|'HOST_ONLY'){
    return prepareTaskRecovery(limit=>this.compile(limit,counter,undefined,verificationAccess),budget,counter);
  }
  async canonicalSourcePath(input:string){return checkpointPath(this.engine.workspace,input,new Set(await this.engine.sourceFiles(true)));}
  async recordTool(callId:string,name:string,payload:unknown,input:Record<string,unknown>,isError:boolean){
    const text=JSON.stringify(payload);const sources:SourceReference[]=[];
    // Only exact native reads of current full files establish file-body evidence.
    if(name==='read'&&typeof input.path==='string'){
      try{const p=await this.canonicalSourcePath(input.path),source=await this.engine.workspace.read(p,this.engine.config.retrieval.maxFileBytes);
        const content=asRecord(payload).content;if(Array.isArray(content)&&content.some(c=>asRecord(c).text===source.text))sources.push({path:p,sha256:source.sha256});
      }catch{/* Unvalidated native outputs remain historical tool data. */}
    }
    const code=asRecord(asRecord(payload).details).exitCode;
    const event=await this.ledger.append(this.engine.sessionId,this.branchId,{externalId:'tool:'+callId,kind:'TOOL_RESULT',origin:'tool',text:JSON.stringify({toolName:name,result:JSON.parse(text)}),toolCallId:callId,sources,isError,exitCode:typeof code==='number'&&Number.isSafeInteger(code)&&code>=-255&&code<=255?code:null});
    const output=Array.isArray(asRecord(payload).content)?(asRecord(payload).content as unknown[]).flatMap(c=>typeof asRecord(c).text==='string'?[String(asRecord(c).text)]:[]).join('\n'):'';
    const execution=observeExecution(typeof code==='number'?code:null,isError,output);
    if(isError||typeof code==='number'&&code!==0||name==='bash'&&execution.requiresReview){
      const content=asRecord(payload).content,lines=Array.isArray(content)?content.flatMap(c=>typeof asRecord(c).text==='string'?String(asRecord(c).text).split(/\r?\n/):[]):[];
      const important=lines.filter(line=>/error|fail|exception|traceback|assert/i.test(line)),selected=important.length?important:[...lines.slice(0,2),...lines.slice(-2)];
      const diagnostic=selected.slice(0,8).map(line=>containsSecret(line)?'[Potential secret diagnostic omitted]':line.slice(0,256));
      const status=execution.observedOutcome==='CONTRADICTORY'?'TOOL_OUTPUT_CONTRADICTION':execution.observedOutcome==='DIAGNOSTIC'?'TOOL_DIAGNOSTIC_OBSERVED':'TOOL_ERROR_OBSERVED';
      await this.ledger.append(this.engine.sessionId,this.branchId,{externalId:'tool-issue:'+callId,kind:'OPEN_ISSUE',origin:'tool',toolCallId:callId,exitCode:typeof code==='number'&&Number.isSafeInteger(code)&&code>=-255&&code<=255?code:null,isError:execution.observedOutcome!=='DIAGNOSTIC',text:JSON.stringify({status,execution,historical:true,resolution:'UNVERIFIED',toolName:name,originalEventId:event.id,diagnostic,diagnosticPartial:selected.length>8||selected.some(line=>line.length>256),nextAction:'Recover full original before treating this error as resolved'})});
    }
    for(const source of sources){const body=(await this.engine.workspace.read(source.path,this.engine.config.retrieval.maxFileBytes)).text;this.remember({evidenceId:event.id,presence:'FULL_BODY',source,text:body,bodySha256:sha256(body)});}
    return event;
  }
  private remember(observation:EvidenceObservation){
    this.observations.set(observation.evidenceId,observation);let size=[...this.observations.values()].reduce((n,e)=>n+Buffer.byteLength(e.text??''),0);
    while(this.observations.size>256||size>2097152){const first=this.observations.entries().next().value;if(!first)break;size-=Buffer.byteLength(first[1].text??'');this.observations.delete(first[0]);}
  }
  async observeContext(payload:unknown,modelId:string|null,stage:'pre-context'|'pre-provider'){
    if(!this.engine.config.lifecycle.projectionEnabled)return null;
    return this.projection.observe(JSON.stringify(payload),[...this.observations.values()],modelId,stage,visibleText(payload));
  }
  async search(query:string,options:{scope?:'source'|'history'|'all';path?:string;topK?:number;maxTokens?:number}={}){
    boundedString(query,256);const topK=integer(options.topK??8,1,50),budget=integer(options.maxTokens??2048,1,12000);
    const output:{status:string;sources:unknown[];history:unknown[];memory:unknown[];accounting:string;completeness:string}={status:'FOUND',sources:[],history:[],memory:[],accounting:'estimated:utf8-bytes',completeness:'UNVERIFIED'};
    if(options.scope!=='history'){const found=await this.engine.searchCode(query,options.path?{path:options.path,includeMigrations:true}:{includeMigrations:true});output.sources=found.hits.slice(0,topK).map(h=>({...h,excerpt:undefined,representation:'REFERENCE_ONLY',evidenceId:h.chunkId??sha256(JSON.stringify([h.path,h.sha256,h.startLine,h.endLine]))}));}
    if(options.scope!=='source'&&this.engine.config.lifecycle.historyRecallEnabled)output.history=this.ledger.search(this.engine.sessionId,this.branchId,query,{limit:Math.min(topK,50)});
    if(options.scope!=='source'&&this.engine.native?.memory)output.memory=(await this.engine.native.memory.recall(query)).slice(0,topK).map(m=>({id:m.record.id,text:m.record.text.slice(0,512),authority:m.record.authority,status:m.record.status,evidence:m.record.evidence,stale:m.stale,warnings:m.warnings,trusted:false}));
    while(await conservativeCounter.count(JSON.stringify(output))>budget&&(output.history.length||output.sources.length||output.memory.length)){output.status='PARTIAL';if(output.memory.length)output.memory.pop();else if(output.history.length)output.history.pop();else output.sources.pop();}
    if(!output.sources.length&&!output.history.length&&!output.memory.length)output.status='NOT_FOUND';return this.bounded(output,budget);
  }
  async expand(request:{symbol?:string;chunkId?:string;path?:string;maxTokens?:number;offset?:number;limit?:number;include?:string[]}){
    const budget=integer(request.maxTokens??4096,1,12000),offset=integer(request.offset??0,0,1000000),limit=integer(request.limit??200,1,1000);
    let chunk=request.chunkId&&this.engine.native?await this.engine.native.expandChunk(request.chunkId):undefined;
    if(!chunk&&request.symbol&&this.engine.native){await this.engine.native.index.refresh();const exact=this.engine.native.store.chunkHeaders().filter(c=>(!request.path||c.path===request.path)&&(c.name===request.symbol||c.qualifiedName===request.symbol));if(exact.length>1)return{status:'AMBIGUOUS',candidates:exact.slice(0,20).map(c=>({chunkId:c.id,path:c.path,symbol:c.qualifiedName})),completeness:'UNVERIFIED'};if(exact[0])chunk=await this.engine.native.expandChunk(exact[0].id);}
    const file=chunk?.path??request.path;if(!file)return{status:'NOT_FOUND',completeness:'UNVERIFIED'};
    const allowed=new Set(await this.engine.sourceFiles(true));if(!allowed.has(file))return{status:'ACCESS_DENIED',completeness:'UNVERIFIED'};
    const source=await this.engine.workspace.read(file,this.engine.config.retrieval.maxFileBytes);if(containsSecret(source.text))return{status:'ACCESS_DENIED',reason:'Potential secret source',completeness:'UNVERIFIED'};
    const start=chunk?.startLine??1,full=chunk?.text??source.text,lines=full.split(/\r?\n/),text=lines.slice(offset,offset+limit).join('\n'),whole=offset===0&&limit>=lines.length;
    const reference:SourceReference={path:file,sha256:source.sha256,startLine:start+offset,endLine:start+Math.min(lines.length,offset+limit)-1};
    if(reference.endLine!<reference.startLine!)return{status:'NOT_FOUND',reason:'Range outside definition'};
    const evidenceId=sha256(JSON.stringify([reference,sha256(text)]));
    const result={status:whole?'FOUND':'PARTIAL',evidenceId,source:reference,chunkId:chunk?.id??null,representation:whole?'FULL_BODY':'PARTIAL_BODY',text,totalLines:lines.length,nextOffset:offset+limit<lines.length?offset+limit:null,completeness:'UNVERIFIED',relations:[] as unknown[],relationStatus:'NOT_REQUESTED'};
    if(request.include?.some(i=>i==='relationships'||i==='dependencies')&&chunk&&this.engine.native){const r=await this.engine.native.relatedEvidence(chunk.id,{depth:1,maxNodes:12});result.relations=r.edges;result.relationStatus='STATIC_UNVERIFIED';}
    if(await conservativeCounter.count(JSON.stringify(result))>budget)return{status:'BUDGET_EXCEEDED',source:reference,evidenceId,representation:'REFERENCE_ONLY',recommendedAction:'cce_expand with a smaller limit',completeness:'UNVERIFIED'};
    await this.ledger.append(this.engine.sessionId,this.branchId,{externalId:'source:'+evidenceId,kind:'SOURCE_OBSERVED',origin:'tool',text,sources:[reference]});
    this.remember({evidenceId,presence:whole?'FULL_BODY':'PARTIAL_BODY',source:reference,text,bodySha256:sha256(text)});return result;
  }
  async history(request:{query?:string;eventId?:string;level?:'search'|'timeline'|'original';offset?:number;limit?:number;maxTokens?:number}){
    if(!this.engine.config.lifecycle.historyRecallEnabled)return{status:'ACCESS_DENIED',reason:'History recall disabled'};
    const budget=integer(request.maxTokens??2048,1,12000),level=request.level??'search',offset=integer(request.offset??0,0,2097152),limit=integer(request.limit??10,1,50);
    if(level==='original'){
      if(!request.eventId)throw Error('Exact event ID required');
      const original=await this.historyOriginal(request.eventId);
      if(containsSecret(original.text))return{status:'ACCESS_DENIED',eventId:request.eventId,reason:'Potential secret original requires explicit local access'};
      const freshness=await Promise.all(original.event.sources.map(async s=>({source:s,status:await this.ledger.freshness(s)})));
      let end=original.text.length;
      const event={id:original.event.id,kind:original.event.kind,origin:original.event.origin,timestamp:original.event.timestamp,blobSha256:original.event.blobSha256,bytes:original.event.bytes,...(original.event.exitCode!==undefined?{exitCode:original.event.exitCode}:{}),...(original.event.isError!==undefined?{isError:original.event.isError}:{})};
      const page=(at:number)=>({status:freshness.some(f=>f.status!=='CURRENT')?'STALE':offset>0||at<original.text.length?'PARTIAL':'FOUND',event,text:original.text.slice(offset,at),freshness,trust:'UNTRUSTED_DATA',historical:true,representation:offset===0&&at===original.text.length?'FULL_BODY':'PARTIAL_BODY',totalCharacters:original.text.length,nextOffset:at<original.text.length?at:null});
      if(offset>=end)return{status:'NOT_FOUND',reason:'Offset outside original'};
      if(await conservativeCounter.count(JSON.stringify(page(end)))>budget){let low=offset,high=end;while(low<high){const middle=Math.ceil((low+high)/2);if(await conservativeCounter.count(JSON.stringify(page(middle)))<=budget)low=middle;else high=middle-1;}end=low;}
      return this.bounded(page(end),budget);
    }
    const events=level==='timeline'&&request.eventId?this.ledger.timeline(this.engine.sessionId,this.branchId,request.eventId,Math.min(limit,20)):this.ledger.search(this.engine.sessionId,this.branchId,boundedString(request.query,256),{offset,limit});
    const data={status:events.length?'FOUND':'NOT_FOUND',events,nextOffset:events.length===limit?offset+limit:null,historical:true,completeness:'UNVERIFIED'};while(await conservativeCounter.count(JSON.stringify(data))>budget&&data.events.length){data.events.pop();data.status='PARTIAL';}return this.bounded(data,budget);
  }
  async snapshot(budget=4096,schemaPaths:string[]=[]){
    const handoff=await this.compile(Math.max(1,Math.floor(budget*.5))),binding=this.engine.quality?await this.engine.quality.binding():null;
    return this.bounded({schemaVersion:1,projectId:this.engine.workspace.projectId,sessionId:this.engine.sessionId,branchId:this.branchId,sequence:handoff.ledgerSequence,handoff,requirements:binding?this.engine.quality?.tracker?.inspect(binding)??[]:[],manifest:this.projection.snapshot(),...(schemaPaths.length?{schemaEvidence:await schemaEvidence(this.engine,schemaPaths)}:{}),liveDatabaseSchema:'UNKNOWN',semanticCompleteness:'UNVERIFIED'},budget);
  }
  async sufficient(path:string){
    const absolute=pathModule.isAbsolute(path)||pathModule.win32.isAbsolute(path)?path:pathModule.join(this.engine.workspace.root,path);
    let canonical=absolute;try{canonical=await realpath(absolute);}catch{try{canonical=pathModule.join(await realpath(pathModule.dirname(absolute)),pathModule.basename(absolute));}catch{/* Unknown paths cannot match a current explicit evidence target. */}}
    // Native Pi accepts Windows short/absolute paths; compare physical paths, not their spelling.
    const input=pathModule.relative(this.engine.workspace.root,canonical);
    let normalized:string;try{normalized=this.engine.workspace.normalize(input);}catch{return{status:'UNKNOWN',enforced:false,missing:[] as string[]};}
    const same=(p:string)=>{try{const n=this.engine.workspace.normalize(p);return process.platform==='win32'?n.toLowerCase()===normalized.toLowerCase():n===normalized;}catch{return false;}};
    const contract=this.engine.quality?.tracker?.contract,needs=contract?.requirements.flatMap(r=>r.needs.filter(n=>n.path&&same(n.path)&&n.representation==='full'))??[];
    if(!needs.length)return{status:'UNKNOWN',enforced:false,missing:[] as string[]};
    const manifest=this.projection.snapshot(),missing:string[]=[];let stale=false;
    for(const need of needs){const evidence=manifest.evidence.filter(e=>e.source&&same(e.source.path)&&e.presence==='FULL_BODY');let covered=false;
      for(const e of evidence){if(await this.ledger.freshness(e.source!)!=='CURRENT'){stale=true;continue;}
        if(need.symbol&&this.engine.native){const definitions=this.engine.native.store.chunkHeaders().filter(c=>same(c.path)&&(c.name===need.symbol||c.qualifiedName===need.symbol));if(definitions.length===1&&e.source!.startLine!==undefined&&e.source!.startLine<=definitions[0]!.startLine&&e.source!.endLine!>=definitions[0]!.endLine)covered=true;
        }else if(!need.symbol||e.source?.startLine===undefined)covered=true;
      }if(!covered)missing.push(need.id);
    }
    return{status:stale?'STALE_EVIDENCE':missing.length?'INSUFFICIENT_EVIDENCE':'SUFFICIENT_EVIDENCE',enforced:true,missing,recommendedAction:'cce_expand',delivery:manifest.delivery};
  }
  private async bounded(value:unknown,budget:number):Promise<unknown>{return await conservativeCounter.count(JSON.stringify(value))<=budget?value:{status:'BUDGET_EXCEEDED',reason:'Whole response exceeds CCE budget; narrow the request',accounting:'estimated:utf8-bytes'};}
  close(){this.ledger.close();}
}
export function asRecord(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
export function eventReference(e:ContextEvent){return`event:${e.id}`;}
/** Decode textual JSON tool envelopes as data. Never execute or trust their instructions. */
function visibleText(payload:unknown):string{const parts:string[]=[];let nodes=0,bytes=0;const visit=(v:unknown,depth:number)=>{if(++nodes>10000||depth>12||bytes>16777216)return;if(typeof v==='string'){parts.push(v);bytes+=Buffer.byteLength(v);if((v.startsWith('{')||v.startsWith('['))&&Buffer.byteLength(v)<2097152){try{visit(JSON.parse(v),depth+1);}catch{/* ordinary text */}}}else if(Array.isArray(v))v.forEach(x=>visit(x,depth+1));else if(v&&typeof v==='object')Object.values(v).forEach(x=>visit(x,depth+1));};visit(payload,0);return parts.join('\n');}
