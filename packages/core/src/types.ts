import type { ContextQualityReport } from './quality/contracts.ts';
export interface RetrievalHit {
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  sha256: string;
  score: number;
  reason: string;
  chunkId?: string;
  representation?: 'preview' | 'full';
}
export interface SearchResult {
  hits: RetrievalHit[];
  truncated: boolean;
  source: 'ripgrep+disk' | 'hybrid-native+disk';
}
export interface ContextRequest {
  /** Host-authorized full definition evidence; never populated from retrieved code or checkpoints. */
  requiredChunkIds?:string[];
  task: string;
  hits: RetrievalHit[];
  tokenBudget?: number;
  historyTokens?: number;
  overheadTokens?: number;
  projectRules?: string[];
  sessionBudgetKnown?: boolean;
}
export interface BuiltContext {
  quality?: ContextQualityReport;
  text: string;
  estimatedTokens: number;
  tokenSource: 'estimated:utf8-bytes';
  budget: number;
  included: Array<{ path: string; startLine: number; endLine: number }>;
  omitted: Array<{ path: string; reason: string;code?:'OMITTED_BY_TOKEN_BUDGET'|'OMITTED_BY_OVERLAP';startLine?:number;endLine?:number;sha256?:string }>;
}
export interface FileEvidence { type: 'file'; path: string; sha256: string }
export interface CheckpointInput {
  taskId: string;
  goal: string;
  completed: Array<{ description: string; evidence: FileEvidence[] }>;
  pending: string[];
  testResults: Array<{ command: string; exitCode: number | null; summary: string }>;
}
export interface GitState {
  available: boolean;
  head: string | null;
  worktreeDirty: boolean;
  statusSha256: string;
  diffSha256: string;
}
export interface Checkpoint extends CheckpointInput {
  schemaVersion: 1;
  projectId: string;
  sessionId: string;
  changedFiles: string[];
  fileHashes: Record<string, string>;
  git: GitState;
  savedAt: string;
}
export interface LoadedCheckpoint {
  checkpoint: Checkpoint;
  warnings: string[];
  requiresRevalidation: boolean;
  trusted: false;
}
