import fs from 'node:fs/promises';
import path from 'node:path';
import { npm, read, write, walk, hash } from './common.mjs';
import { scanTree, forbiddenPath } from './audit.mjs';
const config = await read('release/config.json'), root = await read('package.json');
const distTag=config.distTag??'alpha';if(!['alpha','latest'].includes(distTag))throw Error('Unsupported reviewed distribution tag');
const scope = process.env.CCE_RELEASE_SCOPE ?? config.scope;
if (!/^@[a-z0-9][a-z0-9-]*$/.test(scope)) throw Error('Invalid npm scope');
const repository = process.env.CCE_RELEASE_REPOSITORY ?? config.repository;
if (repository && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw Error('Use a credential-free HTTPS GitHub repository URL');
if (root.version !== config.version || root.license !== 'Apache-2.0') throw Error('Release metadata/license mismatch');
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-'), output = 'release-artifacts/run-' + stamp, staging = '.release/npm-' + stamp;
await fs.mkdir(output, { recursive: true }); await fs.mkdir(staging, { recursive: true });
const internal = new Set();
function rewrite(source) {
 return source.replace(/(['"])\.\.\/\.\.\/core\/src\/([^'"]+)\.(?:js|ts)\1/g, (_all, quote, module) => {
  if (module !== 'index') internal.add(module);
  return quote + scope + '/core' + (module === 'index' ? '' : '/internal/' + module) + quote;
 }).replace(/((?:from\s*|import\s*\(\s*)['"])(\.[^'"]+)\.ts(['"])/g, '$1$2.js$3').replace(/^\/\/# sourceMappingURL=.*$/gm, '');
}
for (const name of ['core', 'pi-extension', 'mcp']) {
 const directory = staging + '/' + name; await fs.mkdir(directory);
 for (const file of await walk('dist/packages/' + name)) {
  if (file.endsWith('.map')) continue;
  const target = directory + '/dist/' + file; await fs.mkdir(path.dirname(target), { recursive: true });
  const data = await fs.readFile('dist/packages/' + name + '/' + file);
  await fs.writeFile(target, /\.(?:js|ts)$/.test(file) ? rewrite(data.toString('utf8')) : data);
 }
 for (const file of ['LICENSE', 'NOTICE', 'QUICKSTART.md']) await fs.copyFile(file, directory + '/' + file);
 let russianReadme = await fs.readFile('README.RU.md', 'utf8');
 if (repository) russianReadme = russianReadme.replace(/\]\((?!https?:|#)([^)]+)\)/g, '](' + repository + '/blob/main/$1)');
 await fs.writeFile(directory + '/README.RU.md', russianReadme);
 const notices = (await fs.readFile('THIRD_PARTY_NOTICES.md', 'utf8')).split('\n\nDjangoCRM')[0].trimEnd();
 await fs.writeFile(directory + '/THIRD_PARTY_NOTICES.md', notices + '\n');
 await fs.copyFile('release/readmes/' + name + '.md', directory + '/README.md');
 await fs.appendFile(directory + '/README.md', '\n[Русский](README.RU.md)\n');
}
const grammarRoot = staging + '/core/dist/assets/grammars';
for (const grammar of (await read(grammarRoot + '/manifest.json')).grammars) {
 if (hash(await fs.readFile(grammarRoot + '/' + grammar.file)) !== grammar.sha256) throw Error('Unverified grammar asset');
}
const packages = [];
for (const name of ['core', 'pi-extension', 'mcp']) {
 const original = await read('packages/' + name + '/package.json'), directory = staging + '/' + name;
 const exports = { '.': { types: './dist/src/index.d.ts', import: './dist/src/index.js' } };
 if (name === 'core') for (const module of [...internal].sort()) exports['./internal/' + module] = { types: './dist/src/' + module + '.d.ts', import: './dist/src/' + module + '.js' };
 const manifest = { name: scope + '/' + name, version: config.version, type: 'module', license: 'Apache-2.0', description: 'Code Context Engine ' + name + ' — local verified context, experimental alpha',
  engines: { node: config.node }, main: './dist/src/index.js', types: './dist/src/index.d.ts', exports,
  files: ['dist/', 'README.md', 'README.RU.md', 'QUICKSTART.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'],
  publishConfig: { access: 'public', tag: distTag }, ...(repository ? { repository: { type: 'git', url: repository + '.git', directory: 'packages/' + name } } : {}),
  ...(original.dependencies ? { dependencies: original.dependencies } : {}),
  ...(name !== 'core' ? { dependencies: { ...original.dependencies, [scope + '/core']: config.version } } : {}),
  ...(name === 'pi-extension' ? { keywords: ['pi-package', 'context', 'local-llm'], pi: { extensions: ['./dist/src/index.js'] }, peerDependencies: original.peerDependencies, peerDependenciesMeta: original.peerDependenciesMeta } : {}),
  ...(name !== 'pi-extension' ? { bin: { [name === 'core' ? 'cce' : 'cce-mcp']: './dist/src/cli.js' } } : {}) };
 await write(directory + '/package.json', manifest);
 if (manifest.bin) { const cli = directory + '/dist/src/cli.js'; await fs.writeFile(cli, '#!/usr/bin/env node\n' + await fs.readFile(cli, 'utf8')); await fs.chmod(cli, 0o755); }
 const scan = await scanTree(directory); if (scan.status !== 'PASS') throw Error('Package scan failed: ' + JSON.stringify(scan.findings));
 const dry = JSON.parse((await npm(['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: path.resolve(directory) })).stdout)[0];
 for (const file of dry.files) if (forbiddenPath(file.path) || !/^(?:dist\/|README(?:\.RU)?\.md$|QUICKSTART\.md$|LICENSE$|NOTICE$|THIRD_PARTY_NOTICES\.md$|package\.json$)/.test(file.path)) throw Error('Unexpected npm file: ' + file.path);
 const packed = JSON.parse((await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', path.resolve(output)], { cwd: path.resolve(directory) })).stdout)[0];
 const tarball = output + '/' + packed.filename;
 packages.push({ name: manifest.name, version: manifest.version, tarball, sha256: hash(await fs.readFile(tarball)), manifest, dryRun: dry, packed });
}
const result = { at: new Date().toISOString(), version: config.version, scope, repository, distTag, status: 'PACKED_NOT_PUBLISHED', packages,
 publicPublishingBlockers: [...(config.registryIdentityStatus !== 'CONFIRMED' || scope !== config.scope ? ['Npm scope must match the owner-confirmed release configuration'] : []), ...(!repository ? ['Set CCE_RELEASE_REPOSITORY before provenance/publishing'] : [])],
 api: { public: 'Package root exports and documented ContextEngine API', adapterSupport: [...internal].sort().map(module => './internal/' + module), stability: 'Internal subpaths support bundled adapters; unstable throughout alpha' } };
await write(output + '/manifest.json', result); await write('release-artifacts/latest.json', result);
console.log(JSON.stringify({ status: result.status, packages: packages.map(pkg => ({ name: pkg.name, tarball: pkg.tarball, files: pkg.packed.files.length })), blockers: result.publicPublishingBlockers }));
