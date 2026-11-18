import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { after } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../packages/core/src/process.ts';
const roots: string[] = [];
after(async () => { for (const root of roots) {
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('cce-native-')) throw new Error('Unsafe test cleanup');
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
} });
export async function nativeFixture(kind: 'django' | 'typescript' | 'generic-python'): Promise<string> {
  const root = await mkdtemp(path.join(path.resolve(tmpdir()), 'cce-native-')); roots.push(root);
  await cp(fileURLToPath(new URL(`./fixtures/native/${kind}/`, import.meta.url)), root, { recursive: true });
  await writeFile(path.join(root, '.gitignore'), '.context-engine/\n');
  await run('git', ['init', '--quiet'], root); return root;
}
