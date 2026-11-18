// Explicit public-source allowlist. Never copy the existing .git or experimental history.
import fs from 'node:fs/promises';
import path from 'node:path';
import { read, write, walk, hash } from './common.mjs';
import { scanTree } from './audit.mjs';
const directory = 'release-artifacts/source-' + new Date().toISOString().replaceAll(/[:.]/g, '-'); await fs.mkdir(directory, { recursive: true });
const exact = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'LICENSE', 'NOTICE', '.gitignore', '.gitattributes', 'README.RU.md', 'QUICKSTART.md', 'CHANGELOG.md', 'scripts/copy-assets.mjs', 'scripts/pi-smoke.ts'];
const trees = ['packages', 'release', 'scripts/release', '.github/workflows', 'evaluation'];
const files = [...exact];
for (const tree of trees) for (const file of await walk(tree)) files.push(tree + '/' + file);
for (const test of await read('release/public-tests.json')) files.push('tests/' + test);
files.push('tests/helpers.ts', 'tests/native-fixtures.ts');
for (const file of await walk('tests/fixtures/native')) files.push('tests/fixtures/native/' + file);
for (const file of files) {
 if (file.split('/').includes('dist')) continue;
 const destination = directory + '/' + file; await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(file, destination);
}
await fs.copyFile('release/README.md', directory + '/README.md');
const notices = (await fs.readFile('THIRD_PARTY_NOTICES.md', 'utf8')).split('\n\nDjangoCRM')[0].trimEnd(); await fs.writeFile(directory + '/THIRD_PARTY_NOTICES.md', notices + '\n');
for (const file of ['architecture.md', 'limitations.md', 'publishing.md']) { await fs.mkdir(directory + '/docs', { recursive: true }); await fs.copyFile('release/docs/' + file, directory + '/docs/' + file); }
const manifest = await read(directory + '/package.json');
manifest.scripts = Object.fromEntries(Object.entries(manifest.scripts).filter(([name]) => name.startsWith('release:') || ['typecheck', 'build', 'smoke:pi', 'test:public', 'test:release', 'test:evaluation'].includes(name)));
manifest.scripts.test = 'node scripts/release/public-tests.mjs'; await write(directory + '/package.json', manifest);
const scan = await scanTree(directory); if (scan.status !== 'PASS') throw Error('Unsafe public tree: ' + JSON.stringify(scan.findings));
const inventory = [];
for (const file of await walk(directory)) inventory.push({ file, sha256: hash(await fs.readFile(directory + '/' + file)) });
await write('release-artifacts/public-source.json', { directory, status: 'SCANNED_NOT_PUBLISHED', files: inventory, existingGitHistoryCopied: false });
console.log(JSON.stringify({ directory, files: inventory.length, audit: scan.status, gitHistoryCopied: false }));
