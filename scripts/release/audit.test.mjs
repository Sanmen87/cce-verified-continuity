import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanText, forbiddenPath, scanTree } from './audit.mjs';

test('release scanner rejects credentials and private artifacts without returning matched values', () => {
 const value = 'sk-' + 'a'.repeat(48); assert.ok(scanText(value).includes('openai-token')); assert.ok(!JSON.stringify(scanText(value)).includes(value));
 assert.ok(scanText('npm_' + 'a'.repeat(40)).includes('npm-token'));
 assert.ok(scanText('D:' + String.fromCharCode(92) + 'projects' + String.fromCharCode(92) + 'Private' + String.fromCharCode(92)).includes('private-profile-path'));
 for (const file of ['benchmark/run.json', 'benchmarks/run.json', 'a/.env', 'a/private-oracle.py', 'raw.response.sse', '.context-engine/ledger.db']) assert.equal(forbiddenPath(file), true);
 for (const file of ['README.md', 'dist/src/index.js', 'NOTICE', 'assets/grammar.wasm']) assert.equal(forbiddenPath(file), false);
});
test('release tree scanner rejects linked material before reading through it', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cce-release-audit-'));
 try { await fs.writeFile(root + '/source.txt', 'ordinary'); await fs.link(root + '/source.txt', root + '/alias.txt'); await assert.rejects(scanTree(root), /Linked/); }
 finally { const real = await fs.realpath(root); assert.equal(path.dirname(real), await fs.realpath(os.tmpdir())); assert.ok(path.basename(real).startsWith('cce-release-audit-')); await fs.rm(real, { recursive: true }); }
});
