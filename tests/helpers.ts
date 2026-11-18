import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, type TestContext } from 'node:test';
import { run } from '../packages/core/src/process.ts';
const temporaryRoots: string[] = [];
after(async () => {
  for (const root of temporaryRoots) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('cce-test-')) {
      throw new Error('Refusing cleanup outside generated test directory');
    }
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
export async function fixture(_t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cce-test-'));
  temporaryRoots.push(root);
  await run('git', ['init', '--quiet'], root);
  await mkdir(path.join(root, 'crm', 'migrations'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), '.context-engine/\nignored.py\n');
  await writeFile(path.join(root, 'crm', 'models.py'), 'class Deal:\n    status = "new"\n    amount = 10\n\nclass Contact:\n    pass\n');
  await writeFile(path.join(root, 'crm', 'migrations', '0001.py'), 'class DealMigration: pass\n');
  await writeFile(path.join(root, 'ignored.py'), 'class DealIgnored: pass\n');
  await writeFile(path.join(root, '.env'), 'TOKEN=DealSecret\n');
  await writeFile(path.join(root, 'secrets.json'), '{"key":"DealSecret"}');
  await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 68, 101, 97, 108]));
  return root;
}
export async function commit(root: string, message = 'fixture'): Promise<void> {
  await run('git', ['add', '.'], root);
  await run('git', ['-c', 'user.name=CCE Test', '-c', 'user.email=cce@example.invalid',
    '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', message], root);
}
