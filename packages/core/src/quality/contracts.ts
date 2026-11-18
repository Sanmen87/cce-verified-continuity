import type { CodeChunk, GraphEdge, GraphNode, SourceEvidence } from '../native/contracts.ts';
import type { GitState } from '../types.ts';
export type RequirementStatus = 'NOT_CHECKED' | 'CONTEXT_FOUND' | 'IMPLEMENTED_UNVERIFIED' | 'VERIFIED_PASS' | 'VERIFIED_FAIL' | 'BLOCKED';
export interface ContextNeed {
  id: string; kind: 'definition' | 'source' | 'dependency' | 'test'; symbol?: string; path?: string;
  representation: 'preview' | 'full'; relation?: string; targetSymbol?: string;
  bodyRequired?: boolean;
}
export interface TaskRequirement { id: string; clause: string; needs: ContextNeed[]; checks: string[] }
export interface ExplicitTaskContract {
  id: string; source: 'user' | 'confirmed-task-contract'; text: string; requirements: TaskRequirement[];
}
interface ContextReference extends SourceEvidence { startLine: number; endLine: number; chunkId?: string }
export type ContextEvidence = ContextReference & (
  { representation: 'full' | 'file'; text: string } |
  { representation: 'preview'; signature: string; docstring: string; members: string[] }
);
export interface ContextFacts { chunks: CodeChunk[]; nodes: GraphNode[]; edges: GraphEdge[]; graphProvenance: 'indexed-static' | 'fresh-static' | 'unavailable' }
export interface ContextQualityReport {
  contractId: string | null; relevantSymbols: string[]; coveredRequirements: string[]; uncoveredRequirements: string[];
  missingDefinitions: string[]; missingDependencies: Array<{ source: string; target: string; relation: string; provenance: string }>;
  unresolvedDependencies: string[]; staleSources: string[]; rejectedSources: Array<{ path: string; reason: string }>;
  selectedSources: ContextReference[]; evidenceByRequirement: Record<string,ContextReference[]>;
  needCoverage: Record<string,'FOUND' | 'PREVIEW_ONLY' | 'MISSING' | 'UNKNOWN'>;
  confidence: null; completeness: 'UNVERIFIED'; structuralCoverage: { covered: number; total: number; ratio: number | null };
  duplication: { overlappingPairs: number; lineFraction: number; basis: 'declared-source-ranges' };
  budget: { limit: number | null; used: number; accounting: 'estimated:utf8-bytes' | 'model-tokenizer'; exceeded: boolean; historyKnown: boolean };
  git: { available: boolean; head: string | null }; graphProvenance: ContextFacts['graphProvenance'];
  recommendedAction: 'use-context' | 'expand-context' | 'retrieve-more' | 'read-source'; reasons: string[];
}
export interface ProjectBinding { projectId: string; files: Record<string,string | null>; git: GitState }
export interface ExecutedCheckResult { exitCode: number | null; diagnostic: string; executionId: string; termination?: 'completed' | 'watchdog' | 'aborted' | 'launch-error' }
export interface ApprovedCheck {
  id: string; type: 'unit-test' | 'integration-test' | 'typecheck' | 'build' | 'lint' | 'custom-approved';
  source: string; execute: () => Promise<ExecutedCheckResult>;
}
export interface VerificationReceipt {
  id: string; checkId: string; type: ApprovedCheck['type']; status: 'PASS' | 'FAIL' | 'UNKNOWN'; diagnostic: string;
  source: string; executionId: string; startedAt: string; finishedAt: string; binding: ProjectBinding;
  termination: 'completed' | 'watchdog' | 'aborted' | 'launch-error';
  requirementIds: string[]; retryRetrieval: Array<{ requirementId: string; symbols: string[]; paths: string[]; includeTests: boolean }>;
}
