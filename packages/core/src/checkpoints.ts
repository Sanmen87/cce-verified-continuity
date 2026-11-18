import { boundedString, integer, object } from './config.ts';
import type { Checkpoint, CheckpointInput, FileEvidence } from './types.ts';
function list(value: unknown, max = 100): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid checkpoint list');
  return value;
}
export function validateCheckpointInput(value: unknown): CheckpointInput {
  const v = object(value);
  return {
    taskId: boundedString(v.taskId, 128), goal: boundedString(v.goal, 8192),
    completed: list(v.completed).map(item => {
      const c = object(item);
      const evidence: FileEvidence[] = list(c.evidence, 20).map(item => {
        const e = object(item);
        if (e.type !== 'file' || typeof e.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.sha256)) throw new Error('Invalid file evidence');
        return { type: 'file', path: boundedString(e.path, 1024), sha256: e.sha256 };
      });
      if (!evidence.length) throw new Error('Completed step requires verified file evidence');
      return { description: boundedString(c.description, 2048), evidence };
    }),
    pending: list(v.pending).map(p => boundedString(p, 2048)),
    testResults: list(v.testResults).map(item => {
      const t = object(item);
      return { command: boundedString(t.command, 1024), exitCode: t.exitCode === null ? null : integer(t.exitCode, -255, 255),
        summary: boundedString(t.summary, 4096) };
    }),
  };
}
export function validateCheckpoint(value: unknown): Checkpoint {
  const v = object(value);
  const input = validateCheckpointInput(v);
  if (v.schemaVersion !== 1) throw new Error('Unsupported checkpoint schema');
  const git = object(v.git);
  if (typeof git.available !== 'boolean' || typeof git.worktreeDirty !== 'boolean' ||
    (git.head !== null && (typeof git.head !== 'string' || !/^[a-f0-9]{40,64}$/.test(git.head))) ||
    typeof git.statusSha256 !== 'string' || typeof git.diffSha256 !== 'string') throw new Error('Invalid Git state');
  const fileHashes: Record<string, string> = {};
  for (const [p, h] of Object.entries(object(v.fileHashes))) {
    if (typeof h !== 'string' || !/^[a-f0-9]{64}$/.test(h)) throw new Error('Invalid file hash');
    Object.defineProperty(fileHashes, boundedString(p, 1024), { value: h, enumerable: true });
  }
  const savedAt = boundedString(v.savedAt, 40);
  if (!Number.isFinite(Date.parse(savedAt))) throw new Error('Invalid checkpoint timestamp');
  return { ...input, schemaVersion: 1, projectId: boundedString(v.projectId, 64), sessionId: boundedString(v.sessionId, 256),
    changedFiles: list(v.changedFiles, 20000).map(p => boundedString(p, 1024)), fileHashes,
    git: { available: git.available, head: git.head as string | null, worktreeDirty: git.worktreeDirty,
      statusSha256: git.statusSha256, diffSha256: git.diffSha256 }, savedAt };
}
