import { boundedString } from '../config.ts';
import type { CceConfig } from '../config.ts';
import type { Workspace } from '../workspace.ts';
import type { Retrieval } from '../retrieval.ts';
import type { RetrievalHit } from '../types.ts';
import { SourceNotFound, suggestPaths } from '../path-hints.ts';
import type { AdapterRegistry } from './registry.ts';
import type { CodeChunk, EmbeddingProvider, NativeSearchResult, RetrievalDebug, RetrievalProvider } from './contracts.ts';
import { NativeStore } from './store.ts';
import { NativeIndexManager } from './indexer.ts';
import { LocalEmbeddingProvider } from './embeddings.ts';
import { defaultAdapters } from './defaults.ts';
import { rankHybrid, bm25, scoreHybridCandidates } from './ranking.ts';
import { compatibleRegistry } from '../quality/compatible.ts';
import { exactDefinitions, scoreQuality, selectQuality, queryPurpose, type SelectionDecision } from '../quality/retrieval.ts';
import { BoundedCodeGraph } from './graph.ts';
import { SignatureCompressor } from './compression.ts';
import { ProjectMemory } from './memory.ts';
import {SelectiveGraphPlanner} from '../quality/graph-planner.ts';
import {IndexedGraphQuery} from './graph-query.ts';
import type {GraphPlan,GraphResult} from './graph-contracts.ts';
import {GRAPH_RELATIONS,type GraphRelation}from './graph-contracts.ts';
export interface NativeDependencies { registry?: AdapterRegistry; embedding?: EmbeddingProvider }
export class HybridNativeProvider implements RetrievalProvider {
  readonly workspace: Workspace; readonly config: CceConfig; readonly inventory: Retrieval;
  readonly store: NativeStore; readonly index: NativeIndexManager; readonly memory: ProjectMemory | undefined;
  private compressor = new SignatureCompressor(); private embedding: EmbeddingProvider | undefined;
  private integrityWarnings = 0;
  readonly graphQuery:IndexedGraphQuery;private graphPlanner:SelectiveGraphPlanner;
  requiredDefinitions:()=>readonly {symbol:string;path?:string}[]=()=>[];
  lastSelection:SelectionDecision[]=[];
  lastTrace: { profile: string;hydration?:{mode:'full'|'lazy';candidateBodies:number;selectedBodies:number;reason:string}; graph?:{plan:GraphPlan;result:GraphResult|null};timings: Record<string,number>; candidates: Array<{ id:string;path:string;kind:string;startLine:number;endLine:number;name:string;debug:RetrievalDebug }>; selected:string[] } | null = null;
  private constructor(workspace: Workspace, config: CceConfig, inventory: Retrieval, store: NativeStore, registry: AdapterRegistry, embedding: EmbeddingProvider | undefined) {
    this.workspace = workspace; this.config = config; this.inventory = inventory; this.store = store; this.embedding = embedding;
    this.graphPlanner=new SelectiveGraphPlanner(config.hybrid.intentPolicy);
    this.index = new NativeIndexManager(workspace, inventory, store, registry, { stateDir: config.storage.stateDir,
      maxFileBytes: config.retrieval.maxFileBytes, enableGraph: config.hybrid.enableGraph,symbolResolution:config.hybrid.symbolResolution, ...(embedding ? { embedding } : {}) });
    this.graphQuery=new IndexedGraphQuery(store,this.index);
    this.memory = config.hybrid.enableMemory ? new ProjectMemory(workspace, store, config.storage.stateDir, async () => new Set(await this.files(true))) : undefined;
  }
  static async open(workspace: Workspace, config: CceConfig, inventory: Retrieval, dependencies: NativeDependencies = {}): Promise<HybridNativeProvider> {
    const embedding = config.hybrid.enableVector ? dependencies.embedding ?? new LocalEmbeddingProvider(config.hybrid.embedding) : undefined;
    if (embedding && embedding.dimension !== config.hybrid.embedding.dimension) throw new Error('Configured embedding dimension mismatch');
    const store = await NativeStore.open(workspace, config.storage.stateDir, embedding?.dimension ?? 0, config.hybrid.vectorStorage);
    const registry=dependencies.registry ?? defaultAdapters(config.hybrid.symbolResolution==='scoped');
    return new HybridNativeProvider(workspace, config, inventory, store, config.quality.profile==='elara-compatible'?compatibleRegistry(registry):registry, embedding);
  }
  async reindex(force = false) { return this.index.refresh(force); }
  async files(includeMigrations = this.config.retrieval.includeMigrationsByDefault): Promise<string[]> {
    await this.index.refresh(); const indexed = this.store.files();
    return (await this.inventory.files(includeMigrations)).filter(file => indexed.has(file));
  }
  async searchChunks(query: string, options: { topK?: number; path?: string; includeMigrations?: boolean; refresh?: boolean;signal?:AbortSignal;scoringNow?:number } = {}): Promise<Array<{ chunk: CodeChunk; debug: RetrievalDebug }>> {
    const started=performance.now(),timings:Record<string,number>={};let stage=started;
    const tick=(name:string)=>{const now=performance.now();timings[name]=now-stage;stage=now;};
    boundedString(query, 256); if (/[\r\n]/.test(query)) throw new Error('Single-line query required');
    if(options.scoringNow!==undefined&&!Number.isFinite(options.scoringNow))throw new Error('Invalid scoring clock');
    if (options.refresh !== false) await this.index.refresh();
    tick('refresh');
    const topK = options.topK ?? this.config.retrieval.topK;
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100) throw new Error('topK must be an integer from 1 to 100');
    const indexedFiles = this.store.files();
    const allowed = new Set((await this.inventory.files(options.includeMigrations ?? this.config.retrieval.includeMigrationsByDefault)).filter(file => indexedFiles.has(file)));
    tick('inventory');
    let selectedPath: string | undefined;
    if (options.path !== undefined) {
      selectedPath = this.workspace.normalize(options.path);
      try { await this.workspace.resolve(selectedPath); }
      catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new SourceNotFound(await suggestPaths(this.workspace, [...allowed], selectedPath)); throw error; }
      if (!allowed.has(selectedPath)) throw new Error('Source is excluded from the native index');
    }
    const lazy=this.config.hybrid.lazyHydration&&this.config.hybrid.keywordMode==='fts5';
    const chunks = (lazy?this.store.chunkHeaders():this.store.chunks()).filter(chunk => chunk.retrievable && allowed.has(chunk.path) && (!selectedPath || selectedPath === chunk.path));
    tick('hydrateChunks');
    const ids = new Set(chunks.map(chunk => chunk.id));
    const profile=this.config.quality.profile,quality=!['legacy-v04','elara-compatible'].includes(profile),breadth=quality?8:3;
    const scoped=Boolean(selectedPath)||allowed.size!==indexedFiles.size;
    const keyword = !this.config.hybrid.enableBM25 ? [] : this.config.hybrid.keywordMode === 'code-bm25' ?
      bm25(new Map(chunks.map(c => [c.id, c.path + '\n' + c.text])), query).slice(0, topK * breadth) :
      this.store.keyword.search(query, Math.min(10000, Math.max(quality&&scoped?10000:topK * breadth, 1))).filter(hit => ids.has(hit.id)).slice(0,topK*breadth);
    tick('keyword');
    const queryVector=this.embedding?(await this.embedding.embed([query], 'query'))[0]!:null;
    tick('queryEmbedding');
    const vector = queryVector && this.store.vector ? this.store.vector.search(queryVector, Math.max(topK * breadth, 1), selectedPath || quality&&scoped ? ids : undefined).filter(hit => ids.has(hit.id)) : [];
    tick('vector');
    const literal = this.config.hybrid.enableLiteral ? (await this.inventory.searchCode(query, options)).hits.flatMap(hit => chunks.filter(chunk => chunk.path === hit.path && chunk.startLine <= hit.endLine && chunk.endLine >= hit.startLine).map(chunk => ({ id: chunk.id, score: hit.score }))) : [];
    const exact=quality?exactDefinitions(chunks,query).map(c=>({id:c.id,score:1})):[];
    const combinedLiteral=[...literal,...exact.filter(e=>!literal.some(l=>l.id===e.id))];
    const candidateIds=[...new Set([...vector,...keyword,...combinedLiteral].map(r=>r.id))];
    if(lazy){const scoring=this.store.scoringHeaders(candidateIds);for(let i=0;i<chunks.length;i++){const candidate=scoring.get(chunks[i]!.id);if(candidate)chunks[i]=candidate;}}
    const clock=options.scoringNow===undefined?{}:{now:options.scoringNow};
    const scored=scoreHybridCandidates(chunks,query,vector,keyword,{topK,literal:combinedLiteral,pathPenalty:!quality,...clock});
    const strategy=this.config.hybrid.graphStrategy;
    const selective=profile==='hybrid-quality'&&this.config.hybrid.enableGraph&&strategy==='selective';
    const graph=this.config.hybrid.enableGraph&&profile==='hybrid-quality'&&['legacy','always'].includes(strategy)?this.store.graph():{nodes:[],edges:[]};
    this.lastSelection=[];
    const rerank=(edges:Parameters<typeof scoreQuality>[3])=>{const result=selectQuality(scoreQuality(scored,query,profile,edges),query,topK,{policy:this.config.quality.selection,required:this.requiredDefinitions()});this.lastSelection=result.decisions;return result.selected;};
    const ranked = quality?rerank(graph.edges):rankHybrid(chunks, query, vector, keyword, { topK, threshold: this.config.hybrid.confidenceThreshold, literal,...clock });
    let graphTrace:{plan:GraphPlan;result:GraphResult|null}|undefined;
    if(selective){
      const targets=this.graphPlanner.targets(query),matches=(c:CodeChunk)=>['class','function','method','interface'].includes(c.kind)&&targets.some(t=>c.name===t||c.qualifiedName===t||c.qualifiedName.endsWith('.'+t));
      const namedCandidates=scored.filter(r=>matches(r.chunk)),candidateNames=new Set(namedCandidates.map(r=>r.chunk.id));
      const named=this.config.hybrid.intentPolicy==='relationships'?[...namedCandidates,...chunks.filter(c=>matches(c)&&!candidateNames.has(c.id)).map(chunk=>({chunk}))]:namedCandidates;
      const relationship=this.config.hybrid.intentPolicy==='relationships'&&/\brelationships?\b|\binteract\w*\b|\bconnect\w*\b|связан|связь|связи|взаимодейств/iu.test(query);
      const tokens=new Set(queryPurpose(query).identifiers.map(t=>t.toLowerCase()));
      // A named entity can be indexed without making the semantic candidate cutoff. Bind intent
      // against already loaded compact headers, then traverse the ranked contextual definitions.
      // No scores/candidate population change and no whole-graph/materialized-body lookup.
      const structural=relationship?chunks.filter(c=>['class','function','method','interface'].includes(c.kind)&&(tokens.has(c.name.toLowerCase())||tokens.has(c.qualifiedName.toLowerCase()))):[];
      const contextual=ranked.filter(r=>['class','function','method','interface'].includes(r.chunk.kind));
      const distinctSymbols=new Set(structural.map(c=>c.name.toLowerCase()));
      const roots=named.length?named:relationship?(distinctSymbols.size>=2?contextual:[]):contextual;
      const plan=this.graphPlanner.plan(query,roots.slice(0,3).map(r=>r.chunk.id));
      graphTrace={plan,result:null};
      if(plan.mode==='selective'&&plan.seeds.length&&topK>=3){
        const result=await this.graphQuery.execute(plan,{snapshotRefreshed:options.refresh!==false,...(options.signal?{signal:options.signal}:{})});graphTrace.result=result;
        if(!['stale-index','aborted','work-budget','max-nodes','max-edges'].includes(result.stopReason)){
          const reranked=rerank(result.edges);ranked.splice(0,ranked.length,...reranked);
          const byId=new Map(chunks.map(c=>[c.id,c])),selected=new Set(ranked.map(r=>r.chunk.id)),seeds=new Set(plan.seeds);
          const extras:typeof ranked=[];
          for(const node of result.nodes){
            if(seeds.has(node.id)||selected.has(node.id))continue;const chunk=byId.get(node.id);if(!chunk)continue;
            extras.push({chunk,debug:{literalRank:null,keywordRank:null,vectorRank:null,literalScore:null,keywordScore:null,vectorDistance:null,rrf:0,confidence:0,final:0.5,graph:true,quality:{profile,components:{graph:0.5},reasons:[`graph:${plan.direction}`,plan.reason]}}});
            if(extras.length>=Math.min(plan.maxBonusChunks,Math.floor(topK/3)))break;
          }
          if(extras.length){const keep=ranked.filter((r,i)=>i<topK-extras.length||(r.debug.quality?.components.exactSymbol??0)>0);ranked.splice(0,ranked.length,...keep,...extras.slice(0,Math.max(0,topK-keep.length)));}
        }
      }
    }
    if (profile==='hybrid-quality'&&topK>=3&&queryPurpose(query).dependencies&&ranked.length&&graph.edges.length) {
      const seeds=new Set(ranked.slice(0,3).map(r=>r.chunk.id));
      const fields=new Set(chunks.filter(c=>c.parentId&&seeds.has(c.parentId)).map(c=>c.id));
      const incoming=queryPurpose(query).callers,extras:typeof ranked=[];
      for(const edge of graph.edges){
        if(!['CALLS','IMPORTS','INHERITS'].includes(edge.relation)&&!edge.relation.startsWith('ORM_'))continue;
        const target=incoming&&seeds.has(edge.target)?edge.source:seeds.has(edge.source)||fields.has(edge.source)?edge.target:null;
        const chunk=target?chunks.find(c=>c.id===target):undefined;
        if(!chunk||ranked.some(r=>r.chunk.id===chunk.id)||extras.some(r=>r.chunk.id===chunk.id))continue;
        extras.push({chunk,debug:{literalRank:null,keywordRank:null,vectorRank:null,literalScore:null,keywordScore:null,vectorDistance:null,rrf:0,confidence:0,final:0.5,graph:true,
          quality:{profile,components:{graph:0.5},reasons:[`graph:${edge.relation}`,`confidence:${edge.confidence}`]}}});
        if(extras.length>=Math.min(3,Math.floor(topK/3)))break;
      }
      if(extras.length){const keep=ranked.filter((r,i)=>i<topK-extras.length||(r.debug.quality?.components.exactSymbol??0)>0);ranked.splice(0,ranked.length,...keep,...extras.slice(0,Math.max(0,topK-keep.length)));}
    }
    tick('candidateRerankGraph');
    if (this.config.hybrid.enableGraph && profile==='legacy-v04' && ranked.length) {
      const graph = this.store.graph(); const expansion = new BoundedCodeGraph(graph.nodes, graph.edges).expand(ranked.slice(0, 3).map(row => row.chunk.id), { depth: 1, maxNodes: 32, relations: ['CALLS', 'IMPORTS'] });
      for (const node of expansion) {
        if (ranked.length >= topK) break;
        const chunk = chunks.find(c => c.id === node.id); if (!chunk || ranked.some(row => row.chunk.id === chunk.id)) continue;
        ranked.push({ chunk, debug: { literalRank: null, keywordRank: null, vectorRank: null, literalScore: null, keywordScore: null, vectorDistance: null, rrf: 0, confidence: 0, final: 0, graph: true } });
      }
    }
    const verified: typeof ranked = [];
    for (const row of ranked) {
      try { const chunk=lazy?this.store.chunk(row.chunk.id):row.chunk;if(!chunk)throw new Error('Missing selected source');verified.push({ ...row, chunk: await this.index.fresh(chunk) }); }
      catch { this.integrityWarnings++; /* Raced or corrupt indexed sources are never served. */ }
    }
    tick('sourceRevalidation');timings.total=performance.now()-started;
    this.lastTrace={profile,hydration:{mode:lazy?'lazy':'full',candidateBodies:lazy?candidateIds.length:chunks.length,selectedBodies:ranked.length,reason:lazy?'compact headers, candidate scoring prefix, selected full bodies':this.config.hybrid.lazyHydration?'code-bm25 requires full corpus text':'legacy hydration'},...(graphTrace?{graph:graphTrace}:{}),timings,candidates:scored.map(({chunk,debug})=>({id:chunk.id,path:chunk.path,kind:chunk.kind,startLine:chunk.startLine,endLine:chunk.endLine,name:chunk.qualifiedName,debug})),selected:verified.map(r=>r.chunk.id)};
    return verified;
  }
  async searchCode(query: string, options: { path?: string; includeMigrations?: boolean } = {}): Promise<NativeSearchResult> {
    const selected = await this.searchChunks(query, options); const hits: RetrievalHit[] = []; const debug: Record<string, RetrievalDebug> = {};
    let bytes = 0, truncated = false;
    for (const { chunk, debug: score } of selected) {
      const hit: RetrievalHit = { path: chunk.path, startLine: chunk.startLine, endLine: chunk.endLine, sha256: chunk.fileHash,
        chunkId: chunk.id, representation: this.config.hybrid.enableCompression ? 'preview' : 'full',
        excerpt: this.config.hybrid.enableCompression ? JSON.stringify(this.compressor.preview(chunk)) : chunk.text,
        score: score.final, reason: `hybrid ${chunk.kind} ${chunk.qualifiedName}` };
      const size = Buffer.byteLength(JSON.stringify(hit));
      if (bytes + size > 32000 || hits.length >= this.config.retrieval.maxSearchResults) { truncated = true; continue; }
      bytes += size; hits.push(hit); debug[chunk.id] = score;
    }
    return { hits, truncated, source: 'hybrid-native+disk', debug };
  }
  async render(hit: RetrievalHit): Promise<Record<string, unknown>> {
    const indexed = hit.chunkId ? this.store.chunk(hit.chunkId) : null;
    if (!indexed || indexed.path !== hit.path || indexed.fileHash !== hit.sha256) throw new Error('Unbound native source reference');
    const chunk = await this.index.fresh(indexed);
    if (chunk.startLine !== hit.startLine || chunk.endLine !== hit.endLine) {
      const current = await this.workspace.read(hit.path, this.config.retrieval.maxFileBytes);
      if (current.sha256 !== hit.sha256) throw new Error('Source changed during rendering');
      return { representation: 'full', excerpt: current.text.split(/\r?\n/).slice(hit.startLine - 1, hit.endLine).join('\n') };
    }
    return this.config.hybrid.enableCompression ? { chunkId: chunk.id, ...this.compressor.preview(chunk) } : { chunkId: chunk.id, representation: 'full', excerpt: chunk.text };
  }
  async expandChunk(id: string): Promise<CodeChunk> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid chunk id'); await this.index.refresh();
    const chunk = this.store.chunk(id); if (!chunk) throw new Error('Chunk no longer exists'); return this.index.fresh(chunk);
  }
  async related(id: string, options: { depth?: number; maxNodes?: number; relations?: string[] } = {}) {
    if (!this.config.hybrid.enableGraph) throw new Error('Code graph disabled');
    if(this.config.hybrid.graphStrategy==='selective')return(await this.relatedEvidence(id,options)).nodes;
    // Explicit graph requests reconstruct AST evidence instead of trusting stored facts.
    await this.index.refresh(true);
    const graph = this.store.graph(); return new BoundedCodeGraph(graph.nodes, graph.edges).expand([id], { depth: options.depth ?? 1, maxNodes: options.maxNodes ?? 32, ...(options.relations ? { relations: options.relations } : {}) });
  }
  async relatedEvidence(id:string,options:{depth?:number;maxNodes?:number;relations?:string[]}={}):Promise<GraphResult>{
    if(!this.config.hybrid.enableGraph)throw new Error('Code graph disabled');
    const relations=options.relations??[...GRAPH_RELATIONS];if(relations.some(r=>!GRAPH_RELATIONS.includes(r as GraphRelation)))throw new Error('Unknown graph relation');
    await this.index.refresh();
    return this.graphQuery.execute({mode:'selective',direction:'outgoing',relations:relations as GraphRelation[],seeds:[id],maxDepth:options.depth??1,maxNodes:options.maxNodes??32,maxEdges:256,maxBonusChunks:0,intent:'explicit',reason:'Explicit bounded related-code query'},{snapshotRefreshed:true});
  }
  status() { return { backend: 'hybrid-native', keyword: this.config.hybrid.keywordMode, vector: this.store.vector?.backend ?? 'disabled', dimension: this.store.dimension,
    chunks: this.store.chunkCount(), files: this.store.files().size, integrityWarnings: this.integrityWarnings, lastIndex: this.index.lastResult, adapters: this.index.registry.languages.map(a => ({ id: a.id, version: a.version })) }; }
  close(): void { this.store.close(); }
}
