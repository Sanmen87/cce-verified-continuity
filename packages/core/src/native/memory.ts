import { boundedString } from '../config.ts';
import { gitSnapshot } from '../git.ts';
import { sha256, type Workspace } from '../workspace.ts';
import type { MemoryRecord, MemoryRepository, RecalledMemory, SourceEvidence } from './contracts.ts';
import type { NativeStore } from './store.ts';
import { assertNoSecrets } from './secrets.ts';
import { bm25 } from './ranking.ts';
/** Project-scoped untrusted decision records; task checkpoints remain separate. */
export class ProjectMemory implements MemoryRepository {
  private workspace: Workspace; private store: NativeStore; private stateDir: string;
  private allowed: () => Promise<ReadonlySet<string>>;
  constructor(workspace: Workspace, store: NativeStore, stateDir: string, allowed: () => Promise<ReadonlySet<string>>) {
    this.workspace = workspace; this.store = store; this.stateDir = stateDir; this.allowed = allowed;
  }
  private async evidence(input: SourceEvidence[]): Promise<SourceEvidence[]> {
    if (!Array.isArray(input) || input.length > 20) throw new Error('Invalid memory evidence');
    const eligible = await this.allowed(); const result: SourceEvidence[] = [];
    for (const item of input) {
      const file = this.workspace.normalize(item.path);
      if (!eligible.has(file) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid memory evidence');
      const current = await this.workspace.read(file, 2097152); assertNoSecrets(current.text);
      if (current.sha256 !== item.sha256) throw new Error('Stale memory evidence');
      result.push({ path: file, sha256: current.sha256 });
    }
    return result;
  }
  async propose(input: { kind: MemoryRecord['kind']; text: string; evidence: SourceEvidence[] }): Promise<MemoryRecord> {
    const text = boundedString(input.text, 8192); assertNoSecrets(text);
    if (!['decision', 'code-area'].includes(input.kind)) throw new Error('Invalid memory kind');
    const evidence = await this.evidence(input.evidence);
    const id = sha256(JSON.stringify([this.workspace.projectId, input.kind, text]));
    const records = this.store.memories(this.workspace.projectId);
    const existing = records.find(record => record.id === id);
    if (existing?.status === 'confirmed') return existing; // Agent cannot rewrite a user decision.
    if (records.length >= 5000 && !existing) throw new Error('Project memory limit exceeded');
    const snapshot = await gitSnapshot(this.workspace, this.stateDir);
    const record: MemoryRecord = { id, projectId: this.workspace.projectId, kind: input.kind, text, status: 'proposed', authority: 'agent', evidence,
      gitHead: snapshot.git.head, gitFingerprint: sha256(JSON.stringify(snapshot.git)), createdAt: new Date().toISOString() };
    this.store.saveMemory(record); return record;
  }
  async confirm(id: string, authority: 'user'): Promise<MemoryRecord> {
    if (authority !== 'user') throw new Error('Only an explicit user action can confirm memory');
    const record = this.store.memories(this.workspace.projectId).find(row => row.id === id);
    if (!record) throw new Error('Memory record not found');
    await this.evidence(record.evidence);
    const snapshot = await gitSnapshot(this.workspace, this.stateDir);
    if (sha256(JSON.stringify(snapshot.git)) !== record.gitFingerprint) throw new Error('Git state changed; re-propose and review memory');
    const confirmed: MemoryRecord = { ...record, status: 'confirmed', authority: 'user' }; this.store.saveMemory(confirmed); return confirmed;
  }
  async recall(query: string, options: { includeProposed?: boolean } = {}): Promise<RecalledMemory[]> {
    boundedString(query, 256); assertNoSecrets(query);
    const records = this.store.memories(this.workspace.projectId).filter(record => options.includeProposed || record.status === 'confirmed');
    const ranked = bm25(new Map(records.map(record => [record.id, record.text])), query).slice(0, 20);
    const snapshot = await gitSnapshot(this.workspace, this.stateDir); const fingerprint = sha256(JSON.stringify(snapshot.git));
    const result: RecalledMemory[] = [];
    for (const match of ranked) {
      const record = records.find(row => row.id === match.id)!; const warnings: string[] = [];
      if (record.projectId !== this.workspace.projectId || !['proposed', 'confirmed'].includes(record.status) || (record.status === 'confirmed' && record.authority !== 'user')) throw new Error('Invalid project memory binding/provenance');
      assertNoSecrets(record.text);
      if (record.gitFingerprint !== fingerprint) warnings.push('Git HEAD or worktree changed');
      if (!snapshot.git.available) warnings.push('Git state unavailable');
      try { await this.evidence(record.evidence); } catch { warnings.push('Source evidence changed or is unavailable'); }
      result.push({ record, stale: warnings.length > 0, warnings, trusted: false });
    }
    return result;
  }
}
