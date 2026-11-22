import assert from 'node:assert/strict';

export function validateReviewedArchives(config, packed, clean, environment) {
 assert.equal(config.registryIdentityStatus, 'CONFIRMED', 'Owner must confirm registry identity before public publishing');
 assert.equal(environment.CCE_RELEASE_TAG, 'v' + config.version, 'Only matching reviewed alpha tags');
 assert.match(config.version, /^0\.\d+\.\d+-alpha\.\d+$/);
 assert.equal(packed.version, config.version);
 assert.equal(packed.scope, config.scope, 'Archive scope must match the reviewed configuration');
 assert.equal(environment.CCE_RELEASE_SCOPE, config.scope);
 assert.ok(config.repository, 'Owner must confirm the public repository');
 assert.equal(packed.repository, config.repository);
 const distTag=config.distTag??'alpha';assert.ok(['alpha','latest'].includes(distTag),'Unsupported reviewed distribution tag');assert.equal(packed.distTag??'alpha',distTag,'Archive channel must match reviewed configuration');
 assert.equal(environment.CCE_RELEASE_REPOSITORY, config.repository);
 assert.equal(clean.status, 'PASS');
 assert.deepEqual(clean.packages, packed.packages.map(({ name, sha256 }) => ({ name, sha256 })), 'Clean installation must cover these exact archives');
 assert.deepEqual(packed.packages.map(pkg => pkg.name).sort(), ['core', 'mcp', 'pi-extension'].map(name => config.scope + '/' + name).sort());
 for (const pkg of packed.packages) {
  assert.equal(pkg.version, config.version);
  assert.equal(pkg.manifest.license, 'Apache-2.0');
 }
}

export function validateReviewedTree(tracked, inventory) {
 assert.ok(tracked.length > 0, 'A reviewed public source commit is required');
 const reviewed = new Map(inventory.map(file => [file.file, file.sha256]));
 assert.equal(tracked.length, reviewed.size, 'The public commit must contain the complete reviewed export');
 for (const file of tracked) assert.equal(file.sha256, reviewed.get(file.file), 'Unreviewed source content: ' + file.file);
}
