// Content-hash incremental indexing/cache derived from Elara indexer/{pipeline,
// manifest,embedding_cache}.py @ 75071156e08a145fab17c8ce30bb5f418286f434.
// Copyright (c) 2026 Fazle Elahee (MIT). CCE adds atomic snapshots, plugin and
// model identities, source SHA revalidation and fail-closed secret handling.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { gitSnapshot } from '../git.ts';
import type { Retrieval } from '../retrieval.ts';
import { sha256, type Workspace } from '../workspace.ts';
import type { CodeChunk, EmbeddingProvider, ParsedFile, FrameworkAdapter } from './contracts.ts';
import type { NativeStore } from './store.ts';
import type { AdapterRegistry } from './registry.ts';
import { buildGraph } from './graph.ts';
import { containsSecret } from './secrets.ts';
import { validateVector } from './vectors.ts';
export interface NativeIndexOptions {
  stateDir: string; maxFileBytes: number; enableGraph: boolean; embedding?: EmbeddingProvider;
  symbolResolution?:'legacy'|'scoped';
  maxFiles?: number; maxBytes?: number; maxChunks?: number; deadlineMs?: number;
}
export interface NativeIndexResult {
  indexedFiles: number; skippedFiles: number; unchangedFiles: number; deletedFiles: number;
  chunks: number; cacheHits: number; cacheMisses: number; diskReads: number; buildMs: number;
  invalidated: boolean; reason: string; frameworks: string[]; diagnostics: number;
}
export class NativeIndexManager {
  readonly workspace: Workspace; readonly store: NativeStore; readonly registry: AdapterRegistry;
  readonly options: NativeIndexOptions; private inventory: Retrieval; private updating: Promise<NativeIndexResult> | undefined;
  lastResult: NativeIndexResult | null = null;
  frameworks: FrameworkAdapter[] = [];
  private verified = new Map<string, ParsedFile>();
  private frameworksPrepared = false;
  constructor(workspace: Workspace, inventory: Retrieval, store: NativeStore, registry: AdapterRegistry, options: NativeIndexOptions) {
    this.workspace = workspace; this.inventory = inventory; this.store = store; this.registry = registry; this.options = options;
  }
  cacheKey(text: string): string { return sha256(JSON.stringify([this.options.embedding?.id ?? 'none', this.options.embedding?.dimension ?? 0, this.options.embedding?.preprocessing ?? 'none', sha256(text)])); }
  async refresh(force = false): Promise<NativeIndexResult> {
    if (this.updating) { const result = await this.updating; return force ? this.refresh(true) : result; }
    this.updating = this.update(force); try { this.lastResult = await this.updating; return this.lastResult; } finally { this.updating = undefined; }
  }
  private async update(force: boolean): Promise<NativeIndexResult> {
    const started = performance.now(); const check = () => { if (performance.now() - started > (this.options.deadlineMs ?? 600000)) throw new Error('Index build deadline exceeded'); };
    const files = await this.inventory.files(true);
    if (files.length > (this.options.maxFiles ?? 20000)) throw new Error('Index file limit exceeded');
    const old = this.store.files(); const sources = new Map<string, { text: string; sha256: string; modified: number }>();
    let bytes = 0, skippedFiles = 0;
    for (const file of files) {
      check();
      try {
        const source = await this.workspace.read(file, this.options.maxFileBytes);
        if (containsSecret(source.text)) { skippedFiles++; continue; }
        bytes += Buffer.byteLength(source.text); if (bytes > (this.options.maxBytes ?? 128 * 1024 * 1024)) throw new Error('Index corpus byte limit exceeded');
        const modified = (await stat(path.join(this.workspace.root, file))).mtimeMs / 1000;
        sources.set(file, { ...source, modified });
      } catch (error) {
        if ((error as Error).message === 'Index corpus byte limit exceeded') throw error;
        skippedFiles++;
      }
    }
    const manifests = Object.fromEntries([...sources].filter(([file]) => /(?:^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|go\.mod|pom\.xml)$/.test(file)).map(([file, source]) => [file, source.text]));
    this.frameworks = this.registry.detectFrameworks({ files: [...sources.keys()], manifests });
    const snapshot = await gitSnapshot(this.workspace, this.options.stateDir);
    const fingerprint = sha256(JSON.stringify([this.registry.fingerprint(), this.options.embedding?.id ?? null, this.options.embedding?.dimension ?? 0,
      this.options.enableGraph, snapshot.git.head, this.frameworks.map(f => [f.id, f.version]),...(this.options.symbolResolution==='scoped'?['scoped-resolver-v1']:[])]));
    const invalidated = force || this.store.meta('fingerprint') !== fingerprint || this.options.enableGraph&&!this.store.meta('graphSnapshot')||this.store.meta('headersVersion')!=='1';
    const updates: ParsedFile[] = []; let unchangedFiles = 0, diagnostics = 0;
    for (const [file, source] of sources) {
      check(); if (!invalidated && old.get(file) === source.sha256) { unchangedFiles++; continue; }
      const parsed = await this.registry.language(file).parse(file, source.text, source.sha256);
      if (parsed.path !== file || parsed.fileHash !== source.sha256 || parsed.chunks.length > 10000) throw new Error('Invalid language adapter result');
      for (const chunk of parsed.chunks) {
        if (chunk.path !== file || chunk.fileHash !== source.sha256 || !/^[a-f0-9]{64}$/.test(chunk.id) || sha256(chunk.text) !== chunk.chunkHash || chunk.startLine < 1 || chunk.endLine < chunk.startLine) throw new Error('Invalid chunk source binding');
        chunk.metadata.modified_ts = source.modified;
        chunk.retrievable = chunk.retrievable && Boolean(chunk.text.trim());
      }
      updates.push(parsed); diagnostics += parsed.diagnostics.length;
      this.verified.set(file + ':' + source.sha256 + ':' + this.registry.fingerprint(), parsed);
      if (this.verified.size > 64) this.verified.delete(this.verified.keys().next().value!);
    }
    const deleted = [...old.keys()].filter(file => !sources.has(file));
    if (!invalidated && !updates.length && !deleted.length) {
      if (!this.frameworksPrepared) { const chunks = this.store.chunks(); for (const framework of this.frameworks) framework.prepare?.(chunks); this.frameworksPrepared = true; }
      return { indexedFiles: 0, skippedFiles, unchangedFiles, deletedFiles: 0,
      chunks: this.store.chunkCount(), cacheHits: 0, cacheMisses: 0, diskReads: files.length, buildMs: performance.now() - started,
      invalidated: false, reason: 'unchanged content hash scan', frameworks: this.frameworks.map(f => f.id), diagnostics: 0 };
    }
    const changed = new Set([...deleted, ...updates.map(file => file.path)]);
    const retained = invalidated ? [] : this.store.chunks().filter(chunk => !changed.has(chunk.path));
    const all = [...retained, ...updates.flatMap(file => file.chunks)];
    for (const framework of this.frameworks) framework.prepare?.(all);
    this.frameworksPrepared = true;
    for (const chunk of all) { chunk.baseMetadata ??= { ...chunk.metadata }; chunk.metadata = { ...chunk.baseMetadata }; }
    const grouped = new Map<string, CodeChunk[]>();
    for (const chunk of all) { const group = grouped.get(chunk.path) ?? []; group.push(chunk); grouped.set(chunk.path, group); }
    for (const [file, chunks] of grouped) for (const framework of this.frameworks) {
      const enrichment = framework.enrich({ path: file, language: chunks[0]!.language, fileHash: chunks[0]!.fileHash, chunks, diagnostics: [] });
      for (const chunk of chunks) if (enrichment.metadata[chunk.id]) chunk.metadata = { ...chunk.metadata, ...enrichment.metadata[chunk.id] };
    }
    if (all.length > (this.options.maxChunks ?? 30000)) throw new Error('Chunk count limit exceeded');
    const ids = new Set(all.map(c => c.id)); if (ids.size !== all.length) throw new Error('Duplicate chunk id');
    const embeddings = new Map<string, Float32Array>(); let cacheHits = 0, cacheMisses = 0;
    const toEmbed = updates.flatMap(file => file.chunks).filter(c => c.retrievable);
    const misses: CodeChunk[] = []; const model = this.options.embedding;
    if (model) for (const chunk of toEmbed) {
      const cached = this.store.cached(this.cacheKey(chunk.text));
      if (cached) { embeddings.set(chunk.id, validateVector(cached, model.dimension)); cacheHits++; }
      else misses.push(chunk);
    }
    if (model) for (let i = 0; i < misses.length; i += 64) {
      check(); const batch = misses.slice(i, i + 64); const vectors = await model.embed(batch.map(c => c.text), 'document');
      if (vectors.length !== batch.length) throw new Error('Embedding batch count mismatch');
      batch.forEach((chunk, n) => { embeddings.set(chunk.id, validateVector(vectors[n]!, model.dimension)); cacheMisses++; });
    }
    // Re-read every changed source after asynchronous embeddings before commit.
    for (const file of updates) if ((await this.workspace.read(file.path, this.options.maxFileBytes)).sha256 !== file.fileHash) throw new Error('Source changed during index build');
    const graph = this.options.enableGraph ? buildGraph(all, file => this.registry.language(file), this.frameworks,{resolution:this.options.symbolResolution??'legacy'}) : { nodes: [], edges: [] };
    check();
    this.store.transaction(() => {
      for (const file of deleted) this.store.removeFile(file);
      for (const parsed of updates) this.store.replaceFile(parsed);
      this.store.updateMetadata(retained);
      if (model) for (const chunk of toEmbed) { const vector = embeddings.get(chunk.id)!; this.store.vector!.replace([{ id: chunk.id, vector }]); this.store.cache(this.cacheKey(chunk.text), vector); }
      this.store.replaceGraph(graph.nodes, graph.edges);
      this.store.pruneCache(new Set(all.filter(c => c.retrievable).map(c => this.cacheKey(c.text))));
      const sourceSnapshot=sha256(JSON.stringify([...sources].map(([file, source]) => [file, source.sha256])));
      this.store.setMeta('fingerprint', fingerprint); this.store.setMeta('sourceSnapshot', sourceSnapshot);
      this.store.setMeta('graphSnapshot',this.options.enableGraph?sourceSnapshot:'disabled');
      this.store.setMeta('headersVersion','1');
    });
    this.verified.clear(); // Other files can change framework inheritance facts.
    return { indexedFiles: updates.length, skippedFiles, unchangedFiles, deletedFiles: deleted.length, chunks: all.length, cacheHits, cacheMisses,
      diskReads: files.length + updates.length, buildMs: performance.now() - started, invalidated,
      reason: force ? 'explicit rebuild' : invalidated ? 'parser/model/config/Git identity changed' : 'content hash scan', frameworks: this.frameworks.map(f => f.id), diagnostics };
  }
  async fresh(chunk: CodeChunk): Promise<CodeChunk> {
    const current = await this.workspace.read(chunk.path, this.options.maxFileBytes);
    if (current.sha256 !== chunk.fileHash || containsSecret(current.text) || sha256(chunk.text) !== chunk.chunkHash) throw new Error('Stale or invalid indexed chunk');
    const key = chunk.path + ':' + current.sha256 + ':' + this.registry.fingerprint();
    let parsed = this.verified.get(key);
    if (!parsed) {
      parsed = await this.registry.language(chunk.path).parse(chunk.path, current.text, current.sha256);
      for (const framework of this.frameworks) { const enrichment = framework.enrich(parsed); for (const c of parsed.chunks) if (enrichment.metadata[c.id]) c.metadata = { ...c.metadata, ...enrichment.metadata[c.id] }; }
      this.verified.set(key, parsed); if (this.verified.size > 64) this.verified.delete(this.verified.keys().next().value!);
    }
    const verified = parsed.chunks.find(candidate => candidate.id === chunk.id);
    if (!verified || verified.chunkHash !== chunk.chunkHash || verified.startLine !== chunk.startLine || verified.endLine !== chunk.endLine) throw new Error('Indexed chunk does not match current AST');
    return structuredClone(verified);
  }
}
