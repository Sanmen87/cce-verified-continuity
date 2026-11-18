import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReviewedArchives, validateReviewedTree } from './review.mjs';

test('publication requires confirmed identity and clean installs of the exact reviewed archives', () => {
 const config = { registryIdentityStatus: 'CONFIRMED', scope: '@example', version: '0.1.0-alpha.1', repository: 'https://github.com/example/cce' };
 const packed = { ...config, packages: ['core', 'pi-extension', 'mcp'].map(name => ({ name: '@example/' + name, sha256: name, version: config.version, manifest: { license: 'Apache-2.0' } })) };
 const clean = { status: 'PASS', packages: packed.packages.map(({ name, sha256 }) => ({ name, sha256 })) };
 const env = { CCE_RELEASE_TAG: 'v' + config.version, CCE_RELEASE_SCOPE: config.scope, CCE_RELEASE_REPOSITORY: config.repository };
 validateReviewedArchives(config, packed, clean, env);
 assert.throws(() => validateReviewedArchives({ ...config, registryIdentityStatus: 'UNCONFIRMED' }, packed, clean, env), /confirm registry identity/);
 const stale = structuredClone(clean); stale.packages[0].sha256 = 'old-archive';
 assert.throws(() => validateReviewedArchives(config, packed, stale, env), /exact archives/);
 assert.throws(() => validateReviewedArchives(config, { ...packed, scope: '@other' }, clean, env), /scope/);
 assert.throws(() => validateReviewedArchives(config, packed, clean, { ...env, CCE_RELEASE_TAG: 'v0.1.0' }), /matching reviewed/);
});

test('publication rejects changed, missing or extra source content', () => {
 const inventory = [{ file: 'README.md', sha256: 'reviewed' }];
 validateReviewedTree(inventory, inventory);
 assert.throws(() => validateReviewedTree([{ file: 'README.md', sha256: 'modified' }], inventory), /Unreviewed source/);
 assert.throws(() => validateReviewedTree([], inventory), /reviewed public source commit/);
 assert.throws(() => validateReviewedTree([...inventory, { file: 'private.txt', sha256: 'other' }], inventory), /complete reviewed export/);
});
