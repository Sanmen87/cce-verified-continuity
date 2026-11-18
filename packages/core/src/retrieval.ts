import path from 'node:path';
import type { CceConfig } from './config.ts';
import { boundedString } from './config.ts';
import { run } from './process.ts';
import { safeName, Workspace } from './workspace.ts';
import type { RetrievalHit, SearchResult } from './types.ts';
import { SourceNotFound, suggestPaths } from './path-hints.ts';
const excludes = ['.git', '.context-engine', '.pi', '.aws', '.ssh', '.agents', '.codex', '.venv',
  'venv', 'node_modules', 'staticfiles', '__pycache__', 'dist'];
export class Retrieval {
  private workspace: Workspace;
  private config: CceConfig;
  constructor(workspace: Workspace, config: CceConfig) { this.workspace = workspace; this.config = config; }
  private args(migrations: boolean): string[] {
    const globs = [...excludes.map(p => `!**/${p}/**`), '!**/.env*', '!**/*.pem', '!**/*.key',
      '!**/credentials*', '!**/secret*', ...this.config.retrieval.exclude.map(g => `!${g}`)];
    if (!migrations) globs.push('!**/migrations/**');
    return ['--hidden', '--no-require-git', '--glob', '!.git', ...globs.flatMap(g => ['--glob', g])];
  }
  async files(migrations = this.config.retrieval.includeMigrationsByDefault): Promise<string[]> {
    const result = await run('rg', ['--files', '--null', ...this.args(migrations), '--', '.'], this.workspace.root, [0, 1]);
    const names = result.split('\0').filter(Boolean).map(p => p.replaceAll('\\', '/').replace(/^\.\//, '')).filter(safeName).sort();
    if (names.length > 20000) throw new Error('File inventory limit exceeded');
    return names;
  }
  async searchCode(query: string, options: { path?: string; includeMigrations?: boolean } = {}): Promise<SearchResult> {
    boundedString(query, 256);
    if (/[\r\n]/.test(query)) throw new Error('Search query must be a single literal line');
    const migrations = options.includeMigrations ?? this.config.retrieval.includeMigrationsByDefault;
    const files = await this.files(migrations);
    const fileSet = new Set(files);
    let exactPath: string | undefined;
    if (options.path !== undefined) {
      exactPath = this.workspace.normalize(options.path);
      try { await this.workspace.resolve(exactPath); }
      catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw new SourceNotFound(await suggestPaths(this.workspace, files, exactPath));
        }
        throw error;
      }
      if (!fileSet.has(exactPath)) throw new Error('Source path is ignored or excluded');
    }
    const output = await run('rg', ['--json', '--fixed-strings', '--max-count', '20', '--max-columns', '1000',
      '--max-filesize', String(this.config.retrieval.maxFileBytes), ...this.args(migrations), '-e', query, '--',
      exactPath ?? '.'], this.workspace.root, [0, 1]);
    const matches = new Map<string, Set<number>>();
    for (const row of output.split('\n')) {
      if (!row) continue;
      const event = JSON.parse(row) as { type: string; data: { path?: { text?: string }; line_number?: number } };
      if (event.type !== 'match' || !event.data.path?.text || !event.data.line_number) continue;
      const p = event.data.path.text.replaceAll('\\', '/').replace(/^\.\//, '');
      if (!fileSet.has(p)) continue;
      const lines = matches.get(p) ?? new Set<number>();
      lines.add(event.data.line_number); matches.set(p, lines);
    }
    const filenameMatch = (p: string): boolean => p.toLowerCase().includes(query.toLowerCase());
    const candidates = [...new Set([...matches.keys(), ...files.filter(filenameMatch)])]
      .filter(p => !exactPath || p === exactPath).sort();
    if (candidates.length > 2000) throw new Error('Query too broad; use a symbol or exact filename');
    const hits: RetrievalHit[] = [];
    let truncated = false;
    for (const p of candidates) {
      try {
        const source = await this.workspace.read(p, this.config.retrieval.maxFileBytes);
        const lines = source.text.split(/\r?\n/);
        // Recompute from current disk, never trust rg's transient excerpts/line positions.
        const definition = /^[A-Za-z_$][\w$]*$/.test(query) ? new RegExp('^\\s*(?:(?:export|default|async|abstract|declare)\\s+)*(?:class|def|function|interface|type|enum|const|let|var)\\s+' + query.replaceAll('$', '\\$') + '(?![\\w$])') : null;
        const declarationIndex = definition ? lines.findIndex(l => definition.test(l)) : -1;
        const index = declarationIndex >= 0 ? declarationIndex : lines.findIndex(l => l.includes(query));
        if (index < 0 && !filenameMatch(p)) continue;
        const startLine = Math.max(1, (index < 0 ? 0 : index) - 2 + 1);
        const endLine = Math.min(lines.length, (index < 0 ? 0 : index) + 3);
        const excerpt = lines.slice(startLine - 1, endLine).join('\n');
        if (Buffer.byteLength(excerpt) > 4000) { truncated = true; continue; }
        const symbol = index >= 0 && lines[index]!.split(/[^\p{L}\p{N}_$]+/u).includes(query);
        const basename = path.posix.basename(p);
        const score = p === query ? 900 : basename === query ? 850 :
          basename.replace(/\.[^.]+$/, '').toLowerCase() === query.toLowerCase() ? 800 :
          declarationIndex >= 0 ? 700 : symbol ? 300 : filenameMatch(p) ? 200 : 100;
        hits.push({ path: p, startLine, endLine, excerpt, sha256: source.sha256, score,
          reason: score >= 800 ? 'exact path/name' : declarationIndex >= 0 ? 'definition' : symbol ? 'exact identifier' : filenameMatch(p) ? 'filename substring' : 'literal text' });
      } catch { /* Unreadable, binary, symlinked, deleted or racing files are excluded. */ }
    }
    hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.startLine - b.startLine);
    const bounded: RetrievalHit[] = []; let bytes = 0;
    for (const hit of hits) {
      const size = Buffer.byteLength(JSON.stringify(hit));
      if (bounded.length >= Math.min(this.config.retrieval.topK, this.config.retrieval.maxSearchResults) || bytes + size > 32000) { truncated = true; continue; }
      bounded.push(hit); bytes += size;
    }
    return { hits: bounded, truncated, source: 'ripgrep+disk' };
  }
}
