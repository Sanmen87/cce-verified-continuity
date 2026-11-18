import type { ContextEngine } from '../index.ts';
import { estimateTokens } from '../context.ts';
import { gitSnapshot } from '../git.ts';
import { containsSecret } from '../native/secrets.ts';
import { TextLanguageAdapter } from '../native/registry.ts';
import { SignatureCompressor } from '../native/compression.ts';
import type { BuiltContext } from '../types.ts';
import type { SourceEvidence } from '../native/contracts.ts';
import type { ApprovedCheck,ContextEvidence,ContextFacts,ContextQualityReport,ExplicitTaskContract,ProjectBinding } from './contracts.ts';
import { ContextQualityGuard } from './guard.ts';
import { TaskCoverageTracker,VerificationFeedback } from './tracker.ts';
import {GRAPH_RELATIONS,type GraphRelation}from '../native/graph-contracts.ts';
interface ContextRow { line:string; qualityStatus?:boolean; source?:{path:string;startLine:number;endLine:number;sha256:string}; evidence?:ContextEvidence }
function rows(text:string):ContextRow[]{
  return text.split('\n').filter(Boolean).map(line=>{
    try{
      const r=JSON.parse(line)as Record<string,unknown>,match=typeof r.source==='string'?/^(.*):(\d+)-(\d+)$/.exec(r.source):null;
      if(r.cceQuality)return{line,qualityStatus:true};
      if(!match||typeof r.sha256!=='string')return{line};
      const source={path:match[1]!,startLine:Number(match[2]),endLine:Number(match[3]),sha256:r.sha256};
      const id=typeof r.chunkId==='string'?{chunkId:r.chunkId}:{};
      const evidence:ContextEvidence=r.representation==='signature-docstring'?{...source,...id,representation:'preview',signature:typeof r.signature==='string'?r.signature:'',docstring:typeof r.docstring==='string'?r.docstring:'',members:Array.isArray(r.members)?r.members.filter((m):m is string=>typeof m==='string'):[]}:
        {...source,...id,representation:'full',text:typeof r.excerpt==='string'?r.excerpt:''};
      return{line,source,evidence};
    }catch{return{line};}
  });
}
export interface ProgressiveRequest {
  chunkId:string;sha256:string;stage:'preview'|'definition'|'class'|'file'|'dependencies'|'tests';
  budgetTokens:number|null;reason:string;requirementId?:string;offset?:number;limit?:number;
}
/** Optional coordinator; guard/tracker themselves have no Pi/framework dependency. */
export class QualityContextService {
  readonly engine:ContextEngine;tracker:TaskCoverageTracker|undefined;feedback:VerificationFeedback|undefined;
  readonly expansionEvents:Array<{stage:ProgressiveRequest['stage'];status:string;bytes:number;requirementId:string|null}>=[];
  private approvedChecks:ApprovedCheck[];lastBuilt:BuiltContext|undefined;
  private estimate=(text:string)=>estimateTokens(text,this.engine.config.context.tokenEstimateSafetyFactor);
  constructor(engine:ContextEngine,contract?:ExplicitTaskContract,checks:ApprovedCheck[]=[]){this.engine=engine;this.approvedChecks=checks;if(contract)this.setContract(contract);}
  setContract(contract:ExplicitTaskContract):void {this.tracker=new TaskCoverageTracker(contract);this.feedback=new VerificationFeedback(this.tracker,()=>this.binding(),this.approvedChecks);}
  async binding():Promise<ProjectBinding>{
    const files:Record<string,string|null>={};for(const file of await this.engine.sourceFiles(true))try{files[file]=(await this.engine.workspace.read(file,this.engine.config.retrieval.maxFileBytes)).sha256;}catch{files[file]=null;}
    const snapshot=await gitSnapshot(this.engine.workspace,this.engine.config.storage.stateDir);return{projectId:this.engine.workspace.projectId,files,git:snapshot.git};
  }
  async reportImplementation(id:string,evidence:SourceEvidence[]):Promise<void>{
    if(!this.tracker)throw new Error('No explicit task contract');const allowed=new Set(await this.engine.sourceFiles(true));
    for(const file of evidence)if(!allowed.has(file.path)||(await this.engine.workspace.read(file.path,this.engine.config.retrieval.maxFileBytes)).sha256!==file.sha256)throw new Error('Stale or excluded implementation evidence');
    this.tracker.reportImplementation(id,evidence);
  }
  async inspect(built:BuiltContext,historyKnown=true):Promise<ContextQualityReport>{
    const engine=this.engine,registry=engine.native?.index.registry,fallback=new TextLanguageAdapter();
    const needsGraph=this.tracker?.contract.requirements.some(r=>r.needs.some(n=>n.kind==='dependency'))??false;
    const selective=engine.config.hybrid.graphStrategy==='selective';
    if(engine.native)await engine.native.index.refresh(needsGraph&&engine.config.hybrid.enableGraph&&!selective);
    let facts:ContextFacts={chunks:[],nodes:[],edges:[],graphProvenance:'unavailable'};
    if(engine.native&&engine.config.hybrid.enableGraph){
      if(!selective)facts={chunks:[],...engine.native.store.graph(),graphProvenance:needsGraph?'fresh-static':'indexed-static'};
      else if(needsGraph){
        const needs=this.tracker!.contract.requirements.flatMap(r=>r.needs.filter(n=>n.kind==='dependency'));
        const evidence=rows(built.text).flatMap(r=>r.evidence?[r.evidence]:[]);
        const seeds=engine.native.store.chunkHeaders().filter(c=>needs.some(n=>(!n.path||n.path===c.path)&&n.symbol&&(n.symbol===c.name||c.qualifiedName.endsWith('.'+n.symbol)))&&evidence.some(e=>e.path===c.path&&e.startLine<=c.startLine&&e.endLine>=c.endLine)).slice(0,3).map(c=>c.id);
        const relations=[...new Set(needs.flatMap(n=>n.relation&&GRAPH_RELATIONS.includes(n.relation as GraphRelation)?[n.relation as GraphRelation]:!n.relation?[...GRAPH_RELATIONS]:[]))];
        if(seeds.length&&relations.length){const result=await engine.native.graphQuery.execute({mode:'selective',direction:'outgoing',relations,seeds,maxDepth:1,maxNodes:30,maxEdges:128,maxBonusChunks:0,intent:'explicit',reason:'Explicit task-contract dependency evidence'},{snapshotRefreshed:true});
          if(!['stale-index','aborted','work-budget'].includes(result.stopReason))facts={chunks:[],nodes:result.nodes,edges:result.edges,graphProvenance:'fresh-static'};
        }
      }
    }
    const guard=new ContextQualityGuard({workspace:engine.workspace,maxFileBytes:engine.config.retrieval.maxFileBytes,estimateSafetyFactor:engine.config.context.tokenEstimateSafetyFactor,
      allowedPaths:async()=>new Set(await engine.sourceFiles(true)),parse:async(file,source,sha)=>{
        if(containsSecret(source))throw new Error('Potential secret source rejected');return(registry?.language(file)??fallback).parse(file,source,sha);
      }});
    const snapshot=await gitSnapshot(engine.workspace,engine.config.storage.stateDir);
    return guard.inspect({...(this.tracker?{contract:this.tracker.contract}:{}),evidence:rows(built.text).flatMap(r=>r.evidence?[r.evidence]:[]),contextText:built.text,facts,budgetLimit:historyKnown?built.budget:null,historyKnown,git:snapshot.git});
  }
  async auditBuilt(input:BuiltContext,historyKnown=true):Promise<BuiltContext>{
    const built=structuredClone(input),removed:ContextQualityReport['rejectedSources']=[];
    built.text=rows(built.text).filter(r=>!r.qualityStatus).map(r=>r.line).join('\n')+'\n';
    // Remove whole records only. Never cut code to make room for quality metadata.
    for(let attempt=0;attempt<Math.min(input.included.length+3,1003);attempt++){
      const report=await this.inspect(built,historyKnown);
      const rejected=new Set([...report.rejectedSources.map(r=>r.path),...report.staleSources]);
      if(rejected.size){
        removed.push(...report.rejectedSources,...report.staleSources.map(path=>({path,reason:'Source changed during audit'})));
        built.text=rows(built.text).filter(r=>!r.source||!rejected.has(r.source.path)).map(r=>r.line).join('\n')+'\n';
        built.included=built.included.filter(r=>!rejected.has(r.path));for(const file of rejected)built.omitted.push({path:file,reason:'quality guard rejected stale/invalid source'});
        continue;
      }
      if(removed.length){report.rejectedSources.push(...removed);report.recommendedAction='read-source';report.reasons.push('Rejected records were removed from the returned context');}
      const status=JSON.stringify({cceQuality:{completeness:report.completeness,confidence:report.confidence,coveredRequirements:report.coveredRequirements,uncoveredRequirements:report.uncoveredRequirements,missingDependencies:report.missingDependencies,unresolvedDependencies:report.unresolvedDependencies,recommendedAction:report.recommendedAction}})+'\n';
      if(this.estimate(built.text+status)>built.budget){
        const records=rows(built.text),last=records.map((r,i)=>r.source?i:-1).filter(i=>i>=0).at(-1);
        if(last===undefined){built.quality={...report,rejectedSources:[...report.rejectedSources,...removed],recommendedAction:'read-source',reasons:[...report.reasons,'Quality status cannot fit available context budget']};built.estimatedTokens=this.estimate(built.text);this.lastBuilt=built;return built;}
        const omitted=records[last]!.source!;records.splice(last,1);built.text=records.map(r=>r.line).join('\n')+'\n';built.included=built.included.filter(r=>!(r.path===omitted.path&&r.startLine===omitted.startLine&&r.endLine===omitted.endLine));built.omitted.push({path:omitted.path,reason:'quality status envelope budget'});continue;
      }
      built.text+=status;built.estimatedTokens=this.estimate(built.text);report.budget.used=built.estimatedTokens;
      built.quality=report;this.lastBuilt=built;return built;
    }
    throw new Error('Quality context packing failed to converge');
  }
  async expand(request:ProgressiveRequest){
    if(!this.engine.native)throw new Error('Progressive AST expansion requires hybrid-native');
    if(!request.reason.trim()||request.reason.length>2048)throw new Error('An explicit expansion reason is required');
    if(!['preview','definition','class','file','dependencies','tests'].includes(request.stage))throw new Error('Unknown expansion stage');
    if(request.requirementId&&!this.tracker?.contract.requirements.some(r=>r.id===request.requirementId))throw new Error('Unknown explicit requirement');
    const finish=(status:string,sources:ContextEvidence[],omitted:string[]=[])=>{
      const result={status,stage:request.stage,reason:request.reason,requirementId:request.requirementId??null,sources,omitted,truncated:omitted.length>0,tokenSource:'estimated:utf8-bytes',estimatedTokens:0};
      const measure=()=>{for(let i=0;i<4;i++){const tokens=this.estimate(JSON.stringify(result));if(tokens===result.estimatedTokens)break;result.estimatedTokens=tokens;}};measure();
      if(request.budgetTokens!==null&&result.estimatedTokens>request.budgetTokens){
        result.omitted.push('Whole source records omitted for budget; use an explicit smaller range or native read');result.truncated=true;
        measure();while(result.sources.length&&result.estimatedTokens>request.budgetTokens){result.sources.pop();result.status=result.sources.length?'PARTIAL':'BUDGET_EXCEEDED';measure();}
        if(!result.sources.length){result.status='BUDGET_EXCEEDED';measure();}
      }
      this.expansionEvents.push({stage:request.stage,status:result.status,bytes:Buffer.byteLength(JSON.stringify(result)),requirementId:request.requirementId??null});return result;
    };
    if(request.budgetTokens===null)return finish('BUDGET_UNKNOWN',[],['Session budget unknown: automatic expansion unavailable']);
    if(!Number.isSafeInteger(request.budgetTokens)||request.budgetTokens<0)throw new Error('Invalid expansion budget');
    let chunk=await this.engine.native.expandChunk(request.chunkId);
    if(!/^[a-f0-9]{64}$/.test(request.sha256)||chunk.fileHash!==request.sha256)throw new Error('Source changed since preview; retrieve a new reference');
    if(request.stage==='class'){
      let depth=0;while(chunk.kind!=='class'&&chunk.parentId&&depth++<32)chunk=await this.engine.native.expandChunk(chunk.parentId);
      if(chunk.kind!=='class')return finish('UNAVAILABLE',[],['No enclosing class definition']);
      if(chunk.fileHash!==request.sha256)throw new Error('Source changed during class expansion');
    }
    if(request.stage==='preview'){
      const preview=new SignatureCompressor().preview(chunk);return finish('OK',[{path:chunk.path,sha256:chunk.fileHash,startLine:chunk.startLine,endLine:chunk.endLine,chunkId:chunk.id,representation:'preview',signature:preview.signature,docstring:preview.docstring,members:preview.members}]);
    }
    if(request.stage==='file'){
      if(!new Set(await this.engine.sourceFiles(true)).has(chunk.path))throw new Error('Excluded file');
      const source=await this.engine.workspace.read(chunk.path,this.engine.config.retrieval.maxFileBytes);if(source.sha256!==request.sha256)throw new Error('Source changed during expansion');
      const lines=source.text.split(/\r?\n/),offset=request.offset??0,limit=request.limit??lines.length;
      if(!Number.isSafeInteger(offset)||offset<0||offset>=lines.length||!Number.isSafeInteger(limit)||limit<1||limit>1000000)throw new Error('Invalid explicit line range');
      const end=Math.min(lines.length,offset+limit),partial=offset>0||end<lines.length;
      return finish('OK',[{path:chunk.path,sha256:source.sha256,startLine:offset+1,endLine:end,representation:partial?'full':'file',text:lines.slice(offset,end).join('\n')}],partial?[`Explicit partial file range ${offset+1}-${end} of ${lines.length} lines`]:[]);
    }
    if(request.stage==='dependencies'||request.stage==='tests'){
      const nodes=await this.engine.native.related(chunk.id,{depth:2,maxNodes:32}),candidates=nodes.flatMap(n=>{const c=this.engine.native!.store.chunk(n.id);return c?[c]:[];});
      if((await this.engine.native.expandChunk(request.chunkId)).fileHash!==request.sha256)throw new Error('Source changed during dependency expansion');
      if(request.stage==='tests')candidates.push(...this.engine.native.store.chunks().filter(c=>/(?:^|\/)(?:tests?|spec)[^/]*(?:\/|\.)/i.test(c.path)&&c.syntax.references.includes(chunk.name)).slice(0,8));
      const selected=candidates.filter(c=>c.id!==chunk.id&&(request.stage!=='tests'||/(?:^|\/)(?:tests?|spec)[^/]*(?:\/|\.)/i.test(c.path))).slice(0,8),sources:ContextEvidence[]=[],omitted:string[]=[];
      const seen=new Set<string>();for(const indexed of selected){if(seen.has(indexed.id))continue;seen.add(indexed.id);try{const current=await this.engine.native.expandChunk(indexed.id);if(current.fileHash!==indexed.fileHash)throw new Error('Stale dependency');sources.push({path:current.path,sha256:current.fileHash,startLine:current.startLine,endLine:current.endLine,chunkId:current.id,representation:'full',text:current.text});}catch{omitted.push(indexed.path+': source changed or unavailable');}}
      return finish(sources.length?'OK':'UNAVAILABLE',sources,omitted);
    }
    return finish('OK',[{path:chunk.path,sha256:chunk.fileHash,startLine:chunk.startLine,endLine:chunk.endLine,chunkId:chunk.id,representation:'full',text:chunk.text}]);
  }
}
