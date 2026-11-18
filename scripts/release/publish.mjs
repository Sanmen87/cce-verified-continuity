import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { read, npm, hash } from './common.mjs';
assert.equal(process.env.CCE_CONFIRM_PUBLICATION, 'alpha-reviewed', 'Publishing is opt-in and requires review');
await import('./publish-gate.mjs');
const release = await read('release-artifacts/latest.json');
for (const pkg of release.packages) {
 assert.equal(hash(await fs.readFile(pkg.tarball)), pkg.sha256, 'Archive changed after review');
 await npm(['publish', path.resolve(pkg.tarball), '--tag', 'alpha', '--access', 'public', '--ignore-scripts']);
 console.log('Published ' + pkg.name + '@' + pkg.version);
}
