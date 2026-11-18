import {sha256} from '../workspace.ts';
import type {NativeIndexManager} from './indexer.ts';
import type {NativeStore} from './store.ts';
import {GRAPH_RELATIONS,type GraphPlan,type GraphResult,type GraphStopReason} from './graph-contracts.ts';
/** Bounded indexed SQL traversal. Every cache use requires a current index scan and source revalidation. */
export class IndexedGraphQuery {
  private cache=new Map<string,GraphResult>();private generation='';
  private store:NativeStore;private index:NativeIndexManager;
  constructor(store:NativeStore,index:NativeIndexManager){this.store=store;this.index=index;}
  private validate(plan:GraphPlan):void {
    if(plan.mode!=='selective')throw new Error('Invalid graph mode');
    if(!['incoming','outgoing','both'].includes(plan.direction)||plan.seeds.length>30||plan.seeds.some(id=>!/^[a-f0-9]{64}$/.test(id))||plan.relations.some(r=>!GRAPH_RELATIONS.includes(r))||!plan.relations.length)throw new Error('Invalid graph plan');
    for(const [value,min,max]of [[plan.maxDepth,0,5],[plan.maxNodes,1,1000],[plan.maxEdges,1,4096],[plan.maxBonusChunks,0,100]]as const)if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('Invalid graph work limit');
  }
  async execute(plan:GraphPlan,options:{snapshotRefreshed?:boolean;signal?:AbortSignal;maxWorkMs?:number}={}):Promise<GraphResult>{
    const started=performance.now(),empty=(stopReason:GraphStopReason):GraphResult=>({edges:[],nodes:[],visitedNodes:0,visitedEdges:0,truncated:stopReason!=='complete',stopReason,generation:this.store.generation(),cacheHit:false,sqlQueries:0,completeness:'UNVERIFIED'});
    if(plan.mode==='skip')return empty('complete');this.validate(plan);
    if(options.maxWorkMs!==undefined&&(!Number.isFinite(options.maxWorkMs)||options.maxWorkMs<0))throw new Error('Invalid graph deadline');
    if(options.signal?.aborted)return empty('aborted');
    if(!options.snapshotRefreshed)try{await this.index.refresh();}catch{return empty('stale-index');}
    if(options.signal?.aborted)return empty('aborted');
    const generation=this.store.generation();if(generation!==this.generation){this.cache.clear();this.generation=generation;}
    if(this.store.meta('graphSnapshot')!==this.store.meta('sourceSnapshot')||!this.store.meta('graphSnapshot'))return empty('stale-index');
    const key=sha256(JSON.stringify([this.index.workspace.projectId,generation,this.store.meta('sourceSnapshot'),plan]));
    const current=async(result:GraphResult):Promise<boolean>=>{
      const hashes=new Map<string,string>();for(const edge of result.edges){if(hashes.has(edge.path)&&hashes.get(edge.path)!==edge.fileHash)return false;hashes.set(edge.path,edge.fileHash);}
      // Sources establish edges; checking target SHA alone cannot establish an edge.
      for(const node of result.nodes)if(node.path){const c=this.store.chunkHeader(node.id);if(!c||c.path!==node.path||hashes.has(c.path)&&hashes.get(c.path)!==c.fileHash)return false;hashes.set(c.path,c.fileHash);}
      try{for(const [file,hash]of hashes)if((await this.index.workspace.read(file,this.index.options.maxFileBytes)).sha256!==hash)return false;}catch{return false;}
      return this.store.generation()===generation&&!options.signal?.aborted;
    };
    const cached=this.cache.get(key);if(cached){if(await current(cached))return{...structuredClone(cached),cacheHit:true,sqlQueries:0,visitedEdges:0,visitedNodes:0};this.cache.delete(key);return empty(options.signal?.aborted?'aborted':'stale-index');}
    const result=empty('complete');result.generation=generation;
    const nodes=new Map<string,NonNullable<ReturnType<NativeStore['graphNode']>>>(),edges=new Set<string>();
    let frontier=[...new Set(plan.seeds)],stopped=false;
    const stop=(reason:GraphStopReason)=>{result.stopReason=reason;result.truncated=true;stopped=true;};
    for(const id of frontier){const node=this.store.graphNode(id);result.sqlQueries++;if(node){if(nodes.size===plan.maxNodes){stop('max-nodes');break;}nodes.set(id,node);}}
    for(let depth=0;depth<plan.maxDepth&&frontier.length&&!stopped;depth++){
      const next:string[]=[];
      traversal:for(const id of frontier)for(const direction of plan.direction==='both'?['incoming','outgoing']as const:[plan.direction]){
        if(options.signal?.aborted){stop('aborted');break traversal;}
        if(options.maxWorkMs!==undefined&&performance.now()-started>=options.maxWorkMs){stop('work-budget');break traversal;}
        const remaining=plan.maxEdges-result.visitedEdges;if(remaining<=0){stop('max-edges');break traversal;}
        const rows=this.store.graphNeighbors(id,direction,plan.relations,remaining);result.sqlQueries++;
        for(const edge of rows){
          result.visitedEdges++;
          const key=JSON.stringify([edge.source,edge.target,edge.relation]);if(edges.has(key))continue;edges.add(key);
          const target=direction==='incoming'?edge.source:edge.target;
          if(!nodes.has(target)){
            // Unresolved names are not relationship evidence. Keep charging scanned edges/SQL
            // to the existing work bounds, but never let placeholders consume the node budget.
            let resolved:ReturnType<NativeStore['graphNode']>|undefined;
            if(plan.intent==='relationship'){
              resolved=this.store.graphNode(target);result.sqlQueries++;
              if(!resolved||resolved.path===null||resolved.kind==='unresolved'){
                if(result.visitedEdges>=plan.maxEdges){stop('max-edges');break traversal;}
                continue;
              }
            }
            if(nodes.size>=plan.maxNodes){stop('max-nodes');break traversal;}
            const node=resolved??this.store.graphNode(target);if(!resolved)result.sqlQueries++;if(node){nodes.set(target,node);next.push(target);}
          }
          result.edges.push(edge);
          if(result.visitedEdges>=plan.maxEdges){stop('max-edges');break traversal;}
        }
      }
      frontier=next;if(depth===plan.maxDepth-1&&frontier.length&&!stopped)stop('max-depth');
    }
    if(plan.maxDepth===0&&frontier.length&&!stopped)stop('max-depth');
    result.nodes=[...nodes.values()];result.visitedNodes=nodes.size;
    if(!await current(result))return empty(options.signal?.aborted?'aborted':'stale-index');
    if(['aborted','work-budget'].includes(result.stopReason))return{...result,edges:[],nodes:[]};
    this.cache.set(key,structuredClone(result));if(this.cache.size>128)this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
}
