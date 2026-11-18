import { parseConfig, boundedString } from './config.ts';
import { Workspace } from './workspace.ts';
import { Retrieval } from './retrieval.ts';
import { buildContext } from './context.ts';
import { SqliteStorage } from './storage.ts';
import { gitSnapshot } from './git.ts';
import { validateCheckpointInput } from './checkpoints.ts';
import {checkpointPath,CheckpointError} from './checkpoint-path.ts';
import type { Checkpoint, CheckpointInput, ContextRequest, LoadedCheckpoint } from './types.ts';
import type { RetrievalProvider } from './native/contracts.ts';
import type { HybridNativeProvider, NativeDependencies } from './native/provider.ts';
import type { NativeIndexResult } from './native/indexer.ts';
import { QualityContextService } from './quality/service.ts';
import type { ApprovedCheck,ExplicitTaskContract } from './quality/contracts.ts';
import { ContextLifecycle } from './lifecycle/service.ts';
export * from './types.ts';
export { parseConfig, defaults } from './config.ts';
export { estimateTokens } from './context.ts';
export { sha256, Workspace } from './workspace.ts';
export {CheckpointError} from './checkpoint-path.ts';
export type * from './native/contracts.ts';
export type * from './quality/contracts.ts';
export { ContextQualityGuard } from './quality/guard.ts';
export { TaskCoverageTracker,VerificationFeedback } from './quality/tracker.ts';
export { AdapterRegistry, TextLanguageAdapter } from './native/registry.ts';
export { ContextLedger } from './lifecycle/ledger.ts';
export { ContextProjection } from './lifecycle/projection.ts';
export { compileHandoff } from './lifecycle/compiler.ts';
export type * from './lifecycle/contracts.ts';
export type {ContinuationHandle} from './lifecycle/continuation.ts';
export class ContextEngine {
  readonly workspace: Workspace;
  readonly config: ReturnType<typeof parseConfig>;
  readonly sessionId: string;
  private retrieval: RetrievalProvider;
  readonly native: HybridNativeProvider | undefined;
  readonly quality: QualityContextService | undefined;
  lifecycle:ContextLifecycle|undefined;
  private storage: SqliteStorage;
  private constructor(workspace: Workspace, config: ReturnType<typeof parseConfig>, storage: SqliteStorage, sessionId: string, retrieval: RetrievalProvider, native?: HybridNativeProvider, taskContract?: ExplicitTaskContract, checks?: ApprovedCheck[]) {
    this.workspace = workspace; this.config = config; this.storage = storage; this.sessionId = sessionId;
    this.retrieval = retrieval; this.native = native;
    this.quality=config.quality.guardEnabled||config.quality.coverageEnabled?new QualityContextService(this,taskContract,checks):undefined;
    if(native)native.requiredDefinitions=()=>this.quality?.tracker?.contract.requirements.flatMap(r=>r.needs.flatMap(n=>n.kind==='definition'&&n.representation==='full'&&n.symbol?[{symbol:n.symbol,...(n.path?{path:n.path}:{})}]:[]))??[];
  }
  static async open(root: string, options: { config?: unknown; sessionId?: string; native?: NativeDependencies; taskContract?: ExplicitTaskContract; verificationChecks?: ApprovedCheck[] } = {}): Promise<ContextEngine> {
    const config = parseConfig(options.config);
    const workspace = await Workspace.create(root);
    const session = boundedString(options.sessionId ?? 'cli', 256);
    const storage = await SqliteStorage.open(workspace, config.storage.stateDir);
    const inventory = new Retrieval(workspace, config);
    let native:HybridNativeProvider|undefined;
    try {
      native = config.retrieval.backend === 'hybrid-native' ? await import('./native/provider.ts').then(module => module.HybridNativeProvider.open(workspace, config, inventory, options.native)) : undefined;
      const engine=new ContextEngine(workspace, config, storage, session, native ?? inventory, native, options.taskContract, options.verificationChecks);
      if(config.enabled&&config.lifecycle.enabled)engine.lifecycle=await ContextLifecycle.open(engine);
      return engine;
    } catch (error) { native?.close(); storage.close(); throw error; }
  }
  searchCode(query: string, options: { path?: string; includeMigrations?: boolean } = {}) {
    return this.retrieval.searchCode(query, options);
  }
  async sourceFiles(includeMigrations=true):Promise<string[]> {return this.retrieval.files(includeMigrations);}
  async buildContext(request: ContextRequest) {
    const contract=this.quality?.tracker?.contract,requiredChunkIds:string[]=[];
    if(this.native&&this.config.quality.packing==='quality-aware'&&contract)for(const h of request.hits){
      const c=h.chunkId?this.native.store.chunk(h.chunkId):null;
      if(c&&contract.requirements.some(r=>r.needs.some(n=>n.representation==='full'&&n.kind==='definition'&&(!n.path||n.path===c.path)&&n.symbol&&(c.name===n.symbol||c.qualifiedName===n.symbol||c.qualifiedName.endsWith('.'+n.symbol)))))requiredChunkIds.push(c.id);
    }
    const built=await buildContext(this.workspace,this.retrieval,this.config,this.config.quality.packing==='quality-aware'?{...request,requiredChunkIds}:request);
    return this.config.quality.guardEnabled?this.quality!.auditBuilt(built,request.sessionBudgetKnown??false):built;
  }
  async reindex(options: { force?: boolean } = {}): Promise<{ indexedFiles: number; skippedFiles: number; native?: NativeIndexResult }> {
    const native = this.native ? await this.native.reindex(options.force ?? false) : undefined;
    const files = await this.retrieval.files();
    const manifest = []; let skippedFiles = 0;
    for (const p of files) {
      try { const source = await this.workspace.read(p, this.config.retrieval.maxFileBytes); manifest.push({ path: p, sha256: source.sha256 }); }
      catch { skippedFiles++; }
    }
    this.storage.replaceManifest(this.workspace.projectId, manifest);
    return { indexedFiles: manifest.length, skippedFiles, ...(native ? { native } : {}) };
  }
  getStatus() {
    return { mode: this.config.mode, enabled: this.config.enabled, projectId: this.workspace.projectId,
      sessionId: this.sessionId, indexedFiles: this.storage.manifestCount(this.workspace.projectId),
      retrieval: this.native ? 'hybrid-native' : 'literal-ripgrep', tokenAccounting: 'estimated:utf8-bytes', checkpointSchema: 1,
      ...(this.native ? { native: this.native.status() } : {}) };
  }
  async saveCheckpoint(value: CheckpointInput): Promise<Checkpoint> {
    let input:CheckpointInput;
    try{input=validateCheckpointInput(value);}catch{throw new CheckpointError('INVALID_CHECKPOINT_INPUT','Invalid checkpoint input: completed steps need file evidence with current SHA-256; check required fields and limits.');}
    // Evidence proves the referenced file snapshot exists, not semantic correctness of a claim.
    const fileHashes: Record<string, string> = Object.create(null) as Record<string, string>;
    const allowed = new Set(await this.retrieval.files(true));
    for (const step of input.completed) for (const evidence of step.evidence) {
      const p = await checkpointPath(this.workspace,evidence.path,allowed);
      evidence.path=p;
      const source = await this.workspace.read(p, this.config.retrieval.maxFileBytes);
      if (source.sha256 !== evidence.sha256) throw new CheckpointError('STALE_FILE_HASH','Stale checkpoint evidence: read the current file and supply its SHA-256 before saving.');
      fileHashes[p] = source.sha256;
    }
    const snapshot = await gitSnapshot(this.workspace, this.config.storage.stateDir);
    for (const p of snapshot.changedFiles) {
      if (!allowed.has(p)) continue;
      try { fileHashes[p] = (await this.workspace.read(p, this.config.retrieval.maxFileBytes)).sha256; } catch { /* Deleted or binary */ }
    }
    const checkpoint: Checkpoint = { ...input, schemaVersion: 1, projectId: this.workspace.projectId,
      sessionId: this.sessionId, fileHashes, ...snapshot, savedAt: new Date().toISOString() };
    this.storage.save(checkpoint);
    return checkpoint;
  }
  async loadCheckpoint(taskId: string): Promise<LoadedCheckpoint | null> {
    boundedString(taskId, 128);
    const checkpoint = this.storage.load(this.workspace.projectId, this.sessionId, taskId);
    if (!checkpoint) return null;
    if (checkpoint.projectId !== this.workspace.projectId || checkpoint.sessionId !== this.sessionId || checkpoint.taskId !== taskId) {
      throw new Error('Checkpoint binding mismatch');
    }
    const current = await gitSnapshot(this.workspace, this.config.storage.stateDir);
    const warnings: string[] = [];
    if (!current.git.available || !checkpoint.git.available) warnings.push('Git state unavailable; revalidate project');
    if (JSON.stringify(current.git) !== JSON.stringify(checkpoint.git)) warnings.push('Git HEAD or worktree changed; revalidate before continuing');
    const allowed = new Set(await this.retrieval.files(true));
    for (const [p, hash] of Object.entries(checkpoint.fileHashes)) {
      try {
        if (!allowed.has(p)) throw new Error('Ignored path');
        if ((await this.workspace.read(p, this.config.retrieval.maxFileBytes)).sha256 !== hash) warnings.push(`File changed: ${p}`);
      } catch { warnings.push(`File unavailable: ${p}`); }
    }
    return { checkpoint, warnings, requiresRevalidation: warnings.length > 0, trusted: false };
  }
  recordMetric(name: string, value: number, source: 'measured' | 'estimated'): void {
    if (this.config.telemetry.enabled) this.storage.metric(this.workspace.projectId, this.sessionId, name, value, source);
  }
  close(): void { try { this.lifecycle?.close(); } finally { try { this.native?.close(); } finally { this.storage.close(); } } }
}
