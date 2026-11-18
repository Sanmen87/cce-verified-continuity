import type {GraphEdge,GraphNode} from './contracts.ts';
export const GRAPH_RELATIONS=['CALLS','IMPORTS','INHERITS','REFERENCES','DEFINES','CONTAINS','ORM_FOREIGNKEY','ORM_ONETOONEFIELD','ORM_MANYTOMANYFIELD','ORM_GENERICRELATION','ROUTES_TO']as const;
export type GraphRelation=typeof GRAPH_RELATIONS[number];
export type GraphDirection='incoming'|'outgoing'|'both';
export interface GraphPlan {
  mode:'skip'|'selective';direction:GraphDirection;relations:readonly GraphRelation[];seeds:readonly string[];
  maxDepth:number;maxNodes:number;maxEdges:number;maxBonusChunks:number;reason:string;
  intent:'definition'|'callers'|'calls'|'inheritance'|'dependency'|'impact'|'relationship'|'unknown'|'explicit';
}
export type GraphStopReason='complete'|'max-depth'|'max-nodes'|'max-edges'|'stale-index'|'aborted'|'work-budget';
export interface GraphResult {
  edges:GraphEdge[];nodes:GraphNode[];visitedNodes:number;visitedEdges:number;truncated:boolean;
  stopReason:GraphStopReason;generation:string;cacheHit:boolean;sqlQueries:number;completeness:'UNVERIFIED';
}
