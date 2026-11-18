import { createHash } from 'node:crypto';
import { lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const forbiddenDirs = new Set(['.git', '.context-engine', '.pi', '.aws', '.ssh', '.codex', '.agents',
  '.venv', 'venv', 'node_modules', 'staticfiles', '__pycache__', 'dist']);
export function safeName(relative: string): boolean {
  const parts = relative.replaceAll('\\', '/').split('/');
  return !parts.some(p => forbiddenDirs.has(p.toLowerCase())) && !parts.some(p =>
    /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)$/i.test(p)) &&
    !/\.(?:pem|key|p12|pfx|sqlite3?|db|zip|exe|dll|png|jpe?g|gif|woff2?|pdf)$/i.test(relative);
}
export class Workspace {
  readonly root: string;
  readonly projectId: string;
  private constructor(root: string) { this.root = root; this.projectId = sha256(root); }
  static async create(root: string): Promise<Workspace> {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new Error('Workspace must be a directory');
    return new Workspace(canonical);
  }
  normalize(input: string): string {
    if (!input || input.includes('\0') || input.includes(':') || path.isAbsolute(input) ||
      path.win32.isAbsolute(input) || input.split(/[\\/]/).some(p => p === '..')) throw new Error('Unsafe path');
    const value = input.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!value || value === '.' || value.split('/').some(p => !p || p === '.')) throw new Error('Unsafe path');
    return value;
  }
  async resolve(input: string, source = true): Promise<string> {
    const relative = this.normalize(input);
    if (source && !safeName(relative)) throw new Error('Excluded source path');
    let current = this.root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink paths are not supported');
    }
    const canonical = await realpath(current);
    const rel = path.relative(this.root, canonical);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path outside workspace');
    return canonical;
  }
  async read(input: string, maxBytes: number): Promise<{ text: string; sha256: string }> {
    const file = await this.resolve(input);
    const handle = await open(file, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxBytes) throw new Error('Source exceeds size/type limit');
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, before.size + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const data = buffer.subarray(0, bytesRead);
      const after = await handle.stat();
      if (bytesRead > maxBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || bytesRead !== before.size || data.includes(0)) throw new Error('Unstable or binary source');
      if (await this.resolve(input) !== file) throw new Error('Source changed during read');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      return { text, sha256: sha256(data) };
    } finally { await handle.close(); }
  }
}
