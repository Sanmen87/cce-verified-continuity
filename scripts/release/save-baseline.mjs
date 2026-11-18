// Preserve experimental identities before changing release metadata or source.
import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, write } from './common.mjs';
const root = path.resolve('.bench/release-hardening/baseline-' + new Date().toISOString().replaceAll(/[:.]/g, '-'));
const files = ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', '.gitignore', 'packages/core/package.json', 'packages/pi-extension/package.json', 'packages/mcp/package.json', 'packages/core/src/config.ts', 'packages/core/src/lifecycle/task-state.ts', 'packages/core/src/lifecycle/current-work.ts', 'tests/action-continuity.test.ts'];
const manifest = {};
for (const file of files) { const bytes = await fs.readFile(file); await fs.mkdir(path.dirname(root + '/' + file), { recursive: true }); await fs.writeFile(root + '/' + file, bytes, { flag: 'wx' }); manifest[file] = hash(bytes); }
await write(root + '/manifest.json', { at: new Date().toISOString(), scope: 'Pre-hardening files; historical benchmark outputs not rewritten', files: manifest });
await write('.bench/release-hardening/baseline.json', { root, manifest });
console.log(JSON.stringify({ status: 'PRESERVED', files: files.length, root }));
