import path from 'node:path';
import { safeName, type Workspace } from './workspace.ts';
export class SourceNotFound extends Error {
  readonly suggestions: string[];
  constructor(suggestions: string[]) { super('Source path not found'); this.suggestions = suggestions; }
}
export async function suggestPaths(workspace: Workspace, files: string[], input: string): Promise<string[]> {
  const relative = workspace.normalize(input);
  if (!safeName(relative)) return [];
  const name = path.posix.basename(relative).toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');
  const matches = files.filter(p => safeName(p) && (p.toLowerCase().startsWith(relative.toLowerCase() + '.') ||
    path.posix.basename(p).toLowerCase() === name || path.posix.basename(p).toLowerCase().replace(/\.[^.]+$/, '') === stem))
    .sort((a, b) => Number(b.toLowerCase().startsWith(relative.toLowerCase() + '.')) - Number(a.toLowerCase().startsWith(relative.toLowerCase() + '.')) || a.localeCompare(b));
  const suggestions: string[] = [];
  for (const candidate of matches.slice(0, 20)) {
    try { await workspace.read(candidate, 2097152); suggestions.push(candidate); } catch { /* no unavailable, binary or symlink hints */ }
    if (suggestions.length === 5) break;
  }
  return suggestions;
}
