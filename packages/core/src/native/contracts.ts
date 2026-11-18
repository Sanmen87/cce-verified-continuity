import type { RetrievalHit, SearchResult } from '../types.ts';
export interface ExpressionFact {
  kind: string; text: string; value?: string; callee?: string;
  arguments?: ExpressionFact[]; keywords?: Record<string, ExpressionFact>; elements?: ExpressionFact[];
}
export interface ImportFact { module: string; name: string | null; alias: string | null; relative: number }
export interface CallFact { callee: string; arguments: ExpressionFact[]; keywords: Record<string, ExpressionFact> }
export interface SyntaxFacts {
  bases: string[]; decorators: string[]; imports: ImportFact[]; calls: CallFact[];
  references: string[]; assignment: { target: string; value: ExpressionFact } | null;
}
export interface CodeChunk {
  id: string; path: string; language: string; kind: string; name: string; qualifiedName: string;
  parentId: string | null; startLine: number; endLine: number; definitionStartLine: number;
  fileHash: string; chunkHash: string; signature: string; docstring: string;
  text: string; parserVersion: string; algorithmVersion: string; retrievable: boolean;
  syntax: SyntaxFacts; metadata: Record<string, unknown>;
  baseMetadata?: Record<string, unknown>;
}
export interface ParsedFile { path: string; language: string; fileHash: string; chunks: CodeChunk[]; diagnostics: string[] }
export interface ChunkParser {
  readonly id: string; readonly version: string;
  parse(path: string, source: string, fileHash: string): Promise<ParsedFile>;
}
export interface LanguageAdapter extends ChunkParser {
  detects(path: string): boolean;
  moduleName(path: string): string;
  resolveImport(from: string, specifier: string, files: ReadonlySet<string>, relative?: number): string | null;
}
export interface ProjectDescription { files: readonly string[]; manifests: Readonly<Record<string, string>> }
export interface RelationFact {
  source: string; targetName: string; relation: string; confidence: 'syntax' | 'inferred';
  metadata: Record<string, unknown>;
}
export interface FrameworkEnrichment {
  metadata: Record<string, Record<string, unknown>>; relations: RelationFact[];
}
export interface FrameworkAdapter {
  readonly id: string; readonly version: string;
  prepare?(chunks: readonly CodeChunk[]): void;
  detects(project: ProjectDescription): boolean;
  enrich(file: ParsedFile): FrameworkEnrichment;
}
export interface EmbeddingProvider {
  readonly id: string; readonly dimension: number; readonly preprocessing: string;
  embed(texts: readonly string[], purpose: 'document' | 'query'): Promise<Float32Array[]>;
}
export interface RankedId { id: string; score: number; distance?: number }
export interface VectorIndex {
  readonly backend: string;
  replace(entries: ReadonlyArray<{ id: string; vector: Float32Array }>): void;
  search(vector: Float32Array, topK: number, allowed?: ReadonlySet<string>): RankedId[];
  remove(ids: readonly string[]): void;
}
export interface KeywordIndex {
  readonly backend: string;
  replace(chunks: readonly CodeChunk[]): void;
  search(query: string, topK: number): RankedId[];
  remove(ids: readonly string[]): void;
}
export interface GraphEdge {
  source: string; target: string; relation: string; path: string; fileHash: string;
  confidence: 'syntax' | 'inferred'; metadata: Record<string, unknown>;
}
export interface GraphNode { id: string; name: string; path: string | null; kind: string }
export interface CodeGraph {
  neighbors(id: string, relations?: readonly string[]): Array<{ node: GraphNode; edge: GraphEdge }>;
  expand(ids: readonly string[], options: { depth: number; maxNodes: number; relations?: readonly string[] }): GraphNode[];
}
export interface SourceEvidence { path: string; sha256: string }
export interface MemoryRecord {
  id: string; projectId: string; kind: 'decision' | 'code-area'; text: string;
  status: 'proposed' | 'confirmed'; authority: 'agent' | 'user'; evidence: SourceEvidence[];
  gitHead: string | null; gitFingerprint: string; createdAt: string;
}
export interface RecalledMemory { record: MemoryRecord; stale: boolean; warnings: string[]; trusted: false }
export interface MemoryRepository {
  propose(input: { kind: MemoryRecord['kind']; text: string; evidence: SourceEvidence[] }): Promise<MemoryRecord>;
  confirm(id: string, authority: 'user'): Promise<MemoryRecord>;
  recall(query: string, options?: { includeProposed?: boolean }): Promise<RecalledMemory[]>;
}
export interface ContextCompressor {
  preview(chunk: CodeChunk): { representation: 'signature-docstring'; signature: string; docstring: string; members: string[]; omittedFields: string[]; omittedMembers: number };
}
export interface RetrievalProvider {
  files(includeMigrations?: boolean): Promise<string[]>;
  searchCode(query: string, options?: { path?: string; includeMigrations?: boolean }): Promise<SearchResult>;
  render?(hit: RetrievalHit): Promise<Record<string, unknown>>;
}
export interface RetrievalDebug {
  quality?: { profile: string; components: Record<string,number>; reasons: string[] };
  literalRank: number | null; keywordRank: number | null; vectorRank: number | null;
  literalScore: number | null; keywordScore: number | null; vectorDistance: number | null;
  rrf: number; confidence: number; final: number; graph: boolean;
}
export interface NativeSearchResult extends SearchResult { debug?: Record<string, RetrievalDebug> }
