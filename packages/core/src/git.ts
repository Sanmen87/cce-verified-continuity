import { realpath } from 'node:fs/promises';
import { run } from './process.ts';
import { sha256, type Workspace } from './workspace.ts';
import type { GitState } from './types.ts';
export async function gitSnapshot(workspace: Workspace, stateDir: string): Promise<{ git: GitState; changedFiles: string[] }> {
  const empty: GitState = { available: false, head: null, worktreeDirty: false, statusSha256: '', diffSha256: '' };
  // Only this explicitly selected workspace is trusted; never change global Git config.
  const git = (args: string[]) => run('git', ['-c', `safe.directory=${workspace.root}`,
    '-c', 'core.fsmonitor=false', ...args], workspace.root);
  try {
    const top = (await git(['rev-parse', '--show-toplevel'])).trim();
    if (await realpath(top) !== workspace.root) return { git: empty, changedFiles: [] };
    let head: string | null = null;
    try { head = (await git(['rev-parse', '--verify', 'HEAD'])).trim(); } catch { /* Unborn branch */ }
    const paths = ['--', '.', `:(exclude)${stateDir}/**`];
    const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', ...paths]);
    const unstaged = await git(['diff', '--no-ext-diff', '--no-textconv', '--binary', ...paths]);
    const staged = await git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary', ...paths]);
    const entries = status.split('\0').filter(Boolean);
    const changedFiles: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      changedFiles.push(entry.slice(3).replaceAll('\\', '/'));
      if (entry.slice(0, 2).includes('R') || entry.slice(0, 2).includes('C')) i++;
    }
    return { git: { available: true, head, worktreeDirty: status.length > 0,
      statusSha256: sha256(status), diffSha256: sha256(unstaged + '\0' + staged) }, changedFiles: changedFiles.sort() };
  } catch {
    return { git: empty, changedFiles: [] };
  }
}
