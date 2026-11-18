import type { Workspace } from '../workspace.ts';
import { estimateTokens } from '../context.ts';
import type { CodeChunk, ParsedFile } from '../native/contracts.ts';
import type { GitState } from '../types.ts';
import type { ContextEvidence, ContextFacts, ContextNeed, ContextQualityReport, ExplicitTaskContract } from './contracts.ts';
import { validateTaskContract } from './tracker.ts';
import { isDefinition } from './retrieval.ts';
export interface QualityGuardServices {
  workspace: Workspace; allowedPaths: () => Promise<ReadonlySet<string>>;
  parse: (file: string, source: string, sha256: string) => Promise<ParsedFile>;
  maxFileBytes?: number; countTokens?: (text: string) => Promise<number>;
  estimateSafetyFactor?:number;
}
export interface QualityGuardInput {
  contract?: ExplicitTaskContract; evidence: ContextEvidence[]; contextText: string; facts: ContextFacts;
  budgetLimit: number | null; historyKnown: boolean; git: GitState;
}
const symbolMatches=(chunk:CodeChunk,symbol:string)=>chunk.name===symbol||chunk.qualifiedName===symbol||chunk.qualifiedName.endsWith('.'+symbol);
const normalized=(text:string)=>text.replaceAll('\r\n','\n').replace(/^[ \t]+/,'');
/** Structural evidence audit. No LLM, business rules or claim of semantic completeness. */
export class ContextQualityGuard {
  readonly services:QualityGuardServices;
  constructor(services:QualityGuardServices){this.services=services;}
  async inspect(input:QualityGuardInput):Promise<ContextQualityReport>{
    if(!Array.isArray(input.evidence)||input.evidence.length>1000||Buffer.byteLength(input.contextText)>2097152)throw new Error('Context audit input exceeds limit');
    if(input.budgetLimit!==null&&(!Number.isSafeInteger(input.budgetLimit)||input.budgetLimit<0))throw new Error('Invalid context budget');
    const contract=input.contract?validateTaskContract(input.contract):undefined,allowed=await this.services.allowedPaths();
    const used=this.services.countTokens?await this.services.countTokens(input.contextText):estimateTokens(input.contextText,this.services.estimateSafetyFactor??1.25);
    if(!Number.isSafeInteger(used)||used<0)throw new Error('Invalid token count');
    const report:ContextQualityReport={contractId:contract?.id??null,relevantSymbols:[],coveredRequirements:[],uncoveredRequirements:[],missingDefinitions:[],missingDependencies:[],unresolvedDependencies:[],staleSources:[],rejectedSources:[],selectedSources:[],evidenceByRequirement:{},needCoverage:{},confidence:null,completeness:'UNVERIFIED',
      structuralCoverage:{covered:0,total:contract?.requirements.length??0,ratio:null},duplication:{overlappingPairs:0,lineFraction:0,basis:'declared-source-ranges'},
      budget:{limit:input.budgetLimit,used,accounting:this.services.countTokens?'model-tokenizer':'estimated:utf8-bytes',exceeded:input.budgetLimit!==null&&used>input.budgetLimit,historyKnown:input.historyKnown},
      git:{available:input.git.available,head:input.git.head},graphProvenance:input.facts.graphProvenance,recommendedAction:'use-context',reasons:[]};
    const parsed=new Map<string,{file:ParsedFile;text:string;sha256:string}>(),valid:ContextEvidence[]=[];
    const delivered=(text:string)=>input.contextText.includes(text)||input.contextText.includes(JSON.stringify(text));
    for(const e of input.evidence){
      try{
        const file=this.services.workspace.normalize(e.path);
        if(!allowed.has(file)||!/^[a-f0-9]{64}$/.test(e.sha256))throw new Error('Excluded or invalid source');
        if(!Number.isSafeInteger(e.startLine)||!Number.isSafeInteger(e.endLine)||e.startLine<1||e.endLine<e.startLine)throw new Error('Invalid range');
        let current=parsed.get(file);
        if(!current){const source=await this.services.workspace.read(file,this.services.maxFileBytes??2097152);current={file:await this.services.parse(file,source.text,source.sha256),...source};parsed.set(file,current);}
        if(current.sha256!==e.sha256){report.staleSources.push(file);throw new Error('Stale source SHA');}
        const lines=current.text.split(/\r?\n/);if(e.endLine>lines.length)throw new Error('Source range outside file');
        if(e.representation==='preview'){
          if(e.signature&&!delivered(e.signature)||e.docstring&&!delivered(e.docstring)||e.members.some(m=>!delivered(m)))throw new Error('Preview payload was not included in packed context');
          const matching=current.file.chunks.filter(c=>(!e.chunkId||c.id===e.chunkId)&&c.startLine>=e.startLine&&c.endLine<=e.endLine);
          if(!matching.some(c=>(c.signature===e.signature||e.signature===''&&Buffer.byteLength(c.signature)>4096)&&(e.docstring===''||e.docstring===c.docstring)&&e.members.every(m=>Array.isArray(c.metadata.members)&&c.metadata.members.includes(m))))throw new Error('Preview does not match current AST');
        }else{
          if(!e.text||!delivered(e.text))throw new Error('Source payload was not included in packed context');
          if(e.representation==='file'&&(e.startLine!==1||e.endLine!==lines.length))throw new Error('A file representation must contain the whole file');
          if(normalized(e.text)!==normalized(lines.slice(e.startLine-1,e.endLine).join('\n')))throw new Error('Source payload differs from current disk');
        }
        valid.push(e);report.selectedSources.push({path:file,sha256:e.sha256,startLine:e.startLine,endLine:e.endLine,...(e.chunkId?{chunkId:e.chunkId}:{})});
      }catch(error){report.rejectedSources.push({path:e.path,reason:(error as Error).message});}
    }
    // Source can race asynchronous parsing/tokenization: re-read all accepted bindings.
    for(const [file,current]of parsed)try{if((await this.services.workspace.read(file,this.services.maxFileBytes??2097152)).sha256!==current.sha256)report.staleSources.push(file);}catch{report.staleSources.push(file);}
    const accepted=valid.filter(e=>!report.staleSources.includes(e.path));
    report.selectedSources=report.selectedSources.filter(e=>!report.staleSources.includes(e.path));
    const currentChunks=[...parsed.values()].flatMap(p=>p.file.chunks),selectedIds=new Set<string>();
    const matchingEvidence=(c:CodeChunk,need:ContextNeed)=>accepted.filter(e=>e.path===c.path&&e.startLine<=c.startLine&&e.endLine>=c.endLine&&
      (need.representation==='full'?e.representation!=='preview':e.representation!=='preview'||Boolean(e.signature)&&e.signature===c.signature));
    let needsExpansion=false;
    for(const requirement of contract?.requirements??[]){
      const proof:ContextEvidence[]=[];let covered=requirement.needs.length>0;
      for(const need of requirement.needs){
        const key=requirement.id+'/'+need.id;
        const wholeFileNeed=!need.symbol&&Boolean(need.path)&&(need.kind==='source'||need.kind==='test');
        const candidates=currentChunks.filter(c=>(!need.path||c.path===need.path)&&(!need.symbol||(isDefinition(c)||need.kind==='dependency'&&!c.metadata.fallback)&&symbolMatches(c,need.symbol))&&(!wholeFileNeed||c.kind==='module'));
        const concrete=candidates.filter(c=>{
          if(!need.bodyRequired)return true;
          if(c.syntax.decorators.some(d=>/(?:^|\.)overload$/.test(d)))return false;
          const signature=c.metadata.signatureBounds as {end:number}|undefined,definition=c.metadata.definitionBounds as {end:number}|undefined;
          if(!signature||!definition||signature.end>=definition.end)return false;
          const body=parsed.get(c.path)!.text.slice(signature.end,definition.end).trim();return body!==''&&body!=='pass'&&body!=='...';
        });
        const evidence=concrete.flatMap(c=>matchingEvidence(c,need)).filter(e=>!wholeFileNeed||need.representation==='preview'||e.representation!=='preview'&&e.startLine===1&&e.endLine===parsed.get(e.path)!.text.split(/\r?\n/).length);
        const dependencyEvidence:ContextEvidence[]=[];
        const dependencyOkay=need.kind!=='dependency'||input.facts.graphProvenance==='fresh-static'&&input.facts.edges.some(edge=>{
          const source=concrete.find(c=>c.id===edge.source),target=input.facts.nodes.find(n=>n.id===edge.target);
          const targetDefinition=target?currentChunks.find(c=>c.id===target.id):undefined;
          const targetEvidence=targetDefinition?matchingEvidence(targetDefinition,need):[];
          const matches=Boolean(source&&targetDefinition&&targetEvidence.length>0&&edge.fileHash===parsed.get(source.path)?.sha256&&(!need.relation||edge.relation===need.relation)&&(!need.targetSymbol||target?.name===need.targetSymbol||target?.name.endsWith('.'+need.targetSymbol)));
          if(matches)dependencyEvidence.push(...targetEvidence);return matches;
        });
        if(evidence.length&&dependencyOkay){report.needCoverage[key]='FOUND';proof.push(...evidence,...dependencyEvidence);for(const c of concrete){report.relevantSymbols.push(c.qualifiedName);selectedIds.add(c.id);}}
        else{
          covered=false;const preview=need.representation==='full'&&concrete.some(c=>accepted.some(e=>e.representation==='preview'&&e.path===c.path&&e.startLine<=c.startLine&&e.endLine>=c.endLine));
          report.needCoverage[key]=preview?'PREVIEW_ONLY':candidates.length?'UNKNOWN':'MISSING';needsExpansion ||= preview;
          if(!candidates.length&&need.symbol)report.missingDefinitions.push(need.symbol);
          report.reasons.push(`${key}: ${preview?'only preview is available':!dependencyOkay?'dependency not established':!candidates.length?'required definition/source absent':'required source representation not established'}`);
        }
      }
      report.evidenceByRequirement[requirement.id]=proof.map(e=>({path:e.path,sha256:e.sha256,startLine:e.startLine,endLine:e.endLine,...(e.chunkId?{chunkId:e.chunkId}:{})}));
      (covered?report.coveredRequirements:report.uncoveredRequirements).push(requirement.id);
    }
    for(const edge of input.facts.edges){
      if(report.missingDependencies.length>=32)break;
      if(!selectedIds.has(edge.source)||!['CALLS','IMPORTS','INHERITS'].includes(edge.relation)&&!edge.relation.startsWith('ORM_'))continue;
      const source=currentChunks.find(c=>c.id===edge.source);if(!source||edge.fileHash!==parsed.get(source.path)?.sha256)continue;
      const target=input.facts.nodes.find(n=>n.id===edge.target);if(!target)continue;
      if(!target.path){report.unresolvedDependencies.push(target.name);continue;}
      if(!accepted.some(e=>e.path===target.path))report.missingDependencies.push({source:source.qualifiedName,target:target.name,relation:edge.relation,provenance:`${input.facts.graphProvenance}:${edge.confidence}`});
    }
    let total=0;const unique=new Set<string>();
    accepted.forEach((e,i)=>{for(let line=e.startLine;line<=e.endLine;line++){total++;unique.add(e.path+':'+line);}for(const other of accepted.slice(i+1))if(other.path===e.path&&Math.min(other.endLine,e.endLine)>=Math.max(other.startLine,e.startLine))report.duplication.overlappingPairs++;});
    report.duplication.lineFraction=total?(total-unique.size)/total:0;
    report.structuralCoverage.covered=report.coveredRequirements.length;report.structuralCoverage.ratio=report.structuralCoverage.total?report.coveredRequirements.length/report.structuralCoverage.total:null;
    report.relevantSymbols=[...new Set(report.relevantSymbols)];report.missingDefinitions=[...new Set(report.missingDefinitions)];report.staleSources=[...new Set(report.staleSources)];report.unresolvedDependencies=[...new Set(report.unresolvedDependencies)].slice(0,32);
    if(!contract)report.reasons.push('No explicit task contract: requirement coverage is UNKNOWN');
    if(!input.historyKnown||input.budgetLimit===null)report.reasons.push('Session budget is unknown: automatic expansion disabled');
    if(report.unresolvedDependencies.length)report.reasons.push('Static graph has unresolved targets; runtime dependency completeness is unverified');
    if(!input.git.available)report.reasons.push('Git state unavailable; no Git completeness claim');
    report.reasons.push('Structural evidence coverage does not prove implementation, test success or semantic completeness');
    report.recommendedAction=report.staleSources.length||report.rejectedSources.length||report.budget.exceeded||!input.historyKnown||input.budgetLimit===null?'read-source':
      needsExpansion?'expand-context':report.uncoveredRequirements.length||report.missingDefinitions.length?'retrieve-more':report.missingDependencies.length?'expand-context':'use-context';
    return report;
  }
}
