import type { CodeChunk, GraphEdge, RetrievalDebug } from '../native/contracts.ts';
export const QUALITY_RANKING_VERSION = 'quality-rerank-v1';
export type RetrievalProfile = 'legacy-v04' | 'elara-compatible' | 'definitions-first' | 'structural-balanced' | 'hybrid-quality';
export interface QualityScore { profile: RetrievalProfile; components: Record<string,number>; reasons: string[] }
export interface QualityCandidate { chunk: CodeChunk; debug: RetrievalDebug }
export const isDefinition = (c: CodeChunk): boolean => ['class','function','method','interface'].includes(c.kind);
export function queryPurpose(query: string) {
  const words = query.match(/[\p{L}\p{N}_$]+(?:\.[\p{L}\p{N}_$]+)*/gu) ?? [];
  return { identifiers: words.filter(w=>w.length>1), tests:/\b(test|tests|regression|spec|pytest|jest|vitest|unittest)\b/i.test(query),
    classes:/\b(class|model|interface|type definition)\b/i.test(query),
    dependencies:/\b(dependenc\w*|inherit\w*|extends|call\w*|impact|related|relationship)\b/i.test(query),
    callers:/\b(callers?|who calls|calling function)\b/i.test(query) };
}
export function exactDefinitions(chunks: readonly CodeChunk[], query: string): CodeChunk[] {
  const identifiers=queryPurpose(query).identifiers;
  const explicit=/\b(class|function|method|model|definition|defined|implementation)\b/i.test(query);
  return chunks.filter(c=>isDefinition(c)&&identifiers.some(token=>
    (explicit||query.trim()===token||/[a-z][A-Z]|[_.]/.test(token)||c.kind==='class'&&/^[A-Z]/.test(token))&&
    (c.name.toLowerCase()===token.toLowerCase()||token.includes('.')&&c.qualifiedName.toLowerCase().endsWith('.'+token.toLowerCase()))));
}
/** Separate from frozen Elara numeric semantics. No repository/business names. */
export function scoreQuality(candidates: readonly QualityCandidate[], query: string, profile: RetrievalProfile, edges: readonly GraphEdge[] = []): QualityCandidate[] {
  const intent=queryPurpose(query), exact=new Set(exactDefinitions(candidates.map(c=>c.chunk),query).map(c=>c.id));
  const seeds=new Set(candidates.slice(0,3).map(c=>c.chunk.id));
  const neighbors=new Set(edges.filter(e=>seeds.has(e.source)||intent.callers&&seeds.has(e.target)).map(e=>seeds.has(e.source)?e.target:e.source));
  const balanced=profile==='structural-balanced';
  const scored=candidates.map(row=>{
    const c=row.chunk, qualified=intent.identifiers.some(token=>token.includes('.')&&c.qualifiedName.toLowerCase().endsWith('.'+token.toLowerCase()));
    const components={semantic:row.debug.final,qualified:qualified?0.8:0,exactSymbol:exact.has(c.id)?0.6:0,
      definition:isDefinition(c)?balanced?0.05:0.12:0,classIntent:intent.classes&&['class','interface'].includes(c.kind)?0.12:0,
      tests:intent.tests&&/(?:^|\/)(?:test[^/]*|spec[^/]*)(?:\/|\.)/i.test(c.path)?0.15:0,
      module:intent.identifiers.some(w=>w.includes('.')&&(c.path.endsWith(w)||c.path.endsWith(w.replaceAll('.','/')+'.py')))?0.15:0,
      graph:profile==='hybrid-quality'&&intent.dependencies&&neighbors.has(c.id)?0.08:0,
      overload:c.syntax.decorators.some(d=>/(?:^|\.)overload$/.test(d))?-0.2:0,
      implementation:isDefinition(c)?Math.min(0.06,Math.log2(c.endLine-c.startLine+1)/100):0};
    const total=Object.values(components).reduce((a,b)=>a+b,0);
    const quality:QualityScore={profile,components,reasons:Object.entries(components).filter(([k,v])=>k!=='semantic'&&v!==0).map(([k,v])=>`${k}:${v}`)};
    return{chunk:c,debug:{...row.debug,final:total,quality}};
  }).sort((a,b)=>b.debug.final-a.debug.final||a.chunk.path.localeCompare(b.chunk.path)||a.chunk.startLine-b.chunk.startLine||a.chunk.id.localeCompare(b.chunk.id));
  return scored;
}
export type SelectionReason='SELECTED'|'OMITTED_BY_FILE_QUOTA'|'OMITTED_BY_GLOBAL_TOPK'|'OMITTED_BY_OVERLAP'|'OMITTED_BY_STRUCTURAL_QUOTA';
export interface SelectionDecision {id:string;reason:SelectionReason;coveredBy?:string;quotaException?:'explicit-definition'|'independent-relevant-definition'}
export interface SelectionOptions {policy?:'legacy'|'evidence-aware';required?:readonly {symbol:string;path?:string}[]}
/** Pure selection over an already scored, deterministically ordered population. Scores never change. */
export function selectQuality(scored:readonly QualityCandidate[],query:string,topK:number,options:SelectionOptions={}) {
  if(!Number.isSafeInteger(topK)||topK<1||topK>100)throw new Error('Invalid topK');
  const aware=options.policy==='evidence-aware',exact=new Set(exactDefinitions(scored.map(r=>r.chunk),query).map(c=>c.id));
  const required=new Set(aware?scored.filter(({chunk:c})=>isDefinition(c)&&options.required?.some(n=>(!n.path||n.path===c.path)&&(c.name===n.symbol||c.qualifiedName===n.symbol||c.qualifiedName.endsWith('.'+n.symbol)))).map(r=>r.chunk.id):[]);
  const selected:QualityCandidate[]=[],decisions:SelectionDecision[]=[],perFile=new Map<string,number>();let structural=0;
  const bestSemantic=Math.max(0,...scored.filter(r=>isDefinition(r.chunk)).map(r=>r.debug.quality?.components.semantic??r.debug.final));
  const independent=(row:QualityCandidate)=>isDefinition(row.chunk)&&!row.chunk.syntax.decorators.some(d=>/(?:^|\.)overload$/.test(d))&&
    (row.debug.quality?.components.semantic??row.debug.final)>=0.9*bestSemantic;
  // Reserve only explicitly confirmed definitions. Other evidence retains score order.
  const ordered=aware?[...scored.filter(r=>required.has(r.chunk.id)),...scored.filter(r=>!required.has(r.chunk.id))]:scored;
  for(const row of ordered){
    const c=row.chunk,definition=isDefinition(c),count=perFile.get(c.path)??0;
    let reason:SelectionReason='SELECTED',coveredBy:string|undefined,quotaException:SelectionDecision['quotaException'];
    if(selected.length>=topK)reason='OMITTED_BY_GLOBAL_TOPK';
    else if(!definition&&structural>=Math.max(1,Math.floor(topK/4)))reason='OMITTED_BY_STRUCTURAL_QUOTA';
    else{
      // Keep legacy exact-name behavior. Additional exceptions have a hard six-per-file ceiling.
      if(count>=3&&(aware||!exact.has(c.id))){
        if(aware&&count<6&&(required.has(c.id)||exact.has(c.id)||independent(row)))quotaException=required.has(c.id)||exact.has(c.id)?'explicit-definition':'independent-relevant-definition';
        else reason='OMITTED_BY_FILE_QUOTA';
      }
      if(reason==='SELECTED'){
        const conflict=selected.find(o=>o.chunk.path===c.path&&!(exact.has(c.id)&&exact.has(o.chunk.id))&&
          Math.min(o.chunk.endLine,c.endLine)-Math.max(o.chunk.startLine,c.startLine)+1>0.5*Math.min(o.chunk.endLine-o.chunk.startLine+1,c.endLine-c.startLine+1));
        if(conflict){
          // A preview/property/import cannot stand in for a full definition. Prefer a containing
          // definition only when its source range covers the existing fragment in full.
          const covers=c.startLine<=conflict.chunk.startLine&&c.endLine>=conflict.chunk.endLine;
          if(aware&&definition&&!isDefinition(conflict.chunk)&&covers){
            selected.splice(selected.indexOf(conflict),1);structural--;perFile.set(c.path,count-1);
            const prior=decisions.find(d=>d.id===conflict.chunk.id)!;prior.reason='OMITTED_BY_OVERLAP';prior.coveredBy=c.id;
          }else{reason='OMITTED_BY_OVERLAP';coveredBy=conflict.chunk.id;}
        }
      }
    }
    decisions.push({id:c.id,reason,...(coveredBy?{coveredBy}:{}),...(reason==='SELECTED'&&quotaException?{quotaException}:{})});
    if(reason==='SELECTED'){selected.push(row);if(!definition)structural++;perFile.set(c.path,(perFile.get(c.path)??0)+1);}
  }
  return{selected,decisions};
}
export function rerankQuality(candidates:readonly QualityCandidate[],query:string,profile:RetrievalProfile,topK:number,edges:readonly GraphEdge[]=[],options:SelectionOptions={}):QualityCandidate[]{
  return selectQuality(scoreQuality(candidates,query,profile,edges),query,topK,options).selected;
}
